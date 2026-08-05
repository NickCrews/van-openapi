#!/usr/bin/env bash
#
# crawl.sh — download every person record from an NGP VAN instance.
#
# GET /people has no "list everything" mode: it rejects any request that does not
# carry at least one search parameter. This script works around that by
# partitioning the database into prefix buckets (text criteria are
# case-insensitive prefix matches), paging each bucket with $top/$skip, and
# unioning the results by vanId.
#
# See README.md in this directory for the strategy, the measured API limits, and
# the two coverage gaps this approach cannot close.
#
# Requires: bash 4+, curl, jq.

set -euo pipefail

# --------------------------------------------------------------- environment ---
# Shared by the main process and the __page workers it spawns via xargs, so all of
# these read from the environment. The main process re-exports the _CRAWL_* ones
# after parsing flags.
BASE_URL="${VAN_BASE_URL:-https://api.securevan.com/v4}"
MODE="${VAN_MODE:-1}"                       # 1 = My Campaign, 0 = My Voters
APP_NAME="${VAN_APP_NAME:-van-openapi-crawl}"
API_KEY="${NGP_API_KEY:-${NGP_API_KEY_SANDBOX:-}}"

TOP="${_CRAWL_TOP:-200}"
EXPAND="${_CRAWL_EXPAND-emails,phones,addresses,districts}"   # `-` not `:-`: empty means "no $expand"
EXTRA="${_CRAWL_EXTRA-}"
MAX_RETRIES="${_CRAWL_MAX_RETRIES:-6}"

# ------------------------------------------------------------------ helpers ---
log()  { printf '%s\n' "$*" >&2; }
vlog() { (( VERBOSE )) && printf '%s\n' "$*" >&2 || true; }
warn() { printf 'WARNING: %s\n' "$*" >&2; }
die()  { printf 'error: %s\n' "$*" >&2; exit 1; }

urlenc() { jq -rn --arg s "$1" '$s|@uri'; }

# GET $BASE_URL$1, echo the body. Retries 429 and 5xx with backoff.
#
# VAN sends no Retry-After header on a 429 — the only hint is the number of
# milliseconds embedded in the error text — so parse that, and fall back to
# exponential backoff when it is absent.
api_get() {
  local path="$1" attempt=0 resp http body ms delay
  while :; do
    resp=$(curl -sS --max-time 180 -u "$AUTH" -w $'\n%{http_code}' "$BASE_URL$path") || resp=$'\n000'
    http="${resp##*$'\n'}"
    body="${resp%$'\n'*}"

    case "$http" in
      200) printf '%s' "$body"; return 0 ;;
      429|500|502|503|504|000) ;;   # retryable
      *)
        printf 'error: HTTP %s on %s\n%s\n' "$http" "$path" "$body" >&2
        return 1 ;;
    esac

    attempt=$((attempt + 1))
    if (( attempt > MAX_RETRIES )); then
      printf 'error: gave up after %d retries (HTTP %s) on %s\n%s\n' \
        "$MAX_RETRIES" "$http" "$path" "$body" >&2
      return 1
    fi

    ms=$(printf '%s' "$body" | jq -r '.errors[0].text // ""' 2>/dev/null \
         | sed -n 's/.*Try again in \([0-9][0-9]*\) ms.*/\1/p' || true)
    if [[ -n "$ms" ]]; then
      delay=$(awk -v ms="$ms" 'BEGIN { printf "%.3f", (ms / 1000) + 0.25 }')
    else
      delay=$(awk -v a="$attempt" 'BEGIN { printf "%.3f", (2 ^ (a - 1)) }')
    fi
    printf 'retry %d/%d after %ss (HTTP %s) %s\n' "$attempt" "$MAX_RETRIES" "$delay" "$http" "$path" >&2
    sleep "$delay"
  done
}

# Build the query string for one search field / prefix, plus any --extra params.
search_qs() {
  local field="$1" prefix="$2" qs
  qs="$(urlenc "$field")=$(urlenc "$prefix")"
  [[ -n "$EXTRA" ]] && qs+="&$EXTRA"
  printf '%s' "$qs"
}

# ------------------------------------------------------------- worker mode ---
# Invoked as: crawl.sh __page <field> <prefix> <dir> <skip>
#
# Each worker writes its own file so concurrent pages can never interleave on a
# shared descriptor (a $top=200 page with $expand is far larger than PIPE_BUF).
if [[ "${1:-}" == "__page" ]]; then
  [[ $# -eq 5 ]] || die "__page takes 4 arguments, got $(($# - 1))"
  _field="$2"; _prefix="$3"; _dir="$4"; _skip="$5"
  AUTH="$APP_NAME:$API_KEY|$MODE"

  _q="$(search_qs "$_field" "$_prefix")&\$top=$TOP&\$skip=$_skip"
  [[ -n "$EXPAND" ]] && _q+="&\$expand=$(urlenc "$EXPAND")"

  api_get "/people?$_q" | jq -c '.items[]' > "$_dir/$(printf '%012d' "$_skip").ndjson"
  exit 0
fi

# ------------------------------------------------------------------- usage ---
usage() {
  cat <<'EOF'
crawl.sh — download every person from an NGP VAN instance via prefix-partitioned
           search over GET /people.

Usage: crawl.sh [options]

Options:
  -o, --out FILE        output NDJSON, one person per line   (default: people.ndjson)
  -g, --gaps FILE       TSV report of unreachable buckets     (default: <out>.gaps.tsv)
  -f, --fields LIST     comma-separated search fields to crawl and union
                                                              (default: lastName,firstName)
  -a, --alphabet STR    characters used to build prefixes
                                            (default: a-z0-9)
  -t, --top N           page size, 1..200                     (default: 200)
  -b, --max-bucket N    subdivide a prefix whose count exceeds this
                                                              (default: 100000)
  -j, --jobs N          concurrent page fetches               (default: 4)
  -e, --expand LIST     $expand sections; '' to disable
                              (default: emails,phones,addresses,districts)
  -x, --extra QS        extra query string, e.g. 'contactMode=Person'
  -r, --retries N       retries per request on 429/5xx        (default: 6)
      --no-drain-gaps   when subdividing cannot cover a bucket, drop the
                        unreachable records instead of paging the parent deep
  -n, --dry-run         probe counts and print the plan, download nothing
  -v, --verbose         log every bucket, including empty ones
  -h, --help            this message

Environment:
  NGP_API_KEY           API key (falls back to NGP_API_KEY_SANDBOX)
  VAN_BASE_URL          default https://api.securevan.com/v4
  VAN_MODE              1 = My Campaign (default), 0 = My Voters
  VAN_APP_NAME          basic-auth username; any value works

Examples:
  # See what the crawl would cost before running it
  ./crawl.sh --dry-run

  # Names only, no related collections — much smaller and faster
  ./crawl.sh --fields lastName --expand '' --out names.ndjson

  # People only, full records
  ./crawl.sh --extra 'contactMode=Person' --jobs 8
EOF
}

# ------------------------------------------------------------ parse options ---
OUT="people.ndjson"
GAPS=""
FIELDS="lastName,firstName"
ALPHABET="abcdefghijklmnopqrstuvwxyz0123456789"
MAX_BUCKET=100000
JOBS=4
DRY_RUN=0
VERBOSE=0
DRAIN_GAPS=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    -o|--out)        OUT="$2"; shift 2 ;;
    -g|--gaps)       GAPS="$2"; shift 2 ;;
    -f|--fields)     FIELDS="$2"; shift 2 ;;
    -a|--alphabet)   ALPHABET="$2"; shift 2 ;;
    -t|--top)        TOP="$2"; shift 2 ;;
    -b|--max-bucket) MAX_BUCKET="$2"; shift 2 ;;
    -j|--jobs)       JOBS="$2"; shift 2 ;;
    -e|--expand)     EXPAND="$2"; shift 2 ;;
    -x|--extra)      EXTRA="$2"; shift 2 ;;
    -r|--retries)    MAX_RETRIES="$2"; shift 2 ;;
    -n|--dry-run)    DRY_RUN=1; shift ;;
    -v|--verbose)    VERBOSE=1; shift ;;
    --no-drain-gaps) DRAIN_GAPS=0; shift ;;
    -h|--help)       usage; exit 0 ;;
    *)               die "unknown option: $1 (try --help)" ;;
  esac
done

command -v curl >/dev/null || die "curl is required"
command -v jq   >/dev/null || die "jq is required"

[[ -n "$API_KEY" ]] || die "set NGP_API_KEY (or NGP_API_KEY_SANDBOX)"
[[ "$TOP" =~ ^[0-9]+$ && "$TOP" -ge 1 && "$TOP" -le 200 ]] \
  || die "--top must be 1..200 (the API rejects \$top > 200)"
[[ "$JOBS" =~ ^[0-9]+$ && "$JOBS" -ge 1 ]] || die "--jobs must be >= 1"
[[ "$MAX_BUCKET" =~ ^[0-9]+$ && "$MAX_BUCKET" -ge 1 ]] || die "--max-bucket must be >= 1"
[[ -n "$ALPHABET" ]] || die "--alphabet must not be empty"

AUTH="$APP_NAME:$API_KEY|$MODE"
[[ -n "$GAPS" ]] || GAPS="$OUT.gaps.tsv"

SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
export _CRAWL_TOP="$TOP" _CRAWL_EXPAND="$EXPAND" _CRAWL_EXTRA="$EXTRA" \
       _CRAWL_MAX_RETRIES="$MAX_RETRIES" \
       VAN_BASE_URL="$BASE_URL" VAN_MODE="$MODE" VAN_APP_NAME="$APP_NAME" \
       NGP_API_KEY="$API_KEY"

TMPROOT="$(mktemp -d "${TMPDIR:-/tmp}/van-crawl.XXXXXX")"
trap 'rm -rf "$TMPROOT"' EXIT
RAW="$TMPROOT/raw.ndjson"
: > "$RAW"

PLANNED=0         # records a dry run would download
PLANNED_PAGES=0   # page requests a dry run would issue
PROBES="$TMPROOT/probes"
: > "$PROBES"

# --------------------------------------------------------------- the crawl ---

# How many records match this field/prefix? One cheap $top=1, no $expand.
probe_count() {
  local field="$1" prefix="$2" body
  # Callers use $(probe_count ...), so a shell variable would be incremented in
  # a subshell and lost — tally probes on disk instead.
  printf '.' >> "$PROBES"
  body="$(api_get "/people?$(search_qs "$field" "$prefix")&\$top=1")" \
    || die "count probe failed for $field=$prefix"
  printf '%s' "$body" | jq -r '.count'
}

# Page a bucket we have decided is small enough to walk with $skip.
#
# The offsets are all known up front from `count`, so the pages can be fetched
# concurrently — no need to chase nextPageLink serially.
drain() {
  local field="$1" prefix="$2" count="$3"
  local dir skip=0 offsets=()

  while (( skip < count )); do
    offsets+=("$skip")
    skip=$((skip + TOP))
  done

  dir="$(mktemp -d "$TMPROOT/bucket.XXXXXX")"
  printf '%s\n' "${offsets[@]}" \
    | xargs -n 1 -P "$JOBS" "$SELF" __page "$field" "$prefix" "$dir"
  cat "$dir"/*.ndjson >> "$RAW"
  rm -rf "$dir"
}

# Recursively handle one prefix whose count we already know.
crawl_known() {
  local field="$1" prefix="$2" count="$3"
  local i ch child sum=0 residue

  if (( count == 0 )); then
    vlog "    $field=$prefix  0"
    return 0
  fi

  if (( count <= MAX_BUCKET )); then
    log "    $field=$prefix  $count"
    if (( DRY_RUN )); then
      PLANNED=$((PLANNED + count))
      PLANNED_PAGES=$((PLANNED_PAGES + (count + TOP - 1) / TOP))
    else
      drain "$field" "$prefix" "$count"
    fi
    return 0
  fi

  log "    $field=$prefix  $count  > --max-bucket $MAX_BUCKET, subdividing"
  for (( i = 0; i < ${#ALPHABET}; i++ )); do
    ch="${ALPHABET:i:1}"
    child="$(probe_count "$field" "$prefix$ch")"
    sum=$((sum + child))
    crawl_known "$field" "$prefix$ch" "$child"
  done

  # Children are disjoint subsets of the parent, so anything the parent counted
  # that no child claims is a record whose value either *is* the prefix exactly
  # or continues with a character outside --alphabet. Extending the prefix can
  # never reach it, and there is no exact-match operator to ask for it directly.
  residue=$((count - sum))
  (( residue > 0 )) || return 0

  printf '%s\t%s\t%d\t%d\t%d\n' "$field" "$prefix" "$count" "$sum" "$residue" >> "$GAPS"

  # Subdividing only exists to keep $skip shallow. If it cannot cover the bucket,
  # paging the parent deep is strictly better than dropping records: the worst
  # case is a $skip depth nobody has verified, and the dedupe absorbs the
  # overlap with the children we already fetched.
  if (( DRAIN_GAPS )); then
    warn "$residue record(s) under $field prefix '$prefix' are unreachable by any child prefix ($count matched, children cover $sum) — paging the parent to \$skip=$count instead"
    log "    $field=$prefix  $count  (gap fallback)"
    if (( DRY_RUN )); then
      PLANNED=$((PLANNED + count))
      PLANNED_PAGES=$((PLANNED_PAGES + (count + TOP - 1) / TOP))
    else
      drain "$field" "$prefix" "$count"
    fi
  else
    warn "$residue record(s) DROPPED under $field prefix '$prefix' ($count matched, children cover $sum) — --no-drain-gaps is set; widen --alphabet or raise --max-bucket"
  fi
}

printf 'field\tprefix\tcount\tcovered_by_children\tunreachable\n' > "$GAPS"

log "base:       $BASE_URL (mode $MODE)"
log "fields:     $FIELDS"
log "alphabet:   $ALPHABET"
log "page size:  \$top=$TOP  jobs=$JOBS  max-bucket=$MAX_BUCKET"
log "expand:     ${EXPAND:-<none>}"
[[ -n "$EXTRA" ]] && log "extra:      $EXTRA"
(( DRY_RUN )) && log "MODE:       dry run (counts only, nothing downloaded)"
log ""

IFS=',' read -r -a FIELD_LIST <<< "$FIELDS"
for field in "${FIELD_LIST[@]}"; do
  field="${field// /}"
  [[ -n "$field" ]] || continue
  log "  crawling $field"
  for (( n = 0; n < ${#ALPHABET}; n++ )); do
    seed="${ALPHABET:n:1}"
    # A whitespace-only prefix reads as empty to the API and trips the
    # "requires at least one search parameter" 400, so never send one.
    [[ -n "${seed// /}" ]] || continue
    crawl_known "$field" "$seed" "$(probe_count "$field" "$seed")"
  done
done

log ""
probes=$(wc -c < "$PROBES" | tr -d ' ')

if (( DRY_RUN )); then
  log "plan: $PLANNED record-hits across all buckets (before cross-field dedup)"
  log "      $probes count probes issued; the real run would add $PLANNED_PAGES page requests"
else
  # Dedupe by vanId: a person reachable by more than one field (lastName=a and
  # firstName=z, say) is fetched more than once. Sorting by the key field keeps
  # output deterministic regardless of --jobs, and sort spills to disk so this
  # stays safe on multi-GB crawls.
  jq -r '"\(.vanId)\t\(tojson)"' "$RAW" \
    | sort -t $'\t' -k1,1n -s -u \
    | cut -f2- > "$OUT"

  fetched=$(wc -l < "$RAW" | tr -d ' ')
  unique=$(wc -l < "$OUT" | tr -d ' ')
  log "fetched $fetched record-hits -> $unique unique people -> $OUT"
fi

gap_rows=$(($(wc -l < "$GAPS" | tr -d ' ') - 1))
if (( gap_rows > 0 )); then
  warn "$gap_rows bucket(s) had unreachable records — see $GAPS"
else
  rm -f "$GAPS"
fi
