# TokenHub MCP

TokenHub MCP is a production-packaged Model Context Protocol server for coding agents. It keeps the always-loaded MCP surface small, then routes larger file, git, web, database, package, browser, GitHub, and Sentry work through token-budgeted tools, workflows, and `tokenhub://resource/...` artifacts.

## Install

Run without installing:

```bash
npx tokenhub-mcp --root /path/to/workspace
```

Install globally:

```bash
npm install -g tokenhub-mcp
tokenhub-mcp --root /path/to/workspace
```

For local development from this repository:

```bash
npm install
npm run build
node dist/cli.js --root /path/to/workspace
```

When serving the repository root itself during local development:

```bash
node dist/cli.js --root .
```

Diagnostics are silent by default. For local debugging, emit structured JSON lines to stderr with either a CLI flag or environment variable:

```bash
TOKENHUB_LOG_LEVEL=debug npx tokenhub-mcp --root /path/to/workspace
npx tokenhub-mcp --root /path/to/workspace --log-level info
```

## Quick Start

Start TokenHub with a workspace root that should bound filesystem and git operations:

```bash
npx tokenhub-mcp --root /path/to/workspace
```

Then call the public MCP tool `run_workflow` with an advertised workflow capability:

```json
{
  "name": "resolve_request",
  "request": "Inspect this repository and summarize the main architecture, runtime stack, and entry points.",
  "depth": "standard",
  "evidence": "resource_links",
  "execution": "answer_only"
}
```

Large or raw outputs are returned as redacted `tokenhub://resource/...` handles. Use `read_resource` to expand snippets, ranges, or full resource content.

## Documentation

The README is the quick production reference. The full project docs live under `docs/`:

| Document | Purpose |
| --- | --- |
| [Docs index](docs/README.md) | Navigation for operators, contributors, and release owners. |
| [Architecture](docs/architecture.md) | Runtime layout, tool surface, workflows, resources, and package boundaries. |
| [Configuration](docs/configuration.md) | CLI flags, MCP client setup, provider inputs, and environment variables. |
| [Operations](docs/operations.md) | Install, run, validate, smoke test, troubleshoot, and maintain the service. |
| [Security](docs/security.md) | Workspace confinement, mutation opt-in, credential handling, and network boundaries. |
| [Release](docs/release.md) | Release checklist, verification evidence, npm packaging contract, and rollback notes. |

Public release support files:

- [CHANGELOG.md](CHANGELOG.md) records user-facing changes by version.
- [CONTRIBUTING.md](CONTRIBUTING.md) explains local setup, testing, and contribution expectations.
- [SECURITY.md](SECURITY.md) explains how to report vulnerabilities and what versions are supported.
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) sets the baseline for community behavior.

## MCP Client Configuration

Local package execution with `npx`:

```json
{
  "mcpServers": {
    "tokenhub": {
      "command": "npx",
      "args": ["tokenhub-mcp", "--root", "/path/to/workspace"]
    }
  }
}
```

Global install:

```json
{
  "mcpServers": {
    "tokenhub": {
      "command": "tokenhub-mcp",
      "args": ["--root", "/path/to/workspace"]
    }
  }
}
```

On Windows, quote paths in your MCP client JSON as a single JSON string, for example `"C:\\Users\\you\\project"`.

## Tools

TokenHub exposes exactly six public MCP tools:

| Tool | Production status | Purpose |
| --- | --- | --- |
| `discover_capabilities` | Production | Finds deferred internal capabilities without loading every schema into the client context. |
| `run_workflow` | Production | Runs server-side workflows such as `resolve_request`, `answer_from_web`, `validate`, `filesystem_action`, `git_action`, and `project_scan`. |
| `retrieve_context` | Production | Retrieves token-budgeted context from runtime sources including files, git, web pages, search, databases, GitHub, npm docs, Sentry, and browser state. |
| `read_resource` | Production | Reads a `tokenhub://resource/...` artifact by snippet, line range, or full content. |
| `capture_state` | Production | Stores caller-provided logs, snapshots, or state summaries as resource artifacts. |
| `estimate_cost` | Production | Estimates tool cost, saved tokens, and whether the operation clears the default ROI threshold. |

The user-facing advertised capabilities in this README are `resolve_request`, `answer_from_web`, `web_fetch`, `web_search`, `filesystem`, and `git`. Those are not separate top-level MCP tools; they are workflows or retrieval capabilities reached through the six public tools above.

## Workflows

| Workflow | Invoke through | Behavior |
| --- | --- | --- |
| `resolve_request` | `run_workflow` | Infers intent, source strategy, output shape, depth, evidence mode, and execution mode from a natural-language request. It supports `answer_only` and `plan_only`; implementation execution modes are rejected instead of faking success. |
| `answer_from_web` | `run_workflow` | Searches the web, fetches source pages, extracts clean text, and returns cited ranked-list or summary answers with source resource links. |
| `validate` | `run_workflow` | Runs allowlisted validation commands (`npm test`, `npm run lint`, or `npm run build`), redacts secret-looking output, stores the full validation log as a resource, and reports pass/fail warnings. |
| `filesystem_action` | `run_workflow` | Lists a workspace tree by default. Write, move, and delete require the service process to be started with `TOKENHUB_ENABLE_FS_MUTATIONS=true`. |
| `git_action` | `run_workflow` | Runs bounded git status, diff, show, stage, commit, or branch operations inside the configured workspace. |
| `project_scan` | `run_workflow` | Combines git summary and filesystem search into compact project context. |

Example web answer:

```json
{
  "name": "answer_from_web",
  "query": "top 10 healthiest vegetables",
  "target": "ranked_list",
  "limit": 10,
  "sourceLimit": 5
}
```

Validation example:

```json
{
  "name": "validate",
  "command": "npm",
  "args": ["test"]
}
```

Unsupported workflow modes, including `execution: "implement"` and `execution: "implement_and_verify"` for `resolve_request`, return explicit errors rather than claiming a mutation happened.

## Retrieval Sources

`retrieve_context.source` uses the runtime names shown below. The docs also name friendly advertised sources where they differ.

| Documented source | Runtime source | Required configuration | Supported operations | Optional-provider errors |
| --- | --- | --- | --- | --- |
| `filesystem` | `files` | `--root`; optional `query`, `limit`, `budgetTokens` | Search workspace files, return redacted snippets and resource links | Missing matches return empty results; workspace escape attempts are rejected. |
| `git` | `git` | `--root` in a git repository | Summarize status, recent commits, diff stats, and raw log resource | Non-repositories return warnings instead of raw git floods. |
| `web` / `web_fetch` | `web` | `url` | Fetch and scrape one web page with timeout and optional raw resource | Missing `url` errors; HTTP failures include status. |
| `web_search` | `search` | `query`; optional `provider` and `apiKey` | Search Brave, Exa, Tavily, SerpAPI, or no-key DuckDuckGo fallback | Provider-specific modes error when the required API key is absent. |
| `github` | `github` | `owner` and `repo`; optional `token` | Summarize repo, issues, PRs, and workflow runs | Missing owner/repo errors; private or rate-limited repos need a token. |
| `sqlite` | `sqlite` | `databaseBase64`; optional read-only `query` | Inspect schema and safe `SELECT` rows | Missing database bytes errors; non-SELECT queries return warnings and no rows. |
| `postgres` | `postgres` | `connectionString`; optional read-only `query` | Inspect public schema and safe `SELECT` rows | Missing connection string errors; auth/network failures come from `pg`. |
| `npm` | `docs` | `packageName` or `query` | Fetch npm registry metadata, latest version, docs, repository, and releases link | Missing package/query errors; registry HTTP failures include status. |
| `sentry` | `sentry` | `issues` array, or `organization` plus `token`; optional `project` | Summarize and cluster issue impact | Missing issues or organization/token errors; Sentry API HTTP failures include status. |
| `browser` | `browser` | `url`; Playwright browser dependencies installed | Capture title, headings, links, form controls, console errors, failed requests, and optional screenshot | Missing URL errors; navigation timeout is currently 20000ms. |

## Environment Variables

| Variable | Used for |
| --- | --- |
| `BRAVE_SEARCH_API_KEY` | Selects Brave as the default `web_search` provider and authenticates Brave Search. |
| `EXA_API_KEY` | Selects Exa as the default search provider when Brave is not set. |
| `TAVILY_API_KEY` | Selects Tavily as the default search provider when Brave and Exa are not set. |
| `SERPAPI_API_KEY` | Selects SerpAPI as the default search provider when the other keyed providers are not set. |
| `TOKENHUB_ENABLE_FS_MUTATIONS` | When set to `true`, enables trusted-local filesystem write, move, and delete workflows. Leave unset for read/list behavior. |
| `TOKENHUB_ALLOW_PRIVATE_NETWORK` | When set to `true`, allows trusted-local web and browser retrieval of localhost, private LAN, and other non-public network targets. Leave unset for public-network-only retrieval. |
| `TOKENHUB_LOG_LEVEL` | Optional diagnostic logging level: `error`, `info`, or `debug`. Logs are JSON lines on stderr and are silent when unset. |

GitHub tokens are supplied as `retrieve_context` input `token`; there is no dedicated GitHub environment variable in the runtime. Sentry tokens are supplied as `token`, Postgres uses `connectionString`, npm registry lookup uses the public registry URL, and browser capture uses local Playwright without a credential variable. Network timeouts are currently fixed in code: web fetch and DuckDuckGo search use 5000ms, browser navigation uses 20000ms, git commands use 10000ms, and validation commands use 120000ms.

## Security Notes

TokenHub confines filesystem paths to the configured `--root` workspace and rejects path escapes, including symlink-realpath escapes for mutation targets. File snippets and stored file resources redact secret-looking values before model-facing output.

File deletion and mutation are opt-in. `filesystem_action` `tree` is available by default, but write, move, and delete require `TOKENHUB_ENABLE_FS_MUTATIONS=true` on the TokenHub process; use it only in trusted local workspaces.

Git operations run in the workspace and can stage, commit, or branch when explicitly requested through `git_action`. Review paths and messages before allowing agent-driven git changes.

Network fetches, search providers, GitHub, npm, Sentry, Postgres, and browser capture can contact external services. Web and browser retrieval reject localhost, private LAN, metadata, and unverified DNS targets by default; set `TOKENHUB_ALLOW_PRIVATE_NETWORK=true` only for trusted local network debugging. Treat URLs, credentials, connection strings, and returned third-party content as sensitive. Do not place secrets in prompts when they can be passed as tool input, and prefer resource links over copying raw logs into chat.

`read_resource` can expand redacted resources; screenshots may still contain visible secrets from the captured page. Share resource URIs only with clients that should have access to the workspace resource store.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Missing search credentials | Use no-key DuckDuckGo fallback by omitting `provider`, or set `BRAVE_SEARCH_API_KEY`, `EXA_API_KEY`, `TAVILY_API_KEY`, or `SERPAPI_API_KEY`. |
| GitHub, Sentry, or Postgres credential errors | Pass `token` for GitHub/Sentry or `connectionString` for Postgres in the MCP request. TokenHub does not read dedicated env vars for those providers today. |
| Blocked network or provider timeout | Check outbound HTTPS access to the provider URL. Web fetch/search timeouts are currently fixed at 5000ms. |
| Package install issues | Use Node 20 or newer, then retry `npx tokenhub-mcp --root /path/to/workspace` or `npm install -g tokenhub-mcp`. |
| Windows path quoting | In MCP JSON, write paths as one escaped string such as `"C:\\Users\\you\\workspace"` and keep `--root` and the path as separate args. |
| Unsupported workflow mode | Use `execution: "answer_only"` or `execution: "plan_only"` for `resolve_request`; direct implementation modes are intentionally rejected. |
| Filesystem mutation blocked | Restart TokenHub with `TOKENHUB_ENABLE_FS_MUTATIONS=true` only for trusted local workspaces. |
| Need request-level diagnostics | Restart TokenHub with `--log-level debug` or `TOKENHUB_LOG_LEVEL=debug`. Logs include tool start/end/error events, request IDs, durations, and redacted metadata on stderr. |

## Release Verification

Run the production release gate:

```bash
npm run verify:release
```

The script expands to:

```bash
npm run lint
npm test
npm run build
npm run eval:resolve-request
npm run eval:resolve-request:live
npm pack --dry-run
npm run smoke:install
```

Eval artifacts are written under `artifacts/evals`. The live eval uses live DuckDuckGo search and page fetches, so failures can reflect network or provider volatility.
