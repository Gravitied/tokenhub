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
      source: "files" | "git" | "web";
      query?: string;
      url?: string;
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
        source: z.enum(["files", "git", "web"]),
        query: z.string().optional(),
        url: z.string().url().optional(),
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
