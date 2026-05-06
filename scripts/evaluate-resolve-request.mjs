import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createTokenHubRuntime } from "../dist/server.js";
import { estimateTokens } from "../dist/core/token.js";

const workspace = resolve(fileURLToPath(new URL("..", import.meta.url)));
const artifactsDir = join(workspace, "artifacts", "evals");
const reportPath = join(artifactsDir, "resolve-request-eval.json");

const batches = [
  [
    {
      id: "deepseek-paper-summary",
      request: "Give me a 1 paragraph summary of the latest DeepSeek research papers",
      expected: { intent: "research", subject: "paper", outputShape: "paragraph", sources: ["web_search", "web_pages"], summary: ["DeepSeek", "Sources:"] }
    },
    {
      id: "healthy-vegetable-list",
      request: "Find the top 10 healthiest vegetables and return a ranked list",
      expected: { subject: "data", outputShape: "list", sources: ["web_search"], summary: ["1.", "Sources:"], itemCountAtLeast: 10 }
    },
    {
      id: "bun-node-comparison",
      request: "Compare Bun and Node for a backend API and return the tradeoffs",
      expected: { intent: "compare", subject: "api", outputShape: "agent_context", sources: ["docs", "web_search"], summary: ["Bun", "Node"] }
    },
    {
      id: "stripe-implementation-context",
      request: "Look up the latest Stripe Checkout API docs and give implementation context for subscriptions",
      expected: { subject: "api", sources: ["docs", "web_search"], summary: ["Stripe", "Checkout"] }
    },
    {
      id: "undici-debug",
      request: "Debug TypeError fetch failed in Node undici ECONNRESET",
      expected: { intent: "debug", subject: "error", sources: ["web_search"], summary: ["ECONNRESET"] }
    },
    {
      id: "github-actions-table",
      request: "Extract a pricing table for GitHub Actions minutes",
      expected: { intent: "extract", subject: "data", outputShape: "table", sources: ["web_search"], summary: ["GitHub Actions"] }
    },
    {
      id: "express-fastify-plan",
      request: "Make a plan to migrate an Express app to Fastify using the latest docs",
      expected: { intent: "plan", subject: "docs", outputShape: "plan", sources: ["docs", "web_search"], summary: ["Fastify"] }
    },
    {
      id: "react-query-cache-update",
      request: "Use the latest React Query package changelog to update caching code",
      expected: { subject: "package", sources: ["package_registry", "docs", "web_search"], summary: ["React Query"] }
    },
    {
      id: "retry-implementation-compare",
      request: "Find similar professional optimized implementations of retry backoff in TypeScript and compare them to this code",
      expected: { intent: "compare", subject: "code", sources: ["local_files", "web_search", "github_code", "docs"], localMatchesAtLeast: 1 }
    },
    {
      id: "nvidia-current-fact",
      request: "Who is the current CEO of Nvidia and cite sources",
      expected: { intent: "research", subject: "fact", outputShape: "citations", sources: ["web_search"], summary: ["Nvidia", "Sources:"] }
    }
  ],
  [
    {
      id: "openai-api-code-context",
      request: "Show me a TypeScript example for the latest OpenAI Responses API from official docs",
      expected: { subject: "api", sources: ["docs", "web_search"], summary: ["Responses API"] }
    },
    {
      id: "postgres-sqlite-compare",
      request: "Compare Postgres and SQLite for a local-first SaaS prototype",
      expected: { intent: "compare", outputShape: "agent_context", summary: ["Postgres", "SQLite"] }
    },
    {
      id: "env-var-extraction",
      request: "Extract the required environment variables from the deployment docs into structured data",
      expected: { intent: "extract", subject: "docs", outputShape: "structured_data", sources: ["docs", "web_search"], summary: ["DATABASE_URL"] }
    },
    {
      id: "playwright-token-research",
      request: "Research the latest Playwright MCP token efficiency guidance",
      expected: { intent: "research", subject: "docs", sources: ["docs", "web_search"], summary: ["Playwright"] }
    },
    {
      id: "github-actions-debug",
      request: "Fix a GitHub Actions node setup cache failure and cite likely causes",
      expected: { intent: "implement", subject: "error", outputShape: "patch_plan", sources: ["web_search"], summary: ["cache"] }
    },
    {
      id: "next-upgrade-plan",
      request: "Find the latest Next.js changelog and make an upgrade plan",
      expected: { intent: "plan", subject: "package", outputShape: "plan", sources: ["package_registry", "docs", "web_search"], summary: ["Next.js"] }
    },
    {
      id: "zod-package-table",
      request: "Collect npm package metadata for zod and return a table",
      expected: { intent: "extract", subject: "package", outputShape: "table", sources: ["package_registry", "docs"], summary: ["zod"] }
    },
    {
      id: "sentry-sdk-summary",
      request: "Summarize the latest Sentry JavaScript SDK release notes",
      expected: { intent: "research", subject: "package", outputShape: "paragraph", sources: ["package_registry", "docs", "web_search"], summary: ["Sentry"] }
    },
    {
      id: "mcp-filesystem-compare",
      request: "Compare professional MCP filesystem server implementations to ours and list gaps",
      expected: { intent: "compare", subject: "code", outputShape: "list", sources: ["local_files", "web_search", "github_code", "docs"] }
    },
    {
      id: "cloudflare-deploy-plan",
      request: "Generate commands to deploy a Vite app to Cloudflare Pages using current docs",
      expected: { intent: "plan", subject: "docs", outputShape: "plan", sources: ["docs", "web_search"], summary: ["Cloudflare"] }
    }
  ],
  [
    {
      id: "prisma-migration-checklist",
      request: "Find current Prisma migration docs and create a checklist",
      expected: { intent: "plan", subject: "docs", outputShape: "plan", sources: ["docs", "web_search"], summary: ["Prisma"] }
    },
    {
      id: "vercel-function-debug",
      request: "Debug Vercel FUNCTION_INVOCATION_FAILED 500 errors",
      expected: { intent: "debug", subject: "error", sources: ["web_search"], summary: ["Vercel"] }
    },
    {
      id: "cloudflare-cache-header-table",
      request: "Extract Cloudflare cache headers from current docs as a table",
      expected: { intent: "extract", subject: "docs", outputShape: "table", sources: ["docs", "web_search"], summary: ["Cache-Control"] }
    },
    {
      id: "redis-upstash-rate-limit",
      request: "Compare Redis and Upstash for API rate limiting",
      expected: { intent: "compare", subject: "api", outputShape: "agent_context", sources: ["docs", "web_search"], summary: ["Redis", "Upstash"] }
    },
    {
      id: "typescript-release-summary",
      request: "Summarize the latest TypeScript release notes in one paragraph",
      expected: { intent: "research", subject: "package", outputShape: "paragraph", sources: ["package_registry", "docs", "web_search"], summary: ["TypeScript"] }
    },
    {
      id: "docker-node-best-practices",
      request: "Find official Docker Node image best practices and give commands",
      expected: { intent: "plan", subject: "docs", outputShape: "plan", sources: ["docs", "web_search"], summary: ["Docker"] }
    },
    {
      id: "github-rate-limit-structured",
      request: "Look up GitHub REST API rate limits and return structured data",
      expected: { subject: "api", outputShape: "structured_data", sources: ["docs", "web_search"], summary: ["rate limit"] }
    },
    {
      id: "postgres-release-summary",
      request: "Summarize latest PostgreSQL release notes",
      expected: { intent: "research", subject: "package", outputShape: "paragraph", sources: ["package_registry", "docs", "web_search"], summary: ["PostgreSQL"] }
    },
    {
      id: "browser-state-capture-compare",
      request: "Compare professional browser automation state capture implementations to ours",
      expected: { intent: "compare", subject: "code", outputShape: "agent_context", sources: ["local_files", "web_search", "github_code", "docs"] }
    },
    {
      id: "oauth-current-spec-citations",
      request: "Find current OAuth 2.1 spec changes and cite sources",
      expected: { intent: "research", subject: "docs", outputShape: "citations", sources: ["docs", "web_search"], summary: ["OAuth", "Sources:"] }
    }
  ]
];

await mkdir(artifactsDir, { recursive: true });
const root = await mkdtemp(join(tmpdir(), "tokenhub-resolve-eval-"));
await seedWorkspace(root);
const runtime = createTokenHubRuntime({ root, resourceDir: join(root, ".tokenhub", "resources") });
const originalFetch = globalThis.fetch;
globalThis.fetch = fakeFetch;

const report = {
  generatedAt: new Date().toISOString(),
  batches: [],
  summary: "",
  allPassed: false
};

try {
  for (const [batchIndex, batch] of batches.entries()) {
    const results = [];
    for (const testCase of batch) {
      results.push(await runCase(runtime, testCase));
    }
    const passed = results.every((result) => result.passed);
    report.batches.push({ batch: batchIndex + 1, passed, results });
    if (!passed) {
      break;
    }
  }
} finally {
  globalThis.fetch = originalFetch;
  await rm(root, { recursive: true, force: true });
}

report.allPassed = report.batches.every((batch) => batch.passed) && report.batches.length === batches.length;
report.summary = `${report.batches.reduce((sum, batch) => sum + batch.results.filter((result) => result.passed).length, 0)} of ${report.batches.reduce(
  (sum, batch) => sum + batch.results.length,
  0
)} resolve_request prompt evaluations passed.`;

await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
console.log(report.summary);
console.log(`Report: ${reportPath}`);

for (const batch of report.batches) {
  for (const result of batch.results) {
    console.log(`${result.passed ? "PASS" : "FAIL"} batch ${batch.batch} ${result.id}: ${result.reason}`);
  }
}

if (!report.allPassed) {
  process.exitCode = 1;
}

async function runCase(runtime, testCase) {
  const started = Date.now();
  const result = await runtime.runWorkflow({
    name: "resolve_request",
    request: testCase.request,
    budgetTokens: 1800,
    provider: "duckduckgo",
    execution: testCase.request.includes("implement the gaps") ? "plan_only" : undefined
  });
  const requestPlan = result.data?.requestPlan;
  const checks = [];
  const expected = testCase.expected;
  if (expected.intent) checks.push(check(requestPlan?.intent === expected.intent, `intent expected ${expected.intent}, got ${requestPlan?.intent}`));
  if (expected.subject) checks.push(check(requestPlan?.subject === expected.subject, `subject expected ${expected.subject}, got ${requestPlan?.subject}`));
  if (expected.outputShape) {
    checks.push(check(requestPlan?.outputShape === expected.outputShape, `outputShape expected ${expected.outputShape}, got ${requestPlan?.outputShape}`));
  }
  for (const source of expected.sources ?? []) {
    checks.push(check(requestPlan?.sources?.includes(source), `missing source ${source}`));
  }
  for (const text of expected.summary ?? []) {
    checks.push(check(result.summary.includes(text), `summary missing ${text}`));
  }
  if (expected.itemCountAtLeast) {
    checks.push(check((result.data?.web?.items?.length ?? 0) >= expected.itemCountAtLeast, `expected at least ${expected.itemCountAtLeast} items`));
  }
  if (expected.localMatchesAtLeast) {
    checks.push(check((result.data?.local?.length ?? 0) >= expected.localMatchesAtLeast, `expected at least ${expected.localMatchesAtLeast} local matches`));
  }
  checks.push(check(result.resources.some((resource) => resource.uri?.startsWith("tokenhub://resource/")), "missing tokenhub resource link"));
  checks.push(check(result.telemetry?.capability === "workflow.resolve_request", "wrong telemetry capability"));

  const failures = checks.filter((item) => !item.ok).map((item) => item.reason);
  return {
    id: testCase.id,
    request: testCase.request,
    passed: failures.length === 0,
    reason: failures.length ? failures.join("; ") : "matched expected route, format, evidence, and resource contract",
    ms: Date.now() - started,
    estimatedTokens: estimateTokens(JSON.stringify(result)),
    actual: {
      intent: requestPlan?.intent,
      subject: requestPlan?.subject,
      outputShape: requestPlan?.outputShape,
      sources: requestPlan?.sources,
      resourceUris: result.resources.map((resource) => resource.uri),
      telemetryCapability: result.telemetry?.capability,
      telemetry: result.telemetry,
      summary: result.summary.slice(0, 500),
      warnings: result.warnings
    }
  };
}

function check(ok, reason) {
  return { ok: Boolean(ok), reason };
}

async function seedWorkspace(root) {
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(
    join(root, "src", "retry.ts"),
    "export async function retryBackoff(fn: () => Promise<unknown>) { try { return await fn(); } catch { return await fn(); } }\n",
    "utf8"
  );
  await writeFile(join(root, "src", "cache.ts"), "export function updateReactQueryCache() { return 'stale'; }\n", "utf8");
  await writeFile(join(root, "src", "browser.ts"), "export function captureBrowserState() { return { headings: [], links: [], consoleErrors: [] }; }\n", "utf8");
  await writeFile(join(root, "package.json"), JSON.stringify({ dependencies: { zod: "^4.0.0", next: "^16.0.0" } }, null, 2), "utf8");
}

async function fakeFetch(url) {
  const urlText = url.toString();
  if (urlText.includes("duckduckgo.com/html/")) {
    const parsed = new URL(urlText);
    const query = parsed.searchParams.get("q") ?? "";
    const slug = classify(query);
    const results = [1, 2, 3]
      .map(
        (index) =>
          `<a class="result__a" href="https://example.test/${slug}/${index}">${titleFor(slug, index)}</a><a class="result__snippet">${snippetFor(slug)}</a>`
      )
      .join("\n");
    return new Response(`<html><body>${results}</body></html>`, { status: 200, headers: { "content-type": "text/html" } });
  }
  return new Response(pageFor(urlText), { status: 200, headers: { "content-type": "text/html" } });
}

function classify(query) {
  const lower = query.toLowerCase();
  if (lower.includes("vegetable")) return "vegetables";
  if (lower.includes("deepseek")) return "deepseek";
  if (lower.includes("bun") && lower.includes("node")) return "bun-node";
  if (lower.includes("stripe")) return "stripe";
  if (lower.includes("undici") || lower.includes("econnreset")) return "undici";
  if (lower.includes("github actions") && lower.includes("pricing")) return "github-actions";
  if (lower.includes("fastify")) return "fastify";
  if (lower.includes("react query")) return "react-query";
  if (lower.includes("retry") || lower.includes("backoff")) return "retry";
  if (lower.includes("nvidia")) return "nvidia";
  if (lower.includes("responses api") || lower.includes("openai")) return "openai";
  if (lower.includes("postgres") && lower.includes("sqlite")) return "postgres-sqlite";
  if (lower.includes("environment variables")) return "env-vars";
  if (lower.includes("playwright")) return "playwright";
  if (lower.includes("node setup cache")) return "actions-cache";
  if (lower.includes("next.js") || lower.includes("nextjs")) return "next";
  if (lower.includes("zod")) return "zod";
  if (lower.includes("sentry")) return "sentry";
  if (lower.includes("filesystem")) return "mcp-filesystem";
  if (lower.includes("prisma")) return "prisma";
  if (lower.includes("vercel")) return "vercel";
  if (lower.includes("cache headers")) return "cloudflare-cache";
  if (lower.includes("cloudflare")) return "cloudflare";
  if (lower.includes("redis") && lower.includes("upstash")) return "redis-upstash";
  if (lower.includes("typescript") && lower.includes("release")) return "typescript";
  if (lower.includes("docker")) return "docker-node";
  if (lower.includes("github rest api") || lower.includes("rate limits")) return "github-rate-limit";
  if (lower.includes("postgresql")) return "postgres-release";
  if (lower.includes("browser automation")) return "browser-state";
  if (lower.includes("oauth")) return "oauth";
  return "general";
}

function titleFor(slug, index) {
  return `${labelFor(slug)} reference ${index}`;
}

function snippetFor(slug) {
  return `${labelFor(slug)} source with current docs, implementation notes, and cited context.`;
}

function labelFor(slug) {
  const labels = {
    vegetables: "Healthy vegetables",
    deepseek: "DeepSeek research papers",
    "bun-node": "Bun Node backend API comparison",
    stripe: "Stripe Checkout API subscriptions",
    undici: "Node undici ECONNRESET debug",
    "github-actions": "GitHub Actions pricing table",
    fastify: "Express to Fastify migration docs",
    "react-query": "React Query package changelog",
    retry: "TypeScript retry backoff implementation",
    nvidia: "Nvidia current CEO sources",
    openai: "OpenAI Responses API TypeScript docs",
    "postgres-sqlite": "Postgres SQLite comparison",
    "env-vars": "Deployment environment variables docs",
    playwright: "Playwright MCP token efficiency",
    "actions-cache": "GitHub Actions node setup cache failure",
    next: "Next.js package changelog",
    zod: "zod npm package metadata",
    sentry: "Sentry JavaScript SDK release notes",
    "mcp-filesystem": "MCP filesystem implementation comparison",
    cloudflare: "Cloudflare Pages Vite deployment",
    prisma: "Prisma migration docs",
    vercel: "Vercel function invocation debug",
    "cloudflare-cache": "Cloudflare cache headers docs",
    "redis-upstash": "Redis Upstash API rate limiting",
    typescript: "TypeScript release notes",
    "docker-node": "Docker Node image best practices",
    "github-rate-limit": "GitHub REST API rate limits",
    "postgres-release": "PostgreSQL release notes",
    "browser-state": "Browser automation state capture",
    oauth: "OAuth 2.1 spec changes"
  };
  return labels[slug] ?? "General developer research";
}

function pageFor(url) {
  const slug = new URL(url).pathname.split("/").filter(Boolean)[0] ?? "general";
  if (slug === "vegetables") {
    return html("Healthy vegetables", [
      "<ol><li>Watercress</li><li>Spinach</li><li>Kale</li><li>Swiss chard</li><li>Beet greens</li><li>Broccoli</li><li>Brussels sprouts</li><li>Carrots</li><li>Red cabbage</li><li>Bell peppers</li></ol>"
    ]);
  }
  const pages = {
    deepseek: ["Abstract: DeepSeek Sparse Attention improves long-context efficiency and reasoning while preserving open model availability."],
    "bun-node": ["Bun and Node both support backend API workloads. Bun emphasizes fast startup and integrated tooling, while Node has deeper ecosystem maturity."],
    stripe: ["Stripe Checkout API supports subscription mode, price IDs, success URLs, cancel URLs, and webhook verification for production billing."],
    undici: ["ECONNRESET in Node undici usually points to a closed socket, proxy reset, TLS interruption, or missing retry and timeout handling."],
    "github-actions": ["GitHub Actions pricing table: Linux minutes, Windows minutes, macOS minutes, storage, included quota, and overage rates."],
    fastify: ["Fastify migration plan: audit Express middleware, convert routes, add schemas, update plugins, run integration tests, then switch traffic."],
    "react-query": ["React Query changelog highlights cache invalidation, stale time defaults, query client updates, and migration notes for caching code."],
    retry: ["A professional retry backoff implementation validates input, supports exponential jitter, typed errors, max attempts, abort signals, and testable timers."],
    nvidia: ["Nvidia is led by Jensen Huang. Sources should cite current company leadership pages and recent filings."],
    openai: ["Responses API TypeScript example: create a client, call responses.create, pass model and input, then read output_text."],
    "postgres-sqlite": ["Postgres supports concurrent SaaS workloads and managed operations, while SQLite is strong for local-first prototypes and embedded data."],
    "env-vars": ["Deployment docs require DATABASE_URL, API_KEY, NODE_ENV, SENTRY_DSN, and AUTH_SECRET environment variables."],
    playwright: ["Playwright MCP guidance emphasizes compact snapshots and CLI usage when full MCP page trees cost too many tokens."],
    "actions-cache": ["GitHub Actions node setup cache failures often come from lockfile path mismatches, package manager changes, or stale cache keys."],
    next: ["Next.js changelog upgrade plan: read breaking changes, update package, run codemods, test routes, and check runtime configuration."],
    zod: ["zod npm package metadata table includes package name, latest version, license, repository, types, and documentation links."],
    sentry: ["Sentry JavaScript SDK release notes summarize tracing changes, browser integrations, Node support, and migration guidance."],
    "mcp-filesystem": ["Professional MCP filesystem implementations include allowed roots, path validation, read/write tools, tree listing, and safe error messages."],
    cloudflare: ["Cloudflare Pages Vite deployment commands: npm run build, wrangler pages deploy dist, set build output directory, and configure environment variables."],
    prisma: ["Prisma migration docs checklist: run prisma migrate dev, review generated SQL, apply migrations in CI, and verify schema drift."],
    vercel: ["Vercel FUNCTION_INVOCATION_FAILED 500 errors can come from runtime exceptions, missing environment variables, timeouts, or unsupported Node APIs."],
    "cloudflare-cache": ["Cloudflare cache headers table includes Cache-Control, CDN-Cache-Control, Cloudflare-CDN-Cache-Control, ETag, and Vary."],
    "redis-upstash": ["Redis and Upstash both support API rate limiting. Upstash offers serverless HTTP access while Redis gives direct low-latency control."],
    typescript: ["TypeScript release notes summarize compiler changes, editor improvements, stricter checks, and migration recommendations."],
    "docker-node": ["Docker Node image best practices commands include docker build, npm ci --omit=dev, non-root users, and multi-stage builds."],
    "github-rate-limit": ["GitHub REST API rate limit structured data includes core limit, search limit, GraphQL points, reset time, and headers."],
    "postgres-release": ["PostgreSQL release notes summarize planner improvements, SQL features, replication changes, and upgrade cautions."],
    "browser-state": ["Professional browser automation state capture uses compact DOM maps, stable element refs, console errors, network failures, and screenshot resources."],
    oauth: ["OAuth 2.1 spec changes consolidate PKCE, remove implicit flow guidance, tighten redirect URI rules, and cite current standards sources."]
  };
  return html(labelFor(slug), pages[slug] ?? ["General developer research source."]);
}

function html(title, paragraphs) {
  return `<!doctype html><html><head><title>${title}</title></head><body><main>${paragraphs.map((p) => `<p>${p}</p>`).join("")}</main></body></html>`;
}
