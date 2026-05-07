# TokenHub Production Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn TokenHub into a production-ready npm-distributed MCP service that users can download, run on Windows/macOS/Linux with Node 20+, and trust that every advertised feature either works or reports a clear optional-provider limitation.

**Architecture:** Keep the existing MCP server, tool modules, workflows, and eval harness. Add production packaging checks, a safe CLI argument layer, cross-platform workspace path handling, release smoke testing, and docs contract tests. Preserve the six public MCP tools.

**Tech Stack:** TypeScript, Node.js 20+, Vitest, npm package distribution, MCP SDK, existing module/workflow structure.

---

## File Structure

Production code:

- `src/cli.ts` - CLI entrypoint; add help/version handling through a testable parser.
- `src/cli-options.ts` - new pure parser for CLI options and validation results.
- `src/core/workspace-path.ts` - new cross-platform workspace path resolver.
- `src/modules/filesystem.ts` - use the shared workspace path resolver.
- `src/server.ts` - keep server creation stable while supporting CLI validation output.
- `package.json` - production metadata, package file allowlist, release scripts, bin contract.
- `README.md` - install, MCP client config, tool/workflow/source reference, env vars, security, troubleshooting, release checklist.
- `LICENSE` - package-required license file.

Tests and scripts:

- `tests/cli.test.ts` - CLI parser and help/version behavior.
- `tests/workspace-path.test.ts` - Windows and POSIX path containment cases.
- `tests/packaging.test.ts` - npm package contents and public entrypoint contract.
- `tests/docs-contract.test.ts` - README headings and advertised feature coverage.
- `scripts/smoke-install.mjs` - build, pack, install into a temporary project, and start installed entrypoint through non-hanging CLI commands.

Verification artifacts:

- `artifacts/evals/resolve-request-eval.json`
- `artifacts/evals/resolve-request-live-eval.json`

---

## Implementation Tasks

### 1. Lock The CLI Contract With Failing Tests

- [ ] Add `tests/cli.test.ts` with tests for `parseCliArgs(argv, packageVersion)`.
- [ ] Assert `[]` returns `{ kind: "start", root: process.cwd() }`.
- [ ] Assert `["--root", "C:\\work"]` returns `{ kind: "start", root: "C:\\work" }` on Windows paths.
- [ ] Assert `["--root"]` returns `{ kind: "error", code: "missing-root" }`.
- [ ] Assert `["--help"]` returns `{ kind: "help", text: string }` and includes `npx tokenhub-mcp --root`.
- [ ] Assert `["--version"]` returns `{ kind: "version", text: packageVersion }`.
- [ ] Assert an unknown flag returns `{ kind: "error", code: "unknown-argument" }`.
- [ ] Run `npm test -- tests/cli.test.ts` and confirm it fails because `src/cli-options.ts` does not exist.

### 2. Implement The CLI Parser And Wire It Into The Entry Point

- [ ] Create `src/cli-options.ts` with a pure `parseCliArgs` function and exported result types.
- [ ] Support `--root <path>`, `--help`, `-h`, `--version`, and `-v`.
- [ ] Return structured errors instead of throwing from the parser.
- [ ] Update `src/cli.ts` to use `parseCliArgs`.
- [ ] For `help` and `version`, print to stdout and exit with code `0` without starting stdio transport.
- [ ] For parser errors, print a short message to stderr, print help to stderr, and exit with code `1`.
- [ ] For `start`, call `startServer({ root })` as it does today.
- [ ] Run `npm test -- tests/cli.test.ts` and confirm it passes.
- [ ] Run `npm run build` and confirm `dist/cli.js` is emitted.

### 3. Add Cross-Platform Workspace Path Tests First

- [ ] Add `tests/workspace-path.test.ts`.
- [ ] Cover POSIX containment:
  - [ ] `resolveWorkspacePath("/repo", "src/a.ts")` resolves inside `/repo`.
  - [ ] `resolveWorkspacePath("/repo", "../secret.txt")` returns a rejection result.
- [ ] Cover Windows containment using `path.win32` semantics:
  - [ ] `resolveWorkspacePath("C:\\repo", "src\\a.ts")` resolves inside `C:\\repo`.
  - [ ] `resolveWorkspacePath("C:\\repo", "..\\secret.txt")` returns a rejection result.
  - [ ] `resolveWorkspacePath("C:\\repo", "D:\\other\\secret.txt")` returns a rejection result.
- [ ] Cover root equality:
  - [ ] resolving `"."` inside the root is allowed.
- [ ] Run `npm test -- tests/workspace-path.test.ts` and confirm it fails because `src/core/workspace-path.ts` does not exist.

### 4. Implement Shared Workspace Path Resolution

- [ ] Create `src/core/workspace-path.ts`.
- [ ] Export `resolveWorkspacePath(root, requestedPath, options?)`.
- [ ] Return a discriminated union:

```ts
type WorkspacePathResult =
  | { ok: true; path: string }
  | { ok: false; reason: "outside-workspace" | "invalid-path"; message: string };
```

- [ ] Use `path.win32` when the root or requested path has a Windows drive/UNC shape.
- [ ] Use `path.posix` when both paths are POSIX-shaped.
- [ ] Use native `path` for ordinary relative paths on the current platform.
- [ ] Normalize case only for Windows comparisons.
- [ ] Update `src/modules/filesystem.ts` to call `resolveWorkspacePath` for read/write/list/delete operations.
- [ ] Preserve existing filesystem tool response shapes and upgrade unsafe-path responses to clear user-facing errors.
- [ ] Run `npm test -- tests/workspace-path.test.ts tests/integrations.test.ts tests/core.test.ts`.

### 5. Add Package Contents Tests Before Manifest Edits

- [ ] Add `tests/packaging.test.ts`.
- [ ] Use Node `child_process.execFile` to run `npm pack --dry-run --json`.
- [ ] Parse the JSON output and inspect the first package entry.
- [ ] Assert package contents include:
  - [ ] `package/dist/cli.js`
  - [ ] `package/dist/server.js`
  - [ ] `package/package.json`
  - [ ] `package/README.md`
  - [ ] `package/LICENSE`
- [ ] Assert package contents do not include:
  - [ ] `package/src/`
  - [ ] `package/tests/`
  - [ ] `package/scripts/`
  - [ ] `package/artifacts/`
  - [ ] `package/.tokenhub/`
  - [ ] `package/.worktrees/`
- [ ] Assert `package.json` has `bin.tokenhub-mcp`, `engines.node`, `files`, `license`, `description`, and `keywords`.
- [ ] Run `npm test -- tests/packaging.test.ts` and confirm the missing metadata or missing `LICENSE` failure is visible.

### 6. Make The npm Package Downloadable And Minimal

- [ ] Add `LICENSE` with the package license declared in `package.json`.
- [ ] Update `package.json`:
  - [ ] Ensure `"type": "module"` remains unchanged.
  - [ ] Keep `"bin": { "tokenhub-mcp": "dist/cli.js" }`.
  - [ ] Set `"engines": { "node": ">=20" }`.
  - [ ] Set `"files": ["dist", "README.md", "LICENSE", "package.json"]`.
  - [ ] Add production description and keywords.
  - [ ] Add `"smoke:install": "node scripts/smoke-install.mjs"`.
  - [ ] Add `"verify:release": "npm run lint && npm test && npm run build && npm run eval:resolve-request && npm run eval:resolve-request:live && npm pack --dry-run && npm run smoke:install"`.
- [ ] Run `npm run build`.
- [ ] Run `npm test -- tests/packaging.test.ts`.
- [ ] Run `npm pack --dry-run --json` and inspect that only intended files are included.

### 7. Add Install Smoke Test Script

- [ ] Create `scripts/smoke-install.mjs`.
- [ ] Build the package with `npm run build`.
- [ ] Create a temporary directory under the OS temp folder.
- [ ] Run `npm pack --json` in the repo root.
- [ ] Install the generated tarball into the temporary directory with `npm install <tarball> --ignore-scripts`.
- [ ] Run `node node_modules/tokenhub-mcp/dist/cli.js --help` and assert exit code `0`.
- [ ] Run `node node_modules/tokenhub-mcp/dist/cli.js --version` and assert exit code `0`.
- [ ] Remove the generated tarball from the repo root after the script completes.
- [ ] Clean the temporary directory after success or failure.
- [ ] Run `npm run smoke:install` and confirm it passes.

### 8. Add README Contract Tests Before Rewriting Docs

- [ ] Add `tests/docs-contract.test.ts`.
- [ ] Read `README.md`.
- [ ] Assert these exact headings exist:
  - [ ] `## Install`
  - [ ] `## Quick Start`
  - [ ] `## MCP Client Configuration`
  - [ ] `## Tools`
  - [ ] `## Workflows`
  - [ ] `## Retrieval Sources`
  - [ ] `## Environment Variables`
  - [ ] `## Security Notes`
  - [ ] `## Troubleshooting`
  - [ ] `## Release Verification`
- [ ] Assert all public tools are documented:
  - [ ] `resolve_request`
  - [ ] `answer_from_web`
  - [ ] `web_fetch`
  - [ ] `web_search`
  - [ ] `filesystem`
  - [ ] `git`
- [ ] Assert all retrieval sources are documented:
  - [ ] `browser`
  - [ ] `sqlite`
  - [ ] `postgres`
  - [ ] `npm`
  - [ ] `github`
  - [ ] `sentry`
  - [ ] `filesystem`
  - [ ] `git`
  - [ ] `web`
- [ ] Run `npm test -- tests/docs-contract.test.ts` and confirm it fails on the current README.

### 9. Rewrite README As Production Documentation

- [ ] Update `README.md` to document the exact npm install and `npx` paths:
  - [ ] `npx tokenhub-mcp --root /path/to/workspace`
  - [ ] `npm install -g tokenhub-mcp`
  - [ ] `tokenhub-mcp --root /path/to/workspace`
- [ ] Add MCP client JSON examples for local package execution and global install.
- [ ] Add a concise public tool reference for the six tools and their production status.
- [ ] Add a workflow reference for `resolve_request`, `answer_from_web`, and validation behavior.
- [ ] Add a retrieval source table with required configuration, supported operations, and clear optional-provider errors.
- [ ] Add environment variable documentation for web search, GitHub, Sentry, Postgres, npm registry, browser capture, and network timeouts.
- [ ] Add security notes for workspace confinement, file deletion, git operations, network fetches, secrets, and redacted resources.
- [ ] Add troubleshooting entries for missing credentials, blocked network, package install issues, Windows path quoting, and unsupported workflow modes.
- [ ] Add release verification commands matching `verify:release`.
- [ ] Run `npm test -- tests/docs-contract.test.ts`.

### 10. Add Feature Evidence Contract Test

- [ ] Add `tests/feature-contract.test.ts`.
- [ ] Define a table of advertised capabilities and evidence files:
  - [ ] tools registered in `src/server.ts`
  - [ ] workflows in `src/workflows/index.ts`
  - [ ] retrieval sources in `src/core/resources.ts`
  - [ ] eval artifacts under `artifacts/evals`
  - [ ] README sections from `tests/docs-contract.test.ts`
- [ ] Assert every public tool name in the README appears in `src/server.ts`.
- [ ] Assert every documented retrieval source appears in `src/core/resources.ts`.
- [ ] Assert every workflow in README appears in `src/workflows/index.ts`.
- [ ] Assert local and live eval artifact files contain passing `pass: true` cases.
- [ ] Run `npm test -- tests/feature-contract.test.ts` and confirm failures identify contract drift.

### 11. Run Focused Regression And Repair Any Breakage

- [ ] Run `npm test -- tests/cli.test.ts tests/workspace-path.test.ts tests/packaging.test.ts tests/docs-contract.test.ts tests/feature-contract.test.ts`.
- [ ] Fix the smallest production-code or docs issue for each failing assertion.
- [ ] Run `npm test -- tests/integrations.test.ts tests/request-router.test.ts tests/resolve-request.test.ts tests/retrieval.test.ts`.
- [ ] Fix only regressions caused by this productionization work.
- [ ] Run `npm run build`.

### 12. Run Full Release Verification

- [ ] Run `npm run lint`.
- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Run `npm run eval:resolve-request`.
- [ ] Run `npm run eval:resolve-request:live`.
- [ ] Run `npm pack --dry-run --json`.
- [ ] Run `npm run smoke:install`.
- [ ] Run `git diff --check`.
- [ ] Record any command failure with the exact command, top failure cause, and next repair step.

### 13. Final Production Audit

- [ ] Map each approved spec requirement to evidence:
  - [ ] Downloadable npm package: `npm pack --dry-run --json` and `npm run smoke:install`.
  - [ ] Universal compatibility: CLI path tests for Windows/POSIX and Node `engines`.
  - [ ] Public tools work: unit/integration/eval coverage and server registration test.
  - [ ] Optional providers degrade clearly: integration tests and README source table.
  - [ ] No hollow features: feature evidence contract test.
  - [ ] No hardcoded results: eval artifacts generated by current eval commands.
  - [ ] Production docs: docs contract test.
- [ ] Inspect `git diff --stat` and `git diff --check`.
- [ ] Confirm no unrelated files were reverted.
- [ ] Present concise completion evidence to the user.

---

## Commit Plan

- [ ] Commit CLI parser and workspace path hardening after tasks 1-4 pass.
- [ ] Commit packaging and smoke install after tasks 5-7 pass.
- [ ] Commit docs and feature contract after tasks 8-10 pass.
- [ ] Commit final fixes after tasks 11-13 pass.

Each commit message should use the form `fix: ...`, `test: ...`, or `docs: ...` and describe the production guarantee it adds.
