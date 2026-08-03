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

## Layout

- [openapi.json](openapi.json) — the spec (source of truth)
- [STATUS.md](STATUS.md) — per-endpoint research status and sandbox field notes
- `make fuzz` — validate the spec against the sandbox API with [schemathesis](https://schemathesis.readthedocs.io/) (needs `uv`, and `NGP_API_KEY_SANDBOX` in `.env`)
- `make docs` / `make serve` — build/preview the static [Scalar](https://scalar.com/) docs site in `docs/` (GitHub Pages-ready)
