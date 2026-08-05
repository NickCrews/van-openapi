# download-all

Bulk-download every person from an NGP VAN instance.

```bash
export NGP_API_KEY=...          # or NGP_API_KEY_SANDBOX
./crawl.sh --dry-run            # see the plan and its cost first
./crawl.sh --out people.ndjson  # then run it
```

Output is NDJSON — one `Person` object per line, deduped by `vanId`, sorted by
`vanId`. Requires `bash`, `curl` and `jq`.

## Why this is not just a loop over `/people`

`GET /people` has no "list everything" mode. It rejects any request that does not
carry at least one search parameter, and paging parameters do not count:

```
GET /people?$top=200            -> 400 "This endpoint requires at least one search parameter to be set."
GET /people?lastName=           -> 400  (an empty string is not a parameter)
GET /people?contactMode=Person  -> 400  (a filter is not a search parameter)
```

You must always supply one of `firstName`, `lastName`, `middleName`,
`streetAddress`, `city`, `stateOrProvince`, `zipOrPostalCode`, `phoneNumber`,
`email`, `commonName`, `officialName`.

The way in is that text criteria are **case-insensitive prefix matches**, and the
response envelope carries a total `count`. So `lastName=a` is a bucket, `count`
tells you how big it is, and `$top`/`$skip` walk it. Cover the alphabet and you
have covered the database.

## The strategy

```
for each field in --fields (default: lastName, firstName):
    for each character c in --alphabet (default: a-z0-9):
        crawl(field, c)

crawl(field, prefix):
    count = GET /people?{field}={prefix}&$top=1   ->  .count
    if count == 0:                 prune this branch
    if count <= --max-bucket:      page it with $top=200 & $skip
    else:                          crawl(field, prefix + c) for each c
                                   residue = count - Σ(children)
                                   if residue > 0: report it, then page the
                                                   parent anyway (see gaps)

finally: union all passes, dedupe by vanId
```

Two details worth knowing:

- **Pages are fetched concurrently.** Once `count` is known, every `$skip` offset
  for that bucket is known too, so there is no reason to chase `nextPageLink`
  serially. `--jobs` controls the fan-out. Each worker writes its own temp file,
  because a `$top=200` page with `$expand` is far larger than `PIPE_BUF` and
  concurrent appends to one descriptor would interleave.
- **The `firstName` pass exists to catch records the `lastName` pass cannot see**
  (see gaps below). The two passes overlap heavily; the final dedupe by `vanId`
  handles that.

## Measured API behaviour

Everything below was probed against the live sandbox on 2026-08-04 and is what
the script and its mock are built against. See [../STATUS.md](../STATUS.md) for
the wider endpoint survey.

| | Behaviour |
|---|---|
| `$top` | Default 50, **max 200**. `201` → 400. (van-cli caps people search at 50 client-side — that is a client convention, not a server limit.) |
| `$skip` | Walks to the end of the result set; `$skip=4287` of 4288 returned the last record. Past `count` it returns `{"items":[],"count":0}` rather than an error. |
| Paging stability | A full crawl of `lastName=a` — 22 pages, 4288 records — returned **4288 unique vanIds, 0 duplicates, 0 gaps**, matching the reported `count`. Order is deterministic across repeated calls (it is not vanId order, and `$orderby=Name` does not change it). |
| Throughput | `$top=200&$expand=emails,phones,addresses,districts`: 137 people/s sequential, **~300 people/s at 16 concurrent requests, zero 429s**. ~2.8 KB per record. |
| Rate limits | This key's profile is High 200 / Medium 15 / Low 4. A 429 carries **no `Retry-After` header** — the delay appears only in the error text (`"Try again in N ms."`), which `api_get` parses. |

So roughly: **1M records ≈ 1 hour and ≈ 2.8 GB** of JSON with full `$expand`.
Pass `--expand ''` if you only need names and ids; it is dramatically smaller.

## The two coverage gaps

This approach cannot be proven complete, and the script is explicit about it
rather than quietly returning a short file.

**1. Records with no value in any crawled field.** A prefix search can only find
a record that *has* the field. In the sandbox, a `firstName=a…z` sample of 469
records contained **134 with a blank `lastName`** — a `lastName`-only crawl
misses every one. That is why `--fields` defaults to `lastName,firstName`.
Records blank in *both* are unreachable by any prefix. (The sandbox is polluted
with fuzzer records so that ratio is not representative, but the failure mode is
real — check your instance.)

**2. Residue when a bucket is subdivided.** If `lastName=an` matches more than
`--max-bucket` records, the script recurses into `ana`, `anb`, … — which cannot
reach a record whose `lastName` **is** `"An"`, with no further character, or
continues with a character outside `--alphabet`. There is no exact-match
operator to ask for those directly.

The script detects case 2 **exactly**: children are disjoint subsets of the
parent, so `parent_count - Σ(child_counts)` is precisely the number of records no
deeper prefix can reach. When that is non-zero it warns on stderr and writes a
row to `<out>.gaps.tsv`:

```
field     prefix  count  covered_by_children  unreachable
lastName  an      5      0                    5
```

and then **pages the parent bucket anyway**, letting the dedupe absorb the
overlap with the children it already fetched. Subdividing only ever existed to
keep `$skip` shallow; if it cannot cover the bucket, a deeper-than-usual `$skip`
is a far better outcome than dropping records. The gap row still tells you it
happened, so you can widen `--alphabet` and re-run if you would rather not rely
on deep paging. `--no-drain-gaps` disables the fallback and accepts the loss —
the warning then says `DROPPED`.

Mitigations, in order of preference: widen `--alphabet` to include the characters
your data actually uses (apostrophes, hyphens, accented letters), or raise
`--max-bucket` so the bucket is paged whole instead of subdivided at all
(`$skip` is verified good to at least ~4.3k and has no documented ceiling).

There is no equivalent detector for the *top* level — a `lastName` starting with
a character outside `--alphabet` is simply never seen, and no total count exists
to compare against. The `firstName` pass mitigates this in practice but does not
close it.

## What you should probably use instead

For a one-off full extract, the crawl is the fallback, not the intended path.
`GET /exportJobTypes` on this key returns `{"exportJobTypeId": 4, "name":
"SavedListExport"}`, so **`POST /exportJobs`** can export a saved list to CSV in
one shot — build a saved list of everyone in the VAN UI, then export it. Probing
an empty POST shows the required fields are `savedListId`, `type`, and
`webhookUrl` (**mandatory, must be a valid HTTPS URL** — there is no polling-only
mode).

`POST /changedEntityExportJobs`, the delta-export API you would want for keeping
an extract fresh, returns **403 FORBIDDEN** for this key, as does
`/changedEntityExportJobs/resources`.

Neither endpoint is in `openapi.json` yet — both are marked `unresearched` in
[../STATUS.md](../STATUS.md).

## Options

```
-o, --out FILE        output NDJSON                          (default: people.ndjson)
-g, --gaps FILE       TSV report of unreachable buckets       (default: <out>.gaps.tsv)
-f, --fields LIST     search fields to crawl and union        (default: lastName,firstName)
-a, --alphabet STR    characters used to build prefixes       (default: a-z0-9)
-t, --top N           page size, 1..200                       (default: 200)
-b, --max-bucket N    subdivide a prefix whose count exceeds this  (default: 100000)
-j, --jobs N          concurrent page fetches                 (default: 4)
-e, --expand LIST     $expand sections; '' to disable
                                    (default: emails,phones,addresses,districts)
-x, --extra QS        extra query string, e.g. 'contactMode=Person'
-r, --retries N       retries per request on 429/5xx          (default: 6)
    --no-drain-gaps   when subdividing cannot cover a bucket, drop the
                      unreachable records instead of paging the parent deep
-n, --dry-run         probe counts and print the plan, download nothing
-v, --verbose         log every bucket, including empty ones
```

Environment: `NGP_API_KEY` (or `NGP_API_KEY_SANDBOX`), `VAN_BASE_URL`,
`VAN_MODE` (`1` = My Campaign, `0` = My Voters), `VAN_APP_NAME`.

## Tests

```bash
./test.sh
```

Runs entirely offline against [mock_van.py](mock_van.py) — no API key, no
network, nothing touched in a real instance. The mock reproduces the behaviours
the crawl depends on (the at-least-one-search-parameter rule, prefix matching,
`$top`/`$skip` paging, the `Retry-After`-less 429) over a 26-record dataset
shaped to hit every branch, including the two coverage gaps.

The 23 assertions cover: full recovery of an in-alphabet field; the blank and
out-of-alphabet records a single-field crawl provably misses; never issuing a
parameter-less request; cross-field union and dedupe; `--jobs 8` producing
byte-identical output to `--jobs 1`; recursive subdivision; residue detection,
the gaps report, and both sides of the drain-vs-drop fallback;
retry-through-429; `--dry-run` downloading nothing; and the client-side
`--top`/API-key guards.

## Then what — deduping

Worth knowing before you build on this: **the API has no merge endpoint.**
`/people/merge`, `/people/{id}/merge`, `/mergePeople` and
`/people/{id}/duplicates` are all route misses (IIS HTML 404s, not permission
errors), and `DELETE /people/{vanId}` is 403 for this key. The API can find
duplicates; collapsing them is a UI or bulk-import operation.

Also relevant: `POST /people/find` **resolves ambiguous matches silently** — given
three identical records it returns exactly one `vanId` with nothing signalling
that others matched. Criteria including a name return the oldest record,
name-less criteria (email alone, phone alone) the newest. A `302` is not proof of
uniqueness. See the field notes in [../STATUS.md](../STATUS.md).
