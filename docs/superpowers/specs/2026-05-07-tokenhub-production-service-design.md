# TokenHub Production Service Design

## Goal

Make TokenHub MCP a production-ready npm-distributed MCP service that can be downloaded with `npx tokenhub-mcp`, run consistently on Windows, macOS, and Linux with Node 20+, and prove that every advertised public feature works as intended.

## Release Target

The first production target is the npm CLI package. Docker is intentionally deferred until the npm release contract is stable. The primary user path is:

```bash
npx tokenhub-mcp --root .
```

Local development remains:

```bash
npm install
npm run build
node dist/cli.js --root .
```

## Production Definition

Production-ready means the repository can produce a package that:

- Builds from a clean checkout with `npm run build`.
- Publishes only the intended runtime files through `npm pack`.
- Installs into a temporary project and starts the MCP server through the declared bin path.
- Works without optional provider credentials for local files, Git, web fetch/scrape, DuckDuckGo search fallback, SQLite, npm metadata, browser capture, validation, resources, and fixture-style Sentry issue summarization.
- Degrades clearly when optional provider credentials or external services are unavailable.
- Documents all supported tools, workflows, environment variables, limits, and known non-goals.
- Verifies every README-advertised capability with tests or evals that exercise the public runtime surface.

## Public Surface

TokenHub continues to expose exactly six always-loaded MCP tools:

- `discover_capabilities`
- `run_workflow`
- `retrieve_context`
- `read_resource`
- `capture_state`
- `estimate_cost`

Internal modules remain behind the registry and workflow layer. Productionization should not add new always-loaded tools.

## Feature Contract

The production service must verify these advertised capabilities:

| Capability | Required behavior | Verification evidence |
| --- | --- | --- |
| Capability discovery | Ranked compact manifests without full schemas | Unit tests for registry ranking and hidden schemas |
| Resource storage | Text/log/json/html snippets, ranges, full reads, hashes, and screenshot data URLs | Resource tests including binary screenshot readback |
| Filesystem retrieval | Workspace search with ignored generated folders, redacted summaries/resources, resource links | Retrieval tests with secret-looking values |
| Git summaries/actions | Status/log/diff summaries, safe stage/commit/branch paths, failed actions reported as failures | Integration tests in temporary repositories |
| Web fetch/scrape | Clean text extraction, source resources, bounded timeouts | Web cleanup and timeout tests |
| Web search | Brave/Exa/Tavily/SerpAPI when configured, DuckDuckGo no-key fallback otherwise | Provider-shape tests and live source-quality eval |
| `answer_from_web` | Search, fetch, synthesize summary or ranked list from sources with citations | Answer-web tests and resolve-request evals |
| `resolve_request` | Infer intent/source/output/depth, execute planned supported sources, reject unsupported implementation execution | Router corpus, fixture eval, live eval |
| Browser capture | Playwright state summary, element refs, console/network counts, screenshot resources | Local HTTP server integration test |
| SQLite/Postgres | Safe read-only inspection with row limits and redaction | SQLite tests and Postgres schema projection tests |
| npm docs lookup | Package metadata, versions, docs/changelog links | Package lookup tests |
| GitHub summary | Public repo, issues, PRs, workflow runs with optional auth | Injected-fetch integration test |
| Sentry summary | Issue clustering from raw issue payloads, optional live auth path | Sentry clustering test |
| Validation workflow | Runs configured commands, captures redacted logs as resources | Workflow validation tests |
| Packaging | `npm pack` contains expected files and the bin path starts | Install smoke test against generated tarball |

## Package And Compatibility Contract

The npm package must include:

- `dist/**`
- `README.md`
- `LICENSE`
- `package.json` metadata required for discoverability and support

The package must exclude:

- `src/**`
- `tests/**`
- `scripts/**`
- `.tokenhub/**`
- `.worktrees/**`
- `artifacts/**`
- local eval scratch files

Compatibility requirements:

- Node `>=20` remains the supported runtime range.
- The CLI must parse `--root <path>` and default to `process.cwd()`.
- The service must not depend on POSIX-only shell behavior.
- Path checks must work for Windows and POSIX separators.
- Network timeouts must prevent indefinite hangs.
- Optional capabilities must return clear errors or warnings when credentials are missing.

## Documentation Contract

README should be promoted from demo notes to production user documentation:

- Install and quick start.
- MCP client configuration examples.
- Public tool reference.
- Workflow reference for `validate`, `project_scan`, `filesystem_action`, `git_action`, `answer_from_web`, and `resolve_request`.
- Retrieval source reference for files, git, web, search, GitHub, browser, SQLite, Postgres, docs, and Sentry.
- Environment variables for Brave, Exa, Tavily, SerpAPI, GitHub, Postgres, and Sentry.
- Security notes for filesystem boundaries, secret redaction, destructive actions, and optional credentials.
- Troubleshooting for Playwright/browser dependencies, provider failures, timeouts, and package install issues.
- Verification and release checklist.

## Error Handling And Safety

Production behavior must be explicit:

- Unknown workflow names throw `Unknown workflow`.
- Unsupported implementation execution modes are rejected at schema/runtime boundaries.
- External fetch/search operations time out and report source-specific warnings.
- Failed Git actions summarize failure, not success.
- File resources store redacted content when generated by retrieval.
- Destructive filesystem actions stay constrained to the configured workspace root.
- Optional live integrations fail closed with actionable messages.

## Verification Gates

The production branch is not complete until these commands pass from the repository root:

```bash
npm test
npm run build
npm run lint
npm run eval:resolve-request
npm run eval:resolve-request:live
npm pack --dry-run
```

The implementation must also add an automated install smoke test that:

1. Builds the package.
2. Creates an npm tarball.
3. Installs the tarball into a temporary project.
4. Runs the installed `tokenhub-mcp` bin far enough to prove the declared entrypoint exists and starts.

## Non-Goals For First Production Milestone

- Docker image publishing.
- Hosted service deployment.
- Mutating GitHub operations.
- Live Postgres or Sentry tests that require real credentials in CI.
- Guaranteeing that every external provider returns fresh results at all times.
- Implementing file/code modifications through `resolve_request`.

## Acceptance Criteria

The work is accepted when:

- The npm package can be built, packed, installed, and started from a temporary project.
- README and package metadata describe the production contract accurately.
- Tests/evals cover each advertised feature in the feature contract table.
- Live network eval passes under normal network conditions and bounded timeouts prevent hangs when providers fail.
- `git diff --check`, `npm test`, `npm run build`, `npm run lint`, `npm run eval:resolve-request`, and `npm run eval:resolve-request:live` pass.
- Any generated proof or eval artifacts included in the repository correspond to the latest verification run.
