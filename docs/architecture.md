# Architecture

TokenHub MCP is a Node.js and TypeScript Model Context Protocol server. Its main design constraint is keeping the always-loaded MCP surface small while still providing broad developer-tool behavior through server-side routing.

## Runtime Entry Points

| Path | Responsibility |
| --- | --- |
| `src/cli.ts` | CLI entrypoint. Parses `--root`, `--help`, and `--version`, then starts the MCP stdio transport. |
| `src/cli-options.ts` | Pure CLI argument parser used by tests and the entrypoint. |
| `src/server.ts` | Creates the runtime and registers the six public MCP tools. |
| `src/workflows/index.ts` | Dispatches named workflows such as `resolve_request`, `answer_from_web`, `validate`, `filesystem_action`, `git_action`, and `project_scan`. |
| `src/workflows/resolve-request.ts` | Runs dynamic request resolution and source strategy execution. |
| `src/extensions/` | Loads trusted-local extension manifests and adapts configured MCP stdio servers or command tools into TokenHub capabilities. |

## Public MCP Surface

The public tool surface is deliberately fixed at six tools:

- `discover_capabilities`
- `run_workflow`
- `retrieve_context`
- `read_resource`
- `capture_state`
- `estimate_cost`

This keeps clients lightweight. Feature-specific behavior is reached through a workflow name or retrieval source instead of separate top-level MCP tools.

User extensions follow the same rule. `tokenhub.extensions.json` entries are advertised as deferred `extension.<id>.<tool>` capabilities and are executed with the `extension_call` workflow.

## Internal Modules

| Module | Capability |
| --- | --- |
| `src/modules/filesystem.ts` | Workspace file search, tree listing, and opt-in trusted-local mutations. |
| `src/modules/git.ts` | Git status, diff, show, stage, commit, and branch summaries/actions. |
| `src/modules/web.ts` | Direct URL fetch and clean text scraping. |
| `src/modules/search.ts` | Search provider normalization and DuckDuckGo fallback. |
| `src/modules/answer-web.ts` | Search plus fetch workflow for cited answers. |
| `src/modules/database.ts` | SQLite and Postgres schema/query projection. |
| `src/modules/docs.ts` | npm package metadata and documentation lookup. |
| `src/modules/github.ts` | GitHub repo, issue, pull request, and workflow summaries. |
| `src/modules/sentry.ts` | Sentry issue fetching and clustering. |
| `src/modules/browser.ts` | Playwright-backed browser state capture. |

## Resource Store

Large outputs are stored by `ResourceStore` in `.tokenhub/resources` under the configured workspace root unless a custom resource directory is provided. Public responses return `tokenhub://resource/...` handles with metadata. Clients expand those handles with `read_resource`.

The resource store records:

- content bytes
- token estimate
- SHA-256 hash
- label
- source
- content kind

File and validation outputs are redacted before becoming model-facing responses.

## Request Resolution Flow

`resolve_request` converts a natural-language request into:

- intent
- source strategy
- output shape
- depth
- evidence mode
- execution mode

The workflow executes supported read/research paths and rejects unsupported implementation execution modes instead of pretending to mutate code.

## Extension Flow

At runtime startup, TokenHub loads an optional extension manifest from the workspace root, `--extensions <path>`, or `TOKENHUB_EXTENSIONS`. Valid entries are registered in the capability registry without changing the public MCP tool list.

When a caller runs `extension_call`, TokenHub resolves `extensionId` and `toolName` against the trusted manifest. Command extensions execute configured commands without a shell and receive JSON input on stdin. MCP extensions start the configured stdio server and call only tools named in the manifest allowlist. Large or raw extension output is redacted and stored as resources.

## Package Boundary

The npm package is intentionally small. The package allowlist includes only:

- `dist`
- `README.md`
- `LICENSE`
- `package.json`

Source files, tests, scripts, artifacts, local resources, and worktrees are not published.
