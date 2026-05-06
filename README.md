# TokenHub MCP

TokenHub MCP is a single developer MCP server with a tiny always-loaded surface and a deferred internal capability library for common coding-agent work.

## Install

```bash
npx tokenhub-mcp
```

Local development:

```bash
npm install
npm run build
node dist/src/cli.js --root .
```

## Always-Loaded Tools

TokenHub exposes only six public tools:

- `discover_capabilities`
- `run_workflow`
- `retrieve_context`
- `read_resource`
- `capture_state`
- `estimate_cost`

Internal modules cover filesystem retrieval, Git summaries, GitHub, web fetch/scrape, web search provider hooks, browser state capture, SQLite/Postgres inspection, npm package docs lookup, Sentry issue summaries, validation workflows, resource storage, and token telemetry. Large outputs are stored as `tokenhub://resource/...` handles and can be progressively expanded.

`run_workflow` also includes `answer_from_web`, which searches the web, fetches source pages, scrapes clean text, extracts ranked/list candidates or summary snippets, and returns cited answers with `tokenhub://resource/...` context handles. Examples:

```json
{
  "name": "answer_from_web",
  "query": "top 10 most healthy vegetables",
  "target": "ranked_list",
  "limit": 10,
  "sourceLimit": 5
}
```

```json
{
  "name": "answer_from_web",
  "query": "1 paragraph summary of the latest DeepSeek research papers",
  "target": "summary",
  "sourceLimit": 5,
  "budgetTokens": 900
}
```

`run_workflow` also supports `resolve_request`, a dynamic workflow that infers intent, source strategy, output shape, depth, evidence, and execution mode from a natural-language request.

```json
{
  "name": "resolve_request",
  "request": "Give me a 1 paragraph summary of the latest DeepSeek research papers",
  "depth": "standard",
  "evidence": "resource_links"
}
```

For implementation research:

```json
{
  "name": "resolve_request",
  "request": "Look for similar professional optimized implementations of this feature and compare it to this code, then implement the gaps",
  "depth": "deep",
  "execution": "plan_only",
  "outputShape": "patch_plan"
}
```

## Token ROI Rule

Every capability records estimated tool cost, estimated saved tokens, output tokens, and whether it clears the default graduation threshold:

```text
estimated_saved_tokens >= 3 * estimated_tool_cost_tokens
```

## Optional Providers

The local slice runs without provider keys for filesystem, Git, fetch/scrape, SQLite, npm package lookup, browser capture, and fixture-based Sentry summaries. Optional keys unlock richer modes for Brave, Exa, Tavily, SerpAPI, GitHub, Postgres, and Sentry.

## Proof

Run:

```bash
npm test
npm run build
npm run proof
```

The proof command writes `artifacts/proof/tokenhub-proof.png`, a PNG screenshot generated from real local verification command results.

## Competitive Benchmarks

Run:

```bash
npm run bench
```

The benchmark downloads or invokes free baselines through `npx`, `uvx`, local Git CLI tools, public APIs, Playwright, SQL.js, and raw provider payloads, then compares TokenHub on expected facts, secret redaction, resource-link behavior, coverage, and estimated token usage. Reports are written to `artifacts/benchmarks/competitive-report.json`.

The report separates:

- `qualityScore`: calculated from expected facts, required patterns, forbidden leakage, and output bloat.
- `coverageScore`: calculated from declared capability overlap, parity level, and known gaps.
- `estimatedTokens`: output tokens plus tool overhead. TokenHub uses an amortized one-server session overhead because its six public tools are loaded once across the benchmark suite; standalone MCP/CLI/API baselines are charged per invoked baseline.
- `baselines`: whether each comparison is a live MCP call, CLI call, raw public API, or fixture-shaped provider payload.

Auth-gated competitors such as GitHub MCP, Sentry MCP, Brave Search MCP, and Postgres MCP are cataloged, but only run live when credentials are available.
