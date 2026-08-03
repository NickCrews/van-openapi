# Endpoint Survey

Research status of NGP VAN API endpoints. Base URL: `https://api.securevan.com/v4`.

**Statuses:** `unresearched` → `researched` (docs read + sandbox probed) → `spec'd` (in openapi.json) → `validated` (passing `make fuzz`).

Sources per endpoint group:
- **docs** — https://docs.ngpvan.com (index of pages: https://docs.ngpvan.com/llms.txt)
- **van-cli** — https://github.com/NGPVAN/van-cli `src/commands/`

> Sandbox note: the sandbox key is **My Campaign (mode `|1`) only** (`hasMyVoters: false`, "Demo State" committee). Endpoints requiring My Voters mode cannot be probed with it.

| Endpoint group | Known paths | Sources | Status | Last researched |
|---|---|---|---|---|
| Echoes | `POST /echoes` | docs | **validated** | 2026-08-03 |
| People — find | `POST /people/find` | docs, van-cli | **validated** | 2026-08-03 |
| Survey Questions — list | `GET /surveyQuestions` | docs, van-cli | **validated** | 2026-08-03 |
| People — CRUD | `GET/POST /people`, `GET /people/{vanId}`, `POST /people/create`, `POST /people/findOrCreate`, `GET /people/quickSearch` | docs, van-cli | researched (probed findOrCreate, GET by id, quickSearch) | 2026-08-03 |
| People — sub-resources | `/people/{vanId}/{activistCodes,canvassResponses,customFields,notes,scores,stories}` | van-cli | unresearched | — |
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
| Notes | `GET /notes/categories` | van-cli | unresearched | — |
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

## Field notes (from sandbox probing, 2026-08-03)

- **Auth**: HTTP Basic. Username = application name (anything works in sandbox; van-cli defaults to `default_user`), password = `{apiKey}|{databaseMode}`. Mode `0` = My Voters, `1` = My Campaign. Wrong mode → `401 {"errors":[{"code":"UNAUTHORIZED","text":"Invalid Database Mode"}]}`.
- **Error envelope**: `{"errors":[{"code","text","properties":[…],"hint"?}]}`. Seen codes: `UNAUTHORIZED`, `INVALID_PARAMETER`, `NOT_FOUND`.
- **Pagination envelope**: `{"items":[…],"nextPageLink":null|string,"count":int}` — but not universal: `/canvassResponses/contactTypes` returns a bare array.
- **`$top`**: default 50, max 200 per the `INVALID_PARAMETER` hint on `/surveyQuestions`.
- **`POST /people/find` does not behave as docs imply**: match → `302` with `Location: /v4/people/{vanId}` and body `{"vanId":int,"status":"Matched"}`; no match → `404` with `{"vanId":null,"status":"Unmatched"}` (even for sparse criteria like firstName-only — no 400 observed). `findOrCreate` → `201 {"vanId":int,"status":"UnmatchedStored"}`.
- **`POST /echoes`** accepts an empty body; all fields nullable in response (`{"message","dateSent","delayInMilliseconds"}`). **BUG**: `delayInMilliseconds: -1` hangs the connection indefinitely (likely passed straight into .NET as `Timeout.Infinite`); other negative values return 500.
- **Fuzzer-found 500s** (should be 400s): negative `delayInMilliseconds` on `/echoes`; non-ASCII filter values on `/surveyQuestions`; `vanId: 0` or `phones: [null]` on `/people/find`. Documented as 500 responses in the spec; `not_a_server_error` check disabled in `make fuzz`.
- **Redirect-following clients** (requests, fetch, httpx, schemathesis) see `POST /people/find` return **200 with the full person record** because they auto-follow the 302 to `GET /people/{vanId}`. The spec documents both the raw 302 and the followed 200.
- **Person field inventory** observed live via `GET /people/{vanId}` (~70 fields, most null on a minimal record — see the `Person` schema). `dateAcquired` is `0001-01-01T00:00:00Z` (dotnet default) for API-created records.
- **`POST /surveyQuestions`** requires all `*OtherLanguage` fields, `scope`, and a valid `type`; `Candidate`/`Issue`/`Volunteer`/`GOTV` all rejected as invalid type in the demo committee — valid values still unknown (blocker for seeding sandbox list data).
- Sandbox committee: "Ship Creek Group (APIKR-2320)", Demo State, 30M req/month quota, rate limits High=200/s, Medium=15/s.
- Test data created in sandbox: person `vanId 102714507` (Ada Testperson, ada.testperson@example.com).
