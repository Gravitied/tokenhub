# Release

This document defines the release process for TokenHub MCP.

## Release Gate

Run:

```bash
npm run verify:release
```

The command expands to:

```bash
npm run lint
npm test
npm run build
npm run eval:resolve-request
npm run eval:resolve-request:live
npm pack --dry-run
npm run smoke:install
```

All steps must pass before publishing.

## npm Package Contract

The package is named `tokenhub-mcp` and exposes:

```json
{
  "bin": {
    "tokenhub-mcp": "dist/cli.js"
  },
  "engines": {
    "node": ">=20"
  }
}
```

The published package root must contain only:

- `dist`
- `README.md`
- `LICENSE`
- `package.json`

Benchmark and eval helpers compile to `dist-bench` for local verification but must not appear under `package/dist/bench` in the packed artifact.

`tests/packaging.test.ts` enforces this contract.

## Smoke Install

`npm run smoke:install` verifies the packed package from the consumer side. It:

1. builds the project
2. runs `npm pack --json`
3. installs the tarball in a temporary project
4. runs the installed `tokenhub-mcp` bin shim with `--help`
5. runs the installed bin shim with `--version`
6. checks expected stdout
7. removes the tarball and temporary directory

## Eval Evidence

Release eval artifacts live in:

- `artifacts/evals/resolve-request-eval.json`
- `artifacts/evals/resolve-request-live-eval.json`

The local eval should pass all fixture prompts. The live eval uses DuckDuckGo and fetched pages, so a failure can reflect provider or network volatility; investigate before publishing.

## Publish Checklist

1. Confirm `git status --short` is clean.
2. Run `npm run verify:release`.
3. Confirm no `tokenhub-mcp-*.tgz` tarball remains in the repo root.
4. Review `npm pack --dry-run --json` contents.
5. Run `tokenhub-mcp extensions lint --root <fixture>` against at least one extension manifest fixture when extension behavior changed.
6. Confirm `CHANGELOG.md`, `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, and `.github/workflows/ci.yml` are present and current.
7. Tag the release commit.
8. Publish to npm from the verified commit.
9. Confirm `npx tokenhub-mcp --version` resolves to the published version.

## Rollback

If a bad npm release is published:

1. publish a fixed patch version
2. document the broken version in release notes
3. avoid unpublishing unless the package meets npm's narrow unpublish criteria
4. keep Git tags immutable unless the tag itself points to the wrong commit before public use
