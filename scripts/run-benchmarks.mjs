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

  const report = createBenchmarkReport({
    generatedAt: new Date().toISOString(),
    sources: [
      "https://github.com/modelcontextprotocol/servers",
      "https://www.npmjs.com/package/@modelcontextprotocol/server-filesystem",
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
