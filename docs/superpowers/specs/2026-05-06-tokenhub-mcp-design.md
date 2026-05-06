# TokenHub MCP Design

## Goal

Build `tokenhub-mcp`, a single installable developer MCP server that exposes six small top-level tools while routing to a larger internal capability library only when the agent asks for it.

## Research Notes

- OpenAI's Agents SDK documents hosted MCP lazy loading through `ToolSearchTool` and `defer_loading`, which supports the product choice to keep large tool definitions out of the model context until needed.
- Anthropic's Claude Code MCP docs say Tool Search defers MCP tools and loads only the tools Claude uses; the same docs warn when MCP outputs exceed token limits and describe resource references for large content.
- Anthropic's tool-use docs explain that tool definitions are injected into a tool-use system prompt, so every always-loaded schema has an ongoing context cost.
- Microsoft's Playwright MCP README says coding agents may benefit from CLI-style workflows because they avoid loading large schemas and verbose accessibility trees into model context.

Sources:

- https://openai.github.io/openai-agents-python/mcp/
- https://code.claude.com/docs/en/mcp
- https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools
- https://github.com/microsoft/playwright-mcp/blob/main/README.md

## Architecture

The MCP surface is intentionally small:

- `discover_capabilities`
- `run_workflow`
- `retrieve_context`
- `read_resource`
- `capture_state`
- `estimate_cost`

Internal capabilities live in a deferred registry. Each module advertises a compact manifest with keywords, supported actions, default budgets, and cost hints. `discover_capabilities` ranks manifests without exposing full internal schemas. `run_workflow` executes known multi-step workflows server-side. `retrieve_context` searches files, web pages, docs, logs, and repo state under a token budget. `read_resource` progressively expands handles returned by other tools. `capture_state` stores screenshots, logs, and test artifacts as resource handles. `estimate_cost` predicts token spend before expensive work.

## Initial Build Scope

The first implementation ships the core architecture and practical primitives:

- Token telemetry with an ROI threshold of `estimated_saved_tokens >= 3 * estimated_tool_cost`.
- Deferred capability registry with ranked discovery.
- Resource store with snippets, line ranges, full reads, hashes, and token budgets.
- Filesystem retrieval with ignore rules and resource links.
- Git retrieval with status/diff/log summaries.
- Web search/fetch/scrape primitives with provider hooks and no-key fallback where possible.
- GitHub public repo/issue summaries with optional token auth.
- Browser compact state capture using Playwright internally, with screenshots stored as resources.
- SQLite and Postgres schema/query inspection with safe read-only limits.
- npm package docs/version lookup and optional provider expansion for docs systems.
- Sentry issue clustering with optional token auth and fixture/raw issue summarization.
- Testing workflow that runs lint/build/test commands, summarizes failures, and stores raw output as resources.
- Browser state capture using Playwright internally for PNG screenshots without exposing Playwright's full schema.
- A proof page and PNG screenshot showing the local verification result.

## Data Flow

Requests enter one of the six top-level MCP tools. The tool validates budget options, asks the registry for candidate modules, runs the selected module or workflow, stores large artifacts in the resource store, and records telemetry. Responses return summaries, snippets, resource IDs, token estimates, confidence, and cursors instead of raw large payloads by default.

## Error Handling

All module responses include structured warnings and resource links when raw output was truncated. Destructive filesystem or Git actions are out of scope for the initial public version. Secrets are redacted from command output before summaries or resources are returned.

## Testing

The test suite covers telemetry ROI decisions, discovery ranking, resource reads, filesystem retrieval, Git summaries, workflow summaries, and screenshot proof generation. Verification requires `npm test`, `npm run build`, and generation of a PNG proof artifact.
