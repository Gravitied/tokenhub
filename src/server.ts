import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { join, resolve } from "node:path";
import { CapabilityRegistry } from "./core/registry.js";
import { ResourceStore } from "./core/resources.js";
import { TokenTelemetry } from "./core/telemetry.js";
import { estimateTokens } from "./core/token.js";
import { listWorkflowNames, runWorkflow as runWorkflowImpl } from "./workflows/index.js";
import type { SearchProvider } from "./modules/search.js";
import { createDiagnosticLogger, logLevelFromEnv, type DiagnosticLogger, type DiagnosticLogLevel } from "./core/logger.js";
import { loadExtensionConfigSync } from "./extensions/config.js";
import { ExtensionManager } from "./extensions/manager.js";
import { createDefaultSourceRegistry } from "./sources/defaults.js";
import type { RetrieveContextInput } from "./sources/registry.js";
import { loadSecurityPolicy } from "./core/security-policy.js";

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
  extensionConfigPath?: string;
  policyPath?: string;
  logLevel?: DiagnosticLogLevel;
  logger?: DiagnosticLogger;
};

export function createTokenHubRuntime(options: RuntimeOptions) {
  const root = resolve(options.root);
  const resourceStore = new ResourceStore({
    rootDir: options.resourceDir ?? join(root, ".tokenhub", "resources")
  });
  const telemetry = new TokenTelemetry({ roiThreshold: 3 });
  const registry = createDefaultRegistry();
  const sourceRegistry = createDefaultSourceRegistry();
  const logger = options.logger ?? createDiagnosticLogger({ level: options.logLevel ?? logLevelFromEnv() });
  const extensionConfig = loadExtensionConfigSync({ root, configPath: options.extensionConfigPath });
  const securityPolicy = loadSecurityPolicy({ root, policyPath: options.policyPath });
  const extensionManager = new ExtensionManager({ root, config: extensionConfig, resourceStore });
  extensionManager.registerCapabilities(registry);
  let requestCounter = 0;

  return {
    registry,
    resourceStore,
    telemetry,
    publicToolNames: (): PublicToolName[] => [...PUBLIC_TOOLS],
    sourceNames: () => sourceRegistry.names(),
    workflowNames: () => listWorkflowNames(),
    extensionPoolStats: () => extensionManager.poolStats(),
    securityPolicySummary: () => securityPolicy.summary(),
    close: async () => {
      await Promise.all([extensionManager.close(), sourceRegistry.close()]);
    },
    discoverCapabilities: (input: { query: string; limit?: number }) =>
      instrumentTool(logger, "discover_capabilities", nextRequestId, input, () =>
        registry.discover(input.query, { limit: input.limit })
      ),
    runWorkflow: (input: {
      name: string;
      budgetTokens?: number;
      includeRaw?: boolean;
      command?: string;
      args?: string[];
      action?: string;
      path?: string;
      destination?: string;
      content?: string;
      paths?: string[];
      message?: string;
      ref?: string;
      branch?: string;
      query?: string;
      url?: string;
      request?: string;
      target?: "ranked_list" | "summary";
      depth?: "fast" | "standard" | "deep" | "exhaustive";
      outputShape?: "paragraph" | "list" | "table" | "plan" | "patch_plan" | "citations" | "structured_data" | "agent_context";
      evidence?: "none" | "sources" | "snippets" | "resource_links" | "raw_extracts";
      execution?: "answer_only" | "plan_only" | "implement" | "implement_and_verify";
      provider?: SearchProvider;
      apiKey?: string;
      limit?: number;
      sourceLimit?: number;
      extensionId?: string;
      toolName?: string;
      input?: unknown;
    }) =>
      instrumentTool(logger, "run_workflow", nextRequestId, input, async () =>
        {
          securityPolicy.assertWorkflow(input.name);
          if (input.name === "extension_call") {
            securityPolicy.assertExtension(input.extensionId);
          }
          return runWorkflowImpl({
            ...input,
            root,
            resourceStore,
            telemetry,
            extensionManager,
            securityPolicy,
            sourceNames: sourceRegistry.names(),
            workflowNames: listWorkflowNames(),
            extensionPoolStats: extensionManager.poolStats()
          });
        }
      ),
    retrieveContext: async (input: RetrieveContextInput) =>
      instrumentTool(logger, "retrieve_context", nextRequestId, input, async () => {
        securityPolicy.assertSource(input.source);
        return sourceRegistry.retrieve(input, { root, resourceStore, securityPolicy });
      }),
    readResource: (input: {
      uri: string;
      mode?: "snippet" | "range" | "full";
      budgetTokens?: number;
      startLine?: number;
      endLine?: number;
    }) => instrumentTool(logger, "read_resource", nextRequestId, input, () => resourceStore.read(input.uri, input)),
    captureState: async (input: { label?: string; text?: string }) => {
      return instrumentTool(logger, "capture_state", nextRequestId, input, async () => {
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
      });
    },
    estimateCost: (input: { operation: string; expectedInputTokens?: number; expectedOutputTokens?: number }) => {
      return instrumentTool(logger, "estimate_cost", nextRequestId, input, () => {
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
      });
    }
  };

  function nextRequestId(): string {
    requestCounter += 1;
    return `req_${requestCounter}`;
  }
}

function instrumentTool<T>(
  logger: DiagnosticLogger,
  tool: PublicToolName,
  nextRequestId: () => string,
  input: Record<string, unknown>,
  operation: () => T
): T {
  const requestId = nextRequestId();
  const startedAt = Date.now();
  logger.info("tool.start", { requestId, tool, ...summarizeToolInput(tool, input) });
  try {
    const value = operation();
    if (isPromiseLike(value)) {
      return value.then(
        (result) => {
          logger.info("tool.end", { requestId, tool, durationMs: Date.now() - startedAt });
          return result;
        },
        (error: unknown) => {
          logger.error("tool.error", { requestId, tool, durationMs: Date.now() - startedAt, error: errorMessage(error) });
          throw error;
        }
      ) as T;
    }
    logger.info("tool.end", { requestId, tool, durationMs: Date.now() - startedAt });
    return value;
  } catch (error) {
    logger.error("tool.error", { requestId, tool, durationMs: Date.now() - startedAt, error: errorMessage(error) });
    throw error;
  }
}

function summarizeToolInput(tool: PublicToolName, input: Record<string, unknown>): Record<string, unknown> {
  if (tool === "discover_capabilities") {
    return { queryLength: stringLength(input.query), limit: input.limit };
  }
  if (tool === "run_workflow") {
    return {
      workflow: input.name,
      action: input.action,
      provider: input.provider,
      limit: input.limit,
      budgetTokens: input.budgetTokens,
      includeRaw: input.includeRaw,
      extensionId: input.extensionId,
      toolName: input.toolName
    };
  }
  if (tool === "retrieve_context") {
    return {
      source: input.source,
      provider: input.provider,
      limit: input.limit,
      budgetTokens: input.budgetTokens,
      includeRaw: input.includeRaw,
      returnMode: input.returnMode
    };
  }
  if (tool === "read_resource") {
    return { uri: input.uri, mode: input.mode, budgetTokens: input.budgetTokens };
  }
  if (tool === "capture_state") {
    return { label: input.label, textLength: stringLength(input.text) };
  }
  return {
    operationLength: stringLength(input.operation),
    expectedInputTokens: input.expectedInputTokens,
    expectedOutputTokens: input.expectedOutputTokens
  };
}

function stringLength(value: unknown): number | undefined {
  return typeof value === "string" ? value.length : undefined;
}

function isPromiseLike<T>(value: T | PromiseLike<T>): value is PromiseLike<T> {
  return Boolean(value && typeof value === "object" && "then" in value && typeof value.then === "function");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function compactMatchingLine(snippet: string, query?: string): string {
  const lines = snippet.split(/\r?\n/).filter(Boolean);
  if (!query) {
    return lines[0] ?? "";
  }
  const matchingLine = lines.find((line) => line.toLowerCase().includes(query.toLowerCase()));
  return matchingLine ?? lines[0] ?? "";
}

export function createMcpServer(options: RuntimeOptions): McpServer {
  const runtime = createTokenHubRuntime(options);
  const server = new McpServer({
    name: "tokenhub-mcp",
    version: "0.1.0"
  });

  server.registerResource(
    "tokenhub-artifacts",
    new ResourceTemplate("tokenhub://resource/{id}", {
      list: async () => ({
        resources: (await runtime.resourceStore.list()).map((resource) => ({
          uri: resource.uri,
          name: resource.label,
          title: resource.label,
          description: resource.source ?? `TokenHub ${resource.kind} resource`,
          mimeType: mimeTypeForResource(resource.kind),
          size: resource.bytes
        }))
      })
    }),
    {
      title: "TokenHub artifacts",
      description: "Generated TokenHub resources such as logs, scraped pages, screenshots, and captured state.",
      mimeType: "text/plain"
    },
    async (uri) => {
      const resource = await runtime.resourceStore.read(uri.toString(), { mode: "full" });
      if (resource.kind === "screenshot") {
        return {
          contents: [
            {
              uri: resource.uri,
              mimeType: "image/png",
              blob: resource.content.replace(/^data:image\/png;base64,/, "")
            }
          ]
        };
      }
      return {
        contents: [
          {
            uri: resource.uri,
            mimeType: mimeTypeForResource(resource.kind),
            text: resource.content
          }
        ]
      };
    }
  );

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
        args: z.array(z.string()).optional(),
        action: z.string().optional(),
        path: z.string().optional(),
        destination: z.string().optional(),
        content: z.string().optional(),
        paths: z.array(z.string()).optional(),
        message: z.string().optional(),
        ref: z.string().optional(),
        branch: z.string().optional(),
        query: z.string().optional(),
        url: z.string().url().optional(),
        request: z.string().optional(),
        target: z.enum(["ranked_list", "summary"]).optional(),
        depth: z.enum(["fast", "standard", "deep", "exhaustive"]).optional(),
        outputShape: z.enum(["paragraph", "list", "table", "plan", "patch_plan", "citations", "structured_data", "agent_context"]).optional(),
        evidence: z.enum(["none", "sources", "snippets", "resource_links", "raw_extracts"]).optional(),
        execution: z.enum(["answer_only", "plan_only"]).optional(),
        provider: z.enum(["brave", "exa", "tavily", "serpapi", "duckduckgo"]).optional(),
        apiKey: z.string().optional(),
        limit: z.number().int().positive().max(25).optional(),
        sourceLimit: z.number().int().positive().max(10).optional(),
        extensionId: z.string().optional(),
        toolName: z.string().optional(),
        input: z.unknown().optional()
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
        includeRaw: z.boolean().optional(),
        returnMode: z.enum(["summary", "compact"]).optional(),
        responseProfile: z.enum(["minimal", "standard", "detailed", "audit"]).optional()
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

function mimeTypeForResource(kind: "text" | "log" | "screenshot" | "json" | "html"): string {
  if (kind === "json") {
    return "application/json";
  }
  if (kind === "html") {
    return "text/html";
  }
  if (kind === "screenshot") {
    return "image/png";
  }
  return "text/plain";
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
    id: "workflow.browser_scenario",
    module: "browser",
    title: "Run browser scenario",
    summary: "Run a bounded Playwright step scenario with assertions, screenshots, and a compact trace resource.",
    keywords: ["browser", "playwright", "scenario", "click", "fill", "assert", "screenshot"],
    costHintTokens: 210,
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
    id: "web.answer",
    module: "web",
    title: "Answer from web",
    summary: "Search, fetch source pages, scrape them, and synthesize cited ranked lists or summary answers server-side.",
    keywords: ["answer", "web", "search", "scrape", "ranked", "summary", "citations"],
    costHintTokens: 220,
    inputSchema: { deferred: true }
  });
  registry.register({
    id: "workflow.resolve_request",
    module: "workflow",
    title: "Resolve dynamic request",
    summary:
      "Infer intent, sources, depth, evidence, and output shape from a natural-language request, then gather compact context or answer from the right internal modules.",
    keywords: ["dynamic", "resolve", "request", "router", "auto", "intent", "research", "compare", "implement"],
    costHintTokens: 260,
    inputSchema: { deferred: true }
  });
  registry.register({
    id: "workflow.diagnostics_pack",
    module: "diagnostics",
    title: "Create diagnostics pack",
    summary: "Capture a redacted JSON diagnostics artifact with runtime, workspace, git, policy, source, workflow, and extension status.",
    keywords: ["diagnostics", "debug", "support", "logs", "environment", "policy"],
    costHintTokens: 180,
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
  const structuredContent =
    value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : { value };
  return {
    structuredContent,
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2)
      }
    ]
  };
}
