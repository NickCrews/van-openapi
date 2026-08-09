# Counting and aggregation

Read this before answering anything shaped like *how many*, *what fraction of*,
*all of our*, or *across the whole database*.

## The short answer

The VAN API has **no aggregate endpoint**. There is no count-by-attribute, no
`GROUP BY`, no "number of people where X". The only total it volunteers is `count`
in the pagination envelope, and that counts matches for a query you already had to
write.

There is also **no "all people" query**: `searchPeople` refuses a request with no
search parameter (`400 INVALID_PARAMETER`, "This endpoint requires at least one
search parameter to be set"), and every search parameter needs a value. So you
cannot even ask for the size of the database directly.

## What `count` is good for

For anything expressible as one search, `count` is exact and costs one request.
Ask for `$top=1` — you want the number, not the page.

```bash
curl -sS -u "app-name:$NGP_API_KEY|1" \
  'https://api.securevan.com/v4/people?lastName=Nguyen&$top=1'
# → {"count": 412, "items": [...], "nextPageLink": "..."}
```

This works for any single [`searchPeople`](../operations/searchPeople.md)
criterion: a name prefix, a city, a ZIP, an email prefix, an exact phone number.
It does **not** work for anything the endpoint cannot filter on — and the presence
or absence of a phone, email, or address is exactly that.

## When the question needs a sweep

If the attribute is not a search parameter, the only in-spec route is to enumerate
people and count them yourself. Enumeration means picking disjoint prefixes that
between them cover the database, then paging each one.

Single letters on `lastName` are disjoint, so their counts add up without
double-counting:

```bash
for L in a b c d e f g h i j k l m n o p q r s t u v w x y z; do
  curl -sS -u "app-name:$NGP_API_KEY|1" \
    "https://api.securevan.com/v4/people?lastName=$L&\$top=1"
done
```

**Verified on the sandbox (2026-08-09):** 26 requests, summing to 8172 people.
Deep paging works — `$skip=7200` returned rows — and ordering was stable across
repeated identical requests, so paging does not silently skip or repeat people.

### What a sweep misses

A prefix sweep is an approximation, and worth labelling as one:

- People with no last name at all, and organizations, which carry
  `commonName`/`officialName` instead.
- Last names starting with a digit, punctuation, or a non-Latin script.
- Anything created or merged away while the sweep runs. The same query returned
  `7073` and then `7245` twenty minutes apart on the sandbox during this session —
  a live database moves under you, and a sweep is a smear across time, not a
  snapshot.

## Cost, honestly

Page size maxes out at `$top=200`, so a sweep costs a bit more than `N/200`
requests — each prefix needs at least one request however few people it holds, and
each one ends with a partial page.

**Measured on the sandbox (2026-08-09):** a full 26-prefix sweep with
`$expand=phones` over 8,172 people took **64 requests in 35 seconds** — against a
floor of 41 from `N/200` alone. Scale from the measured rate, ~0.5 s/page:

| Database size | Requests | Wall clock |
| --- | --- | --- |
| 8,000 (sandbox, measured) | 64 | 35 s |
| 100,000 | ~530 | ~5 minutes |
| 2,000,000 (a real My Voters file) | ~10,000 | ~1.5 hours, before rate limits |

Those projections assume the sandbox's throughput and no throttling; a production
key on the medium profile will be slower.

Rate limits are per key and apply across all endpoints — commonly 15 requests/s on
the medium profile. `429` carries no `Retry-After`; the suggested wait is buried in
the error text.

**Above roughly 100k people, stop and say so.** Recommend Export Jobs instead of
burning hours on a paging loop. Those are real endpoints
([COVERAGE.md](../COVERAGE.md) section 3) — they exist, this spec just does not
describe them yet, so you would be working without a schema.

## Worked example: how many people have a phone number

The question sounds like a filter and is not one. `phoneNumber` on `searchPeople`
takes an exact number, and even then it only compares against the single phone VAN
flags `isBest` — so it cannot answer "has any phone".

Collections are `null` unless expanded, so `$expand=phones` is required; without
it every person looks phoneless.

```bash
curl -sS -u "app-name:$NGP_API_KEY|1" \
  'https://api.securevan.com/v4/people?lastName=b&$top=200&$expand=phones' \
  | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(d['count'], sum(1 for p in d['items'] if p.get('phones')))
"
# → 5 1
```

Repeat per prefix, page each prefix to exhaustion with `$skip`, and sum. Run in
full against the sandbox, that yields **151 of 8,172 people with at least one
phone — 1.8%**.

Report a number like that as an approximation over the population the sweep
actually covered, and say which people it could not reach.

If the file is large, the correct answer is not a bigger loop — it is that this
belongs in an export.

## Related

- [`searchPeople`](../operations/searchPeople.md) — every filter, and what each one
  really reads
- [`PersonPhone`](../schemas/PersonPhone.md) — how `isBest` picks the one phone
  that search compares against
- [COVERAGE.md](../COVERAGE.md) — what to reach for when this is not enough
