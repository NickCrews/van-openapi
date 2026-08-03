---
name: reverse-engineer-endpoint
description: Reverse-engineer an NGP VAN API endpoint into openapi.json by cross-referencing official docs, van-cli source, and live sandbox probing, then validating with the schemathesis fuzzer. Use when adding or updating an endpoint in the spec, researching VAN API behavior, or when STATUS.md marks an endpoint unresearched.
---

# Reverse-engineer a VAN API endpoint

Golden rule: **observed behavior beats documented behavior.** When they differ, spec the observation and note the discrepancy in the description (prefix with `OBSERVED:`).

## Sources (consult all three)

1. **Official docs** — page index at https://docs.ngpvan.com/llms.txt; fetch pages as
   `https://docs.ngpvan.com/reference/<slug>.md`. Beware: pages can describe a different
   verb than the slug implies (e.g. `surveyquestions-1.md` is the POST, not the GET),
   and response codes are sometimes wrong (docs said `/people/find` returns 200; it returns 302/404).
2. **van-cli source** — https://github.com/NGPVAN/van-cli, `src/commands/*.ts`.
   Good for the full path inventory and request shapes actually used in practice.
3. **Live sandbox** — the ground truth. Probe with curl:

   ```bash
   source .env
   curl -s -w "\nHTTP %{http_code}\n" \
     -u "default_user:${NGP_API_KEY_SANDBOX}|1" \
     "https://api.securevan.com/v4/<path>"
   ```

## Sandbox facts

- Basic auth: username = app name (arbitrary), password = `apiKey|mode`. The sandbox key is
  **My Campaign only** (`|1`); `|0` returns 401 "Invalid Database Mode".
- Demo State committee, 30M req/month — probe and fuzz freely. Writes are fine (it's a demo DB),
  but record created test entities in STATUS.md "Field notes".
- The DB is nearly empty. To observe a "found"/populated response you may need to create the
  entity first (e.g. `POST /people/findOrCreate`).

## Workflow

1. Pick the endpoint in [STATUS.md](../../../STATUS.md); read its docs page(s) and van-cli command file.
2. Probe the sandbox: happy path, empty/missing fields, invalid values, pagination params.
   Capture status codes, headers (e.g. `Location` on 302), and exact body shapes.
3. Add the operation to `openapi.json`:
   - Reuse `components`: `ErrorResponse`, the `BadRequest`/`Unauthorized`/`ServerError` responses,
     and the `{items, nextPageLink, count}` list envelope pattern (but verify — some endpoints
     return bare arrays, e.g. `/canvassResponses/contactTypes`).
   - Mark nullable fields as `"type": ["X", "null"]` — most VAN response fields are nullable.
   - Constrain inputs known to 500 the server (e.g. `minimum: 1` on vanId) and document the
     bug in the field description.
4. `make fuzz` (runs `make validate` first). Fix spec-vs-reality mismatches until green.
   A 500 the fuzzer finds is a real VAN bug: constrain the input if possible, and log it.
5. Update STATUS.md: bump the endpoint's status (`researched` → `spec'd` → `validated`),
   set today's date, and add any new discoveries to "Field notes".
6. `make docs` to refresh the published spec copy; `make serve` to eyeball the Scalar page.
