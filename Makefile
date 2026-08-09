# All tooling runs via uvx (no Python project needed). Requires: uv, curl.
# Optional: CI passes NGP_API_KEY_SANDBOX through the environment instead.
-include .env
export

SPEC     := openapi.json
BASE_URL := https://api.securevan.com/v4
# Basic auth: username = app name (arbitrary), password = apiKey|databaseMode (1 = My Campaign)
AUTH     := default_user:$(NGP_API_KEY_SANDBOX)|1

# Conformance checks only: the gate asserts "the spec describes reality".
# - not_a_server_error is off: the API genuinely 500s on malformed input
#   (documented as a 500 response in the spec; bugs noted in STATUS.md).
# - negative_data_rejection is off: the API tolerantly ignores unknown fields.
CHECKS := status_code_conformance,content_type_conformance,response_schema_conformance

.PHONY: lint fuzz discrepancies serve clean types behaviors behaviors-all inject inject-check agent-docs agent-docs-check

## Lint the spec structurally
lint:
	uvx --from openapi-spec-validator openapi-spec-validator $(SPEC)

## Property-based fuzz of the spec against the sandbox API
fuzz: lint
	uvx schemathesis run $(SPEC) \
		--url $(BASE_URL) \
		--auth "$(AUTH)" \
		--checks $(CHECKS) \
		--max-examples 25 \
		--rate-limit 10/s \
		--seed 42

## Regenerate DISCREPANCIES.md from x-docs-discrepancy fields in the spec
discrepancies:
	python3 scripts/discrepancies.py $(SPEC) > DISCREPANCIES.md

## Preview the docs site locally (docs/openapi.json is a committed symlink to the spec)
serve:
	@echo "http://localhost:8931"
	python3 -m http.server 8931 -d docs

## Regenerate the typed client from the spec (tests then typecheck against it)
types:
	npx openapi-typescript $(SPEC) -o tests/harness/schema.d.ts

## Run the behavior suite live against the sandbox (skips slow behaviors)
behaviors: types
	npx vitest run

## Everything, including the slow behaviors
behaviors-all: types
	VAN_SLOW=1 npx vitest run

## Regenerate the agent-browsable reference in the van-api skill
agent-docs:
	python3 scripts/agent_docs.py

## CI gate: fail if the agent docs are stale with respect to their sources
agent-docs-check:
	python3 scripts/agent_docs.py --check

## Fold recorded transcripts into the spec as examples and code samples
inject:
	npx tsx scripts/inject-examples.ts

## CI gate: fail if the spec is stale with respect to transcripts/
inject-check:
	npx tsx scripts/inject-examples.ts --check

clean:
	rm -rf schemathesis-report/
