# Operations

This document covers day-to-day operation for TokenHub MCP.

## Install

Use Node.js 20 or newer.

```bash
npx tokenhub-mcp --root /path/to/workspace
```

For repeated local use:

```bash
npm install -g tokenhub-mcp
tokenhub-mcp --root /path/to/workspace
```

## Local Development

```bash
npm install
npm run build
node dist/cli.js --root .
```

## Health Checks

Before relying on a checkout:

```bash
npm run lint
npm test
npm run build
```

Check extension manifests before starting a client session:

```bash
tokenhub-mcp extensions lint --root /path/to/workspace
tokenhub-mcp extensions test --root /path/to/workspace --extension <id> --tool <name> --input-json '{}'
```

For the full production release gate:

```bash
npm run verify:release
```

## Smoke Testing The Published Shape

The install smoke script builds the package, creates an npm tarball, installs it into a temporary project, runs the installed `tokenhub-mcp` bin shim, verifies `--help` and `--version`, and cleans up generated files.

```bash
npm run smoke:install
```

## Common Operational Failures

| Symptom | Likely cause | Action |
| --- | --- | --- |
| `tokenhub-mcp` is not found | Package is not installed globally | Use `npx tokenhub-mcp ...` or run `npm install -g tokenhub-mcp`. |
| MCP client cannot start server | Bad command/args path | Confirm `--root` and the workspace path are separate args. |
| Search returns DuckDuckGo warning | No keyed search provider configured | Set a provider key or accept no-key fallback behavior. |
| Git source returns warnings | Workspace is not a git repo or git command failed | Start with a git repository root and inspect warning text. |
| Filesystem mutation rejected | Mutations are disabled by default | Restart TokenHub with `TOKENHUB_ENABLE_FS_MUTATIONS=true` for trusted workspaces. |
| Web or browser URL rejected | Target is localhost, private network, metadata, reserved, or DNS-unverified | Use public URLs by default; for trusted local debugging, restart TokenHub with `TOKENHUB_ALLOW_PRIVATE_NETWORK=true`. |
| Browser capture fails | Playwright/browser dependency or navigation issue | Install Playwright browsers and verify the target URL is reachable. |
| Repeated browser capture is slow | Browser pooling is disabled | For trusted local runs, set `TOKENHUB_ENABLE_BROWSER_POOL=true` and close the runtime cleanly when the MCP client exits. |
| Extension startup dominates latency | MCP extension pooling is disabled | Add `pool.enabled`, `pool.ttlMs`, and `pool.maxUses` to the trusted extension manifest entry. |
| Registry-installed extension has unknown tools | Installed without `--tools` | Either keep `"tools": ["*"]` and rely on advertised-tool verification, or edit the manifest with a concrete allowlist. |
| Workflow or source denied | `tokenhub.policy.json` or `TOKENHUB_POLICY` blocks it | Inspect the policy file or run `diagnostics_pack` for a redacted summary. |

## Diagnostics Packs

When reporting an operational issue, run the `diagnostics_pack` workflow. It stores a bounded JSON artifact with runtime, workspace index, git, source, workflow, policy, and extension status. TokenHub redacts `TOKENHUB_*` secret-looking environment variables before writing the pack.

## Maintenance Notes

- Keep `README.md` aligned with `tests/docs-contract.test.ts` and `tests/feature-contract.test.ts`.
- Keep `package.json.files` narrow. Tests expect only `dist`, `README.md`, `LICENSE`, and `package.json` in the npm package root.
- Runtime code builds into `dist`; benchmark and eval helpers build into `dist-bench` and are not published.
- Refresh eval artifacts only through the eval scripts.
- Do not commit `.tokenhub` resource data or generated package tarballs.
