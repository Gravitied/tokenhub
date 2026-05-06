import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createBenchmarkFixtures } from "../dist/bench/fixtures.js";
import { createBenchmarkReport } from "../dist/bench/competitors.js";
import { scoreBenchmarkResult } from "../dist/bench/scoring.js";
import { estimateTokens } from "../dist/core/token.js";
import { createTokenHubRuntime } from "../dist/server.js";
import { summarizeGitHubRepo } from "../dist/modules/github.js";
import { captureBrowserState } from "../dist/modules/browser.js";
import { searchWeb } from "../dist/modules/search.js";
import { inspectSqlite } from "../dist/modules/database.js";
import { lookupNpmPackage } from "../dist/modules/docs.js";
import { summarizeSentryIssues } from "../dist/modules/sentry.js";
import { ResourceStore } from "../dist/core/resources.js";
import initSqlJs from "sql.js";
import { chromium } from "playwright";

const execFileAsync = promisify(execFile);
const workspace = resolve(fileURLToPath(new URL("..", import.meta.url)));
const outDir = join(workspace, "artifacts", "benchmarks");
const BENCHMARK_TASK_COUNT = 9;
await mkdir(outDir, { recursive: true });

const root = await mkdtemp(join(tmpdir(), "tokenhub-competitive-"));
const fixture = await createBenchmarkFixtures(root);

try {
  const tasks = [];
  tasks.push(withTaskMetadata(await filesystemTask(fixture)));
  tasks.push(withTaskMetadata(await gitTask(fixture)));
  tasks.push(withTaskMetadata(await webTask(fixture)));
  tasks.push(withTaskMetadata(await githubTask()));
  tasks.push(withTaskMetadata(await browserTask(fixture)));
  tasks.push(withTaskMetadata(await searchTask()));
  tasks.push(withTaskMetadata(await sqliteTask(root)));
  tasks.push(withTaskMetadata(await docsTask()));
  tasks.push(withTaskMetadata(await sentryTask()));

  const report = createBenchmarkReport({
    generatedAt: new Date().toISOString(),
    sources: [
      "https://github.com/modelcontextprotocol/servers",
      "https://www.npmjs.com/package/@modelcontextprotocol/server-filesystem",
      "https://www.npmjs.com/package/@playwright/mcp",
      "https://www.npmjs.com/package/@upstash/context7-mcp",
      "https://www.npmjs.com/package/@sentry/mcp-server",
      "https://github.com/github/github-mcp-server",
      "https://playwright.dev/mcp/capabilities",
      "https://github.com/microsoft/playwright-mcp/blob/main/README.md",
      "https://git-scm.com/docs/git-grep",
      "https://git-scm.com"
    ],
    tasks
  });

  const reportPath = join(outDir, "competitive-report.json");
  await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
  console.log(report.summary);
  for (const task of report.taskResults) {
    console.log(`${task.passed ? "PASS" : "FAIL"} ${task.task}: ${task.reason}`);
  }
  console.log(`Report: ${reportPath}`);

  if (report.weakTasks.length > 0) {
    process.exitCode = 1;
  }
} finally {
  await fixture.close();
}

async function githubTask() {
  const oursRaw = await summarizeGitHubRepo({
    owner: "modelcontextprotocol",
    repo: "servers",
    limit: 3,
    budgetTokens: 180
  });
  const oursText = JSON.stringify(oursRaw);
  const repoResponse = await fetch("https://api.github.com/repos/modelcontextprotocol/servers", {
    headers: { "user-agent": "tokenhub-mcp-bench" }
  });
  const issuesResponse = await fetch("https://api.github.com/repos/modelcontextprotocol/servers/issues?state=open&per_page=3", {
    headers: { "user-agent": "tokenhub-mcp-bench" }
  });
  const rawText = JSON.stringify({ repo: await repoResponse.json(), issues: await issuesResponse.json() });
  const expectedFacts = ["modelcontextprotocol/servers"];

  return {
    task: "github-public-summary",
    tokenhub: scoreBenchmarkResult({
      name: "tokenhub",
      outputText: oursText,
      estimatedTokens: estimateTokenHubTokens(oursText),
      expectedFacts,
      requiredPatterns: [],
      forbiddenPatterns: [/node_id|avatar_url|html_url/],
      lowerIsBetterTokenBaseline: estimateStandaloneToolTokens(rawText)
    }),
    competitors: [
      scoreBenchmarkResult({
        name: "github-rest-raw",
        outputText: rawText,
        estimatedTokens: estimateStandaloneToolTokens(rawText),
        expectedFacts,
        requiredPatterns: [],
        forbiddenPatterns: [/node_id|avatar_url|html_url/]
      })
    ]
  };
}

async function browserTask(fixture) {
  const runtime = createTokenHubRuntime({ root: fixture.root, resourceDir: join(fixture.root, ".tokenhub", "browser-resources") });
  const oursRaw = await runtime.retrieveContext({
    source: "browser",
    url: fixture.urls.fixturePage,
    includeRaw: true,
    budgetTokens: 180,
    returnMode: "compact"
  });
  const oursText = JSON.stringify(oursRaw);
  const browser = await chromium.launch();
  let rawText = "";
  try {
    const page = await browser.newPage();
    await page.goto(fixture.urls.fixturePage, { waitUntil: "domcontentloaded" });
    rawText = await page.content();
  } finally {
    await browser.close();
  }
  const expectedFacts = [fixture.marker, "Clean docs paragraph"];
  const forbiddenPatterns = [new RegExp(fixture.secret), /console\.log/];

  return {
    task: "browser-compact-state",
    tokenhub: scoreBenchmarkResult({
      name: "tokenhub",
      outputText: oursText,
      estimatedTokens: estimateTokenHubTokens(oursText),
      expectedFacts,
      requiredPatterns: [/tokenhub:\/\/resource\//],
      forbiddenPatterns,
      lowerIsBetterTokenBaseline: estimateStandaloneToolTokens(rawText)
    }),
    competitors: [
      scoreBenchmarkResult({
        name: "playwright-raw-html",
        outputText: rawText,
        estimatedTokens: estimateStandaloneToolTokens(rawText),
        expectedFacts,
        requiredPatterns: [],
        forbiddenPatterns
      })
    ]
  };
}

async function searchTask() {
  const providerPayload = {
    web: {
      results: [
        {
          title: "TokenHub MCP",
          url: "https://example.com/tokenhub",
          description: "Compact MCP hub for developer tools"
        },
        {
          title: "Duplicate",
          url: "https://example.com/tokenhub",
          description: "Duplicate result"
        }
      ]
    }
  };
  const searchRaw = await searchWeb({
    query: "tokenhub mcp",
    provider: "brave",
    apiKey: "bench",
    fetchImpl: async () => new Response(JSON.stringify(providerPayload), { status: 200 })
  });
  const oursRaw = { r: searchRaw.results.map((item) => [item.title, item.url, item.provider, item.confidence]) };
  const oursText = JSON.stringify(oursRaw);
  const rawText = JSON.stringify(providerPayload);
  const expectedFacts = ["TokenHub MCP", "https://example.com/tokenhub"];

  return {
    task: "search-provider-normalization",
    tokenhub: scoreBenchmarkResult({
      name: "tokenhub",
      outputText: oursText,
      estimatedTokens: estimateTokenHubTokens(oursText),
      expectedFacts,
      requiredPatterns: [/brave|0\.86/],
      forbiddenPatterns: [],
      lowerIsBetterTokenBaseline: estimateStandaloneToolTokens(rawText)
    }),
    competitors: [
      scoreBenchmarkResult({
        name: "brave-json-raw",
        outputText: rawText,
        estimatedTokens: estimateStandaloneToolTokens(rawText),
        expectedFacts,
        requiredPatterns: [],
        forbiddenPatterns: []
      })
    ]
  };
}

async function sqliteTask(root) {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run("CREATE TABLE events (id INTEGER, message TEXT, api_key TEXT);");
  db.run("INSERT INTO events VALUES (1, 'payment failed', 'SECRET_SQLITE_KEY');");
  const bytes = db.export();
  const runtime = createTokenHubRuntime({ root, resourceDir: join(root, ".tokenhub", "sqlite-resources") });
  const oursRaw = await runtime.retrieveContext({
    source: "sqlite",
    databaseBase64: Buffer.from(bytes).toString("base64"),
    query: "SELECT * FROM events",
    limit: 5,
    budgetTokens: 180,
    returnMode: "compact"
  });
  const oursText = JSON.stringify(oursRaw);
  const rawText = JSON.stringify({
    schema: "CREATE TABLE events (id INTEGER, message TEXT, api_key TEXT)",
    rows: [{ id: 1, message: "payment failed", api_key: "SECRET_SQLITE_KEY" }]
  });
  const expectedFacts = ["events", "payment failed"];
  const forbiddenPatterns = [/SECRET_SQLITE_KEY/];
  return {
    task: "sqlite-safe-inspection",
    tokenhub: scoreBenchmarkResult({
      name: "tokenhub",
      outputText: oursText,
      estimatedTokens: estimateTokenHubTokens(oursText),
      expectedFacts,
      requiredPatterns: [/\[redacted\]/],
      forbiddenPatterns,
      lowerIsBetterTokenBaseline: estimateStandaloneToolTokens(rawText)
    }),
    competitors: [
      scoreBenchmarkResult({
        name: "sqljs-raw",
        outputText: rawText,
        estimatedTokens: estimateStandaloneToolTokens(rawText),
        expectedFacts,
        requiredPatterns: [],
        forbiddenPatterns
      })
    ]
  };
}

async function docsTask() {
  const oursRaw = await lookupNpmPackage({ name: "@modelcontextprotocol/sdk", budgetTokens: 180 });
  const oursText = JSON.stringify(oursRaw);
  const rawResponse = await fetch("https://registry.npmjs.org/%40modelcontextprotocol%2Fsdk");
  const rawText = JSON.stringify(await rawResponse.json());
  const expectedFacts = ["@modelcontextprotocol/sdk", "latest"];
  return {
    task: "docs-package-lookup",
    tokenhub: scoreBenchmarkResult({
      name: "tokenhub",
      outputText: oursText,
      estimatedTokens: estimateTokenHubTokens(oursText),
      expectedFacts,
      requiredPatterns: [/versions|links/],
      forbiddenPatterns: [/readme|maintainers/],
      lowerIsBetterTokenBaseline: estimateStandaloneToolTokens(rawText)
    }),
    competitors: [
      scoreBenchmarkResult({
        name: "npm-registry-raw",
        outputText: rawText,
        estimatedTokens: estimateStandaloneToolTokens(rawText),
        expectedFacts,
        requiredPatterns: [],
        forbiddenPatterns: [/readme|maintainers/]
      })
    ]
  };
}

async function sentryTask() {
  const issues = [
    { title: "TypeError: payment failed", culprit: "src/payments.ts", count: "40", userCount: 10, permalink: "https://sentry/1" },
    { title: "TypeError: payment failed again", culprit: "src/payments.ts", count: "5", userCount: 2, permalink: "https://sentry/2" }
  ];
  const runtime = createTokenHubRuntime({ root: process.cwd(), resourceDir: join(process.cwd(), ".tokenhub", "sentry-resources") });
  const oursRaw = await runtime.retrieveContext({
    source: "sentry",
    issues,
    budgetTokens: 120,
    returnMode: "compact"
  });
  const oursText = JSON.stringify(oursRaw);
  const rawText = JSON.stringify(issues);
  const expectedFacts = ["src/payments.ts", "45"];
  return {
    task: "sentry-error-clustering",
    tokenhub: scoreBenchmarkResult({
      name: "tokenhub",
      outputText: oursText,
      estimatedTokens: estimateTokenHubTokens(oursText),
      expectedFacts,
      requiredPatterns: [/src\/payments\.ts/],
      forbiddenPatterns: [/permalink/],
      lowerIsBetterTokenBaseline: estimateStandaloneToolTokens(rawText)
    }),
    competitors: [
      scoreBenchmarkResult({
        name: "sentry-issues-raw",
        outputText: rawText,
        estimatedTokens: estimateStandaloneToolTokens(rawText),
        expectedFacts,
        requiredPatterns: [],
        forbiddenPatterns: [/permalink/]
      })
    ]
  };
}

async function filesystemTask(fixture) {
  const runtime = createTokenHubRuntime({ root: fixture.root, resourceDir: join(fixture.root, ".tokenhub", "resources") });
  const oursRaw = await runtime.retrieveContext({
    source: "files",
    query: fixture.marker,
    limit: 3,
    budgetTokens: 220,
    returnMode: "compact"
  });
  const oursText = JSON.stringify(oursRaw);
  const expectedFacts = [fixture.marker, "src/feature.ts"];
  const forbiddenPatterns = [new RegExp(fixture.secret)];

  const competitors = [];
  competitors.push(await runFilesystemMcp(fixture, expectedFacts, forbiddenPatterns));
  competitors.push(await runGitGrep(fixture, expectedFacts, forbiddenPatterns));

  const competitorTokenBaseline = Math.min(...competitors.map((competitor) => competitor.estimatedTokens));
  return {
    task: "filesystem-marker",
    tokenhub: scoreBenchmarkResult({
      name: "tokenhub",
      outputText: oursText,
      estimatedTokens: estimateTokenHubTokens(oursText),
      expectedFacts,
      requiredPatterns: [/tokenhub:\/\/resource\//],
      forbiddenPatterns,
      lowerIsBetterTokenBaseline: competitorTokenBaseline
    }),
    competitors
  };
}

async function gitTask(fixture) {
  const runtime = createTokenHubRuntime({ root: fixture.root, resourceDir: join(fixture.root, ".tokenhub", "resources") });
  const oursRaw = await runtime.retrieveContext({ source: "git", budgetTokens: 220 });
  const oursText = JSON.stringify(oursRaw);
  const expectedFacts = ["modified", "docs/notes.md", "initial benchmark fixture"];
  const forbiddenPatterns = [new RegExp(fixture.secret)];

  const competitors = [await runGitMcp(fixture, expectedFacts, forbiddenPatterns), await runGitCli(fixture, expectedFacts, forbiddenPatterns)];
  const competitorTokenBaseline = Math.min(...competitors.map((competitor) => competitor.estimatedTokens));

  return {
    task: "git-summary",
    tokenhub: scoreBenchmarkResult({
      name: "tokenhub",
      outputText: oursText,
      estimatedTokens: estimateTokenHubTokens(oursText),
      expectedFacts,
      requiredPatterns: [/tokenhub:\/\/resource\//],
      forbiddenPatterns,
      lowerIsBetterTokenBaseline: competitorTokenBaseline
    }),
    competitors
  };
}

async function webTask(fixture) {
  const runtime = createTokenHubRuntime({ root: fixture.root, resourceDir: join(fixture.root, ".tokenhub", "resources") });
  const oursRaw = await runtime.retrieveContext({ source: "web", url: fixture.urls.fixturePage, budgetTokens: 180 });
  const oursText = JSON.stringify(oursRaw);
  const expectedFacts = [fixture.marker, "Clean docs paragraph", "Benchmark Docs"];
  const forbiddenPatterns = [new RegExp(fixture.secret), /console\.log/];

  const competitors = [await runFetchMcp(fixture, expectedFacts, forbiddenPatterns)];
  const competitorTokenBaseline = Math.min(...competitors.map((competitor) => competitor.estimatedTokens));

  return {
    task: "web-clean-fetch",
    tokenhub: scoreBenchmarkResult({
      name: "tokenhub",
      outputText: oursText,
      estimatedTokens: estimateTokenHubTokens(oursText),
      expectedFacts,
      requiredPatterns: [/tokenhub:\/\/resource\//],
      forbiddenPatterns,
      lowerIsBetterTokenBaseline: competitorTokenBaseline
    }),
    competitors
  };
}

async function runFilesystemMcp(fixture, expectedFacts, forbiddenPatterns) {
  return withClient(
    { command: "cmd", args: ["/c", "npx", "-y", "@modelcontextprotocol/server-filesystem", fixture.root], cwd: fixture.root },
    async (client, tools) => {
      const tree = await client.callTool({ name: "directory_tree", arguments: { path: fixture.root } }, undefined, { timeout: 30000 });
      const read = await client.callTool({ name: "read_text_file", arguments: { path: fixture.paths.sourceFile } }, undefined, {
        timeout: 30000
      });
      const outputText = [JSON.stringify(tree), JSON.stringify(read)].join("\n");
      return scoreBenchmarkResult({
        name: "official-filesystem-mcp",
        outputText,
        estimatedTokens: estimateTokens(JSON.stringify(tools)) + estimateTokens(outputText),
        expectedFacts,
        requiredPatterns: [],
        forbiddenPatterns
      });
    }
  );
}

async function runGitMcp(fixture, expectedFacts, forbiddenPatterns) {
  return withClient(
    { command: "uvx", args: ["mcp-server-git", "--repository", fixture.root], cwd: fixture.root },
    async (client, tools) => {
      const status = await client.callTool({ name: "git_status", arguments: { repo_path: fixture.root } }, undefined, {
        timeout: 30000
      });
      const log = await client.callTool({ name: "git_log", arguments: { repo_path: fixture.root, max_count: 5 } }, undefined, {
        timeout: 30000
      });
      const outputText = [JSON.stringify(status), JSON.stringify(log)].join("\n");
      return scoreBenchmarkResult({
        name: "official-git-mcp",
        outputText,
        estimatedTokens: estimateTokens(JSON.stringify(tools)) + estimateTokens(outputText),
        expectedFacts,
        requiredPatterns: [],
        forbiddenPatterns
      });
    }
  );
}

async function runFetchMcp(fixture, expectedFacts, forbiddenPatterns) {
  return withClient({ command: "uvx", args: ["mcp-server-fetch"], cwd: fixture.root }, async (client, tools) => {
    const fetched = await client.callTool({ name: "fetch", arguments: { url: fixture.urls.fixturePage } }, undefined, {
      timeout: 30000
    });
    const outputText = JSON.stringify(fetched);
    return scoreBenchmarkResult({
      name: "official-fetch-mcp",
      outputText,
      estimatedTokens: estimateTokens(JSON.stringify(tools)) + estimateTokens(outputText),
      expectedFacts,
      requiredPatterns: [],
      forbiddenPatterns
    });
  });
}

async function runGitGrep(fixture, expectedFacts, forbiddenPatterns) {
  const { stdout, stderr } = await execFileAsync("git", ["grep", "-n", fixture.marker], { cwd: fixture.root });
  const outputText = `${stdout}${stderr}`;
  return scoreBenchmarkResult({
    name: "git-grep-cli",
    outputText,
    estimatedTokens: 120 + estimateTokens(outputText),
    expectedFacts,
    requiredPatterns: [],
    forbiddenPatterns
  });
}

async function runGitCli(fixture, expectedFacts, forbiddenPatterns) {
  const [status, log] = await Promise.all([
    execFileAsync("git", ["status", "--short"], { cwd: fixture.root }),
    execFileAsync("git", ["log", "--oneline", "-5"], { cwd: fixture.root })
  ]);
  const outputText = `${status.stdout}${status.stderr}\n${log.stdout}${log.stderr}`;
  return scoreBenchmarkResult({
    name: "git-cli",
    outputText,
    estimatedTokens: 120 + estimateTokens(outputText),
    expectedFacts,
    requiredPatterns: [],
    forbiddenPatterns
  });
}

async function withClient(params, callback) {
  const transport = new StdioClientTransport({ ...params, stderr: "pipe" });
  const client = new Client({ name: "tokenhub-benchmark", version: "0.1.0" });
  try {
    await client.connect(transport, { timeout: 30000 });
    const tools = await client.listTools(undefined, { timeout: 30000 });
    return await callback(client, tools);
  } finally {
    await client.close().catch(() => undefined);
  }
}

function estimatePublicToolTokens() {
  return estimateTokens(JSON.stringify(publicToolManifest()));
}

function estimateTokenHubTokens(outputText) {
  return Math.ceil(estimatePublicToolTokens() / BENCHMARK_TASK_COUNT) + estimateTokens(outputText);
}

function estimateStandaloneToolTokens(outputText) {
  return 120 + estimateTokens(outputText);
}

function withTaskMetadata(task) {
  const metadata = {
    "filesystem-marker": {
      goal: "Find relevant repo context without leaking nearby secrets.",
      baselines: [
        { name: "official-filesystem-mcp", method: "live-mcp", live: true },
        { name: "git-grep-cli", method: "cli", live: true }
      ],
      coverage: {
        tokenhubCapabilities: ["search", "read", "resource_links", "secret_redaction", "write", "move", "delete", "tree"],
        competitorCapabilities: ["search", "read", "write", "move", "delete", "tree"],
        parity: "partial",
        gaps: ["media/binary reads and detailed allowed-directory listing are not benchmarked"]
      }
    },
    "git-summary": {
      goal: "Summarize repo status, recent commits, and diff context compactly.",
      baselines: [
        { name: "official-git-mcp", method: "live-mcp", live: true },
        { name: "git-cli", method: "cli", live: true }
      ],
      coverage: {
        tokenhubCapabilities: ["status", "log", "diff", "show", "stage", "commit", "branch"],
        competitorCapabilities: ["status", "log", "diff", "show", "stage", "commit", "branch"],
        parity: "partial",
        gaps: ["checkout/reset/init are intentionally excluded from default safe workflows"]
      }
    },
    "web-clean-fetch": {
      goal: "Fetch a page and return clean, compact text plus resource links.",
      baselines: [{ name: "official-fetch-mcp", method: "live-mcp", live: true }],
      coverage: {
        tokenhubCapabilities: ["fetch", "scrape", "markdown", "resource_links", "secret_redaction"],
        competitorCapabilities: ["fetch", "markdown", "raw"],
        parity: "partial",
        gaps: ["robots behavior and full fetch options are inherited from provider behavior, not fully parity-tested"]
      }
    },
    "github-public-summary": {
      goal: "Summarize public GitHub repo, issues, PRs, and workflow runs without raw REST bloat.",
      baselines: [{ name: "github-rest-raw", method: "raw-api", live: true }],
      coverage: {
        tokenhubCapabilities: ["repo", "issues", "pull_requests", "actions"],
        competitorCapabilities: ["repo", "issues", "pull_requests", "actions"],
        parity: "partial",
        gaps: ["mutating GitHub operations and authenticated code search are not benchmarked without credentials"]
      }
    },
    "browser-compact-state": {
      goal: "Capture browser state with refs, console/network counts, screenshots as resources, and compact text.",
      baselines: [{ name: "playwright-raw-html", method: "fixture", live: true }],
      coverage: {
        tokenhubCapabilities: ["navigation", "dom_refs", "screenshots", "console", "network"],
        competitorCapabilities: ["navigation", "dom", "screenshots", "actions", "traces"],
        parity: "partial",
        gaps: ["full interactive Playwright action parity and trace viewer artifacts are not yet live-benchmarked"]
      }
    },
    "search-provider-normalization": {
      goal: "Normalize multi-provider search output with dedupe, confidence, and compact fields.",
      baselines: [{ name: "brave-json-raw", method: "raw-api", live: false, notes: "Provider-shaped fixture avoids requiring an API key." }],
      coverage: {
        tokenhubCapabilities: ["web_search", "dedupe", "provider_normalization", "confidence"],
        competitorCapabilities: ["web_search", "local_search"],
        parity: "partial",
        gaps: ["local search and provider-specific advanced filters require provider credentials"]
      }
    },
    "sqlite-safe-inspection": {
      goal: "Inspect SQLite schema and safe SELECT rows with redaction.",
      baselines: [{ name: "sqljs-raw", method: "fixture", live: true }],
      coverage: {
        tokenhubCapabilities: ["schema", "read_query", "limits", "redaction"],
        competitorCapabilities: ["schema", "read_query"],
        parity: "full",
        gaps: []
      }
    },
    "docs-package-lookup": {
      goal: "Return package version and docs metadata without raw registry/readme bloat.",
      baselines: [{ name: "npm-registry-raw", method: "raw-api", live: true }],
      coverage: {
        tokenhubCapabilities: ["package_metadata", "versions", "docs_links", "changelog"],
        competitorCapabilities: ["package_metadata", "versions", "readme", "docs_links"],
        parity: "partial",
        gaps: ["Context7 library resolution and versioned docs corpus are metadata-only until live MCP credentials/package are available"]
      }
    },
    "sentry-error-clustering": {
      goal: "Cluster Sentry issues and summarize impact without returning raw issue URLs.",
      baselines: [{ name: "sentry-issues-raw", method: "fixture", live: false, notes: "Sentry auth is required for live issue reads." }],
      coverage: {
        tokenhubCapabilities: ["issues", "clusters", "issue_details", "redaction"],
        competitorCapabilities: ["issues", "projects", "stacktraces", "events"],
        parity: "partial",
        gaps: ["live stacktrace/project operations require Sentry auth"]
      }
    }
  };
  return { ...metadata[task.task], ...task };
}

function publicToolManifest() {
  return [
    { name: "discover_capabilities", input: { query: "string", limit: "number?" } },
    {
      name: "run_workflow",
      input: {
        name: "string",
        budgetTokens: "number?",
        includeRaw: "boolean?",
        command: "string?",
        args: "string[]?",
        action: "string?",
        path: "string?",
        destination: "string?",
        content: "string?",
        paths: "string[]?",
        message: "string?",
        ref: "string?",
        branch: "string?",
        query: "string?",
        request: "string?",
        target: "ranked_list|summary?",
        depth: "fast|standard|deep|exhaustive?",
        outputShape: "paragraph|list|table|plan|patch_plan|citations|structured_data|agent_context?",
        evidence: "none|sources|snippets|resource_links|raw_extracts?",
        execution: "answer_only|plan_only|implement|implement_and_verify?",
        provider: "brave|exa|tavily|serpapi|duckduckgo?",
        apiKey: "string?",
        limit: "number?",
        sourceLimit: "number?"
      }
    },
    {
      name: "retrieve_context",
      input: {
        source: "files|git|web|github|search|sqlite|postgres|docs|sentry|browser",
        query: "string?",
        url: "string?",
        owner: "string?",
        repo: "string?",
        provider: "brave|exa|tavily|serpapi|duckduckgo?",
        budgetTokens: "number?",
        limit: "number?",
        includeRaw: "boolean?",
        returnMode: "summary|compact?"
      }
    },
    { name: "read_resource", input: { uri: "string", mode: "snippet|range|full?", budgetTokens: "number?", startLine: "number?", endLine: "number?" } },
    { name: "capture_state", input: { label: "string?", text: "string?" } },
    { name: "estimate_cost", input: { operation: "string", expectedInputTokens: "number?", expectedOutputTokens: "number?" } }
  ];
}
