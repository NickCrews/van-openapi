# Endpoint Survey

Part of [NickCrews/van-openapi](https://github.com/NickCrews/van-openapi).

Research tracker for the NGP VAN API — what has been checked, what is still open, and how to probe it. Base URL: `https://api.securevan.com/v4`.

**Findings do not live here.** Everything learned about how the API behaves is written into [openapi.json](openapi.json): behavior in the descriptions, the evidence behind it in `x-provenance`, and departures from the official docs in `x-docs-discrepancy` (collected in [DISCREPANCIES.md](DISCREPANCIES.md)). This file tracks the state of the work, not its results.

**Statuses:** `unresearched` → `researched` (docs read + sandbox probed) → `spec'd` (in openapi.json) → `validated` (passing `make fuzz`).

Sources per endpoint group:
- **docs** — https://docs.ngpvan.com (index of pages: https://docs.ngpvan.com/llms.txt)
- **van-cli** — https://github.com/NGPVAN/van-cli `src/commands/`

> Sandbox note: the sandbox key is **My Campaign (mode `|1`) only** (`hasMyVoters: false`, "Demo State" committee). Endpoints requiring My Voters mode cannot be probed with it.

| Endpoint group | Known paths | Sources | Status | Last researched |
|---|---|---|---|---|
| Echoes | `POST /echoes` | docs | **validated** | 2026-08-03 |
| People — find | `POST /people/find` | docs, van-cli | **validated** (incl. minimum match combinations) | 2026-08-04 |
| Survey Questions — list | `GET /surveyQuestions` | docs, van-cli | **validated** | 2026-08-03 |
| People — get by id | `GET /people/{vanId}` | docs, van-cli | **validated** (incl. stateful links from `/people/find`, and what `isBest`/`isPreferred` mean on each contact method) | 2026-08-06 |
| People — write | `POST /people/create`, `POST /people/findOrCreate`, `POST /people/{vanId}` (update) | docs (common models only), van-cli | **validated** (incl. the full writeable scalar field set: the six fields gated behind `$expand=preferences`, the three accepted-and-discarded, and the two that need `contactMode: Organization`) | 2026-08-10 |
| People — search | `GET /people` (requires ≥1 search param; `GET /people/quickSearch` does **not** exist — 404 "No HTTP resource") | van-cli | **validated** (incl. what each address/contact filter actually reads: `streetAddress`/`city`/`stateOrProvince`/`zipOrPostalCode` the Voting address only, `phoneNumber` the single best phone, `email` every address) | 2026-08-06 |
| People — merge | `PUT /people/{vanId}/mergeInto` | docs | **validated** (sandbox key is permitted; `whatIf` parsing trap, contact-method dedup and preferred-email recomputation confirmed live) | 2026-08-06 |
| People — delete | `DELETE /people/{vanId}` | van-cli | researched (route exists; sandbox key gets `403 FORBIDDEN` "Access to this action is restricted", so success shape unknown — deliberately left out of the spec) | 2026-08-03 |
| People — notes | `GET/POST /people/{vanId}/notes`, `GET/PUT/DELETE /people/{vanId}/notes/{noteId}` | docs, van-cli | **validated** (list + create; `PUT` spec'd from docs only and `GET`/`DELETE` by id left out — all three are `403 FORBIDDEN` "Access to this action is restricted" for the sandbox key) | 2026-08-04 |
| People — sub-resources | `/people/{vanId}/{activistCodes,canvassResponses,customFields,scores,stories}` | van-cli | unresearched | — |
| Survey Questions — CRUD | `POST /surveyQuestions`, `GET/PUT /surveyQuestions/{id}` | docs, van-cli | researched (create 400s captured; valid `type` values unknown) | 2026-08-03 |
| API Key Profiles | `GET /apiKeyProfiles` | van-cli | researched (probed; returns items envelope with rate-limit profile) | 2026-08-03 |
| Activist Codes | `GET /activistCodes`, `GET /activistCodes/{id}` | docs, van-cli | unresearched | — |
| Bulk Import | `GET/POST /bulkImportJobs`, `/{jobId}/{cancel,errors,results,start,upload}` | docs, van-cli | unresearched | — |
| Canvass Responses (lookups) | `GET /canvassResponses/{contactTypes,inputTypes,resultCodes}` | van-cli | researched (probed contactTypes: bare array, no envelope) | 2026-08-03 |
| Changed Entity Export Jobs | `POST /changedEntityExportJobs`, `/{jobId}`, `/{jobId}/{cancel,downloadUrl,status}` | van-cli | unresearched | — |
| Codes | `GET /codes/{contactTypes,inputTypes,resultCodes,supporterGroups}` + by-id | van-cli | unresearched | — |
| Contributions | `GET/POST /contributions`, `/{id}`, `/recentContributions`, `/payments` | docs, van-cli | unresearched | — |
| Custom Fields | `GET /customFields`, `/{id}` | van-cli | unresearched | — |
| Departments | `GET /departments`, `/{id}` | docs | unresearched | — |
| Designations | `GET /designations`, `/{id}` | docs (changelog), van-cli | unresearched | — |
| Disbursements | `GET /disbursements/recentDisbursements` | docs | unresearched | — |
| Early Vote Fields | `GET /earlyVoteFields`, `/{id}` | docs | unresearched | — |
| Email | `GET /email/messages`, `/email/message/{foreignMessageId}` | van-cli | unresearched | — |
| Employers / Labor | `/employers/{id}/bargainingUnits/…`, `/jobClasses/{id}`, `/worksites/{id}/…` | docs | unresearched | — |
| Events | `GET/POST /events`, `/{eventId}`, `/events/types`, `/types/{id}` | docs, van-cli | unresearched | — |
| Export Jobs | `GET/POST /exportJobs`, `/{id}`, `/{id}/downloadUrl` | van-cli | unresearched | — |
| File Loading Jobs | `POST /fileLoadingJobs` | docs | unresearched | — |
| Folders / Map Regions | `/folders/{folderId}/mapRegions`, `/{mapRegionId}`, `…/refresh` | docs | unresearched | — |
| Locations | `GET/POST /locations`, `/{id}`, `/findOrCreate` | van-cli | unresearched | — |
| MiniVAN Exports | `GET /minivanExports` | docs | unresearched | — |
| Note Categories | `GET /notes/categories`, `GET /notes/categories/{noteCategoryId}`, `GET /notes/categoryTypes` | docs, van-cli | **validated** (bare arrays, no envelope; sandbox committee has none opted in, so only the empty array and 404s observed — item shape and the `assignableTypes` vocabulary from docs; `categoryTypes` is `403 FORBIDDEN` for the sandbox key) | 2026-08-08 |
| Printed Lists | `GET /printedLists` | docs | unresearched | — |
| Saved Lists | `GET /savedLists`, `/{id}` | van-cli | unresearched | — |
| Scores | `GET /scores`, `/{id}`, `/{id}/committeeAccess` | docs, van-cli | unresearched | — |
| Signups | `GET/POST /signups`, `/{id}` | van-cli | unresearched | — |
| Stories | `GET/POST /stories`, `/{id}` | van-cli | unresearched | — |
| Supporter Groups | `GET/POST /supporterGroups`, `/{id}`, `/{id}/people/{vanId}` | van-cli | unresearched | — |
| Targets | `GET /targets/{id}`, `/targets/subgroups` | van-cli | unresearched | — |
| Targeted Emails | (paths TBD — see van-cli `targetedEmails.ts`) | van-cli | unresearched | — |
| Voter Registration Batches | `POST /voterRegistrationBatches/{batchId}/people` | docs | unresearched | — |
| Introspection | (see docs "Introspection" page) | docs | unresearched | — |

## Open questions

Things probing has *not* settled. Everything already settled is written up in the spec.

- **`POST /surveyQuestions` valid `type` values.** Create requires every `*OtherLanguage` field, `scope`, and a valid `type`; `Candidate`, `Issue`, `Volunteer` and `GOTV` are all rejected as invalid in the demo committee, so no survey question can be created. This blocks seeding list/canvass data in the sandbox, and is why the CRUD half of Survey Questions is still `researched` rather than spec'd.
- **Actions the key is refused.** `DELETE /people/{vanId}` and `GET`/`PUT`/`DELETE /people/{vanId}/notes/{noteId}` all answer `403` "Access to this action is restricted" before the target is looked up, so their success shapes are unverified — `PUT` is spec'd from the docs alone, the rest are deliberately left out. Whether any key in this committee can be granted these actions is unknown.
- **My Voters (mode `|0`) is unreachable** with this key, so anything gated on it is unprobeable. Two `$expand` sections are refused in My Campaign and may work there: `scores` (403) and `pollingLocation` (400 on both `GET /people/{vanId}` and `GET /people`).
- **Note categories.** The committee has none opted in, so only `[]` has been seen from `GET /notes/categories` and only 404s from `GET /notes/categories/{noteCategoryId}`; the item shape comes from the docs, and no valid `category` value can be exercised on note create. The `assignableTypes` vocabulary is documented rather than observed: `GET /notes/categoryTypes`, which is the authoritative per-context list, is `403 FORBIDDEN` for this key, so the docs' "in almost all cases" set — `Event`, `Location`, `Person`, `Organization` — has not been confirmed live, and whether any context exposes a fifth type is unknown.
- **Note `contactHistory`** always reads back null, even with `$expand=noteDetails`, so its populated shape has never been observed and is left unmodelled.
- **`isCellStatus`** is validated on write but always reads back null; `GET /phones/isCellStatuses` returns an empty array here, so the real status list is unknown.
- **`$expand=recordedAddresses`** returns `[]` even for a record carrying four addresses — probably a My Voters concept, unconfirmed.
- **Merge leftovers**: whether identical addresses are deduped is not observable through the API, and which address wins the Voting slot when both people have one has not been characterized.
- **The one-off 404 from `POST /people/create` with a body `vanId`.** In CI on 2026-08-08 (run 31282824344), `{"vanId": 100000001, "firstName": "Soren"}` answered 404 in two schemathesis phases minutes apart; fifteen minutes later the identical request — with and without a session cookie — answered the usual blind 302 echo on every attempt. Documented as a rare 404 response on the operation so a recurrence passes conformance, but what triggers it is unknown (the sandbox had served a bare 502 half an hour earlier, so it may be an infrastructure mode).
- **`isBest` leftovers.** The phone ranking was pinned down through the API (see `PersonPhone.isBest`), but only for phones the API itself created: whether a VAN-UI or file-loaded phone ranks the same way, and whether editing an existing phone rather than appending a new one moves the flag, is unprobed — the API has no way to edit a phone in place. For addresses the flag is unobservable in the negative, since `$expand=addresses` returns only the best of each type.
- Everything marked `unresearched` in the table above, which is most of the API.

## Probing the sandbox

```bash
source .env
curl -s -u "default_user:${NGP_API_KEY_SANDBOX}|1" https://api.securevan.com/v4/people/102714507
```

Basic auth: username is the application name (anything works here), password is `{apiKey}|{databaseMode}` — `0` = My Voters, `1` = My Campaign. Committee "Ship Creek Group (APIKR-2320)", Demo State, 30M requests/month, rate limits High = 200/s and Medium = 15/s. Writes are fine; it is a demo database. Space bursts out or you will collect `429`s.

The database is nearly empty, so observing a populated response usually means creating the person first with `POST /people/create`.

## Sandbox test data

`make fuzz` creates a few hundred throwaway people per run and mutates the person records used as examples, so treat almost nothing here as stable. The load-bearing ones:

| vanId | Why it matters |
|---|---|
| `102714507` | Ada Testperson — the `vanId` example on both notes operations, so fuzz appends notes to it every run. Note `184580` on it is view-restricted and therefore invisible to the API. |
| `102714580` | Cre Atetest — the example on `POST /people/{vanId}`, so fuzz mutates its fields every run. Keep it out of any example needing stable values. |
| `102720707` → `102720504` | The merge examples, **both already merged away**. Every request the fuzzer builds from them is refused with `400 already been merged`, which is what stops `make fuzz` destroying live person records on an irreversible endpoint. Do not replace them with live vanIds. |
| `102721543` | Addrvis Control — carries four addresses (Home / Work / Mailing / Custom). The calibration person showing `GET /people` sees only the home address while `POST /people/find` sees all four. |
| `102720679`, `102720680`, `102720681` | Merr Alpha / Beta and Merge Test Org — kept unmerged as the contactMode-mismatch fixture. |
| `102720708` | Targety Mergetest — holds the merged-in data and the note that moved with it. |

Other probe people: contact-model and nullability probes `102714558`–`102716327`, merge and contact-method probes `102720504`–`102721908` (the secondaries among them are merged away and permanently unusable on either side of another merge), `isBest` probes `102721927`–`102721947` (all named "BestProbe", one per phone/address ranking case), and body-`vanId` boundary probes `102724282`–`102724293` (Ghost, ProbeLow/ProbeHigh/ProbeB*, Sentinel, FocProbe*, Matchable — created 2026-08-08 while mapping which body vanIds echo and which hide a create).

One id worth protecting: `100777777` **must keep matching no person** — it is the in-range phantom sentinel in `create-echoes-a-plausible-vanid-blindly` and `findorcreate-ignores-an-unknown-vanid` (the behaviors guard this with a GET that expects 404). Nothing can create a person at a chosen id, so only a database reset could break it.

## Reading a `make fuzz` run

Green means every conformance check passed; three warnings are expected and are not defects:

- **403 on `PUT /people/{vanId}/notes/{noteId}`** — the key is refused that action (see Open questions).
- **"missing test data" on `PUT /people/{vanId}/mergeInto`** — deliberate, see the merge examples above.
- **"schema validation mismatch"** on the notes and merge operations — those endpoints reject most generated input by design.

Two failure modes are infrastructure rather than API behavior, and can turn a run red at random: a bare nginx `502` (seen once from `POST /people/find`) and schemathesis' 10-second read timeout (seen once on `mergeInto`, whose request replayed 30 times afterwards at a 1.34s median, max 3.91s). Retry before investigating — a single network error fails the whole run even when every check passed.

Stateful coverage is thin: 41 links are selected per run (31 inferred by schemathesis) but only **2 are exercised**. The links off 200 responses can't be reached by schemathesis' non-redirect-following client, and the rest aren't hit at this example budget. Worth revisiting if stateful coverage matters more than wall-clock.
