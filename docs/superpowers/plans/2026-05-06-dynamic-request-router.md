# Dynamic Request Router Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a general `resolve_request` workflow that can infer what a user needs, gather web/files/docs/GitHub context, and return either a polished answer, agent context, a plan, structured data, or implementation guidance without hardcoding hundreds of target types.

**Architecture:** Keep the public MCP surface small by adding one dynamic workflow and a typed internal request model. The workflow decomposes natural-language requests into composable dimensions: intent, subject, output shape, source strategy, depth, evidence mode, and execution mode. Specific behavior emerges from routing and orchestration, while advanced callers can override dimensions when they need hyper-specific control.

**Tech Stack:** TypeScript, Zod, existing TokenHub `ResourceStore`, `TokenTelemetry`, `searchWeb`, `fetchAndScrape`, filesystem retrieval, GitHub summary, docs lookup, and `runWorkflow`.

---

## Design Principles

- Do not add hundreds of public `target` values.
- Prefer one general entrypoint: `run_workflow({ name: "resolve_request", request: "..." })`.
- Keep manual overrides available for advanced agents.
- Return compact outputs by default, with resource handles for expansion.
- Preserve current low-level tools for direct callers.
- Treat implementation actions as opt-in: the router can plan by default, and only modify files when `executionMode` explicitly allows it.

## Request Shape

The router should infer this object:

```ts
export type RequestIntent = "answer" | "research" | "compare" | "implement" | "debug" | "extract" | "plan";
export type RequestSubject = "fact" | "code" | "docs" | "paper" | "package" | "api" | "repo" | "data" | "error" | "unknown";
export type OutputShape = "paragraph" | "list" | "table" | "plan" | "patch_plan" | "citations" | "structured_data" | "agent_context";
export type SourceStrategy = "local_files" | "web_search" | "web_pages" | "github_repo" | "github_code" | "docs" | "package_registry";
export type RequestDepth = "fast" | "standard" | "deep" | "exhaustive";
export type EvidenceMode = "none" | "sources" | "snippets" | "resource_links" | "raw_extracts";
export type ExecutionMode = "answer_only" | "plan_only" | "implement" | "implement_and_verify";

export type RequestPlan = {
  request: string;
  intent: RequestIntent;
  subject: RequestSubject;
  outputShape: OutputShape;
  sources: SourceStrategy[];
  depth: RequestDepth;
  evidence: EvidenceMode;
  execution: ExecutionMode;
  searchQueries: string[];
  localQueries: string[];
  constraints: string[];
  confidence: number;
  rationale: string[];
};
```

## File Structure

- Create: `src/core/request-shape.ts`
  - Owns request-shape types, input hints, defaults, and normalization helpers.

- Create: `src/core/request-router.ts`
  - Owns deterministic request inference from natural language plus caller hints.

- Create: `src/workflows/resolve-request.ts`
  - Owns orchestration for retrieving local/web/docs/GitHub context and formatting the result.

- Modify: `src/workflows/index.ts`
  - Routes `name === "resolve_request"` to the new workflow.

- Modify: `src/server.ts`
  - Adds public `run_workflow` fields: `request`, `mode`, `depth`, `outputShape`, `evidence`, `scope`, `hints`.
  - Registers a capability entry for dynamic request resolution.

- Create: `tests/request-router.test.ts`
  - Tests inference without network.

- Create: `tests/resolve-request.test.ts`
  - Tests workflow orchestration with mocked fetch/search.

- Modify: `README.md`
  - Documents the general workflow and examples.

---

### Task 1: Add Request Shape Types

**Files:**
- Create: `src/core/request-shape.ts`
- Test: `tests/request-router.test.ts`

- [ ] **Step 1: Write the failing type/default tests**

Add this to `tests/request-router.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { normalizeRequestHints } from "../src/core/request-shape.js";

describe("request shape", () => {
  test("normalizes empty hints into safe defaults", () => {
    expect(normalizeRequestHints({})).toEqual({
      depth: "standard",
      evidence: "resource_links",
      execution: "answer_only"
    });
  });

  test("preserves explicit advanced hints", () => {
    expect(
      normalizeRequestHints({
        depth: "deep",
        evidence: "snippets",
        execution: "implement_and_verify"
      })
    ).toEqual({
      depth: "deep",
      evidence: "snippets",
      execution: "implement_and_verify"
    });
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
npm test -- tests/request-router.test.ts
```

Expected: FAIL because `src/core/request-shape.ts` does not exist.

- [ ] **Step 3: Implement request-shape types and defaults**

Create `src/core/request-shape.ts`:

```ts
export type RequestIntent = "answer" | "research" | "compare" | "implement" | "debug" | "extract" | "plan";
export type RequestSubject = "fact" | "code" | "docs" | "paper" | "package" | "api" | "repo" | "data" | "error" | "unknown";
export type OutputShape = "paragraph" | "list" | "table" | "plan" | "patch_plan" | "citations" | "structured_data" | "agent_context";
export type SourceStrategy = "local_files" | "web_search" | "web_pages" | "github_repo" | "github_code" | "docs" | "package_registry";
export type RequestDepth = "fast" | "standard" | "deep" | "exhaustive";
export type EvidenceMode = "none" | "sources" | "snippets" | "resource_links" | "raw_extracts";
export type ExecutionMode = "answer_only" | "plan_only" | "implement" | "implement_and_verify";

export type RequestHints = {
  intent?: RequestIntent;
  subject?: RequestSubject;
  outputShape?: OutputShape;
  sources?: SourceStrategy[];
  depth?: RequestDepth;
  evidence?: EvidenceMode;
  execution?: ExecutionMode;
};

export type NormalizedRequestHints = {
  depth: RequestDepth;
  evidence: EvidenceMode;
  execution: ExecutionMode;
};

export type RequestPlan = {
  request: string;
  intent: RequestIntent;
  subject: RequestSubject;
  outputShape: OutputShape;
  sources: SourceStrategy[];
  depth: RequestDepth;
  evidence: EvidenceMode;
  execution: ExecutionMode;
  searchQueries: string[];
  localQueries: string[];
  constraints: string[];
  confidence: number;
  rationale: string[];
};

export function normalizeRequestHints(hints: RequestHints): NormalizedRequestHints {
  return {
    depth: hints.depth ?? "standard",
    evidence: hints.evidence ?? "resource_links",
    execution: hints.execution ?? "answer_only"
  };
}
```

- [ ] **Step 4: Verify the type/default tests pass**

Run:

```bash
npm test -- tests/request-router.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/request-shape.ts tests/request-router.test.ts
git commit -m "feat: add dynamic request shape types"
```

---

### Task 2: Add Deterministic Request Router

**Files:**
- Create: `src/core/request-router.ts`
- Modify: `tests/request-router.test.ts`

- [ ] **Step 1: Add routing tests for general and hyper-specific requests**

Append to `tests/request-router.test.ts`:

```ts
import { inferRequestPlan } from "../src/core/request-router.js";

describe("request router", () => {
  test("infers web research summary for latest papers", () => {
    const plan = inferRequestPlan({
      request: "Give me a 1 paragraph summary of the latest DeepSeek research papers"
    });

    expect(plan.intent).toBe("research");
    expect(plan.subject).toBe("paper");
    expect(plan.outputShape).toBe("paragraph");
    expect(plan.sources).toEqual(expect.arrayContaining(["web_search", "web_pages"]));
    expect(plan.searchQueries[0]).toContain("DeepSeek research papers");
    expect(plan.execution).toBe("answer_only");
  });

  test("infers external code comparison with implementation plan", () => {
    const plan = inferRequestPlan({
      request:
        "Look for similar professional optimized implementations of this feature and compare it to this code, then implement the gaps",
      hints: { execution: "implement_and_verify" }
    });

    expect(plan.intent).toBe("implement");
    expect(plan.subject).toBe("code");
    expect(plan.outputShape).toBe("patch_plan");
    expect(plan.sources).toEqual(expect.arrayContaining(["local_files", "web_search", "github_code", "docs"]));
    expect(plan.execution).toBe("implement_and_verify");
    expect(plan.depth).toBe("deep");
  });
});
```

- [ ] **Step 2: Run the failing router tests**

Run:

```bash
npm test -- tests/request-router.test.ts
```

Expected: FAIL because `inferRequestPlan` is missing.

- [ ] **Step 3: Implement the deterministic router**

Create `src/core/request-router.ts`:

```ts
import type { OutputShape, RequestHints, RequestIntent, RequestPlan, RequestSubject, SourceStrategy } from "./request-shape.js";
import { normalizeRequestHints } from "./request-shape.js";

export type InferRequestPlanInput = {
  request: string;
  hints?: RequestHints;
};

export function inferRequestPlan(input: InferRequestPlanInput): RequestPlan {
  const request = input.request.trim();
  const lower = request.toLowerCase();
  const hints = input.hints ?? {};
  const normalized = normalizeRequestHints(hints);

  const intent = hints.intent ?? inferIntent(lower);
  const subject = hints.subject ?? inferSubject(lower);
  const outputShape = hints.outputShape ?? inferOutputShape(lower, intent, subject);
  const sources = hints.sources ?? inferSources(lower, intent, subject);
  const depth = hints.depth ?? inferDepth(lower, intent);

  return {
    request,
    intent,
    subject,
    outputShape,
    sources,
    depth,
    evidence: normalized.evidence,
    execution: normalized.execution,
    searchQueries: buildSearchQueries(request, subject, intent),
    localQueries: buildLocalQueries(request, subject),
    constraints: buildConstraints(lower),
    confidence: 0.78,
    rationale: buildRationale(intent, subject, outputShape, sources)
  };
}

function inferIntent(lower: string): RequestIntent {
  if (/\b(implement|fix|add|patch|close the gaps|then implement)\b/.test(lower)) return "implement";
  if (/\b(compare|versus|vs\.?|difference|gaps)\b/.test(lower)) return "compare";
  if (/\b(debug|error|failing|stack trace|exception)\b/.test(lower)) return "debug";
  if (/\b(extract|scrape|collect|dataset|table)\b/.test(lower)) return "extract";
  if (/\b(plan|roadmap|steps)\b/.test(lower)) return "plan";
  if (/\b(research|latest|papers|sources|citations|deep)\b/.test(lower)) return "research";
  return "answer";
}

function inferSubject(lower: string): RequestSubject {
  if (/\b(code|implementation|feature|repo|github|typescript|python|function|class)\b/.test(lower)) return "code";
  if (/\b(paper|papers|arxiv|research)\b/.test(lower)) return "paper";
  if (/\b(api|endpoint|openapi|sdk)\b/.test(lower)) return "api";
  if (/\b(package|npm|version|changelog|release)\b/.test(lower)) return "package";
  if (/\b(error|stack trace|exception)\b/.test(lower)) return "error";
  if (/\b(data|csv|table|rows|prices|list)\b/.test(lower)) return "data";
  if (/\b(repo|pull request|issue)\b/.test(lower)) return "repo";
  if (/\b(docs|documentation)\b/.test(lower)) return "docs";
  if (/\b(who|what|when|where|fact)\b/.test(lower)) return "fact";
  return "unknown";
}

function inferOutputShape(lower: string, intent: RequestIntent, subject: RequestSubject): OutputShape {
  if (/\b(table|spreadsheet|columns|rows)\b/.test(lower)) return "table";
  if (/\b(list|top \d+|ranked|best)\b/.test(lower)) return "list";
  if (/\b(1 paragraph|one paragraph|summary|summarize)\b/.test(lower)) return "paragraph";
  if (intent === "implement") return "patch_plan";
  if (intent === "plan") return "plan";
  if (intent === "extract" || subject === "data") return "structured_data";
  if (intent === "research" || intent === "compare") return "agent_context";
  return "paragraph";
}

function inferSources(lower: string, intent: RequestIntent, subject: RequestSubject): SourceStrategy[] {
  const sources = new Set<SourceStrategy>();
  if (intent === "implement" || intent === "compare" || subject === "code") {
    sources.add("local_files");
    sources.add("web_search");
    sources.add("github_code");
    sources.add("docs");
  }
  if (subject === "paper" || /\blatest|internet|web|search|research\b/.test(lower)) {
    sources.add("web_search");
    sources.add("web_pages");
  }
  if (subject === "package") {
    sources.add("package_registry");
    sources.add("docs");
  }
  if (subject === "api") {
    sources.add("docs");
    sources.add("web_search");
  }
  if (sources.size === 0) sources.add("web_search");
  return [...sources];
}

function inferDepth(lower: string, intent: RequestIntent): RequestPlan["depth"] {
  if (/\b(exhaustive|all competitors|no compromises)\b/.test(lower)) return "exhaustive";
  if (/\b(deep|professional|optimized|compare|gaps|research)\b/.test(lower) || intent === "implement") return "deep";
  if (/\b(quick|fast|brief)\b/.test(lower)) return "fast";
  return "standard";
}

function buildSearchQueries(request: string, subject: RequestSubject, intent: RequestIntent): string[] {
  if (subject === "code" && (intent === "compare" || intent === "implement")) {
    return [
      `${request} GitHub production implementation`,
      `${request} professional optimized implementation`,
      `${request} best practices docs`
    ];
  }
  return [request];
}

function buildLocalQueries(request: string, subject: RequestSubject): string[] {
  if (subject === "code") return [request, "feature", "implementation"];
  return [request];
}

function buildConstraints(lower: string): string[] {
  const constraints: string[] = [];
  if (lower.includes("latest")) constraints.push("prefer fresh sources and include dates when available");
  if (lower.includes("professional") || lower.includes("optimized")) constraints.push("prefer mature, maintained, production-oriented references");
  if (lower.includes("implement")) constraints.push("do not modify files unless execution mode allows implementation");
  return constraints;
}

function buildRationale(intent: RequestIntent, subject: RequestSubject, outputShape: OutputShape, sources: SourceStrategy[]): string[] {
  return [
    `intent=${intent} based on action words in the request`,
    `subject=${subject} based on domain terms in the request`,
    `outputShape=${outputShape} selected from requested answer format and action`,
    `sources=${sources.join(",")} selected for evidence gathering`
  ];
}
```

- [ ] **Step 4: Verify router tests pass**

Run:

```bash
npm test -- tests/request-router.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/request-router.ts tests/request-router.test.ts
git commit -m "feat: infer dynamic request plans"
```

---

### Task 3: Add Resolve Request Workflow

**Files:**
- Create: `src/workflows/resolve-request.ts`
- Modify: `src/workflows/index.ts`
- Test: `tests/resolve-request.test.ts`

- [ ] **Step 1: Write workflow orchestration tests**

Create `tests/resolve-request.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ResourceStore } from "../src/core/resources.js";
import { TokenTelemetry } from "../src/core/telemetry.js";
import { runWorkflow } from "../src/workflows/index.js";

describe("resolve_request workflow", () => {
  test("resolves latest paper summary through dynamic routing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tokenhub-resolve-summary-"));
    const resourceStore = new ResourceStore({ rootDir: join(dir, ".tokenhub", "resources") });
    try {
      const result = await runWorkflow({
        name: "resolve_request",
        root: dir,
        request: "Give me a 1 paragraph summary of the latest DeepSeek research papers",
        provider: "tavily",
        apiKey: "test-key",
        resourceStore,
        telemetry: new TokenTelemetry({ roiThreshold: 3 }),
        fetchImpl: async (url, init) => {
          const urlText = url.toString();
          if (urlText.includes("api.tavily.com")) {
            return new Response(
              JSON.stringify({
                results: [
                  {
                    title: "DeepSeek-V3.2",
                    url: "https://arxiv.org/abs/2512.02556",
                    content: "DeepSeek-V3.2 introduces DeepSeek Sparse Attention and improved reasoning."
                  }
                ]
              }),
              { status: 200 }
            );
          }
          return new Response(
            "<html><title>DeepSeek-V3.2</title><body><p>Abstract: DeepSeek Sparse Attention improves long-context efficiency and reasoning.</p></body></html>",
            { status: 200, headers: { "content-type": "text/html" } }
          );
        }
      });

      expect(result.summary).toContain("DeepSeek");
      expect(result.summary).toContain("Sources:");
      expect(JSON.stringify(result.data)).toContain("requestPlan");
      expect(result.resources[0].uri).toMatch(/^tokenhub:\/\/resource\//);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("creates agent context for external implementation comparison", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tokenhub-resolve-code-"));
    await writeFile(join(dir, "feature.ts"), "export function feature() { return 'basic'; }", "utf8");
    const resourceStore = new ResourceStore({ rootDir: join(dir, ".tokenhub", "resources") });
    try {
      const result = await runWorkflow({
        name: "resolve_request",
        root: dir,
        request: "Look for similar professional optimized implementations of this feature and compare it to this code, then implement the gaps",
        execution: "plan_only",
        resourceStore,
        telemetry: new TokenTelemetry({ roiThreshold: 3 }),
        fetchImpl: async (url) => {
          if (url.toString().includes("duckduckgo.com")) {
            return new Response(
              "<html><body><a class=\"result__a\" href=\"https://example.test/pro-feature\">Professional feature implementation</a><a class=\"result__snippet\">Uses validation, caching, and typed errors.</a></body></html>",
              { status: 200 }
            );
          }
          return new Response("<html><body><pre>function feature(input) { validate(input); return cached(input); }</pre></body></html>", { status: 200 });
        }
      });

      expect(result.summary).toContain("Request plan");
      expect(result.summary).toContain("implementation");
      expect(result.warnings).not.toContain("Files modified");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run failing workflow tests**

Run:

```bash
npm test -- tests/resolve-request.test.ts
```

Expected: FAIL because `resolve_request` is not wired.

- [ ] **Step 3: Implement `resolve-request.ts`**

Create `src/workflows/resolve-request.ts`:

```ts
import type { ResourceLink, ResourceStore } from "../core/resources.js";
import type { TokenTelemetry } from "../core/telemetry.js";
import { estimateTokens, truncateToTokens } from "../core/token.js";
import type { FetchLike } from "../modules/github.js";
import type { SearchProvider } from "../modules/search.js";
import { answerFromWeb } from "../modules/answer-web.js";
import { searchFiles } from "../modules/filesystem.js";
import { inferRequestPlan } from "../core/request-router.js";
import type { EvidenceMode, ExecutionMode, OutputShape, RequestDepth, RequestHints } from "../core/request-shape.js";

export type ResolveRequestWorkflowInput = {
  root: string;
  request: string;
  budgetTokens?: number;
  provider?: SearchProvider;
  apiKey?: string;
  resourceStore: ResourceStore;
  telemetry: TokenTelemetry;
  fetchImpl?: FetchLike;
  depth?: RequestDepth;
  outputShape?: OutputShape;
  evidence?: EvidenceMode;
  execution?: ExecutionMode;
};

export async function runResolveRequestWorkflow(input: ResolveRequestWorkflowInput): Promise<{
  summary: string;
  resources: ResourceLink[];
  telemetry: ReturnType<TokenTelemetry["record"]>;
  warnings: string[];
  data: unknown;
}> {
  const hints: RequestHints = {
    depth: input.depth,
    outputShape: input.outputShape,
    evidence: input.evidence,
    execution: input.execution
  };
  const requestPlan = inferRequestPlan({ request: input.request, hints });
  const warnings: string[] = [];
  const resources: ResourceLink[] = [];
  const sections: string[] = [`Request plan\n${JSON.stringify(requestPlan, null, 2)}`];
  const data: Record<string, unknown> = { requestPlan };

  if (requestPlan.sources.includes("local_files")) {
    const local = await searchFiles({
      root: input.root,
      query: requestPlan.localQueries[0] ?? input.request,
      limit: requestPlan.depth === "deep" || requestPlan.depth === "exhaustive" ? 20 : 8,
      budgetTokens: Math.floor((input.budgetTokens ?? 1600) / 3),
      resourceStore: input.resourceStore
    });
    data.local = local.matches;
    sections.push(local.matches.length ? `Local context\n${local.matches.map((match) => `- ${match.path}:${match.line} ${match.snippet}`).join("\n")}` : "Local context\nNo matching local files found.");
    warnings.push(...local.warnings);
  }

  if (requestPlan.sources.includes("web_search") || requestPlan.sources.includes("web_pages")) {
    const target = requestPlan.outputShape === "list" ? "ranked_list" : "summary";
    const web = await answerFromWeb({
      query: requestPlan.searchQueries[0] ?? input.request,
      target,
      limit: target === "ranked_list" ? 10 : 1,
      sourceLimit: requestPlan.depth === "deep" || requestPlan.depth === "exhaustive" ? 5 : 3,
      budgetTokens: Math.floor((input.budgetTokens ?? 1600) / 2),
      provider: input.provider,
      apiKey: input.apiKey,
      resourceStore: input.resourceStore,
      fetchImpl: input.fetchImpl
    });
    data.web = {
      summary: web.summary,
      items: web.items,
      sources: web.sources,
      contextSnippets: web.contextSnippets
    };
    resources.push(...web.resources);
    warnings.push(...web.warnings);
    sections.push(`Web context\n${web.summary}`);
  }

  if (requestPlan.execution === "implement" || requestPlan.execution === "implement_and_verify") {
    warnings.push("Implementation execution is planned but not yet enabled in resolve_request; returning gap context only.");
  }

  const summary = truncateToTokens(sections.join("\n\n"), input.budgetTokens ?? 1400).text;
  const link = await input.resourceStore.writeText({
    kind: "json",
    label: `resolve_request:${input.request}`,
    source: "resolve_request",
    content: JSON.stringify(data, null, 2)
  });
  resources.unshift(link);

  const telemetry = input.telemetry.record({
    capability: "workflow.resolve_request",
    estimatedToolCostTokens: estimateTokens(summary),
    estimatedSavedTokens: Math.max(900, resources.length * 300 + estimateTokens(JSON.stringify(data))),
    outputTokens: estimateTokens(summary)
  });

  return { summary, resources, telemetry, warnings, data };
}
```

- [ ] **Step 4: Wire workflow index**

Modify `src/workflows/index.ts`:

```ts
import { runResolveRequestWorkflow } from "./resolve-request.js";
import type { EvidenceMode, ExecutionMode, OutputShape, RequestDepth } from "../core/request-shape.js";
```

Extend `WorkflowInput`:

```ts
request?: string;
depth?: RequestDepth;
outputShape?: OutputShape;
evidence?: EvidenceMode;
execution?: ExecutionMode;
```

Add routing before the default project scan:

```ts
if (input.name === "resolve_request") {
  if (!input.request) {
    throw new Error("resolve_request requires request.");
  }
  return runResolveRequestWorkflow({
    root: input.root,
    request: input.request,
    budgetTokens: input.budgetTokens,
    provider: input.provider,
    apiKey: input.apiKey,
    resourceStore: input.resourceStore,
    telemetry: input.telemetry,
    fetchImpl: input.fetchImpl,
    depth: input.depth,
    outputShape: input.outputShape,
    evidence: input.evidence,
    execution: input.execution
  });
}
```

- [ ] **Step 5: Verify workflow tests pass**

Run:

```bash
npm test -- tests/resolve-request.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/workflows/index.ts src/workflows/resolve-request.ts tests/resolve-request.test.ts
git commit -m "feat: add dynamic resolve request workflow"
```

---

### Task 4: Expose Dynamic Workflow Through MCP Schema

**Files:**
- Modify: `src/server.ts`
- Modify: `tests/server.test.ts`

- [ ] **Step 1: Add server schema test**

Append to `tests/server.test.ts`:

```ts
import { createTokenHubRuntime } from "../src/server.js";

test("runtime accepts resolve_request inputs", async () => {
  const runtime = createTokenHubRuntime({ root: process.cwd() });
  const capabilities = runtime.discoverCapabilities({ query: "dynamic request router", limit: 5 });
  expect(JSON.stringify(capabilities)).toContain("resolve");
});
```

- [ ] **Step 2: Run server tests and confirm failure**

Run:

```bash
npm test -- tests/server.test.ts
```

Expected: FAIL because the registry does not yet expose the dynamic workflow.

- [ ] **Step 3: Add runtime input fields**

Modify `src/server.ts` runtime `runWorkflow` input type:

```ts
request?: string;
depth?: "fast" | "standard" | "deep" | "exhaustive";
outputShape?: "paragraph" | "list" | "table" | "plan" | "patch_plan" | "citations" | "structured_data" | "agent_context";
evidence?: "none" | "sources" | "snippets" | "resource_links" | "raw_extracts";
execution?: "answer_only" | "plan_only" | "implement" | "implement_and_verify";
```

- [ ] **Step 4: Add MCP schema fields**

Modify the `run_workflow` tool schema in `src/server.ts`:

```ts
request: z.string().optional(),
depth: z.enum(["fast", "standard", "deep", "exhaustive"]).optional(),
outputShape: z.enum(["paragraph", "list", "table", "plan", "patch_plan", "citations", "structured_data", "agent_context"]).optional(),
evidence: z.enum(["none", "sources", "snippets", "resource_links", "raw_extracts"]).optional(),
execution: z.enum(["answer_only", "plan_only", "implement", "implement_and_verify"]).optional(),
```

- [ ] **Step 5: Register discoverable capability**

Add to `createDefaultRegistry()`:

```ts
registry.register({
  id: "workflow.resolve_request",
  module: "workflow",
  title: "Resolve dynamic request",
  summary: "Infer intent, sources, depth, evidence, and output shape from a natural-language request, then gather compact context or answer from the right internal modules.",
  keywords: ["dynamic", "resolve", "request", "router", "auto", "intent", "research", "compare", "implement"],
  costHintTokens: 260,
  inputSchema: { deferred: true }
});
```

- [ ] **Step 6: Verify server tests pass**

Run:

```bash
npm test -- tests/server.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/server.ts tests/server.test.ts
git commit -m "feat: expose dynamic request workflow"
```

---

### Task 5: Add Documentation And Examples

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add README examples**

Add this after the `answer_from_web` examples:

```md
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
```

- [ ] **Step 2: Run README-adjacent validation**

Run:

```bash
npm run build
npm test
```

Expected: both pass.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document dynamic request workflow"
```

---

### Task 6: Add Proof And Regression Coverage

**Files:**
- Modify: `scripts/generate-proof-page.mjs`
- Modify: `tests/proof.test.ts`

- [ ] **Step 1: Add proof expectation**

Modify `tests/proof.test.ts` to assert the proof output mentions `resolve_request`:

```ts
expect(proofText).toContain("resolve_request");
```

If `proofText` is not exposed today, add an assertion against the generated command list or proof HTML source in the existing proof test structure.

- [ ] **Step 2: Add proof command**

Modify `scripts/generate-proof-page.mjs` so the proof includes:

```bash
npm test -- tests/request-router.test.ts tests/resolve-request.test.ts
```

- [ ] **Step 3: Run proof validation**

Run:

```bash
npm test -- tests/proof.test.ts
npm run proof
```

Expected:

```text
PNG proof written: ...artifacts/proof/tokenhub-proof.png
```

- [ ] **Step 4: Commit**

```bash
git add scripts/generate-proof-page.mjs tests/proof.test.ts artifacts/proof/tokenhub-proof.png
git commit -m "test: prove dynamic request workflow"
```

---

## Future Extension Points

Add these after the first dynamic workflow is stable:

- `src/modules/github-code.ts`
  - Use GitHub code search or raw file fetching for real external implementation comparison.

- `src/modules/code-analysis.ts`
  - Add AST-aware local code summaries for TypeScript and JavaScript.

- `src/workflows/gap-implementation.ts`
  - Turn comparison findings into tests, patches, validation runs, and final diff summaries.

- `src/core/rubrics.ts`
  - Add dynamic quality rubrics by subject type: code, API, paper, data, docs, package, browser, database.

- `src/core/request-cache.ts`
  - Cache request plans and fetched evidence by normalized query and source URL.

## Self-Review

Spec coverage:
- General behavior is covered by `resolve_request`.
- Hyper-specific control is covered by explicit hints: `depth`, `outputShape`, `evidence`, and `execution`.
- Web/data/code/docs/facts/research routing is covered by `RequestPlan.sources`.
- Token efficiency is preserved by resource links and existing budgeted retrieval.
- Implementation is safely gated behind `execution`, with first release returning gap context rather than editing files automatically.

Placeholder scan:
- The implementation tasks use exact filenames, test commands, and code snippets.
- No task depends on undefined public workflow names after Task 3.

Type consistency:
- `RequestDepth`, `EvidenceMode`, `ExecutionMode`, and `OutputShape` are defined in Task 1 and reused in Tasks 3 and 4.
- `resolve_request` is consistently exposed as a `run_workflow` name.

