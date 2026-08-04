# VAN OpenAPI Spec

Goal: An OpenAPI Spec for the [NGP VAN API](https://docs.ngpvan.com/).

---

This is a community project, not published or endorsed by NGP VAN. Issues and
corrections are welcome at https://github.com/NickCrews/van-openapi/issues.

There already exists https://github.com/NGPVAN/van-cli, published by NGP,
but that is bound to a CLI and typescript SDK.

An OpenAPI spec has some nice benefits:
- Defines how to access from any environment: using cURL, python, google apps script, etc
- Able to be auto-fuzzed.
- Can be used as a source to codegen SDKs in any language, or an MCP server.
- Allows for publishing a human readable docs website for exploring the API. See https://nickcrews.github.io/van-openapi/.
- Allows inlining docs and examples of the endpoints right in the spec.

## Usage

### From the command line

Turn the spec into searchable, runnable CLI commands with
[ocli](https://github.com/EvilFreelancer/openapi-to-cli) — no client code needed.
The [van-api-cli](.claude/skills/van-api-cli/SKILL.md) agent skill has setup and
examples. Install it for your coding agent (Claude Code, Codex, Cursor, etc) with:

```bash
npx skills add NickCrews/van-openapi
```

### Browse the docs site

Explore the API in a human-readable form at https://nickcrews.github.io/van-openapi/.

## Layout

- [openapi.json](openapi.json) — the spec (source of truth). Descriptions state
  observed behavior only; where that deviates from the official docs, the
  comparison lives out of band in `x-docs-discrepancy` fields, and research
  evidence/confidence notes in `x-provenance` fields (both hidden by most
  documentation renderers).
- [DISCREPANCIES.md](DISCREPANCIES.md) — deviations from the official docs,
  generated from the spec's `x-docs-discrepancy` fields via `make discrepancies`
- [STATUS.md](STATUS.md) — per-endpoint research status and sandbox field notes
- [docs/](docs/) — the static [Scalar](https://scalar.com/) docs site published to
  GitHub Pages. `docs/openapi.json` is a committed symlink to the spec, so the
  site never carries a second copy that can drift.

## Development

All tooling runs through `uvx`, so the only prerequisites are `uv` and `curl` —
there is no Python project to install.

| Command | What it does |
| --- | --- |
| `make validate` | Lint the spec structurally with [openapi-spec-validator](https://github.com/python-openapi/openapi-spec-validator) |
| `make fuzz` | Property-based check of the spec against the sandbox API with [schemathesis](https://schemathesis.readthedocs.io/) |
| `make discrepancies` | Regenerate `DISCREPANCIES.md` from the spec's `x-docs-discrepancy` fields |
| `make serve` | Preview the docs site at http://localhost:8931 |

`make fuzz` talks to the live sandbox and needs a key: put
`NGP_API_KEY_SANDBOX=...` in a `.env` file at the repo root, or pass it through
the environment.

The fuzzer asserts only that *the spec describes reality* — status codes,
content types, and response schemas. It deliberately does not enforce
`not_a_server_error` (the API really does 500 on some malformed input, which the
spec documents) or `negative_data_rejection` (the API tolerantly ignores unknown
fields). See the comments in the [Makefile](Makefile) for details.

### CI

[.github/workflows/ci.yml](.github/workflows/ci.yml) runs on every push and pull
request: it validates the spec, fails if `DISCREPANCIES.md` is out of date with
respect to `x-docs-discrepancy` fields, checks that the `docs/openapi.json`
symlink is intact, and then fuzzes against the sandbox. The fuzz job needs an
`NGP_API_KEY_SANDBOX` repository secret; without one (as on pull requests from
forks, which never receive secrets) it is skipped rather than failed.

[.github/workflows/docs.yml](.github/workflows/docs.yml) publishes `docs/` to
GitHub Pages on every push to `main`.
