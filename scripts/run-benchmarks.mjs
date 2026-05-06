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
await mkdir(outDir, { recursive: true });

const root = await mkdtemp(join(tmpdir(), "tokenhub-competitive-"));
const fixture = await createBenchmarkFixtures(root);

try {
  const tasks = [];
  tasks.push(await filesystemTask(fixture));
  tasks.push(await gitTask(fixture));
  tasks.push(await webTask(fixture));
  tasks.push(await githubTask());
  tasks.push(await browserTask(fixture));
  tasks.push(await searchTask());
  tasks.push(await sqliteTask(root));
  tasks.push(await docsTask());
  tasks.push(await sentryTask());

  const report = createBenchmarkReport({
    generatedAt: new Date().toISOString(),
    sources: [
      "https://github.com/modelcontextprotocol/servers",
      "https://www.npmjs.com/package/@modelcontextprotocol/server-filesystem",
      "https://www.npmjs.com/package/@playwright/mcp",
      "https://www.npmjs.com/package/@upstash/context7-mcp",
      "https://www.npmjs.com/package/@sentry/mcp-server",
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
      estimatedTokens: estimatePublicToolTokens() + estimateTokens(oursText),
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
      estimatedTokens: estimatePublicToolTokens() + estimateTokens(oursText),
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
      estimatedTokens: estimatePublicToolTokens() + estimateTokens(oursText),
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
      estimatedTokens: estimatePublicToolTokens() + estimateTokens(oursText),
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
      estimatedTokens: estimatePublicToolTokens() + estimateTokens(oursText),
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
      estimatedTokens: estimatePublicToolTokens() + estimateTokens(oursText),
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
      estimatedTokens: estimatePublicToolTokens() + estimateTokens(oursText),
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
      estimatedTokens: estimatePublicToolTokens() + estimateTokens(oursText),
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
      estimatedTokens: estimatePublicToolTokens() + estimateTokens(oursText),
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
  return estimateTokens(
    JSON.stringify([
      "discover_capabilities",
      "run_workflow",
      "retrieve_context",
      "read_resource",
      "capture_state",
      "estimate_cost"
    ])
  );
}

function estimateStandaloneToolTokens(outputText) {
  return 120 + estimateTokens(outputText);
}
