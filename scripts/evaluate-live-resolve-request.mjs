import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createTokenHubRuntime } from "../dist/server.js";
import { estimateTokens } from "../dist/core/token.js";
import { scoreSourceQuality } from "../dist/bench/source-quality.js";

const workspace = resolve(fileURLToPath(new URL("..", import.meta.url)));
const artifactsDir = join(workspace, "artifacts", "evals");
const reportPath = join(artifactsDir, "resolve-request-live-eval.json");

const cases = [
  {
    id: "vitest-typescript-config-docs",
    request: "Find current Vitest official config docs for TypeScript projects and summarize setup",
    expectedKeywords: ["Vitest", "TypeScript", "config"],
    preferredDomains: ["vitest.dev"]
  },
  {
    id: "node-lts-backend-release-notes",
    request: "Summarize current Node.js LTS release notes for backend developers",
    expectedKeywords: ["Node", "LTS", "release"],
    preferredDomains: ["nodejs.org"]
  },
  {
    id: "docker-compose-watch-commands",
    request: "Find official Docker Compose Watch documentation and list setup commands",
    expectedKeywords: ["Docker", "Compose", "watch"],
    preferredDomains: ["docs.docker.com"]
  },
  {
    id: "owasp-api-key-storage",
    request: "Research current OWASP guidance for storing API keys in frontend and backend apps",
    expectedKeywords: ["OWASP", "API", "keys"],
    preferredDomains: ["owasp.org"]
  },
  {
    id: "github-actions-artifact-v4-migration",
    request: "Find current GitHub Actions artifact upload v4 migration notes",
    expectedKeywords: ["GitHub", "Actions", "artifact", "v4"],
    preferredDomains: ["github.com", "docs.github.com"]
  },
  {
    id: "vite-env-variables-docs",
    request: "Find current Vite environment variables docs and summarize env usage",
    expectedKeywords: ["Vite", "environment", "variables"],
    preferredDomains: ["vite.dev"]
  },
  {
    id: "cloudflare-workers-node-compat",
    request: "Find current Cloudflare Workers Node.js compatibility guidance",
    expectedKeywords: ["Cloudflare", "Workers", "Node"],
    preferredDomains: ["developers.cloudflare.com"]
  },
  {
    id: "sveltekit-routing-load-best-practices",
    request: "Summarize current SvelteKit load and routing docs best practices",
    expectedKeywords: ["SvelteKit", "load", "routing"],
    preferredDomains: ["svelte.dev", "kit.svelte.dev"]
  },
  {
    id: "pnpm-workspaces-monorepo-setup",
    request: "Find current pnpm workspaces docs and summarize monorepo setup",
    expectedKeywords: ["pnpm", "workspaces", "monorepo"],
    preferredDomains: ["pnpm.io"]
  },
  {
    id: "turborepo-nx-monorepo-comparison",
    request: "Compare Turborepo and Nx for JavaScript monorepos using current docs",
    expectedKeywords: ["Turborepo", "Nx", "monorepo"],
    preferredDomains: ["turbo.build", "nx.dev"]
  }
];

await mkdir(artifactsDir, { recursive: true });
const root = await mkdtemp(join(tmpdir(), "tokenhub-live-resolve-eval-"));
await seedWorkspace(root);
const runtime = createTokenHubRuntime({ root, resourceDir: join(root, ".tokenhub", "resources") });
const results = [];

try {
  for (const testCase of cases) {
    results.push(await runCase(runtime, testCase));
  }
} finally {
  await rm(root, { recursive: true, force: true });
}

const report = {
  generatedAt: new Date().toISOString(),
  mode: "live-network",
  provider: "duckduckgo",
  note: "This eval uses live DuckDuckGo search and live page fetches through TokenHub resolve_request; failures may reflect network/provider volatility.",
  summary: `${results.filter((result) => result.passed).length} of ${results.length} live resolve_request source-quality evaluations passed.`,
  allPassed: results.every((result) => result.passed),
  results
};

await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
console.log(report.summary);
console.log(`Report: ${reportPath}`);
for (const result of results) {
  console.log(`${result.passed ? "PASS" : "FAIL"} ${result.id}: score=${result.sourceQuality.score}; ${result.reason}`);
}

if (!report.allPassed) {
  process.exitCode = 1;
}

async function runCase(runtime, testCase) {
  const started = Date.now();
  const output = await withTimeout(
    runtime.runWorkflow({
      name: "resolve_request",
      request: testCase.request,
      depth: "deep",
      evidence: "snippets",
      budgetTokens: 2400,
      provider: "duckduckgo"
    }),
    60000,
    testCase.id
  );
  const web = output.data?.web ?? {};
  const sources = web.sources ?? [];
  const contextSnippets = web.contextSnippets ?? [];
  const quality = scoreSourceQuality({
    request: testCase.request,
    expectedKeywords: testCase.expectedKeywords,
    preferredDomains: testCase.preferredDomains,
    sources,
    contextSnippets,
    summary: output.summary,
    minSources: 2,
    minUniqueDomains: 2,
    minContextSnippets: 2,
    minKeywordCoverage: 0.67,
    minScore: 75
  });
  const contractChecks = [
    check(output.telemetry?.capability === "workflow.resolve_request", "telemetry capability should be workflow.resolve_request"),
    check(output.resources.some((resource) => resource.uri?.startsWith("tokenhub://resource/")), "missing tokenhub resource link"),
    check(sources.every((source) => source.resourceUri?.startsWith("tokenhub://resource/")), "not every source has a tokenhub resource link")
  ];
  const failures = [...quality.checks.filter((item) => !item.ok).map((item) => item.reason), ...contractChecks.filter((item) => !item.ok).map((item) => item.reason)];
  const passed = quality.passed && contractChecks.every((item) => item.ok);

  return {
    id: testCase.id,
    request: testCase.request,
    passed,
    reason: passed ? "live sources met quality, relevance, resource, and telemetry contracts" : failures.join("; "),
    ms: Date.now() - started,
    estimatedTokens: estimateTokens(JSON.stringify(output)),
    expectedKeywords: testCase.expectedKeywords,
    preferredDomains: testCase.preferredDomains,
    requestPlan: output.data?.requestPlan,
    sourceQuality: quality,
    sources: sources.map((source) => ({ title: source.title, url: source.url, resourceUri: source.resourceUri })),
    contextSnippets: contextSnippets.slice(0, 8),
    resourceUris: output.resources.map((resource) => resource.uri),
    telemetry: output.telemetry,
    warnings: output.warnings,
    summaryPreview: output.summary.slice(0, 900)
  };
}

function check(ok, reason) {
  return { ok: Boolean(ok), reason };
}

async function seedWorkspace(root) {
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "test-stack.ts"), "export const testStack = ['vitest', 'jest', 'playwright', 'cypress'];\n", "utf8");
  await writeFile(join(root, "src", "monorepo.ts"), "export const monorepoTools = ['pnpm', 'turborepo', 'nx'];\n", "utf8");
}

async function withTimeout(promise, timeoutMs, label) {
  let timeout;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms: ${label}`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeout);
  }
}
