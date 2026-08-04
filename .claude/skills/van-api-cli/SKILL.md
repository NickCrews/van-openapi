---
name: van-api-cli
description: Call the NGP VAN API from the command line using ocli (openapi-to-cli) and a published OpenAPI spec, which turn the API into searchable, runnable CLI commands. Use when exploring which VAN endpoints/parameters exist or when calling the VAN API ad hoc without writing client code.
---

# van-api-cli — call the VAN API from the CLI

[ocli](https://github.com/EvilFreelancer/openapi-to-cli) loads an OpenAPI spec at runtime and
generates one CLI command per operation, with search, per-command `--help`, and real
authenticated HTTP calls. A community-maintained spec for the NGP VAN API is published at
`https://nickcrews.github.io/van-openapi/openapi.json`.

## Setup (once)

Requires Node and a VAN API key.

```bash
npm install -g openapi-to-cli   # or run each command below via `npx -y openapi-to-cli ...`
ocli profiles add van \
  --api-base-url https://api.securevan.com/v4 \
  --openapi-spec https://nickcrews.github.io/van-openapi/openapi.json \
  --api-basic-auth "my_app:${VAN_API_KEY}|{databaseMode}"
ocli use van # make it the default profile for future calls
```

where `my_app` is an arbitrary label, `${VAN_API_KEY}` is your UUID key, and `{databaseMode}` is `0` for My Voters or `1` for My Campaign.

## Explore

```bash
ocli commands # list all operations
ocli commands --query "find person phone" # BM25 search
ocli commands --regex "users.*post" --limit 10 # Search by regex
ocli people_find --help # parameters for one operation
```

## Call

```bash
ocli people_findOrCreate --firstName Test --lastName Person
# → {"vanId": 102717330, "status": "UnmatchedStored"}
ocli people_vanId_get --vanId 102717330
```

## Gotchas

- **Non-2xx responses print only the status code**, not the body (e.g. `people_find` with no
  match prints `Request failed with status code 404` and hides the
  `{"vanId":null,"status":"Unmatched"}` body). When the error body matters, fall back to curl:
  `curl -sS -u "my_app:${VAN_API_KEY}|1" https://api.securevan.com/v4/...`
- `people_find` returning 404 means "no match" (expected VAN behavior), not a broken route.
