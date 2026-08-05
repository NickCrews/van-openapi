#!/usr/bin/env bash
#
# test.sh — exercise crawl.sh against mock_van.py.
#
# Runs entirely offline: no API key, no network, nothing touched in the real
# VAN instance. The mock reproduces the behaviours crawl.sh depends on (the
# at-least-one-search-parameter rule, prefix matching, $top/$skip paging, the
# Retry-After-less 429), so these tests check the *strategy*, not the API.
#
# Usage: ./test.sh          (exits non-zero if any case fails)

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CRAWL="$HERE/crawl.sh"
MOCK="$HERE/mock_van.py"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/van-crawl-test.XXXXXX")"

PASS=0
FAIL=0
MOCK_PID=""

cleanup() { stop_mock; rm -rf "$WORK"; }
trap cleanup EXIT

# ------------------------------------------------------------------ harness ---
ok()   { PASS=$((PASS + 1)); printf '  ok   %s\n' "$*"; }
bad()  { FAIL=$((FAIL + 1)); printf '  FAIL %s\n' "$*"; }

check_eq() { # <what> <expected> <actual>
  if [[ "$2" == "$3" ]]; then
    ok "$1"
  else
    bad "$1"
    printf '       expected: %s\n       actual:   %s\n' "$2" "$3"
  fi
}

start_mock() { # [fail_every]
  local fail_every="${1:-0}"
  rm -f "$WORK/port" "$WORK/requests.log"
  python3 "$MOCK" --port-file "$WORK/port" --log "$WORK/requests.log" \
                  --fail-every "$fail_every" &
  MOCK_PID=$!
  for _ in $(seq 1 100); do
    [[ -s "$WORK/port" ]] && break
    sleep 0.05
  done
  [[ -s "$WORK/port" ]] || { echo "mock server failed to start" >&2; exit 1; }
  local port
  port="$(cat "$WORK/port")"
  export VAN_BASE_URL="http://127.0.0.1:$port"
  export NGP_API_KEY="test-key"
}

stop_mock() {
  [[ -n "$MOCK_PID" ]] || return 0
  kill "$MOCK_PID" 2>/dev/null
  wait "$MOCK_PID" 2>/dev/null
  MOCK_PID=""
}

# vanIds in an output file, comma-joined and sorted — the canonical comparison.
ids_of() { jq -r '.vanId' "$1" 2>/dev/null | sort -n | paste -sd, -; }

seq_ids() { seq "$1" "$2" | paste -sd, -; }

# Expected id sets, derived from mock_van.py's dataset.
ALPHA="$(seq_ids 1001 1012)"     # lastName Alpha01..Alpha12
AN="$(seq_ids 1101 1105)"        # lastName "An" exactly
BETA="$(seq_ids 1201 1204)"      # lastName Beta1..Beta4
BLANK="$(seq_ids 1301 1303)"     # blank lastName, firstName Quinn*
OMEGA="$(seq_ids 1401 1402)"     # lastName Ómega* — outside the alphabet

# ================================================================== cases ===

echo
echo "1. lastName crawl reaches every record with an in-alphabet lastName"
start_mock
"$CRAWL" --fields lastName --top 5 --expand '' --jobs 1 \
         --out "$WORK/a.ndjson" >"$WORK/a.log" 2>&1
check_eq "21 people via lastName (multi-page buckets included)" \
         "$ALPHA,$AN,$BETA" "$(ids_of "$WORK/a.ndjson")"

echo
echo "2. blank and out-of-alphabet lastNames are missed by a lastName-only crawl"
check_eq "blank-lastName records absent"     "" "$(jq -r 'select(.vanId >= 1301 and .vanId <= 1303) | .vanId' "$WORK/a.ndjson" | paste -sd, -)"
check_eq "Ómega records absent"              "" "$(jq -r 'select(.vanId >= 1401) | .vanId' "$WORK/a.ndjson" | paste -sd, -)"

echo
echo "3. the crawl never issues a request without a search parameter"
check_eq "zero 400-triggering requests in the mock log" \
         "0" "$(grep -cE '\?(\$|contactMode)' "$WORK/requests.log" | tr -d ' ')"

echo
echo "4. unioning fields recovers them, and dedupes the overlap"
"$CRAWL" --fields lastName,firstName --top 5 --expand '' --jobs 1 \
         --out "$WORK/b.ndjson" >"$WORK/b.log" 2>&1
check_eq "all 26 people, each exactly once" \
         "$ALPHA,$AN,$BETA,$BLANK,$OMEGA" "$(ids_of "$WORK/b.ndjson")"
check_eq "no duplicate lines despite two passes over the same people" \
         "26" "$(wc -l < "$WORK/b.ndjson" | tr -d ' ')"

echo
echo "5. concurrency does not change the result"
"$CRAWL" --fields lastName,firstName --top 5 --expand '' --jobs 8 \
         --out "$WORK/c.ndjson" >"$WORK/c.log" 2>&1
if cmp -s "$WORK/b.ndjson" "$WORK/c.ndjson"; then
  ok "--jobs 8 output is byte-identical to --jobs 1"
else
  bad "--jobs 8 output differs from --jobs 1"
fi

echo
echo "6. subdivision kicks in above --max-bucket and still finds the subtree"
"$CRAWL" --fields lastName --top 2 --max-bucket 3 --expand '' --jobs 1 \
         --out "$WORK/d.ndjson" --gaps "$WORK/d.gaps.tsv" >"$WORK/d.log" 2>&1
check_eq "every record recovered through recursive prefixes" \
         "$ALPHA,$AN,$BETA" "$(ids_of "$WORK/d.ndjson")"

echo
echo "7. residue is detected and reported"
# lastName "An" has 5 records but no 3rd character, so subdividing 'an' finds
# nothing: the parent counted 5, the children cover 0. That gap is real and the
# crawler must say so even though it goes on to cover it.
check_eq "gaps report names the bucket children could not cover" \
         "lastName	an	5	0	5" \
         "$(awk -F'\t' '$1=="lastName" && $2=="an"' "$WORK/d.gaps.tsv")"
if grep -q 'unreachable by any child prefix' "$WORK/d.log"; then
  ok "warning printed to stderr"
else
  bad "no unreachable-records warning in the log"
fi

echo "7b. and covered by falling back to paging the parent"
check_eq "the 5 exact-'An' records are in the output anyway" \
         "$AN" "$(jq -r 'select(.vanId >= 1101 and .vanId <= 1105) | .vanId' "$WORK/d.ndjson" | sort -n | paste -sd, -)"
# The fallback re-fetches the whole 'an' bucket, overlapping whatever the child
# prefixes already returned, so one line per person is the real assertion here.
check_eq "the fallback re-fetch does not duplicate them" \
         "21" "$(wc -l < "$WORK/d.ndjson" | tr -d ' ')"

echo "7c. --no-drain-gaps trades that coverage away, loudly"
"$CRAWL" --fields lastName --top 2 --max-bucket 3 --expand '' --jobs 1 --no-drain-gaps \
         --out "$WORK/d2.ndjson" --gaps "$WORK/d2.gaps.tsv" >"$WORK/d2.log" 2>&1
check_eq "only the records reachable by prefix" \
         "$ALPHA,$BETA" "$(ids_of "$WORK/d2.ndjson")"
if grep -q 'DROPPED' "$WORK/d2.log"; then
  ok "the loss is reported as a drop"
else
  bad "expected a DROPPED warning"
fi

echo
echo "8. 429s are retried (VAN sends no Retry-After, so the delay is parsed from the text)"
stop_mock
start_mock 3          # every 3rd request 429s
"$CRAWL" --fields lastName --top 5 --expand '' --jobs 1 --retries 8 \
         --out "$WORK/e.ndjson" >"$WORK/e.log" 2>&1
check_eq "full result set despite rate limiting" \
         "$ALPHA,$AN,$BETA" "$(ids_of "$WORK/e.ndjson")"
if grep -q 'retry 1/8' "$WORK/e.log"; then
  ok "retries actually happened"
else
  bad "expected retry log lines"
fi

echo
echo "9. --dry-run probes counts but downloads nothing"
stop_mock
start_mock
"$CRAWL" --fields lastName --dry-run --out "$WORK/f.ndjson" >"$WORK/f.log" 2>&1
if [[ -e "$WORK/f.ndjson" ]]; then
  bad "--dry-run wrote an output file"
else
  ok "no output file created"
fi
if grep -q 'plan: 21 record-hits' "$WORK/f.log"; then
  ok "plan reports the 21 records it would fetch"
else
  bad "plan line missing or wrong: $(grep 'plan:' "$WORK/f.log" || echo '<none>')"
fi
check_eq "only \$top=1 count probes were issued" \
         "0" "$(grep -c 'top=5\|top=200' "$WORK/requests.log" | tr -d ' ')"
# One probe per letter of the default 36-character alphabet, and the two
# non-empty buckets ('a' with 17, 'b' with 4) each fit in a single $top=200 page.
check_eq "probe and page tallies survive the subshells they are counted in" \
         "36 count probes issued; the real run would add 2 page requests" \
         "$(sed -n 's/^ *\([0-9]* count probes.*\)$/\1/p' "$WORK/f.log")"

echo
echo "10. client-side guards match the API's documented limits"
out="$("$CRAWL" --top 201 --out "$WORK/g.ndjson" 2>&1)"; rc=$?
check_eq "--top 201 rejected before any request" "1" "$rc"
# shellcheck disable=SC2016  # literal '$top', not an expansion
if [[ "$out" == *'$top > 200'* ]]; then
  ok "error message cites the API limit"
else
  bad "unexpected message: $out"
fi
# shellcheck disable=SC1007  # deliberately clearing both vars for this one call
out="$(NGP_API_KEY= NGP_API_KEY_SANDBOX= "$CRAWL" --out "$WORK/h.ndjson" 2>&1)"; rc=$?
check_eq "missing API key rejected" "1" "$rc"

# ================================================================= summary ===
echo
echo "-------------------------------"
printf '%d passed, %d failed\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
