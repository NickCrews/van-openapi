---
name: van-api
description: Call the NGP VAN API and find out what it can and cannot do. Use when working with VAN/EveryAction people, voter or contact records — looking someone up, creating or updating a person, merging duplicates, reading or adding notes, listing survey questions, etc.
---

# NGP VAN API

A reverse-engineered, live-verified spec for part of the NGP VAN API. Descriptions
record what the API *actually does*, which is often not what the official docs at
<https://docs.ngpvan.com> say.

**The spec covers 15 operations. The API has hundreds.** Read
[reference/COVERAGE.md](reference/COVERAGE.md) before concluding that anything is
possible or impossible.

## Credentials

Basic auth. Username is any application label; password is `{apiKey}|{databaseMode}`
where the mode is `0` for **My Voters** and `1` for **My Campaign**. Most keys are
issued for only one of the two — a mode the key lacks returns `401`, which looks
identical to a bad key.

```bash
curl -sS -u "app-name:$NGP_API_KEY|1" https://api.securevan.com/v4/people/102714507
```

Debug bad creds with `POST /echoes`.

## Which operation

<!-- BEGIN GENERATED: routing -->

| Task | Operation |
| --- | --- |
| Read one person in full | [`getPerson`](reference/operations/getPerson.md) |
| Change fields, or add a phone / email / address | [`updatePerson`](reference/operations/updatePerson.md) |
| Find people by loose criteria — name, city, ZIP, email | [`searchPeople`](reference/operations/searchPeople.md) |
| Decide whether one specific person is already on file | [`findPerson`](reference/operations/findPerson.md) |
| Create a person, reusing an existing record when there is one | [`findOrCreatePerson`](reference/operations/findOrCreatePerson.md) |
| Create unconditionally, duplicates and all | [`createPerson`](reference/operations/createPerson.md) |
| Collapse two records into one | [`mergePerson`](reference/operations/mergePerson.md) |
| Read the notes on a person | [`listPersonNotes`](reference/operations/listPersonNotes.md) |
| Add a note to a person | [`createPersonNote`](reference/operations/createPersonNote.md) |
| Edit an existing note | [`updatePersonNote`](reference/operations/updatePersonNote.md) |
| List the note categories this committee has | [`listNoteCategories`](reference/operations/listNoteCategories.md) |
| Look up one note category by id | [`getNoteCategory`](reference/operations/getNoteCategory.md) |
| List the note category types | [`listNoteCategoryTypes`](reference/operations/listNoteCategoryTypes.md) |
| List survey questions | [`listSurveyQuestions`](reference/operations/listSurveyQuestions.md) |
| Check that credentials work | [`createEcho`](reference/operations/createEcho.md) |

<!-- END GENERATED: routing -->

`searchPeople` vs `findPerson` is the choice that goes wrong most often.
`searchPeople` takes any single criterion and returns candidates without claiming
any of them is your person. `findPerson` refuses to try at all until you supply one
of a few minimum field combinations, and answers `404 Unmatched` when you don't —
indistinguishable from a genuine no-match. Loose criteria → `searchPeople`.

## Navigating the reference

Read carefully, the full spec is >100k tokens.

| File | What it answers |
| --- | --- |
| [reference/COVERAGE.md](reference/COVERAGE.md) | Is this possible at all? What is out of scope? |
| [reference/INDEX.md](reference/INDEX.md) | One line per operation, with the words a request would use |
| `reference/operations/<operationId>.md` | Everything about one operation |
| `reference/schemas/<Name>.md` | A shared object — `Person`, `PersonInput`, `PersonPhone`, … |
| [reference/ERRORS.md](reference/ERRORS.md) | The `400`/`401`/`403`/`429`/`500` contract, shared by all operations |
| `reference/behaviors/<id>.md` | The recorded request/response traffic behind a claim |
| `openapi.json` | The spec itself, for anything the pages leave out — query, never read whole |
| `reference/recipes/` | Multi-call tasks: [counting](reference/recipes/counting-and-aggregation.md), [identifying a person](reference/recipes/identify-a-person.md) |

Filenames are operationIds and behavior ids exactly as they appear in the spec, so
`reference/operations/findPerson.md` can be opened without consulting the index.

Searching works well because every parameter and property is a single line:

```bash
grep -rn "phoneNumber" reference/          # every mention, with full description
grep -rln "merge" reference/operations/    # which operations are involved
```

## The raw spec

`openapi.json` here is a symlink to the spec the reference pages are generated
from. **Never read it whole — it is over 100k tokens.** Query it.

The pages above are a lossy projection. Three things live only in the spec:

- `x-provenance` — how each behavior was established, and when it was last probed
  against the live API. Reach for this when you need to judge how much to trust a
  claim, or how stale it might be.
- `x-codeSamples` — full multi-step shell scripts, several per operation. The
  reference pages show one minimal call instead and link to `reference/behaviors/`.
- Extra request and response `examples` beyond the one rendered on each page.

```bash
# Everything about one operation, including what the pages drop
python3 -c "import json;print(json.dumps(json.load(open('openapi.json'))['paths']['/people/find']['post'],indent=2))"

# How was this claim established, and when?
grep -n -A3 '"x-provenance"' openapi.json | grep -i lastProbed

# With jq, if available
jq '.paths | keys' openapi.json
jq -r '.. | objects | select(.operationId? == "findPerson") | .["x-codeSamples"][].source' openapi.json
```

If the spec and a reference page ever disagree, the spec wins and the generated
page is a bug — see the note at the bottom of this file.

## Traps that apply everywhere

<!-- BEGIN GENERATED: traps -->

- Related collections are `null` unless `$expand` asks for them. A person with no `phones` key is not a person without phones. The `$expand` vocabulary differs between operations — `getPerson` accepts 23 sections, `searchPeople` only four. ([`person-collections-null-until-expanded`](reference/behaviors/person-collections-null-until-expanded.md), [`person-expand-set-is-policed`](reference/behaviors/person-expand-set-is-policed.md))
- `findPerson` returning 404 means "no match", not a broken route — and usually means the criteria fell short of the minimum combination rather than that the person is absent. ([`findPerson`](reference/operations/findPerson.md), [`find-below-threshold-is-unmatched`](reference/behaviors/find-below-threshold-is-unmatched.md))
- Phone search wants bare 10 digits. `9072223333` matches; `(907) 222-3333` is accepted and then silently matches nobody. ([`search-phone-must-be-bare-digits`](reference/behaviors/search-phone-must-be-bare-digits.md))
- Writes append contact methods, they never replace them. Updating a person with a phone adds a phone, so writing back a record you just read duplicates its contact methods. ([`update-appends-contact-methods`](reference/behaviors/update-appends-contact-methods.md))
- `mergePerson` is irreversible, and `whatIf` only accepts the literal `true` — any other value is parsed as false and the merge happens for real. ([`mergePerson`](reference/operations/mergePerson.md), [`merge-whatif-requires-literal-true`](reference/behaviors/merge-whatif-requires-literal-true.md))
- Text matching is case-insensitive *prefix*, never substring: `helmina` does not find Wilhelmina. ([`search-is-a-case-insensitive-prefix-match`](reference/behaviors/search-is-a-case-insensitive-prefix-match.md))
- A `vanId` in a request body overrides every other criterion, and on the create endpoints a plausible-looking id is echoed back as a match without ever being checked against the database. ([`find-by-vanid-overrides-criteria`](reference/behaviors/find-by-vanid-overrides-criteria.md), [`create-echoes-a-plausible-vanid-blindly`](reference/behaviors/create-echoes-a-plausible-vanid-blindly.md))
- 429 carries no `Retry-After`; the suggested wait appears only in the error text, and the limit is per API key across all endpoints.
- There is no aggregate or count-by-attribute endpoint. The only total is `count` in the pagination envelope, which counts matches for a query you already had to specify — and every search parameter demands a value, so there is no "all people" query to count. ([`searchPeople`](reference/operations/searchPeople.md))

<!-- END GENERATED: traps -->

## Counting and bulk work

Anything phrased as *how many*, *export*, *all of our*, or *across the database*
needs Export Jobs, Saved Lists, or Changed Entity Export Jobs — real endpoints that
this spec does **not** cover. Read
[reference/recipes/counting-and-aggregation.md](reference/recipes/counting-and-aggregation.md)
before writing a paging loop; it explains what the envelope count can and cannot be
made to answer, and when to stop and say so.

## Running calls

curl is enough, and is the only thing that shows you error bodies. For exploration,
[ocli](https://github.com/EvilFreelancer/openapi-to-cli) turns the spec into one
command per operation:

```bash
npm install -g openapi-to-cli
ocli profiles add van \
  --api-base-url https://api.securevan.com/v4 \
  --openapi-spec https://nickcrews.github.io/van-openapi/openapi.json \
  --api-basic-auth "app-name:${NGP_API_KEY}|1"
ocli use van

ocli commands --query "find person phone"   # search operations
ocli people_find --help
ocli people_findOrCreate --firstName Test --lastName Person
```

**ocli prints only the status code for non-2xx responses**, hiding the body — so a
`findPerson` miss shows `Request failed with status code 404` and throws away the
`{"vanId":null,"status":"Unmatched"}` that explains it. Fall back to curl whenever
the error body matters.

## Reporting problems

The spec is community-maintained at <https://github.com/NickCrews/van-openapi>. If
the API contradicts a page here, that is a bug worth filing — the descriptions are
meant to be observed fact.
