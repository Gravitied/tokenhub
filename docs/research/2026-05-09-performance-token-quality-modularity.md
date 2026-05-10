# TokenHub performance, token savings, quality, verbosity, and modularity research

Date: 2026-05-09

Scope: TokenHub MCP as currently implemented in this repository, with emphasis on methods that improve runtime performance, token cost, output faithfulness, caller-controlled verbosity, and long-term modularity.

## Executive summary

TokenHub is already pointed in the right direction: it exposes a small public MCP surface, defers capability details through discovery, stores large artifacts behind `tokenhub://resource/...` handles, and has benchmark and source-quality eval scaffolding. The strongest next improvements are not one magic optimization. They are a set of compounding design moves:

1. Replace the large `retrieve_context` switch with a source registry so every retrieval source owns its schema, token policy, compact projection, cache behavior, and tests.
2. Replace char-count token estimation with model/encoding-aware estimation plus per-source calibration.
3. Make verbosity a first-class input, not an accidental result of `budgetTokens` and `returnMode`.
4. Return structured MCP outputs plus resource links, not only JSON-as-text.
5. Add parallel retrieval with bounded concurrency, cancellation, and progress for multi-source workflows.
6. Add workspace and web caching with invalidation, ETag/Last-Modified support where available, resource dedupe by SHA-256, and delta reads.
7. Extend quality evals from "expected words and source count" to faithfulness, context precision, citation coverage, conflicting-source handling, and refusal/uncertainty behavior.
8. Pool expensive local adapters, especially MCP extension subprocesses and Playwright browser contexts, behind TTLs and health checks.
9. Split runtime core, built-in modules, extension adapters, and bench/eval code so production installs stay lean.

The practical target should be a TokenHub request envelope that can say: "give me `minimal`, `standard`, `detailed`, or `audit` output; spend up to N tokens; cite these evidence levels; use fresh or cached data; return structured JSON plus resource handles." That gives agents control, reduces retries, and makes results easier to benchmark.

## Current-state observations

- Public surface is small: `src/server.ts` exposes six public tools and a deferred capability registry. This aligns with MCP and OpenAI tool-search guidance.
- The retrieval implementation is centralized: `src/server.ts:132` through `src/server.ts:260` handles git, web, GitHub, search, databases, docs, Sentry, browser, and files in one branch chain. This is working, but it makes per-source quality, caching, verbosity, and schema evolution harder.
- Compact outputs exist but are uneven. `returnMode: "compact"` is implemented for search, SQLite, Sentry, browser, and files, while git, web, GitHub, Postgres, and docs mainly return their default shapes.
- Token estimation is rough. `src/core/token.ts:8` uses about one token per four characters. That is acceptable for coarse tests but weak for budget enforcement, truncation, ROI, and source selection.
- `answerFromWeb` fetches pages sequentially in `src/modules/answer-web.ts:65`, even though source fetches are independent and naturally bounded by `sourceLimit`.
- File search recursively reads files from Node (`src/modules/filesystem.ts:127`) instead of using an indexed search or an external fast search tool when available.
- MCP extensions are started and closed per call (`src/extensions/mcp-adapter.ts:25`). This is safest, but repeated calls pay process startup, initialization, and tool-list latency each time.
- Telemetry is in-memory only (`src/core/telemetry.ts:21`). That helps tests but cannot drive production trend analysis, cache tuning, or regression dashboards across runs.
- Source-quality evals exist (`src/bench/source-quality.ts:32`, `scripts/evaluate-live-resolve-request.mjs:128`), and the benchmark report says 9/9 tasks pass the current advantage gate. This is a good base, but current scoring is mostly coverage, presence, and compactness.
- Tool results are returned as serialized JSON text through `asToolResult` in `src/server.ts`, not MCP `structuredContent` or output-schema-validated content.

## Research signals that matter

The MCP draft spec explicitly says tool lists should be deterministic because stable ordering helps clients cache tool context and improves prompt-cache hit rates. It also supports resource links, embedded resources, structured content, output schemas, pagination, progress, cancellation, and explicit tool execution errors. Relevant sources:

- [MCP tools spec](https://modelcontextprotocol.io/specification/draft/server/tools)
- [MCP resources spec](https://modelcontextprotocol.io/specification/draft/server/resources)
- [MCP cancellation](https://modelcontextprotocol.io/specification/draft/basic/utilities/cancellation)
- [MCP progress](https://modelcontextprotocol.io/specification/draft/basic/utilities/progress)
- [MCP logging](https://modelcontextprotocol.io/specification/draft/server/utilities/logging)

OpenAI's prompt-caching guidance says cache hits require exact prefix matches, with static content first and variable content later. It also notes caching begins for prompts of 1024 tokens or more. This supports TokenHub's small, deterministic public surface and argues for stable schema order, stable capability manifests, and deferred/dynamic content at the end of agent context. Source: [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching).

OpenAI's tool-search guidance supports dynamically loading only the tool definitions needed at runtime, preserving cache by injecting loaded tools at the end of context. It recommends namespaces or MCP servers for better token savings, and keeping namespace groups under about 10 functions for efficiency and model performance. Source: [OpenAI tool search](https://developers.openai.com/api/docs/guides/tools-tool-search).

OpenAI's function calling and Structured Outputs docs support strict schemas and structured response formats to reduce retries and parsing failures. MCP has similar support through `structuredContent` and `outputSchema`. Sources: [OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling), [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs).

OpenAI's latency guide gives an important caution: reducing input tokens can lower latency, but for normal prompt sizes the latency gain may be small; the bigger benefits are cost, context reliability, and avoiding massive contexts. Source: [OpenAI latency optimization](https://developers.openai.com/api/docs/guides/latency-optimization).

The "Lost in the Middle" paper shows that models can use long context poorly when relevant information is buried in the middle. This supports ranking, pruning, deduping, and placing high-value evidence near the beginning or end of generated context instead of dumping long concatenations. Source: [Lost in the Middle](https://arxiv.org/abs/2307.03172).

The Ragas paper frames RAG evaluation around retrieval relevance/focus, faithful use of retrieved context, and generation quality. This maps directly to TokenHub's `answer_from_web` and `resolve_request` eval gaps. Source: [Ragas](https://arxiv.org/abs/2309.15217).

A 2026 prompt-caching study on long-horizon agentic tasks reports large cost and TTFT gains from prompt caching across providers, especially when dynamic tool results do not break static cached prefixes. Treat it as research evidence, not a product contract, but it strongly supports cache-stable tool and prompt layout. Source: [Don't Break the Cache](https://arxiv.org/abs/2601.06007).

OpenAI's token-counting cookbook notes that models consume text as tokens and that tokenizer choice varies by model. The page is archived, so use it as background rather than a current API guarantee. Source: [How to count tokens with tiktoken](https://developers.openai.com/cookbook/examples/how_to_count_tokens_with_tiktoken).

## Recommendation matrix

| Area | Recommendation | Expected impact | Effort |
| --- | --- | --- | --- |
| Performance | Add bounded parallel source fetches in web/research workflows | High for web-heavy tasks | Low |
| Performance | Add workspace file index and ripgrep-backed search fallback | High for large repos | Medium |
| Performance | Pool MCP extension clients and browser contexts with TTL cleanup | High for repeated calls | Medium |
| Token savings | Add tokenizer-aware token budgets and source calibration | High for budget correctness | Medium |
| Token savings | Make compact output profiles universal across sources | High | Medium |
| Quality | Add claim/evidence output schema and citation coverage scoring | High | Medium |
| Quality | Add faithfulness and conflict-handling evals | High | Medium |
| Verbosity | Add `responseProfile` and per-profile budgets | High | Low |
| Modularity | Replace retrieval switch with source registry | Very high long-term | Medium |
| Modularity | Split core runtime, built-ins, adapters, and bench/evals | Medium to high | Medium |

## Performance methods

### 1. Parallel retrieval with budgets and cancellation

Current issue: `answerFromWeb` searches, then fetches pages one at a time. A slow source delays every later source. Deep `resolve_request` tasks also combine local, docs, package, and web sources in fixed order.

Method:

- Fetch `sourceLimit` pages concurrently with a small cap, for example 3 to 5.
- Use `Promise.allSettled` so one bad source does not fail the whole answer.
- Pass an `AbortSignal` through `searchWeb`, `fetchAndScrape`, browser navigation, extension calls, and database calls.
- Track per-source timeout, total request deadline, and cancellation reason.
- Emit progress for multi-step workflows when MCP clients support it.

Why it helps:

- Latency becomes closer to the slowest selected source instead of the sum of all selected sources.
- User cancellation can stop DNS, fetch, browser, and subprocess work instead of waiting for timeouts.
- This aligns with MCP's cancellation and progress primitives.

Tests and metrics:

- Unit test that three delayed fetches complete in less than roughly two sequential delays.
- Integration test that one failed source still returns usable sources and warnings.
- Track `durationMs`, `sourceDurations`, `cancelled`, `timeout`, and `sourceFailures`.

### 2. Workspace file index and search backend selection

Current issue: `searchFiles` recursively walks and reads candidate files for every call. This is fine for fixtures, but it becomes expensive in real repositories.

Method:

- Maintain a workspace index keyed by path, mtime, size, and SHA-256.
- Exclude `.git`, `node_modules`, `dist`, generated artifacts, binary files, large files, lockfiles by default, and user-configurable globs.
- Prefer `rg --json` for literal/regex search when available; fall back to Node walking.
- Cache extracted snippets and line maps by `(path, mtime, size, query)`.
- Add `searchMode: "literal" | "regex" | "semantic-lite"` later, not at first.

Why it helps:

- Large repos stop paying full directory traversal on every request.
- `rg` already solves hard cases like ignores, binary detection, and fast line searching.
- Index metadata enables delta retrieval, which saves tokens and CPU.

Tests and metrics:

- Benchmark file search on synthetic repos with 1k, 10k, and 100k files.
- Assert ignored paths stay ignored.
- Track scanned files, read bytes, index hit rate, search backend, and elapsed time.

### 3. HTTP and resource caching

Current issue: web, docs, GitHub, npm, and Sentry retrieval always recompute unless upstream clients cache. Resource writes always create new resource IDs even when content is identical.

Method:

- Add a cache layer with keys derived from source type, normalized input, auth scope, and freshness policy.
- Store response metadata: URL, ETag, Last-Modified, fetchedAt, expiresAt, SHA-256, token count, and source confidence.
- Reuse existing resources when SHA-256 matches.
- Add caller policy: `freshness: "cache_ok" | "revalidate" | "network_only"` and optional `maxAgeSeconds`.
- Never share auth-scoped cache entries across tokens or tenants.

Why it helps:

- Repeated docs/package/repo questions become fast and cheap.
- Resource dedupe reduces disk growth and prevents memory pressure from repeated large artifacts.
- Freshness policy makes behavior explicit instead of surprising.

Tests and metrics:

- Verify public unauthenticated cache reuse.
- Verify token-scoped cache isolation.
- Verify stale cache revalidation fallback when network fails.
- Track cache hit/miss/stale, bytes read/written, and resource dedupe count.

### 4. Warm pools for expensive adapters

Current issue: MCP extension calls create a new `Client` and stdio transport for each call. Browser capture launches Chromium for each call.

Method:

- Add a small pool keyed by extension ID and command hash.
- Reuse MCP clients only after verifying the advertised tool list has not changed.
- Add TTL, idle timeout, max uses, max concurrent calls per extension, and crash cleanup.
- For browser, keep a browser process warm and create isolated contexts per capture.
- Close idle resources on process signals and runtime shutdown.

Why it helps:

- Extension and browser cold-start time can dominate short operations.
- It keeps plug-in MCPs useful for multi-step agent flows.

Safety tradeoff:

- Pools can create leaks or stale state. The safe design is bounded, observable, and easy to disable with `TOKENHUB_DISABLE_POOLS=true`.

Tests and metrics:

- Repeated extension calls should show cold vs warm latency improvement.
- Stress test 100 calls and assert no unbounded handles or RSS growth.
- Simulate crashed child process and verify recovery.

### 5. Package production slimming

Current issue: `tsconfig.json` compiles all of `src`, and `package.json` publishes all of `dist`. Bench/eval code may be included in the production package unless intentionally needed.

Method:

- Split TypeScript configs: `tsconfig.runtime.json`, `tsconfig.bench.json`, `tsconfig.tests.json`.
- Publish only runtime `dist`, CLI, core modules, built-ins, and docs required by users.
- Keep benchmark/eval code in the repo but outside npm runtime output or behind a separate export/package.

Why it helps:

- Smaller npm install, less code surface, faster cold starts, lower audit surface.

Tests and metrics:

- Compare `npm pack --dry-run` file list and tarball size before/after.
- Smoke install still runs CLI, extension loading, and all public tools.

## Token-saving methods

### 1. Tokenizer-aware budgets

Current issue: char-count heuristics can be too loose for code, JSON, non-English text, and URLs. That affects truncation, cost estimates, and ROI telemetry.

Method:

- Add a `TokenEstimator` interface:

```ts
export type TokenEstimator = {
  estimate(value: unknown, options?: { model?: string; encoding?: string }): number;
  truncate(text: string, budgetTokens: number, options?: { model?: string; preserve?: "head" | "tail" | "balanced" }): TruncationResult;
};
```

- Implement a fast default estimator plus optional tokenizer-backed estimator when a supported JS tokenizer package is available.
- Add per-source calibration snapshots comparing estimated vs observed API token usage from real calls when available.
- Never hard-fail if a tokenizer cannot load.

Why it helps:

- Budget enforcement becomes more reliable.
- Truncation failures are easier to explain.
- Evals can compare apples to apples across source types.

Tests and metrics:

- Golden token estimate tests for prose, code, JSON, URLs, emoji/non-ASCII, and minified content.
- Track `estimatedTokens`, `actualTokens` when available, and estimation error.

### 2. Universal response profiles

Current issue: `budgetTokens` and `returnMode` are useful but too low-level. Callers need a higher-level verbosity contract.

Method:

- Add `responseProfile: "minimal" | "standard" | "detailed" | "audit"` to `retrieve_context` and workflows.
- Profiles map to output sections, evidence density, resource expansion, and budgets.
- Keep `budgetTokens` as an override, but the profile chooses defaults.

Suggested profile behavior:

| Profile | Purpose | Shape |
| --- | --- | --- |
| `minimal` | Route planning and quick agent context | One-line summary, compact tuples, warnings, resource handles |
| `standard` | Default user-facing answer support | Short summary, top evidence, sources, warnings |
| `detailed` | Investigation and implementation planning | More snippets, source rationale, confidence, next steps |
| `audit` | Security/release/legal-style review | Claims table, evidence mapping, uncertainty, full warnings |

Why it helps:

- Verbosity becomes predictable across modules.
- Agents can request less text without knowing source-specific tuple formats.
- Humans can request depth without triggering raw dumps.

Tests and metrics:

- Snapshot output shape by profile for every source.
- Assert profile output token ceilings.
- Assert required sections are present for `audit`.

### 3. Stable schemas and cache-friendly ordering

Current issue: TokenHub already has a stable six-tool surface, but schema details and capability manifests can still grow. The next step is to make every static prefix deterministic and defer every dynamic piece.

Method:

- Keep public tool order stable.
- Sort registry manifests by ID for list-like responses unless query ranking is requested.
- Add `describe_capability` or make `discover_capabilities(includeSchema: true)` fetch full schemas only when needed.
- Keep extension capabilities under namespace-like groups: `extension.<id>`, with tool details loaded on demand.
- Move dynamic run results and volatile timestamps to the end of outputs.

Why it helps:

- Exact prefix stability improves provider prompt-cache behavior.
- It mirrors OpenAI tool-search guidance and MCP's deterministic tool-list guidance.

Tests and metrics:

- Snapshot public tool list and schema order.
- Track manifest token footprint.
- Track prompt-cache usage when API usage metadata is available.

### 4. Resource handles over raw payloads

Current issue: TokenHub already uses resources, but many tool results still serialize large objects into text and then also save a resource.

Method:

- Return concise `summary`, `structuredContent`, `resources`, and `warnings`.
- Put raw payloads only behind resources unless `includeRaw` is true.
- Add `read_resource` modes: `head`, `tail`, `around`, `range`, `full`, and maybe `json_path` for JSON resources.
- Add resource annotations: audience, priority, source type, source freshness, and confidence.

Why it helps:

- Agents see enough to decide next steps.
- Large details remain available without contaminating every model turn.

Tests and metrics:

- Assert raw payload fields are absent by default.
- Assert resource reads can expand exact lines/JSON paths.
- Track average output tokens by tool.

### 5. Delta and changed-since context

Method:

- Add resource versions and workspace snapshots.
- Let callers ask for `changedSinceResource`, `changedSinceGitRef`, or `changedSinceTimestamp`.
- For files, return only changed files and snippets around changed hunks.
- For web/docs, return only changed page metadata or diff summaries when cached versions exist.

Why it helps:

- Repeated agent turns often need "what changed?" not the whole repository.
- Deltas are friendlier to context windows and prompt caches.

Tests and metrics:

- Fixture repo with three commits: assert only changed hunks appear.
- Track delta token savings vs full scan.

## Output quality methods

### 1. Claim-to-evidence output contract

Current issue: summaries include sources, but there is no uniform claim-level evidence structure.

Method:

- Define a structured output envelope:

```ts
type EvidenceBackedResult = {
  summary: string;
  claims: Array<{
    claim: string;
    confidence: "low" | "medium" | "high";
    evidence: Array<{ sourceId: string; quoteOrSnippet: string; resourceUri?: string; line?: number }>;
  }>;
  sources: Array<{ id: string; title: string; url?: string; path?: string; resourceUri?: string; freshness?: string }>;
  warnings: string[];
};
```

- Use this shape for `answer_from_web`, `resolve_request`, docs/package summaries, GitHub summaries, and audit modes.
- In text summaries, render only a compact version of the same data.

Why it helps:

- It reduces unsupported assertions.
- It makes evals easier because claims can be checked against evidence.
- It supports "show me why" without another full retrieval.

Tests and metrics:

- Every nontrivial factual claim in audit mode must have at least one evidence item.
- Web answers with fewer than two independent sources should lower confidence or warn.

### 2. Faithfulness and retrieval-quality evals

Current issue: `scoreSourceQuality` checks source count, domain uniqueness, HTTPS, synthetic sources, resource links, snippets, keyword coverage, and preferred domains. That is useful but can pass answers that are shallow or unfaithful.

Method:

- Add eval dimensions inspired by RAGAS:
  - Context precision: are snippets focused on the request?
  - Context recall: did retrieval capture required facts?
  - Faithfulness: are summary claims supported by snippets?
  - Answer relevance: does output actually answer the request?
  - Citation coverage: does every claim cite evidence?
- Add negative fixtures:
  - Conflicting sources.
  - Stale docs vs latest docs.
  - SEO pages outranking official docs.
  - Prompt-injection content in retrieved pages.
  - Search result snippets that contradict fetched page text.

Why it helps:

- Expected-keyword evals catch routing regressions, but faithfulness evals catch hallucinations and hollow summaries.
- This is the path from "it looks plausible" to "it is trustworthy enough to ship."

Tests and metrics:

- Add `scripts/evaluate-faithfulness.mjs`.
- Record per-case `faithfulnessScore`, `citationCoverage`, `unsupportedClaims`, `conflictsDetected`, and `sourceFreshness`.

### 3. Official/source-priority policies

Method:

- Add per-topic source priority rules:
  - For APIs/packages: official docs, package registry, release notes, source repository.
  - For code comparison: local source, official examples, mature OSS repos.
  - For facts: primary organization pages, regulatory/source-of-record pages, then secondary sources.
- Include source selection rationale in `detailed` and `audit` profiles.
- Penalize SEO listicles, mirrors, stale docs, and untrusted generated pages unless the user explicitly wants them.

Why it helps:

- Better sources reduce hallucination risk before summarization even starts.
- It improves "latest/current" requests, where search freshness alone is not enough.

Tests and metrics:

- For package/API prompts, assert at least one official or registry source when available.
- Track source domain categories and preferred-source hit rate.

### 4. Strict structured output and validation

Current issue: MCP results are JSON string content, so clients and models must parse free-form text. MCP and OpenAI both support stronger structured output patterns.

Method:

- Add MCP `structuredContent` and `outputSchema` for public tools where the SDK supports it.
- Validate internal workflow results with Zod before returning.
- Add discriminated result types:
  - `ok`
  - `tool_error`
  - `needs_input`
  - `partial`
  - `unsupported`
- Keep text content as a concise human fallback.

Why it helps:

- Reduces parse failures and retries.
- Makes hollow/fake feature claims easier to test.
- Gives callers a stable contract for automation.

Tests and metrics:

- Schema validation tests for every public tool result.
- Fuzz invalid inputs and assert recoverable errors are typed.

### 5. Better uncertainty behavior

Method:

- Add confidence levels to claims and source bundles.
- Add warnings for:
  - One-source answers.
  - Source fetch failed but search snippet was used.
  - Freshness is unknown.
  - Results conflict.
  - Budget truncation could hide relevant evidence.
- In `minimal` profile, show a compact warning count; in `audit`, show all warnings.

Why it helps:

- It prevents "overconfident compactness."
- It gives agents a reason to ask for deeper retrieval when needed.

## Verbosity methods

### 1. Make verbosity orthogonal to budget

`budgetTokens` should be a hard-ish ceiling. It should not be the only way to express desired detail. Add:

```ts
verbosity?: "minimal" | "standard" | "detailed" | "audit";
```

or use `responseProfile` if that name is clearer. `verbosity` controls structure and density; `budgetTokens` controls size.

### 2. Use progressive disclosure consistently

Default answer:

- What was found.
- The strongest 1 to 3 evidence items.
- Warnings.
- Resource handles for detail.

Follow-up reads:

- `read_resource` range, JSON path, head/tail, or full.
- `retrieve_context` detailed/audit profile.
- Delta since resource.

This keeps first responses small while preserving power.

### 3. Standardize result envelopes

Every source and workflow should return:

```ts
{
  "summary": "...",
  "data": {},
  "resources": [],
  "warnings": [],
  "metrics": {
    "estimatedTokens": 0,
    "elapsedMs": 0,
    "cache": "hit|miss|stale|none"
  }
}
```

Then profiles decide how much of `data`, `resources`, and `metrics` are rendered into text.

### 4. Avoid compact tuple opacity in human profiles

Compact tuples are good for agents, but humans need labels. Keep tuple outputs for `minimal` or explicit `returnMode: "compact"`. For `standard` and above, prefer short keyed objects.

Example:

```json
{
  "path": "src/server.ts",
  "line": 132,
  "snippet": "if (input.source === \"git\")",
  "resourceUri": "tokenhub://resource/..."
}
```

This costs more than a tuple but saves cognitive overhead and prevents misread fields.

## Modularity methods

### 1. Retrieval source registry

Replace the `retrieve_context` branch chain with a registry:

```ts
export type RetrievalSourceModule<Input, Output> = {
  name: string;
  title: string;
  keywords: string[];
  inputSchema: z.ZodType<Input>;
  outputSchema: z.ZodType<Output>;
  defaultBudgetTokens: number;
  supportsCompact: boolean;
  retrieve(input: Input, context: RetrievalContext): Promise<Output>;
  compact?(output: Output, context: CompactContext): unknown;
  estimateCost?(input: Input): TokenCostEstimate;
};
```

Benefits:

- Each source owns its own schema, compact mode, tests, cache policy, and telemetry.
- Extension-provided sources can register beside built-ins.
- The server stays a thin dispatcher.
- New features can be added source-by-source without touching a central switch.

Implementation path:

1. Create `src/sources/types.ts` and `src/sources/registry.ts`.
2. Move files, git, web, search, docs, browser, database, GitHub, and Sentry into source modules.
3. Keep public `retrieve_context` input compatible while internally dispatching through the registry.
4. Add tests that registry output matches current behavior.

### 2. Workflow registry

Apply the same pattern to workflows:

```ts
export type WorkflowModule<Input, Output> = {
  name: string;
  inputSchema: z.ZodType<Input>;
  outputSchema: z.ZodType<Output>;
  run(input: Input, context: WorkflowContext): Promise<Output>;
};
```

Benefits:

- `validate`, `project_scan`, `answer_from_web`, `resolve_request`, `git_action`, `filesystem_action`, and `extension_call` become independently testable modules.
- User extensions could eventually contribute workflows through a trusted manifest.

### 3. Shared policy modules

Extract shared policies so every source behaves consistently:

- `tokenPolicy`: budgets, profiles, truncation, estimates.
- `resourcePolicy`: write, dedupe, read modes, annotations.
- `redactionPolicy`: secrets, PII, source-specific redaction.
- `networkPolicy`: URL validation, DNS/private IP checks, redirect checks.
- `cachePolicy`: cache keys, freshness, auth scoping.
- `errorPolicy`: protocol vs tool execution errors.
- `telemetryPolicy`: metrics, spans, request IDs.

Benefits:

- Prevents duplicated redaction and timeout behavior.
- Makes security audits easier.
- Reduces future bug surface.

### 4. Extension API evolution

The new extension system is a good base. Next steps:

- Let extensions declare capability metadata, compact output schema, and token cost hints.
- Validate extension output against optional output schemas.
- Add extension health checks and startup probes.
- Add pooled MCP sessions as an opt-in per extension.
- Add extension resource access policy, so extensions can return resources without seeing the whole resource store.
- Add `tokenhub extension test <manifest>` CLI for plugin authors.

### 5. Package boundaries

Recommended package layout:

```text
src/
  core/          runtime, registry, resources, token policy, telemetry
  sources/       built-in retrieval sources
  workflows/     workflow modules
  extensions/    extension config and adapters
  cli.ts
bench/
  ...            not published in runtime package
tests/
scripts/
```

At build time:

- Runtime package compiles `src/core`, `src/sources`, `src/workflows`, `src/extensions`, `src/cli.ts`, and `src/server.ts`.
- Bench/eval compile separately or run through tsx/vitest only in dev.

## Prioritized roadmap

### Phase 0 - Instrument before changing behavior

- Persist telemetry to a local JSONL file when enabled.
- Add per-source duration, output tokens, resource bytes, warnings, cache status, and error type.
- Add benchmark summaries for p50/p95 duration and output tokens.
- Add memory stress smoke for repeated browser and extension calls.

Acceptance:

- `npm test` passes.
- A new local telemetry file can be enabled and is redacted.
- Benchmark report includes latency and cache fields.

### Phase 1 - Verbosity and token policy

- Add `responseProfile`.
- Add `TokenEstimator` abstraction.
- Update all public tools to include result metrics.
- Add profile snapshot tests.

Acceptance:

- Every source supports `minimal`, `standard`, and `detailed`; high-risk sources support `audit`.
- Existing `returnMode: "compact"` remains compatible.
- Token estimate tests cover code, JSON, URLs, and non-ASCII.

### Phase 2 - Registry modularization

- Implement source registry.
- Move one source at a time, starting with `files`, `search`, and `web`.
- Add workflow registry after source registry stabilizes.

Acceptance:

- Public API unchanged.
- Source module tests replace branch-chain-specific tests.
- `src/server.ts` becomes mostly registration plus MCP tool definitions.

### Phase 3 - Performance caches and pools

- Add file index.
- Add HTTP/docs cache and resource dedupe.
- Add bounded parallel fetch in `answer_from_web`.
- Add optional MCP extension pool and browser pool.

Acceptance:

- Large-repo search benchmark improves.
- Web workflow latency improves on delayed-source fixtures.
- Pool stress test shows no unbounded handle or memory growth.

### Phase 4 - Quality gates

- Add claim/evidence result schema.
- Add faithfulness and conflict evals.
- Add official-source priority policies.
- Add prompt-injection retrieval fixtures.

Acceptance:

- Existing evals still pass.
- New evals catch unsupported claims and thin evidence.
- `audit` output gives claim-to-source mapping.

### Phase 5 - Release package tightening

- Split runtime and bench/eval builds.
- Update `npm pack --dry-run` expectations.
- Add package-size budget.

Acceptance:

- Published package has no bench/eval-only runtime files unless explicitly intended.
- Smoke install still exercises all six public tools and extensions.

## Concrete implementation tickets

1. Add `responseProfile` plumbing to `retrieve_context`, `run_workflow`, and internal modules.
2. Add `TokenEstimator` and replace direct imports of `estimateTokens` with context-injected estimator where practical.
3. Add `SourceModule` interface and migrate `files` source.
4. Add bounded parallel fetch helper and use it in `answerFromWeb`.
5. Add `EvidenceBackedResult` schema and render it in `answer_from_web` detailed/audit modes.
6. Add resource dedupe by SHA-256 in `ResourceStore`.
7. Add `read_resource` JSON path and head/tail modes.
8. Add source-quality eval cases for conflicting sources, stale docs, unsupported claims, and prompt injection.
9. Add extension health checks and optional pooling.
10. Split runtime and bench/eval TypeScript configs.

## Risk and tradeoff notes

- Pooling improves latency but can create leaks, stale state, and cross-call contamination. Bound it with TTL, max uses, health checks, and isolation.
- Compact tuples save tokens but are harder for humans. Use them for `minimal` and agent-only profiles, not default human detail.
- Tokenizer-aware counting can add dependency weight. Keep a fast fallback and make exact counting optional.
- Caching improves speed and cost but can return stale data. Expose freshness policy and warnings.
- Structured output schemas add schema tokens, but they reduce retries and parsing failures. Use strict schemas for high-value workflows, not every tiny response.
- Parallel retrieval can stress external services. Use concurrency caps, backoff, and per-provider rate limits.

## Measurement dashboard

Track these over time:

- Public tool-list token footprint.
- Capability manifest token footprint.
- Average and p95 output tokens by tool/source/profile.
- Average and p95 duration by tool/source/profile.
- Cache hit/miss/stale rate.
- Resource bytes written and dedupe rate.
- Browser cold vs warm capture time.
- Extension cold vs warm call time.
- Peak RSS after repeated calls.
- Source-quality score, faithfulness score, citation coverage, unsupported claims.
- Benchmark task pass rate and weak-task list.
- NPM pack file count and tarball size.

## Bottom line

The best next version of TokenHub should feel less like a bundle of useful handlers and more like a token-aware retrieval operating system: stable public surface, modular sources, strict output contracts, cached resource handles, caller-controlled verbosity, and evals that punish unsupported claims. That is the path to faster runs, lower token cost, better answers, and a codebase that can keep accepting new MCPs and tools without turning the server into a giant switch statement.

