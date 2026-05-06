import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { join, resolve } from "node:path";
import { CapabilityRegistry } from "./core/registry.js";
import { ResourceStore } from "./core/resources.js";
import { TokenTelemetry } from "./core/telemetry.js";
import { estimateTokens } from "./core/token.js";
import { searchFiles } from "./modules/filesystem.js";
import { fetchAndScrape } from "./modules/web.js";
import { summarizeGit } from "./modules/git.js";
import { runWorkflow as runWorkflowImpl } from "./workflows/index.js";
import { summarizeGitHubRepo } from "./modules/github.js";
import { searchWeb } from "./modules/search.js";
import { inspectPostgres, inspectSqlite } from "./modules/database.js";
import { lookupNpmPackage } from "./modules/docs.js";
import { fetchSentryIssues, summarizeSentryIssues } from "./modules/sentry.js";
import { captureBrowserState } from "./modules/browser.js";

const PUBLIC_TOOLS = [
  "discover_capabilities",
  "run_workflow",
  "retrieve_context",
  "read_resource",
  "capture_state",
  "estimate_cost"
] as const;

export type PublicToolName = (typeof PUBLIC_TOOLS)[number];

export type RuntimeOptions = {
  root: string;
  resourceDir?: string;
};

export function createTokenHubRuntime(options: RuntimeOptions) {
  const root = resolve(options.root);
  const resourceStore = new ResourceStore({
    rootDir: options.resourceDir ?? join(root, ".tokenhub", "resources")
  });
  const telemetry = new TokenTelemetry({ roiThreshold: 3 });
  const registry = createDefaultRegistry();

  return {
    registry,
    resourceStore,
    telemetry,
    publicToolNames: (): PublicToolName[] => [...PUBLIC_TOOLS],
    discoverCapabilities: (input: { query: string; limit?: number }) =>
      registry.discover(input.query, { limit: input.limit }),
    runWorkflow: (input: { name: string; budgetTokens?: number; includeRaw?: boolean; command?: string; args?: string[] }) =>
      runWorkflowImpl({
        ...input,
        root,
        resourceStore,
        telemetry
      }),
    retrieveContext: async (input: {
      source:
        | "files"
        | "git"
        | "web"
        | "github"
        | "search"
        | "sqlite"
        | "postgres"
        | "docs"
        | "sentry"
        | "browser";
      query?: string;
      url?: string;
      owner?: string;
      repo?: string;
      provider?: "brave" | "exa" | "tavily" | "serpapi" | "duckduckgo";
      apiKey?: string;
      packageName?: string;
      databaseBase64?: string;
      connectionString?: string;
      organization?: string;
      project?: string;
      token?: string;
      issues?: Array<Record<string, unknown>>;
      budgetTokens?: number;
      limit?: number;
      includeRaw?: boolean;
      returnMode?: "summary" | "compact";
    }) => {
      if (input.source === "git") {
        return summarizeGit({ root, resourceStore, budgetTokens: input.budgetTokens });
      }
      if (input.source === "web") {
        if (!input.url) {
          throw new Error("retrieve_context source=web requires url.");
        }
        return fetchAndScrape({
          url: input.url,
          resourceStore,
          budgetTokens: input.budgetTokens,
          includeRaw: input.includeRaw
        });
      }
      if (input.source === "github") {
        if (!input.owner || !input.repo) {
          throw new Error("retrieve_context source=github requires owner and repo.");
        }
        return summarizeGitHubRepo({
          owner: input.owner,
          repo: input.repo,
          token: input.token,
          limit: input.limit,
          budgetTokens: input.budgetTokens
        });
      }
      if (input.source === "search") {
        if (!input.query) {
          throw new Error("retrieve_context source=search requires query.");
        }
        const result = await searchWeb({
          query: input.query,
          provider: input.provider,
          apiKey: input.apiKey,
          limit: input.limit,
          budgetTokens: input.budgetTokens
        });
        if (input.returnMode === "compact") {
          return { r: result.results.map((item) => [item.title, item.url, item.provider, item.confidence]) };
        }
        return result;
      }
      if (input.source === "sqlite") {
        if (!input.databaseBase64) {
          throw new Error("retrieve_context source=sqlite requires databaseBase64.");
        }
        const result = await inspectSqlite({
          databaseBytes: Buffer.from(input.databaseBase64, "base64"),
          query: input.query,
          limit: input.limit,
          budgetTokens: input.budgetTokens
        });
        if (input.returnMode === "compact") {
          return {
            s: result.schema.map((table) => [table.table, table.columns]),
            r: result.rows.map((row) => Object.values(row))
          };
        }
        return result;
      }
      if (input.source === "postgres") {
        if (!input.connectionString) {
          throw new Error("retrieve_context source=postgres requires connectionString.");
        }
        return inspectPostgres({
          connectionString: input.connectionString,
          query: input.query,
          limit: input.limit,
          budgetTokens: input.budgetTokens
        });
      }
      if (input.source === "docs") {
        if (!input.packageName && !input.query) {
          throw new Error("retrieve_context source=docs requires packageName or query.");
        }
        return lookupNpmPackage({ name: input.packageName ?? input.query ?? "", budgetTokens: input.budgetTokens });
      }
      if (input.source === "sentry") {
        if (input.issues) {
          const result = summarizeSentryIssues(input.issues, { budgetTokens: input.budgetTokens });
          if (input.returnMode === "compact") {
            return { c: result.clusters.map((cluster) => [cluster.culprit, cluster.issues, cluster.events, cluster.users]) };
          }
          return result;
        }
        if (!input.organization || !input.token) {
          throw new Error("retrieve_context source=sentry requires issues or organization and token.");
        }
        return fetchSentryIssues({
          organization: input.organization,
          project: input.project,
          token: input.token,
          query: input.query,
          budgetTokens: input.budgetTokens
        });
      }
      if (input.source === "browser") {
        if (!input.url) {
          throw new Error("retrieve_context source=browser requires url.");
        }
        const result = await captureBrowserState({
          url: input.url,
          resourceStore,
          includeScreenshot: input.includeRaw,
          budgetTokens: input.budgetTokens
        });
        if (input.returnMode === "compact") {
          return {
            h: result.state.headings,
            t: result.state.textSnippets,
            l: result.state.links.map((link) => [link.text, link.href]),
            e: [result.state.consoleErrors.length, result.state.failedRequests.length],
            r: result.resources
          };
        }
        return result;
      }
      const fileResult = await searchFiles({
        root,
        query: input.query,
        limit: input.limit,
        budgetTokens: input.budgetTokens,
        resourceStore
      });
      if (input.returnMode === "compact") {
        return {
          m: fileResult.matches.map((match) => [
            match.path,
            match.line,
            compactMatchingLine(match.snippet, input.query),
            match.resourceUri
          ])
        };
      }
      return fileResult;
    },
    readResource: (input: {
      uri: string;
      mode?: "snippet" | "range" | "full";
      budgetTokens?: number;
      startLine?: number;
      endLine?: number;
    }) => resourceStore.read(input.uri, input),
    captureState: async (input: { label?: string; text?: string }) => {
      const link = await resourceStore.writeText({
        kind: "log",
        label: input.label ?? "captured state",
        content: input.text ?? "No state text provided.",
        source: "capture_state"
      });
      const record = telemetry.record({
        capability: "capture_state",
        estimatedToolCostTokens: 30,
        estimatedSavedTokens: 120,
        outputTokens: estimateTokens(JSON.stringify(link))
      });
      return { resources: [link], telemetry: record };
    },
    estimateCost: (input: { operation: string; expectedInputTokens?: number; expectedOutputTokens?: number }) => {
      const inputTokens = input.expectedInputTokens ?? estimateTokens(input.operation);
      const outputTokens = input.expectedOutputTokens ?? Math.ceil(inputTokens / 2);
      const estimatedToolCostTokens = 25 + inputTokens + outputTokens;
      const estimatedSavedTokens = Math.max(0, inputTokens * 3 - outputTokens);
      return {
        operation: input.operation,
        estimatedToolCostTokens,
        estimatedSavedTokens,
        clearsRoiThreshold: estimatedSavedTokens >= estimatedToolCostTokens * 3
      };
    }
  };
}

function compactMatchingLine(snippet: string, query?: string): string {
  const lines = snippet.split(/\r?\n/).filter(Boolean);
  if (!query) {
    return lines[0] ?? "";
  }
  const matchingLine = lines.find((line) => line.toLowerCase().includes(query.toLowerCase()));
  return matchingLine ? query : lines[0] ?? "";
}

export function createMcpServer(options: RuntimeOptions): McpServer {
  const runtime = createTokenHubRuntime(options);
  const server = new McpServer({
    name: "tokenhub-mcp",
    version: "0.1.0"
  });

  server.registerTool(
    "discover_capabilities",
    {
      title: "Discover capabilities",
      description: "Find compact internal developer capabilities without loading their full schemas.",
      inputSchema: {
        query: z.string(),
        limit: z.number().int().positive().max(20).optional()
      }
    },
    async (input) => asToolResult(runtime.discoverCapabilities(input))
  );

  server.registerTool(
    "run_workflow",
    {
      title: "Run workflow",
      description: "Batch a common developer workflow server-side and return summaries plus resource links.",
      inputSchema: {
        name: z.string(),
        budgetTokens: z.number().int().positive().optional(),
        includeRaw: z.boolean().optional(),
        command: z.string().optional(),
        args: z.array(z.string()).optional()
      }
    },
    async (input) => asToolResult(await runtime.runWorkflow(input))
  );

  server.registerTool(
    "retrieve_context",
    {
      title: "Retrieve context",
      description: "Token-budgeted retrieval across files, Git state, and web pages.",
      inputSchema: {
        source: z.enum(["files", "git", "web", "github", "search", "sqlite", "postgres", "docs", "sentry", "browser"]),
        query: z.string().optional(),
        url: z.string().url().optional(),
        owner: z.string().optional(),
        repo: z.string().optional(),
        provider: z.enum(["brave", "exa", "tavily", "serpapi", "duckduckgo"]).optional(),
        apiKey: z.string().optional(),
        packageName: z.string().optional(),
        databaseBase64: z.string().optional(),
        connectionString: z.string().optional(),
        organization: z.string().optional(),
        project: z.string().optional(),
        token: z.string().optional(),
        issues: z.array(z.record(z.string(), z.unknown())).optional(),
        budgetTokens: z.number().int().positive().optional(),
        limit: z.number().int().positive().max(50).optional(),
        includeRaw: z.boolean().optional()
        ,
        returnMode: z.enum(["summary", "compact"]).optional()
      }
    },
    async (input) => asToolResult(await runtime.retrieveContext(input))
  );

  server.registerTool(
    "read_resource",
    {
      title: "Read resource",
      description: "Progressively read a TokenHub resource by snippet, line range, or full content.",
      inputSchema: {
        uri: z.string(),
        mode: z.enum(["snippet", "range", "full"]).optional(),
        budgetTokens: z.number().int().positive().optional(),
        startLine: z.number().int().positive().optional(),
        endLine: z.number().int().positive().optional()
      }
    },
    async (input) => asToolResult(await runtime.readResource(input))
  );

  server.registerTool(
    "capture_state",
    {
      title: "Capture state",
      description: "Store logs, snapshots, or state summaries as resource-linked artifacts.",
      inputSchema: {
        label: z.string().optional(),
        text: z.string().optional()
      }
    },
    async (input) => asToolResult(await runtime.captureState(input))
  );

  server.registerTool(
    "estimate_cost",
    {
      title: "Estimate cost",
      description: "Estimate tool cost and token savings before an expensive call.",
      inputSchema: {
        operation: z.string(),
        expectedInputTokens: z.number().int().nonnegative().optional(),
        expectedOutputTokens: z.number().int().nonnegative().optional()
      }
    },
    async (input) => asToolResult(runtime.estimateCost(input))
  );

  return server;
}

function createDefaultRegistry(): CapabilityRegistry {
  const registry = new CapabilityRegistry();
  registry.register({
    id: "filesystem.search",
    module: "filesystem",
    title: "Search files",
    summary: "Search workspace files with snippets, hashes, and resource handles.",
    keywords: ["files", "repo", "search", "grep", "filesystem"],
    costHintTokens: 45,
    inputSchema: { deferred: true }
  });
  registry.register({
    id: "git.summary",
    module: "git",
    title: "Summarize Git state",
    summary: "Return compact Git status, recent commits, diff stats, and raw resource links.",
    keywords: ["git", "diff", "repo", "commit", "status"],
    costHintTokens: 65,
    inputSchema: { deferred: true }
  });
  registry.register({
    id: "web.scrape",
    module: "web",
    title: "Fetch and scrape web page",
    summary: "Fetch a page and extract clean text instead of raw HTML.",
    keywords: ["web", "fetch", "scrape", "docs", "http"],
    costHintTokens: 85,
    inputSchema: { deferred: true }
  });
  registry.register({
    id: "workflow.validate",
    module: "testing",
    title: "Run validation workflow",
    summary: "Run tests, builds, or lint commands and summarize failures with artifacts.",
    keywords: ["test", "lint", "build", "validate", "logs"],
    costHintTokens: 120,
    inputSchema: { deferred: true }
  });
  registry.register({
    id: "github.summary",
    module: "github",
    title: "Summarize GitHub repository",
    summary: "Fetch compact public GitHub repo, issue, and PR context with optional token auth.",
    keywords: ["github", "repo", "issues", "pull", "actions"],
    costHintTokens: 95,
    inputSchema: { deferred: true }
  });
  registry.register({
    id: "browser.capture",
    module: "browser",
    title: "Capture compact browser state",
    summary: "Use Playwright internally for title, headings, links, console errors, failed requests, and screenshot resources.",
    keywords: ["browser", "playwright", "screenshot", "dom", "console"],
    costHintTokens: 130,
    inputSchema: { deferred: true }
  });
  registry.register({
    id: "web.search",
    module: "search",
    title: "Search web providers",
    summary: "Normalize Brave, Exa, Tavily, SerpAPI, and DuckDuckGo fallback results into compact ranked snippets.",
    keywords: ["search", "web", "brave", "exa", "tavily", "serpapi"],
    costHintTokens: 90,
    inputSchema: { deferred: true }
  });
  registry.register({
    id: "database.sqlite",
    module: "database",
    title: "Inspect SQLite",
    summary: "Inspect SQLite schema and run safe read queries with row projection and secret redaction.",
    keywords: ["sqlite", "database", "sql", "schema", "rows"],
    costHintTokens: 85,
    inputSchema: { deferred: true }
  });
  registry.register({
    id: "database.postgres",
    module: "database",
    title: "Inspect Postgres",
    summary: "Inspect Postgres schema and safe SELECT query results with row projection and limits.",
    keywords: ["postgres", "postgresql", "database", "sql", "schema"],
    costHintTokens: 105,
    inputSchema: { deferred: true }
  });
  registry.register({
    id: "docs.npm",
    module: "docs",
    title: "Lookup npm package docs",
    summary: "Fetch package metadata, latest versions, docs links, and compact package context.",
    keywords: ["docs", "package", "npm", "version", "changelog"],
    costHintTokens: 70,
    inputSchema: { deferred: true }
  });
  registry.register({
    id: "observability.sentry",
    module: "observability",
    title: "Summarize Sentry issues",
    summary: "Cluster Sentry issues by culprit and summarize event/user impact with optional token auth.",
    keywords: ["sentry", "observability", "errors", "traces", "logs"],
    costHintTokens: 100,
    inputSchema: { deferred: true }
  });
  return registry;
}

function asToolResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2)
      }
    ]
  };
}
