# Developer Tool Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the developer-tool capabilities TokenHub is missing while proving every new feature is original, safer, more token efficient, and at least as useful as the strongest available competitor.

**Architecture:** Keep TokenHub's six public MCP tools unchanged. Add deferred internal capability packs behind `discover_capabilities`, `retrieve_context`, `run_workflow`, `read_resource`, and native MCP resource/prompt registration. Every pack returns compact "capsules" with evidence, quality metrics, safety warnings, and `tokenhub://resource/...` handles for large raw material.

**Tech Stack:** Node 22, TypeScript 5.9, Vitest 4, `@modelcontextprotocol/sdk` 1.29, Playwright 1.59, native `fetch`, optional provider REST/GraphQL APIs, CLI adapters for Docker/Kubernetes/cloud tools, deterministic fixtures, and the existing TokenHub benchmark harness.

---

## Non-Negotiable Outcomes

1. Public MCP surface remains exactly these six tools: `discover_capabilities`, `run_workflow`, `retrieve_context`, `read_resource`, `capture_state`, `estimate_cost`.
2. Every new capability has a compact summary mode, a resource-linked evidence mode, and a raw-resource expansion path.
3. Every mutating capability has a preview-first workflow. The preview contains the exact external change, a generated idempotency key, and a confirmation token. The mutation runs only when the caller sends that token back through `run_workflow`.
4. Every provider adapter accepts fixture data for tests and live credentials for optional benchmarks.
5. Every feature is original in shape: TokenHub does not merely mirror a provider API. It creates a cross-tool developer capsule, graph, action preview, or benchmarked workflow that competitors do not expose as one compact result.
6. Every feature with a competitor must pass the TokenHub advantage gate:
   - quality score is at least 5 points higher and estimated output tokens are at least 25 percent lower, or
   - quality score is at least equal and estimated output tokens are at least 40 percent lower.
7. Every feature without a direct competitor must beat the raw provider/API/CLI baseline by at least 40 percent token reduction and must pass all factual, safety, and citation checks.
8. No response may leak secrets, bearer tokens, cookies, private keys, `.env` values, or raw issue/comment bodies unless explicitly stored behind a resource handle and redacted in summaries.

## Competitor Evidence To Track

Use primary or project-maintained docs for the competitor catalog. Keep these URLs in `src/bench/competitors.ts` and in generated benchmark reports:

- MCP reference servers and examples: https://github.com/modelcontextprotocol/servers
- MCP TypeScript SDK resources, prompts, and tool annotations: local package `@modelcontextprotocol/sdk` and https://modelcontextprotocol.io/docs
- Official GitHub MCP server: https://github.com/github/github-mcp-server
- Playwright MCP capabilities: https://playwright.dev/docs/mcp
- Context7 MCP package/docs: https://www.npmjs.com/package/@upstash/context7-mcp
- Atlassian Remote MCP for Jira/Confluence: https://support.atlassian.com/rovo/docs/getting-started-with-the-atlassian-remote-mcp-server/
- Linear MCP docs: https://linear.app/docs/mcp
- Slack MCP docs/app listing: https://docs.slack.dev/tools/slack-mcp-server/
- Docker MCP Toolkit/Catalog: https://docs.docker.com/ai/mcp-catalog-and-toolkit/
- Sentry MCP package/docs: https://www.npmjs.com/package/@sentry/mcp-server

## Original TokenHub Capability Model

Each new feature should use these common shapes instead of returning raw provider objects:

```ts
export type EvidenceCapsule = {
  summary: string;
  facts: Array<{ key: string; value: string | number | boolean; source: string }>;
  confidence: number;
  resources: string[];
  warnings: string[];
  tokenEstimate: number;
};

export type WorkGraphNode = {
  id: string;
  type: "issue" | "pull_request" | "commit" | "doc" | "chat" | "deployment" | "alert" | "test" | "service";
  title: string;
  state?: string;
  url?: string;
  owner?: string;
  risk?: "low" | "medium" | "high";
};

export type WorkGraphEdge = {
  from: string;
  to: string;
  relation: "blocks" | "mentions" | "fixes" | "deploys" | "fails" | "documents" | "owns" | "duplicates";
  evidence: string;
};

export type ActionPreview = {
  actionId: string;
  provider: string;
  operation: string;
  target: string;
  before?: unknown;
  after: unknown;
  confirmationToken: string;
  idempotencyKey: string;
  warnings: string[];
};
```

## Capability Roadmap

| Pack | Competitors | Original TokenHub feature | Advantage target |
| --- | --- | --- | --- |
| GitHub Automation | Official GitHub MCP, GitHub REST/GraphQL, `gh` CLI | PR/CI/review capsules that map failures to files, changed tests, and next actions | Equal or better facts, 25-40 percent fewer tokens than raw GitHub MCP/API output |
| Trackers | Atlassian MCP, Linear MCP, Jira/Linear APIs | Cross-tracker issue graph with blocker, stale-owner, and PR/doc/chat links | One compact graph beats separate issue search payloads |
| Knowledge | Context7, Confluence/Notion/Drive APIs, package READMEs | Version-aware doc capsules with recency warnings and source-quality scoring | Higher source quality than raw search, 40 percent fewer tokens |
| Browser Automation | Playwright MCP | Scenario delta runner with compact accessibility diffs and failure evidence resources | Same interaction fidelity, lower token state than repeated snapshots |
| Runtime/Infra | Docker MCP Toolkit, Kubernetes MCPs, cloud CLIs | Runtime health capsule joining compose/k8s/cloud state, logs, env drift, and failing services | Better diagnosis than raw `docker`/`kubectl` output, fewer tokens |
| Security | Snyk MCP, GitHub security, npm audit, secret scanners | Reachability-aware vuln/security capsule linked to imports, lockfiles, and PR changes | Fewer false positives, no secret leakage, compact remediation plan |
| Observability | Sentry MCP, Grafana/New Relic/Datadog APIs | Incident capsule linking alerts, traces, commits, deploys, and candidate tests | Better triage facts per token than provider issue lists |
| Collaboration | Slack/Teams MCPs/APIs | Thread decision capsule that extracts decisions, blockers, owners, and linked work without raw chat bloat | 40 percent fewer tokens and privacy redaction |
| MCP Native Surfaces | Protocol-native server implementations | Native resources/prompts/tool annotations over TokenHub's existing resource store | Better client discoverability without expanding public tool count |

---

### Task 1: Capability Quality Contract And Benchmark Gate

**Files:**
- Create: `src/core/capability-quality.ts`
- Create: `tests/capability-quality.test.ts`
- Modify: `src/bench/scoring.ts`
- Modify: `src/bench/competitors.ts`

- [ ] **Step 1: Write the failing tests**

Add tests that define the shared pass/fail rule for all future packs.

```ts
import { describe, expect, test } from "vitest";
import { passesCapabilityGate, redactProviderSecrets } from "../src/core/capability-quality.js";

describe("capability quality gate", () => {
  test("passes with quality lead and 25 percent token reduction", () => {
    const result = passesCapabilityGate({
      tokenhub: { qualityScore: 91, estimatedTokens: 300, forbiddenHits: [] },
      competitor: { qualityScore: 84, estimatedTokens: 500, forbiddenHits: [] }
    });

    expect(result.passed).toBe(true);
    expect(result.reason).toContain("quality +7");
    expect(result.reason).toContain("tokens 40% lower");
  });

  test("passes with equal quality and 40 percent token reduction", () => {
    const result = passesCapabilityGate({
      tokenhub: { qualityScore: 85, estimatedTokens: 300, forbiddenHits: [] },
      competitor: { qualityScore: 85, estimatedTokens: 600, forbiddenHits: [] }
    });

    expect(result.passed).toBe(true);
  });

  test("fails when TokenHub leaks provider secrets", () => {
    const result = passesCapabilityGate({
      tokenhub: { qualityScore: 100, estimatedTokens: 10, forbiddenHits: ["authorization"] },
      competitor: { qualityScore: 60, estimatedTokens: 1000, forbiddenHits: [] }
    });

    expect(result.passed).toBe(false);
    expect(result.reason).toContain("forbidden output");
  });

  test("redacts common provider credentials", () => {
    const text = redactProviderSecrets("authorization: Bearer ghp_abc123\ncookie=session=secret\napi_key=SECRET");

    expect(text).not.toContain("ghp_abc123");
    expect(text).not.toContain("session=secret");
    expect(text).not.toContain("SECRET");
    expect(text).toContain("[redacted]");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test tests/capability-quality.test.ts
```

Expected: TypeScript cannot find `../src/core/capability-quality.js`.

- [ ] **Step 3: Implement the quality gate**

Create `src/core/capability-quality.ts`.

```ts
export type CapabilityScore = {
  qualityScore: number;
  estimatedTokens: number;
  forbiddenHits: string[];
};

export function passesCapabilityGate(input: { tokenhub: CapabilityScore; competitor: CapabilityScore }): {
  passed: boolean;
  reason: string;
} {
  if (input.tokenhub.forbiddenHits.length > 0) {
    return { passed: false, reason: `forbidden output: ${input.tokenhub.forbiddenHits.join(", ")}` };
  }
  const qualityLead = input.tokenhub.qualityScore - input.competitor.qualityScore;
  const tokenReduction = 1 - input.tokenhub.estimatedTokens / Math.max(input.competitor.estimatedTokens, 1);
  const passed =
    (qualityLead >= 5 && tokenReduction >= 0.25) ||
    (qualityLead >= 0 && tokenReduction >= 0.4);

  return {
    passed,
    reason: passed
      ? `quality +${qualityLead}, tokens ${(tokenReduction * 100).toFixed(0)}% lower`
      : `needed quality +5 with tokens 25% lower, or equal quality with tokens 40% lower; got quality +${qualityLead}, tokens ${(tokenReduction * 100).toFixed(0)}% lower`
  };
}

export function redactProviderSecrets(text: string): string {
  return text
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\b(authorization|cookie|set-cookie|x-api-key|api[_-]?key|token|secret)(\s*[:=]\s*)[^\s,;]+/gi, "$1$2[redacted]")
    .replace(/\b(ghp|github_pat|xoxb|xoxp|sk|AKIA)[A-Za-z0-9_:-]{8,}/g, "[redacted]");
}
```

- [ ] **Step 4: Route existing benchmark scoring through the new gate**

Update `src/bench/scoring.ts` so `assertSignificantlyBetter` calls `passesCapabilityGate` internally. Preserve the existing return shape.

- [ ] **Step 5: Add competitor catalog metadata fields**

Extend `CompetitorInfo` with:

```ts
category?: "github" | "tracker" | "knowledge" | "browser" | "runtime" | "security" | "observability" | "collaboration" | "protocol";
advantageMetric?: "quality_plus_tokens" | "equal_quality_lower_tokens" | "raw_baseline";
```

- [ ] **Step 6: Verify and commit**

Run:

```bash
npm test tests/capability-quality.test.ts tests/bench.test.ts
npm run lint
```

Expected: all tests pass and `tsc` reports no errors.

Commit:

```bash
git add src/core/capability-quality.ts src/bench/scoring.ts src/bench/competitors.ts tests/capability-quality.test.ts
git commit -m "test: add capability quality gate"
```

---

### Task 2: Shared Provider, Resource, And Action Safety Layer

**Files:**
- Create: `src/core/provider.ts`
- Create: `src/core/action-preview.ts`
- Create: `tests/provider-safety.test.ts`
- Modify: `src/core/resources.ts`
- Modify: `src/server.ts`

- [ ] **Step 1: Write failing tests for provider calls and redaction**

```ts
import { describe, expect, test } from "vitest";
import { createProviderClient } from "../src/core/provider.js";
import { createActionPreview, confirmActionPreview } from "../src/core/action-preview.js";

describe("provider safety", () => {
  test("injects credentials into requests but never returns them", async () => {
    const client = createProviderClient({
      provider: "fixture",
      baseUrl: "https://api.example.test",
      token: "SECRET_PROVIDER_TOKEN",
      fetchImpl: async (_url, init) => {
        expect(init?.headers).toEqual(expect.objectContaining({ authorization: "Bearer SECRET_PROVIDER_TOKEN" }));
        return new Response(JSON.stringify({ ok: true, token: "SECRET_PROVIDER_TOKEN" }), { status: 200 });
      }
    });

    const result = await client.getJson("/state");

    expect(JSON.stringify(result)).not.toContain("SECRET_PROVIDER_TOKEN");
    expect(JSON.stringify(result)).toContain("[redacted]");
  });

  test("requires preview confirmation before mutation", () => {
    const preview = createActionPreview({
      provider: "linear",
      operation: "create_issue",
      target: "team/ENG",
      after: { title: "Fix login timeout" }
    });

    expect(preview.confirmationToken).toMatch(/^confirm_/);
    expect(() => confirmActionPreview(preview, "wrong")).toThrow(/confirmation token/);
    expect(confirmActionPreview(preview, preview.confirmationToken)).toEqual(preview.idempotencyKey);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test tests/provider-safety.test.ts
```

Expected: missing modules.

- [ ] **Step 3: Implement `src/core/provider.ts`**

Implement a small fetch wrapper:

```ts
import { redactProviderSecrets } from "./capability-quality.js";

export type ProviderClientInput = {
  provider: string;
  baseUrl: string;
  token?: string;
  fetchImpl?: typeof fetch;
};

export function createProviderClient(input: ProviderClientInput) {
  const fetchImpl = input.fetchImpl ?? fetch;

  return {
    async getJson(path: string, init: RequestInit = {}) {
      const response = await fetchImpl(new URL(path, input.baseUrl), {
        ...init,
        headers: {
          accept: "application/json",
          "user-agent": "tokenhub-mcp/0.1",
          ...(input.token ? { authorization: `Bearer ${input.token}` } : {}),
          ...(init.headers ?? {})
        }
      });
      const text = redactProviderSecrets(await response.text());
      if (!response.ok) {
        throw new Error(`${input.provider} request failed: HTTP ${response.status} ${text.slice(0, 200)}`);
      }
      return JSON.parse(text) as unknown;
    }
  };
}
```

- [ ] **Step 4: Implement `src/core/action-preview.ts`**

Use deterministic SHA-256 hashes over provider, operation, target, and `after` payload for idempotency. Use `crypto.randomUUID()` only for the confirmation token.

- [ ] **Step 5: Add resource labels for provider evidence**

Extend `ResourceStore.writeText` callers to use labels like `provider:linear:issue-search` and `provider:github:actions-log`. Do not change the storage format.

- [ ] **Step 6: Verify and commit**

Run:

```bash
npm test tests/provider-safety.test.ts tests/core.test.ts
npm run lint
```

Commit:

```bash
git add src/core/provider.ts src/core/action-preview.ts src/core/resources.ts src/server.ts tests/provider-safety.test.ts
git commit -m "feat: add provider safety primitives"
```

---

### Task 3: Native MCP Resources, Prompts, And Tool Annotations

**Files:**
- Create: `src/mcp/native-surfaces.ts`
- Create: `tests/native-surfaces.test.ts`
- Modify: `src/server.ts`
- Modify: `README.md`

- [ ] **Step 1: Write failing tests for native surface registration**

Use the SDK's `McpServer.registerResource`, `McpServer.registerPrompt`, and `registerTool` `annotations` support.

```ts
import { describe, expect, test } from "vitest";
import { createMcpServer, createTokenHubRuntime } from "../src/server.js";
import { nativeSurfaceManifest } from "../src/mcp/native-surfaces.js";

describe("native MCP surfaces", () => {
  test("declares resources and prompts without adding public tools", () => {
    const runtime = createTokenHubRuntime({ root: process.cwd() });
    const manifest = nativeSurfaceManifest(runtime);

    expect(runtime.publicToolNames()).toHaveLength(6);
    expect(manifest.resources.map((resource) => resource.uriTemplate)).toContain("tokenhub://resource/{id}");
    expect(manifest.prompts.map((prompt) => prompt.name)).toContain("tokenhub.resolve_request");
  });

  test("server construction keeps the six public tools", () => {
    const server = createMcpServer({ root: process.cwd() });

    expect(server).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test tests/native-surfaces.test.ts
```

Expected: missing `src/mcp/native-surfaces.ts`.

- [ ] **Step 3: Implement `nativeSurfaceManifest`**

Create a manifest that is easy to unit test and easy to register:

```ts
export type NativeSurfaceManifest = {
  tools: Array<{
    name: string;
    annotations: {
      readOnlyHint: boolean;
      destructiveHint: boolean;
      idempotentHint: boolean;
      openWorldHint: boolean;
    };
  }>;
  resources: Array<{ name: string; uriTemplate: string }>;
  prompts: Array<{ name: string; description: string }>;
};

export function nativeSurfaceManifest(runtime: { publicToolNames(): string[] }): NativeSurfaceManifest {
  return {
    tools: runtime.publicToolNames().map((name) => ({
      name,
      annotations: {
        readOnlyHint: name !== "run_workflow" && name !== "capture_state",
        destructiveHint: false,
        idempotentHint: name !== "capture_state",
        openWorldHint: name === "retrieve_context" || name === "run_workflow"
      }
    })),
    resources: [{ name: "TokenHub resource", uriTemplate: "tokenhub://resource/{id}" }],
    prompts: [
      { name: "tokenhub.resolve_request", description: "Resolve a developer request using compact local and external context." },
      { name: "tokenhub.incident_triage", description: "Build an incident capsule from observability, code, and deployment evidence." }
    ]
  };
}
```

- [ ] **Step 4: Register resources and prompts in `createMcpServer`**

Call a helper from `src/mcp/native-surfaces.ts` after the six tools are registered:

```ts
registerTokenHubNativeSurfaces(server, runtime);
```

The helper must:

- register `tokenhub://resource/{id}` as a `ResourceTemplate`
- read through `runtime.readResource({ uri, mode: "snippet" })`
- register prompts for `tokenhub.resolve_request`, `tokenhub.pr_review`, and `tokenhub.incident_triage`
- add tool annotations to the six existing tool registrations

- [ ] **Step 5: Verify with unit and MCP client tests**

Run:

```bash
npm test tests/native-surfaces.test.ts tests/server.test.ts
npm run lint
```

Expected: public tools remain six; resources and prompts are available through MCP-native paths.

- [ ] **Step 6: Commit**

```bash
git add src/mcp/native-surfaces.ts src/server.ts tests/native-surfaces.test.ts README.md
git commit -m "feat: add native mcp resources and prompts"
```

---

### Task 4: GitHub Automation Pack

**Files:**
- Create: `src/modules/github-automation.ts`
- Create: `tests/github-automation.test.ts`
- Modify: `src/modules/github.ts`
- Modify: `src/server.ts`
- Modify: `src/workflows/index.ts`

- [ ] **Step 1: Write failing tests for PR triage capsules**

```ts
import { describe, expect, test } from "vitest";
import { summarizePullRequestTriage } from "../src/modules/github-automation.js";

describe("GitHub automation pack", () => {
  test("summarizes PR checks, review threads, and changed files compactly", async () => {
    const result = await summarizePullRequestTriage({
      owner: "example",
      repo: "demo",
      pullNumber: 12,
      fetchImpl: async (url) => {
        const u = url.toString();
        if (u.includes("/pulls/12/files")) {
          return new Response(JSON.stringify([
            { filename: "src/login.ts", status: "modified", additions: 5, deletions: 2, patch: "@@ login timeout" }
          ]), { status: 200 });
        }
        if (u.includes("/commits/abc/check-runs")) {
          return new Response(JSON.stringify({ check_runs: [{ name: "test", conclusion: "failure", output: { summary: "login timeout failed" } }] }), { status: 200 });
        }
        if (u.includes("/pulls/12")) {
          return new Response(JSON.stringify({ head: { sha: "abc" }, title: "Fix login", user: { login: "dev" } }), { status: 200 });
        }
        return new Response(JSON.stringify([]), { status: 200 });
      }
    });

    expect(result.summary).toContain("Fix login");
    expect(result.facts).toContainEqual({ key: "failed_check", value: "test", source: "github.check_runs" });
    expect(result.facts).toContainEqual({ key: "changed_file", value: "src/login.ts", source: "github.pull_files" });
    expect(result.summary.length).toBeLessThan(900);
  });
});
```

- [ ] **Step 2: Add CI log clustering tests**

Test `summarizeGitHubCiFailure` with a fixture Actions log containing three repeated stack frames. Expected output contains one representative failure, one candidate file path, and a resource handle for the raw log.

- [ ] **Step 3: Add mutating action preview tests**

Test `previewGitHubComment` and `applyGitHubPreview`. Expected behavior:

- preview returns an `ActionPreview`
- wrong confirmation token throws
- correct token calls the fixture `fetchImpl`
- returned summary does not contain the GitHub token

- [ ] **Step 4: Implement GitHub API helpers**

Add helpers for:

- `GET /repos/{owner}/{repo}/pulls/{pull_number}`
- `GET /repos/{owner}/{repo}/pulls/{pull_number}/files`
- `GET /repos/{owner}/{repo}/commits/{ref}/check-runs`
- `GET /repos/{owner}/{repo}/actions/runs/{run_id}/logs`
- `POST /repos/{owner}/{repo}/issues/{issue_number}/comments` through preview confirmation

Return `EvidenceCapsule` for read paths and `ActionPreview` for write paths.

- [ ] **Step 5: Register capabilities**

Add registry entries:

- `github.pr_triage`
- `github.ci_failure`
- `github.review_threads`
- `github.comment_preview`
- `github.issue_update_preview`

Route them through `retrieve_context({ source: "github", query: ... })` for read operations and `run_workflow({ name: "github_action", ... })` for preview/apply.

- [ ] **Step 6: Add benchmark case**

Add `github-pr-triage` to `scripts/run-benchmarks.mjs`.

Competitors:

- official GitHub MCP when auth is available
- raw GitHub REST fixture when auth is unavailable
- `gh pr view --json` fixture when CLI is available

Required facts: PR title, failed check, changed file, author, candidate next action. Required pattern: `tokenhub://resource/` for raw files/logs. Forbidden patterns: auth token, raw repeated log frames.

- [ ] **Step 7: Verify and commit**

Run:

```bash
npm test tests/github-automation.test.ts tests/integrations.test.ts tests/server.test.ts
npm run bench
npm run lint
```

Commit:

```bash
git add src/modules/github-automation.ts src/modules/github.ts src/server.ts src/workflows/index.ts scripts/run-benchmarks.mjs tests/github-automation.test.ts
git commit -m "feat: add compact github automation capsules"
```

---

### Task 5: Tracker Pack For Linear And Jira

**Files:**
- Create: `src/modules/tracker.ts`
- Create: `src/modules/providers/linear.ts`
- Create: `src/modules/providers/atlassian.ts`
- Create: `tests/tracker.test.ts`
- Modify: `src/server.ts`
- Modify: `src/workflows/index.ts`
- Modify: `src/bench/competitors.ts`

- [ ] **Step 1: Write failing tests for a cross-tracker issue graph**

```ts
import { describe, expect, test } from "vitest";
import { buildIssueGraph } from "../src/modules/tracker.js";

describe("tracker pack", () => {
  test("normalizes Linear and Jira issues into one blocker graph", async () => {
    const result = await buildIssueGraph({
      providers: [
        {
          name: "linear",
          issues: [
            { id: "LIN-1", title: "Login timeout", state: "In Progress", assignee: "Ava", blocks: ["JIRA-9"], url: "https://linear.app/acme/issue/LIN-1" }
          ]
        },
        {
          name: "jira",
          issues: [
            { id: "JIRA-9", title: "Session store migration", state: "Blocked", assignee: "Noah", blocks: [], url: "https://acme.atlassian.net/browse/JIRA-9" }
          ]
        }
      ],
      budgetTokens: 300
    });

    expect(result.nodes).toHaveLength(2);
    expect(result.edges).toContainEqual({ from: "LIN-1", to: "JIRA-9", relation: "blocks", evidence: "tracker.blocks" });
    expect(result.summary).toContain("Login timeout blocks Session store migration");
    expect(result.summary.length).toBeLessThan(700);
  });
});
```

- [ ] **Step 2: Write failing tests for stale owner and duplicate detection**

Fixture:

- two issues with near-identical titles
- one issue with no assignee
- one issue stale for 21 days

Expected capsule facts:

- `duplicate_candidate`
- `missing_owner`
- `stale_issue`

- [ ] **Step 3: Write failing tests for issue creation preview**

Test `previewTrackerIssueCreate` creates a provider-specific `ActionPreview` for Linear and Jira without calling `fetchImpl`.

- [ ] **Step 4: Implement provider adapters**

`src/modules/providers/linear.ts` should support:

- GraphQL issue search by team/project/state
- issue create preview
- comment preview
- compact field projection

`src/modules/providers/atlassian.ts` should support:

- Jira REST issue search via JQL
- Confluence link extraction for issue references
- issue create preview
- comment preview
- compact field projection

- [ ] **Step 5: Implement `src/modules/tracker.ts`**

Export:

- `buildIssueGraph`
- `summarizeTrackerBacklog`
- `detectTrackerRisks`
- `previewTrackerIssueCreate`
- `previewTrackerComment`

Use `WorkGraphNode`, `WorkGraphEdge`, and `EvidenceCapsule`. Store full provider payloads as resources only when `includeRaw` is true.

- [ ] **Step 6: Register capabilities**

Add:

- `tracker.issue_graph`
- `tracker.backlog_risks`
- `tracker.create_issue_preview`
- `tracker.comment_preview`

Route with `retrieve_context({ source: "tracker", provider: "linear" | "jira" | "all" })` and `run_workflow({ name: "tracker_action" })`.

- [ ] **Step 7: Add benchmark cases**

Add:

- `tracker-blocker-graph`
- `tracker-stale-owner`
- `tracker-issue-create-preview`

Competitors:

- Linear MCP or Linear GraphQL raw fixture
- Atlassian Remote MCP or Jira REST raw fixture

Required facts: issue id, state, assignee, blocker relation, stale age, preview target. Forbidden patterns: raw description bodies over 800 chars, tokens, cookies.

- [ ] **Step 8: Verify and commit**

Run:

```bash
npm test tests/tracker.test.ts tests/server.test.ts
npm run bench
npm run lint
```

Commit:

```bash
git add src/modules/tracker.ts src/modules/providers/linear.ts src/modules/providers/atlassian.ts src/server.ts src/workflows/index.ts src/bench/competitors.ts scripts/run-benchmarks.mjs tests/tracker.test.ts
git commit -m "feat: add tracker issue graph capsules"
```

---

### Task 6: Knowledge And Documentation Pack

**Files:**
- Create: `src/modules/knowledge.ts`
- Create: `src/modules/providers/confluence.ts`
- Create: `src/modules/providers/notion.ts`
- Create: `src/modules/providers/drive.ts`
- Create: `tests/knowledge.test.ts`
- Modify: `src/modules/docs.ts`
- Modify: `src/server.ts`
- Modify: `src/workflows/resolve-request.ts`

- [ ] **Step 1: Write failing tests for version-aware library docs**

```ts
import { describe, expect, test } from "vitest";
import { summarizeLibraryDocs } from "../src/modules/knowledge.js";

describe("knowledge pack", () => {
  test("binds docs to package version and warns on stale sources", async () => {
    const result = await summarizeLibraryDocs({
      packageName: "demo-lib",
      installedVersion: "2.1.0",
      candidates: [
        { title: "Demo v2 docs", url: "https://example.com/v2", text: "demo-lib v2.1 supports createClient()", updatedAt: "2026-04-01" },
        { title: "Old blog", url: "https://blog.example.com/old", text: "demo-lib v1 uses init()", updatedAt: "2022-01-01" }
      ],
      budgetTokens: 300
    });

    expect(result.summary).toContain("createClient");
    expect(result.facts).toContainEqual({ key: "version", value: "2.1.0", source: "package.installed" });
    expect(result.warnings).toContain("1 stale source excluded from summary.");
    expect(result.summary).not.toContain("init()");
  });
});
```

- [ ] **Step 2: Write failing tests for team-doc decision extraction**

Fixture pages:

- Confluence page with architecture decision
- Notion page with current checklist
- Drive doc with meeting notes

Expected output:

- one decision
- one owner
- one source link per fact
- resource handle for raw pages
- no raw meeting transcript in summary

- [ ] **Step 3: Implement `summarizeLibraryDocs`**

Use the existing npm lookup as the first signal, then rank docs by:

- exact package name match
- installed version or latest version match
- official domain/repository match
- recent update date
- presence of API symbols from the user query

Return `EvidenceCapsule`.

- [ ] **Step 4: Implement team knowledge adapters**

Provider adapters must support fixture input and optional live auth:

- Confluence: CQL or content search, page body extraction, version/update metadata
- Notion: database/page search, rich text flattening, last edited time
- Drive: file search, Google Docs export as text, modified time

All adapters return `KnowledgeDocument`:

```ts
export type KnowledgeDocument = {
  id: string;
  provider: "confluence" | "notion" | "drive" | "web" | "npm" | "github";
  title: string;
  url: string;
  text: string;
  updatedAt?: string;
  owner?: string;
};
```

- [ ] **Step 5: Register capabilities**

Add:

- `knowledge.search`
- `knowledge.answer`
- `knowledge.decision_capsule`
- `docs.library_versioned`

Route package/library questions in `resolve_request` to `docs.library_versioned` before generic web search.

- [ ] **Step 6: Add benchmark cases**

Add:

- `knowledge-versioned-doc-answer`
- `knowledge-decision-capsule`

Competitors:

- Context7 MCP for library docs
- raw Confluence/Notion/Drive fixture payloads for team docs
- generic web search answer from `answer_from_web`

Required facts: current version, correct API symbol, source title, decision, owner. Forbidden patterns: stale API symbol, raw transcript, token.

- [ ] **Step 7: Verify and commit**

Run:

```bash
npm test tests/knowledge.test.ts tests/integrations.test.ts tests/resolve-request.test.ts
npm run bench
npm run lint
```

Commit:

```bash
git add src/modules/knowledge.ts src/modules/providers/confluence.ts src/modules/providers/notion.ts src/modules/providers/drive.ts src/modules/docs.ts src/server.ts src/workflows/resolve-request.ts scripts/run-benchmarks.mjs tests/knowledge.test.ts
git commit -m "feat: add versioned knowledge capsules"
```

---

### Task 7: Interactive Browser Scenario Pack

**Files:**
- Create: `src/modules/browser-scenario.ts`
- Create: `tests/browser-scenario.test.ts`
- Modify: `src/modules/browser.ts`
- Modify: `src/server.ts`
- Modify: `src/workflows/index.ts`

- [ ] **Step 1: Write failing tests for scenario deltas**

```ts
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { runBrowserScenario } from "../src/modules/browser-scenario.js";
import { ResourceStore } from "../src/core/resources.js";

describe("browser scenario pack", () => {
  test("runs click/type steps and returns compact state deltas", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tokenhub-browser-scenario-"));
    const store = new ResourceStore({ rootDir: join(dir, ".tokenhub", "resources") });
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(`
        <h1>Login</h1>
        <input aria-label="Email">
        <button onclick="document.body.insertAdjacentHTML('beforeend','<p>Welcome Ava</p>')">Submit</button>
      `);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing address");

    try {
      const result = await runBrowserScenario({
        url: `http://127.0.0.1:${address.port}`,
        steps: [
          { action: "type", target: "Email", value: "ava@example.com" },
          { action: "click", target: "Submit" }
        ],
        resourceStore: store,
        budgetTokens: 250
      });

      expect(result.summary).toContain("Welcome Ava");
      expect(result.deltas).toHaveLength(2);
      expect(JSON.stringify(result)).not.toContain("ava@example.com");
      expect(result.resources[0]).toMatch(/^tokenhub:\/\/resource\//);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Implement scenario actions**

Support these actions first:

- `goto`
- `click`
- `type`
- `select`
- `wait_for_text`
- `screenshot`

Use accessible names and current `elements` refs from `captureBrowserState`. Store full screenshots and DOM snapshots as resources. Summaries show deltas only.

- [ ] **Step 3: Add failure capsule behavior**

On selector/action failure, return:

- failing step index
- nearest matching elements
- console errors
- failed requests
- screenshot resource
- suggested next step

- [ ] **Step 4: Register capabilities**

Add:

- `browser.scenario`
- `browser.delta_snapshot`
- `browser.failure_capsule`

Route through `run_workflow({ name: "browser_scenario" })`.

- [ ] **Step 5: Add benchmark cases**

Add:

- `browser-login-scenario`
- `browser-failure-diagnosis`

Competitors:

- Playwright MCP snapshot plus click/type sequence
- raw Playwright script output fixture

Required facts: final visible text, step count, failed request count, screenshot resource. Forbidden patterns: typed password/email values in summary.

- [ ] **Step 6: Verify and commit**

Run:

```bash
npm test tests/browser-scenario.test.ts tests/integrations.test.ts
npm run bench
npm run lint
```

Commit:

```bash
git add src/modules/browser-scenario.ts src/modules/browser.ts src/server.ts src/workflows/index.ts scripts/run-benchmarks.mjs tests/browser-scenario.test.ts
git commit -m "feat: add compact browser scenario runner"
```

---

### Task 8: Runtime And Infrastructure Pack

**Files:**
- Create: `src/modules/runtime.ts`
- Create: `src/modules/providers/docker.ts`
- Create: `src/modules/providers/kubernetes.ts`
- Create: `src/modules/providers/cloud-cli.ts`
- Create: `tests/runtime.test.ts`
- Modify: `src/server.ts`
- Modify: `src/workflows/index.ts`

- [ ] **Step 1: Write failing tests for Docker/Compose health capsules**

```ts
import { describe, expect, test } from "vitest";
import { summarizeRuntimeHealth } from "../src/modules/runtime.js";

describe("runtime pack", () => {
  test("joins container status, logs, and env drift into one compact capsule", async () => {
    const result = await summarizeRuntimeHealth({
      docker: {
        containers: [
          { name: "api", image: "acme/api:sha-123", state: "restarting", ports: "3000/tcp" },
          { name: "db", image: "postgres:16", state: "running", ports: "5432/tcp" }
        ],
        logs: { api: "Error: DATABASE_URL password=SECRET failed to connect\nError: DATABASE_URL password=SECRET failed to connect" }
      },
      budgetTokens: 250
    });

    expect(result.summary).toContain("api restarting");
    expect(result.summary).toContain("db running");
    expect(result.summary).not.toContain("SECRET");
    expect(result.facts).toContainEqual({ key: "unhealthy_service", value: "api", source: "docker.containers" });
  });
});
```

- [ ] **Step 2: Write failing tests for Kubernetes event compression**

Fixture:

- pod `api-7d9` crash looping
- deployment unavailable
- repeated image pull event
- log contains token-like value

Expected capsule:

- one crash loop fact
- one deployment fact
- one representative event
- redacted token

- [ ] **Step 3: Implement CLI adapters**

Adapters should execute only read-only commands:

- Docker: `docker ps --format json`, `docker compose ps --format json`, `docker logs --tail 120`
- Kubernetes: `kubectl get pods,deployments,events -o json`, `kubectl logs --tail=120`
- Cloud CLI: `aws sts get-caller-identity`, `aws ecs describe-services`, `gcloud run services list`, `az webapp list`

Only run a CLI when it exists on PATH. If missing, return a warning and fixture-compatible empty result.

- [ ] **Step 4: Implement `summarizeRuntimeHealth`**

Cluster repeated logs by normalized message. Join service state, recent logs, image tags, exposed ports, and recent events. Return an `EvidenceCapsule`.

- [ ] **Step 5: Register capabilities**

Add:

- `runtime.health`
- `runtime.docker`
- `runtime.kubernetes`
- `runtime.cloud`
- `runtime.env_drift`

Route through `retrieve_context({ source: "runtime", provider: "docker" | "kubernetes" | "cloud" | "all" })`.

- [ ] **Step 6: Add benchmark cases**

Add:

- `runtime-docker-health`
- `runtime-kubernetes-crashloop`

Competitors:

- Docker MCP Toolkit metadata/live if available
- raw Docker/Kubernetes CLI output fixture

Required facts: unhealthy service, status, representative error, redaction. Forbidden patterns: repeated logs over 3 copies, secrets.

- [ ] **Step 7: Verify and commit**

Run:

```bash
npm test tests/runtime.test.ts tests/server.test.ts
npm run bench
npm run lint
```

Commit:

```bash
git add src/modules/runtime.ts src/modules/providers/docker.ts src/modules/providers/kubernetes.ts src/modules/providers/cloud-cli.ts src/server.ts src/workflows/index.ts scripts/run-benchmarks.mjs tests/runtime.test.ts
git commit -m "feat: add runtime health capsules"
```

---

### Task 9: Security And Compliance Pack

**Files:**
- Create: `src/modules/security.ts`
- Create: `src/modules/providers/npm-audit.ts`
- Create: `src/modules/providers/git-secrets.ts`
- Create: `tests/security.test.ts`
- Modify: `src/server.ts`
- Modify: `src/workflows/index.ts`
- Modify: `src/bench/competitors.ts`

- [ ] **Step 1: Write failing tests for reachability-aware vulnerability summaries**

```ts
import { describe, expect, test } from "vitest";
import { summarizeSecurityFindings } from "../src/modules/security.js";

describe("security pack", () => {
  test("prioritizes vulnerable packages imported by changed code", async () => {
    const result = await summarizeSecurityFindings({
      packageLock: {
        packages: {
          "node_modules/demo-vuln": { version: "1.0.0" }
        }
      },
      auditFindings: [
        { package: "demo-vuln", severity: "high", title: "Prototype pollution", patchedVersion: "1.0.1" }
      ],
      imports: [{ file: "src/api.ts", package: "demo-vuln" }],
      changedFiles: ["src/api.ts"],
      budgetTokens: 250
    });

    expect(result.summary).toContain("high");
    expect(result.summary).toContain("src/api.ts");
    expect(result.facts).toContainEqual({ key: "reachable_vulnerability", value: "demo-vuln", source: "security.reachability" });
  });
});
```

- [ ] **Step 2: Write failing tests for secret scanning**

Fixture contains:

- `.env` with `OPENAI_API_KEY=sk-test-secret`
- source file with fake token
- generated artifact with false positive token text

Expected:

- source and `.env` findings
- artifact finding suppressed by default ignore rules
- summary redacts secret values

- [ ] **Step 3: Implement providers**

Support:

- `npm audit --json` when available
- package-lock parsing without command execution
- import reachability scan for JS/TS `import`, `require`, and dynamic `import()`
- local secret patterns with allowlist comments `tokenhub-ignore-secret`
- optional Snyk CLI or Snyk API baseline when credentials are configured

- [ ] **Step 4: Register capabilities**

Add:

- `security.audit`
- `security.secrets`
- `security.reachability`
- `security.license_capsule`
- `security.pr_risk`

Route through `retrieve_context({ source: "security" })` and `run_workflow({ name: "security_scan" })`.

- [ ] **Step 5: Add benchmark cases**

Add:

- `security-reachable-vuln`
- `security-secret-redaction`

Competitors:

- `npm audit --json`
- Snyk MCP/API fixture
- raw secret scanner fixture

Required facts: package, severity, patched version, reachable file, secret file path. Forbidden patterns: raw secret value.

- [ ] **Step 6: Verify and commit**

Run:

```bash
npm test tests/security.test.ts tests/server.test.ts
npm run bench
npm run lint
```

Commit:

```bash
git add src/modules/security.ts src/modules/providers/npm-audit.ts src/modules/providers/git-secrets.ts src/server.ts src/workflows/index.ts src/bench/competitors.ts scripts/run-benchmarks.mjs tests/security.test.ts
git commit -m "feat: add security risk capsules"
```

---

### Task 10: Observability Incident Pack

**Files:**
- Create: `src/modules/observability.ts`
- Create: `src/modules/providers/grafana.ts`
- Create: `src/modules/providers/newrelic.ts`
- Create: `src/modules/providers/datadog.ts`
- Create: `tests/observability.test.ts`
- Modify: `src/modules/sentry.ts`
- Modify: `src/server.ts`
- Modify: `src/workflows/index.ts`

- [ ] **Step 1: Write failing tests for incident capsules**

```ts
import { describe, expect, test } from "vitest";
import { buildIncidentCapsule } from "../src/modules/observability.js";

describe("observability pack", () => {
  test("links alerts, traces, deploys, and candidate code owners compactly", () => {
    const result = buildIncidentCapsule({
      alerts: [{ id: "A1", service: "api", message: "5xx spike", startedAt: "2026-05-06T20:00:00Z" }],
      traces: [{ service: "api", route: "/login", error: "TimeoutError", durationMs: 12000 }],
      deploys: [{ service: "api", sha: "abc123", deployedAt: "2026-05-06T19:55:00Z" }],
      codeOwners: [{ path: "src/login.ts", owner: "@auth-team" }],
      budgetTokens: 250
    });

    expect(result.summary).toContain("5xx spike");
    expect(result.summary).toContain("/login");
    expect(result.summary).toContain("@auth-team");
    expect(result.facts).toContainEqual({ key: "suspect_deploy", value: "abc123", source: "observability.deploys" });
  });
});
```

- [ ] **Step 2: Extend Sentry tests**

Add fixture stack traces and release ids. Expected output maps Sentry issue culprit to file path and release commit.

- [ ] **Step 3: Implement provider adapters**

Support fixture and optional live modes:

- Sentry: issues, events, stack trace frames, release commits
- Grafana: alerts, Loki logs, Tempo traces
- New Relic: errors inbox, deployments, traces
- Datadog: monitors, logs, APM traces, deployments

Adapters should normalize into:

```ts
export type ObservabilitySignal = {
  id: string;
  provider: "sentry" | "grafana" | "newrelic" | "datadog";
  service: string;
  kind: "alert" | "log" | "trace" | "error" | "deploy";
  title: string;
  timestamp: string;
  fields: Record<string, string | number | boolean>;
};
```

- [ ] **Step 4: Implement incident joins**

Join signals by service, time window, route, release, commit SHA, and file path. Return:

- `summary`
- `facts`
- `graph`
- `candidateTests`
- `resources`
- `warnings`

- [ ] **Step 5: Register capabilities**

Add:

- `observability.incident`
- `observability.release_regression`
- `observability.trace_to_code`
- `observability.test_suggestions`

Route through `retrieve_context({ source: "observability" })` and `run_workflow({ name: "incident_triage" })`.

- [ ] **Step 6: Add benchmark cases**

Add:

- `observability-incident-capsule`
- `observability-sentry-release-map`

Competitors:

- Sentry MCP fixture/live
- raw Grafana/New Relic/Datadog API fixtures

Required facts: service, alert, route/error, suspect deploy, owner, candidate test. Forbidden patterns: raw log lines above limit, secrets.

- [ ] **Step 7: Verify and commit**

Run:

```bash
npm test tests/observability.test.ts tests/integrations.test.ts
npm run bench
npm run lint
```

Commit:

```bash
git add src/modules/observability.ts src/modules/providers/grafana.ts src/modules/providers/newrelic.ts src/modules/providers/datadog.ts src/modules/sentry.ts src/server.ts src/workflows/index.ts scripts/run-benchmarks.mjs tests/observability.test.ts
git commit -m "feat: add observability incident capsules"
```

---

### Task 11: Collaboration Pack For Slack And Teams

**Files:**
- Create: `src/modules/collaboration.ts`
- Create: `src/modules/providers/slack.ts`
- Create: `src/modules/providers/teams.ts`
- Create: `tests/collaboration.test.ts`
- Modify: `src/server.ts`
- Modify: `src/workflows/index.ts`

- [ ] **Step 1: Write failing tests for thread decision capsules**

```ts
import { describe, expect, test } from "vitest";
import { summarizeThreadDecisions } from "../src/modules/collaboration.js";

describe("collaboration pack", () => {
  test("extracts decisions, blockers, owners, and links without raw chat bloat", () => {
    const result = summarizeThreadDecisions({
      messages: [
        { author: "Ava", text: "Decision: ship the cache fix behind flag login-cache-v2", ts: "1" },
        { author: "Noah", text: "Blocker: need DBA approval for index migration", ts: "2" },
        { author: "Mia", text: "I will own the rollout checklist", ts: "3" }
      ],
      budgetTokens: 220
    });

    expect(result.summary).toContain("ship the cache fix");
    expect(result.facts).toContainEqual({ key: "blocker", value: "need DBA approval for index migration", source: "chat.message" });
    expect(result.facts).toContainEqual({ key: "owner", value: "Mia", source: "chat.message" });
    expect(result.summary.length).toBeLessThan(600);
  });
});
```

- [ ] **Step 2: Write failing privacy tests**

Fixture contains:

- email addresses
- pasted token
- private channel name

Expected summary redacts token, masks email local parts, and includes channel only when `includeChannelNames` is true.

- [ ] **Step 3: Implement provider adapters**

Slack:

- search messages
- fetch thread replies
- extract links to GitHub/Jira/Linear/Confluence
- preview message/comment post

Teams:

- search chat/channel messages when token is configured
- fetch replies
- extract links
- preview reply

- [ ] **Step 4: Implement decision extraction**

Use deterministic text rules first:

- `Decision:`
- `Blocker:`
- `Owner:`
- `Action:`
- "I will"
- linked issue/PR/doc URLs

Keep summaries rule-based and testable before adding provider-specific ranking.

- [ ] **Step 5: Register capabilities**

Add:

- `collaboration.thread_summary`
- `collaboration.decision_capsule`
- `collaboration.work_links`
- `collaboration.reply_preview`

Route through `retrieve_context({ source: "collaboration" })` and `run_workflow({ name: "collaboration_action" })`.

- [ ] **Step 6: Add benchmark cases**

Add:

- `collaboration-decision-capsule`
- `collaboration-privacy-redaction`

Competitors:

- Slack MCP fixture/live
- Teams Graph API fixture
- raw chat export fixture

Required facts: decision, blocker, owner, linked work item. Forbidden patterns: token, full email, raw channel transcript.

- [ ] **Step 7: Verify and commit**

Run:

```bash
npm test tests/collaboration.test.ts tests/server.test.ts
npm run bench
npm run lint
```

Commit:

```bash
git add src/modules/collaboration.ts src/modules/providers/slack.ts src/modules/providers/teams.ts src/server.ts src/workflows/index.ts scripts/run-benchmarks.mjs tests/collaboration.test.ts
git commit -m "feat: add collaboration decision capsules"
```

---

### Task 12: Cross-Tool Work Graph And Dynamic Routing

**Files:**
- Create: `src/core/work-graph.ts`
- Create: `tests/work-graph.test.ts`
- Modify: `src/core/request-router.ts`
- Modify: `src/core/request-shape.ts`
- Modify: `src/workflows/resolve-request.ts`
- Modify: `src/workflows/index.ts`

- [ ] **Step 1: Write failing tests for graph merging**

```ts
import { describe, expect, test } from "vitest";
import { mergeWorkGraphs } from "../src/core/work-graph.js";

describe("work graph", () => {
  test("dedupes nodes and preserves strongest evidence edge", () => {
    const graph = mergeWorkGraphs([
      {
        nodes: [{ id: "PR-12", type: "pull_request", title: "Fix login", url: "https://github/pr/12" }],
        edges: [{ from: "PR-12", to: "LIN-1", relation: "fixes", evidence: "github.pr_body" }]
      },
      {
        nodes: [{ id: "PR-12", type: "pull_request", title: "Fix login", url: "https://github/pr/12" }],
        edges: [{ from: "PR-12", to: "LIN-1", relation: "fixes", evidence: "linear.linked_pr" }]
      }
    ]);

    expect(graph.nodes).toHaveLength(1);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0].evidence).toBe("github.pr_body;linear.linked_pr");
  });
});
```

- [ ] **Step 2: Write failing routing tests**

Requests and expected sources:

- "Why is login failing in prod after the last deploy?" -> observability, github, runtime, files
- "Create tickets for the failing browser accessibility issues" -> browser, tracker action preview
- "Summarize the Slack decision and update the PR" -> collaboration, github action preview
- "Is this vulnerable package reachable from changed code?" -> security, files, git

- [ ] **Step 3: Implement `src/core/work-graph.ts`**

Export:

- `mergeWorkGraphs`
- `summarizeWorkGraph`
- `rankWorkGraphRisks`

Use stable ids and deterministic edge merging.

- [ ] **Step 4: Update request shape**

Add source values:

- `tracker`
- `knowledge`
- `runtime`
- `security`
- `observability`
- `collaboration`

Add output shape:

- `work_graph`
- `action_preview`
- `incident_capsule`

- [ ] **Step 5: Update dynamic workflow**

`resolve_request` should:

- infer target packs from verbs and nouns
- call only the packs needed for the request
- merge graph outputs when more than one pack is called
- return a concise "next action" section
- store full graph as a resource

- [ ] **Step 6: Verify and commit**

Run:

```bash
npm test tests/work-graph.test.ts tests/request-router.test.ts tests/resolve-request.test.ts
npm run lint
```

Commit:

```bash
git add src/core/work-graph.ts src/core/request-router.ts src/core/request-shape.ts src/workflows/resolve-request.ts src/workflows/index.ts tests/work-graph.test.ts tests/request-router.test.ts tests/resolve-request.test.ts
git commit -m "feat: route requests across developer work graph"
```

---

### Task 13: Competitive Benchmark Expansion

**Files:**
- Modify: `scripts/run-benchmarks.mjs`
- Modify: `src/bench/competitors.ts`
- Modify: `src/bench/fixtures.ts`
- Modify: `tests/bench.test.ts`
- Generate: `artifacts/benchmarks/competitive-report.json`

- [ ] **Step 1: Add competitor catalog entries**

Add entries for:

- `github-mcp-server`
- `linear-mcp`
- `atlassian-remote-mcp`
- `slack-mcp-server`
- `playwright-mcp`
- `context7-mcp`
- `docker-mcp-toolkit`
- `snyk-mcp`
- `sentry-mcp-server`
- `grafana-mcp`

Each entry must include `category`, `source`, `benchmarkStatus`, `requiresAuth`, and `strengths`.

- [ ] **Step 2: Add deterministic fixtures**

Add fixture builders for:

- GitHub PR with failed checks and repeated logs
- Linear/Jira linked issues
- Confluence/Notion/Drive docs
- browser login and failure pages
- Docker/Kubernetes unhealthy service output
- npm audit and secret scan
- Sentry/Grafana/New Relic/Datadog incident signals
- Slack/Teams thread messages

- [ ] **Step 3: Add benchmark tasks**

Every new pack must have at least one benchmark task. High-risk packs need two.

Required task list:

- `github-pr-triage`
- `github-ci-failure`
- `tracker-blocker-graph`
- `knowledge-versioned-doc-answer`
- `browser-login-scenario`
- `runtime-docker-health`
- `security-reachable-vuln`
- `observability-incident-capsule`
- `collaboration-decision-capsule`
- `resolve-request-prod-login-failure`

- [ ] **Step 4: Add live benchmark detection**

Run live competitor baselines only when credentials or CLIs are available:

- `GITHUB_TOKEN`
- `LINEAR_API_KEY`
- `ATLASSIAN_API_TOKEN`
- `SLACK_BOT_TOKEN`
- `SENTRY_AUTH_TOKEN`
- `DATADOG_API_KEY`
- `NEW_RELIC_API_KEY`
- Docker CLI
- `kubectl`

When unavailable, use fixture-shaped raw API output and mark baseline method as `fixture`.

- [ ] **Step 5: Enforce advantage gate in benchmarks**

After each task, call the quality gate from Task 1. A generated report with any failed task must set `summary` to include `FAILED` and cause `npm run bench` to exit non-zero.

- [ ] **Step 6: Update benchmark tests**

Extend `tests/bench.test.ts` to require the new competitor names and benchmark task names.

- [ ] **Step 7: Verify and commit**

Run:

```bash
npm test tests/bench.test.ts
npm run bench
npm run lint
```

Commit:

```bash
git add scripts/run-benchmarks.mjs src/bench/competitors.ts src/bench/fixtures.ts tests/bench.test.ts artifacts/benchmarks/competitive-report.json
git commit -m "bench: prove developer tool expansion advantages"
```

---

### Task 14: Documentation, Proof Page, And User-Facing Examples

**Files:**
- Modify: `README.md`
- Modify: `scripts/generate-proof-page.mjs`
- Generate: `artifacts/proof/index.html`
- Generate: `artifacts/proof/tokenhub-proof.png`
- Create: `docs/capability-packs.md`
- Create: `docs/provider-auth.md`

- [ ] **Step 1: Document the six-tool surface**

Update README to state that the public tools remain six and every new feature is discovered through `discover_capabilities`.

- [ ] **Step 2: Document provider auth**

Create `docs/provider-auth.md` with environment variable names, scopes, read/write mode distinctions, and fixture fallback behavior. Mention that mutating workflows require action previews.

- [ ] **Step 3: Document capability examples**

Create `docs/capability-packs.md` with copy-paste examples:

```json
{
  "source": "observability",
  "query": "login failures after latest deploy",
  "returnMode": "compact",
  "budgetTokens": 500
}
```

```json
{
  "name": "browser_scenario",
  "url": "http://localhost:3000/login",
  "steps": [
    { "action": "type", "target": "Email", "value": "test@example.com" },
    { "action": "click", "target": "Sign in" }
  ],
  "budgetTokens": 500
}
```

- [ ] **Step 4: Update proof generator**

The proof page must show:

- public tool count equals six
- all unit tests pass
- all benchmark tasks pass the advantage gate
- generated competitor report path
- generated token efficiency chart from benchmark JSON

- [ ] **Step 5: Verify and commit**

Run:

```bash
npm test
npm run bench
npm run build
npm run proof
```

Commit:

```bash
git add README.md docs/capability-packs.md docs/provider-auth.md scripts/generate-proof-page.mjs artifacts/proof/index.html artifacts/proof/tokenhub-proof.png
git commit -m "docs: document developer tool capability packs"
```

---

### Task 15: Final Release Readiness Gate

**Files:**
- Modify only files needed to fix failures found by this task.

- [ ] **Step 1: Run full local verification**

Run:

```bash
npm test
npm run lint
npm run build
npm run bench
npm run proof
```

Expected:

- Vitest passes
- TypeScript has no errors
- build emits `dist`
- benchmark summary has no failed tasks
- proof PNG exists and is a valid screenshot

- [ ] **Step 2: Inspect benchmark report**

Open `artifacts/benchmarks/competitive-report.json` and confirm:

- every task has a strongest competitor or fixture baseline
- every task includes coverage metadata
- every failed auth-gated live baseline has a fixture fallback
- every TokenHub result is under the token target
- no forbidden pattern hit is present

- [ ] **Step 3: Inspect public MCP surface**

Run a small runtime check:

```bash
node -e "import('./dist/server.js').then(({createTokenHubRuntime})=>{const r=createTokenHubRuntime({root:process.cwd()}); console.log(r.publicToolNames())})"
```

Expected output contains only:

```text
discover_capabilities,run_workflow,retrieve_context,read_resource,capture_state,estimate_cost
```

- [ ] **Step 4: Fix any failing gate**

If any benchmark fails, improve the TokenHub capsule first. Only relax a benchmark when the expected facts are wrong or the competitor fixture is invalid.

- [ ] **Step 5: Commit final fixes**

Commit only if Step 4 changed files:

```bash
git add <changed-files>
git commit -m "fix: satisfy developer tool release gates"
```

---

## Execution Order

1. Build the quality gate and provider/action safety layer first. They protect every later feature.
2. Add MCP-native resources/prompts next because it improves client ergonomics without changing the public tool count.
3. Implement GitHub, tracker, knowledge, and browser packs. These cover the most common daily developer workflows.
4. Implement runtime, security, observability, and collaboration packs. These cover production debugging and team coordination.
5. Upgrade `resolve_request` after the packs exist so routing can be tested against real modules.
6. Expand benchmarks only after each pack has unit tests, then make the benchmark gate mandatory.
7. Finish with docs, proof artifacts, and full release verification.

## Self-Review

- Spec coverage: Every missing feature category from the prior gap analysis has a concrete task, files, tests, benchmarks, and a registration path.
- Competitor coverage: Each category names a direct competitor or raw baseline and defines how TokenHub wins.
- Token efficiency coverage: The shared gate makes token reduction mandatory rather than aspirational.
- Safety coverage: Provider redaction, preview-first mutation, resource handles, and forbidden pattern checks appear in core tasks and every high-risk pack.
- Public surface coverage: The six-tool invariant is tested in Task 3, Task 14, and Task 15.
- Placeholder scan: This plan contains no unspecified implementation placeholders; every task gives concrete files, tests, commands, and acceptance behavior.
