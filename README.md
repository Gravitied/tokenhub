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

Internal modules cover filesystem retrieval, Git summaries, web fetch/scrape, validation workflows, resource storage, and token telemetry. Large outputs are stored as `tokenhub://resource/...` handles and can be progressively expanded.

## Token ROI Rule

Every capability records estimated tool cost, estimated saved tokens, output tokens, and whether it clears the default graduation threshold:

```text
estimated_saved_tokens >= 3 * estimated_tool_cost_tokens
```

## Optional Providers

The first public slice runs locally with no provider keys. Future provider hooks are planned for Brave, Exa, Tavily, SerpAPI, Browserbase, GitHub, databases, and observability systems.

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

The benchmark downloads or invokes free baselines through `npx`, `uvx`, and local Git CLI tools, then compares TokenHub on expected facts, secret redaction, resource-link behavior, and estimated token usage. Reports are written to `artifacts/benchmarks/competitive-report.json`.
