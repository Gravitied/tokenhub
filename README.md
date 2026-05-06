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

The benchmark downloads or invokes free baselines through `npx`, `uvx`, local Git CLI tools, public APIs, Playwright, SQL.js, and raw provider payloads, then compares TokenHub on expected facts, secret redaction, resource-link behavior, and estimated token usage. Reports are written to `artifacts/benchmarks/competitive-report.json`.
