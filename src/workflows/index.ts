import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import type { ResourceLink, ResourceStore } from "../core/resources.js";
import type { TokenTelemetry } from "../core/telemetry.js";
import { estimateTokens, truncateToTokens } from "../core/token.js";
import { searchFiles } from "../modules/filesystem.js";
import { applyFilesystemAction } from "../modules/filesystem.js";
import { runGitAction, summarizeGit } from "../modules/git.js";
import { answerFromWeb } from "../modules/answer-web.js";
import { runBrowserScenario, type BrowserScenarioStep } from "../modules/browser-scenario.js";
import type { SearchProvider } from "../modules/search.js";
import type { FetchLike } from "../modules/github.js";
import { runResolveRequestWorkflow } from "./resolve-request.js";
import type { EvidenceMode, ExecutionMode, OutputShape, RequestDepth } from "../core/request-shape.js";
import type { UrlAddressLookup } from "../core/url-policy.js";
import type { ExtensionManager } from "../extensions/manager.js";
import type { SecurityPolicy } from "../core/security-policy.js";
import { createDiagnosticsPack } from "../core/diagnostics-pack.js";
import { WorkflowRegistry } from "./registry.js";

const execFileAsync = promisify(execFile);

export const WORKFLOW_NAMES = [
  "validate",
  "filesystem_action",
  "git_action",
  "answer_from_web",
  "resolve_request",
  "extension_call",
  "project_scan",
  "browser_scenario",
  "diagnostics_pack"
] as const;

export function listWorkflowNames(): string[] {
  return [...WORKFLOW_NAMES];
}

export type WorkflowInput = {
  name: string;
  root: string;
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
  depth?: RequestDepth;
  outputShape?: OutputShape;
  evidence?: EvidenceMode;
  execution?: ExecutionMode;
  provider?: SearchProvider;
  apiKey?: string;
  limit?: number;
  sourceLimit?: number;
  extensionId?: string;
  toolName?: string;
  input?: unknown;
  extensionManager?: ExtensionManager;
  securityPolicy?: SecurityPolicy;
  sourceNames?: string[];
  workflowNames?: string[];
  extensionPoolStats?: Array<Record<string, unknown>>;
  fetchImpl?: FetchLike;
  urlLookup?: UrlAddressLookup;
  resourceStore: ResourceStore;
  telemetry: TokenTelemetry;
};

export async function runWorkflow(input: WorkflowInput): Promise<{
  summary: string;
  resources: ResourceLink[];
  telemetry: ReturnType<TokenTelemetry["record"]>;
  warnings: string[];
  data?: unknown;
}> {
  return createDefaultWorkflowRegistry().run(input.name, input);
}

function createDefaultWorkflowRegistry(): WorkflowRegistry<WorkflowInput, Awaited<ReturnType<typeof runValidation>>> {
  const registry = new WorkflowRegistry<WorkflowInput, Awaited<ReturnType<typeof runValidation>>>();
  registry.register({ name: "validate", run: runValidation });
  registry.register({ name: "filesystem_action", run: runFilesystemActionWorkflow });
  registry.register({ name: "git_action", run: runGitActionWorkflow });
  registry.register({ name: "answer_from_web", run: runAnswerFromWebWorkflow });
  registry.register({
    name: "resolve_request",
    run: (input) =>
      runResolveRequestWorkflow({
        root: input.root,
        request: requireRequest(input.request),
        budgetTokens: input.budgetTokens,
        provider: input.provider,
        apiKey: input.apiKey,
        resourceStore: input.resourceStore,
        telemetry: input.telemetry,
        fetchImpl: input.fetchImpl,
        depth: input.depth,
        outputShape: input.outputShape,
        evidence: input.evidence,
        execution: input.execution,
        urlLookup: input.urlLookup
      })
  });
  registry.register({ name: "extension_call", run: runExtensionCall });
  registry.register({ name: "project_scan", run: runProjectScan });
  registry.register({ name: "browser_scenario", run: runBrowserScenarioWorkflow });
  registry.register({ name: "diagnostics_pack", run: runDiagnosticsPackWorkflow });
  return registry;
}

function requireRequest(request: string | undefined): string {
  if (!request) {
    throw new Error("resolve_request requires request.");
  }
  return request;
}

async function runAnswerFromWebWorkflow(input: WorkflowInput) {
  if (!input.query) {
    throw new Error("answer_from_web requires query.");
  }
  const result = await answerFromWeb({
    query: input.query,
    target: input.target,
    limit: input.limit,
    sourceLimit: input.sourceLimit,
    budgetTokens: input.budgetTokens,
    provider: input.provider,
    apiKey: input.apiKey,
    resourceStore: input.resourceStore,
    fetchImpl: input.fetchImpl,
    urlLookup: input.urlLookup
  });
  const telemetry = input.telemetry.record({
    capability: "workflow.answer_from_web",
    estimatedToolCostTokens: result.tokenEstimate,
    estimatedSavedTokens: Math.max(500, result.sources.length * 350 + result.items.length * 80 + result.contextSnippets.length * 60),
    outputTokens: result.tokenEstimate
  });
  return {
    summary: result.summary,
    resources: result.resources,
    telemetry,
    warnings: result.warnings,
    data: {
      items: result.items,
      contextSnippets: result.contextSnippets,
      sources: result.sources
    }
  };
}

async function runFilesystemActionWorkflow(input: WorkflowInput) {
  const result = await applyFilesystemAction({
    root: input.root,
    action: parseFilesystemAction(input.action),
    path: input.path,
    destination: input.destination,
    content: input.content
  });
  const telemetry = input.telemetry.record({
    capability: "workflow.filesystem_action",
    estimatedToolCostTokens: estimateTokens(result.summary),
    estimatedSavedTokens: 180,
    outputTokens: estimateTokens(result.summary)
  });
  return { summary: result.summary, resources: [], telemetry, warnings: [] };
}

async function runGitActionWorkflow(input: WorkflowInput) {
  const result = await runGitAction({
    root: input.root,
    action: parseGitAction(input.action),
    paths: input.paths,
    message: input.message,
    ref: input.ref,
    branch: input.branch,
    budgetTokens: input.budgetTokens
  });
  const telemetry = input.telemetry.record({
    capability: "workflow.git_action",
    estimatedToolCostTokens: estimateTokens(result.summary),
    estimatedSavedTokens: 220,
    outputTokens: estimateTokens(result.summary)
  });
  return { summary: result.summary, resources: [], telemetry, warnings: result.warnings };
}

async function runProjectScan(input: WorkflowInput) {
  const git = await summarizeGit({
    root: input.root,
    resourceStore: input.resourceStore,
    budgetTokens: Math.floor((input.budgetTokens ?? 600) / 2)
  });
  const files = await searchFiles({
    root: input.root,
    query: input.query,
    limit: 5,
    budgetTokens: Math.floor((input.budgetTokens ?? 600) / 2),
    resourceStore: input.resourceStore
  });
  const resources: ResourceLink[] = files.matches.map((match) => ({
    uri: match.resourceUri,
    kind: "text" as const,
    label: `file:${match.path}`,
    bytes: 0,
    tokens: 0,
    sha256: ""
  }));
  if (git.rawResourceUri) {
    resources.push({
      uri: git.rawResourceUri,
      kind: "log",
      label: "git raw output",
      bytes: 0,
      tokens: 0,
      sha256: ""
    });
  }

  const summaryText = [
    "Project scan",
    git.summary,
    files.matches.length
      ? `Matching project files:\n${files.matches.map((match) => `- ${match.path}:${match.line}`).join("\n")}`
      : "No matching project files found for the default scan query."
  ].join("\n\n");
  const truncated = truncateToTokens(summaryText, input.budgetTokens ?? 600);
  const telemetry = input.telemetry.record({
    capability: "workflow.project_scan",
    estimatedToolCostTokens: estimateTokens(truncated.text),
    estimatedSavedTokens: estimateTokens(git.summary) + files.matches.length * 120 + 300,
    outputTokens: estimateTokens(truncated.text)
  });

  return {
    summary: truncated.text,
    resources,
    telemetry,
    warnings: [...git.warnings, ...files.warnings]
  };
}

async function runValidation(input: WorkflowInput) {
  const command = parseValidationCommand(input);
  const result = await execFileAsync(command.executable, command.args, {
    cwd: input.root,
    timeout: 120000,
    maxBuffer: 1024 * 1024 * 4
  }).then(
    ({ stdout, stderr }) => ({ exitCode: 0, output: `${stdout}${stderr}` }),
    (error: { code?: number; stdout?: string; stderr?: string; message: string }) => ({
      exitCode: typeof error.code === "number" ? error.code : 1,
      output: `${error.stdout ?? ""}${error.stderr ?? ""}${error.message}`
    })
  );
  const redacted = redactSecrets(result.output);
  const link = await input.resourceStore.writeText({
    kind: "log",
    label: `validation:${command.display}`,
    source: input.root,
    content: redacted
  });
  const summary = truncateToTokens(
    `Validation ${result.exitCode === 0 ? "passed" : "failed"}: ${command.display}\n${redacted}`,
    input.budgetTokens ?? 600
  );
  const telemetry = input.telemetry.record({
    capability: "workflow.validate",
    estimatedToolCostTokens: estimateTokens(summary.text),
    estimatedSavedTokens: Math.max(200, estimateTokens(redacted)),
    outputTokens: estimateTokens(summary.text)
  });

  return {
    summary: summary.text,
    resources: [link],
    telemetry,
    warnings: result.exitCode === 0 ? [] : [`Validation command exited with ${result.exitCode}.`]
  };
}

async function runExtensionCall(input: WorkflowInput) {
  if (!input.extensionManager) {
    throw new Error("extension_call is unavailable because no extension manager is configured.");
  }
  const result = await input.extensionManager.call({
    extensionId: input.extensionId,
    toolName: input.toolName,
    input: input.input,
    budgetTokens: input.budgetTokens,
    includeRaw: input.includeRaw
  });
  const telemetry = input.telemetry.record({
    capability: `extension.${input.extensionId ?? "unknown"}.${input.toolName ?? "unknown"}`,
    estimatedToolCostTokens: estimateTokens(result.summary),
    estimatedSavedTokens: result.estimatedSavedTokens,
    outputTokens: estimateTokens(result.summary)
  });

  return {
    summary: result.summary,
    resources: result.resources,
    telemetry,
    warnings: result.warnings,
    data: result.data
  };
}

async function runBrowserScenarioWorkflow(input: WorkflowInput) {
  if (!input.url) {
    throw new Error("browser_scenario requires url.");
  }
  const result = await runBrowserScenario({
    url: input.url,
    steps: parseBrowserScenarioSteps(input.input),
    resourceStore: input.resourceStore,
    budgetTokens: input.budgetTokens,
    urlLookup: input.urlLookup,
    networkPolicy: input.securityPolicy?.networkPolicy()
  });
  const telemetry = input.telemetry.record({
    capability: "workflow.browser_scenario",
    estimatedToolCostTokens: result.tokenEstimate,
    estimatedSavedTokens: Math.max(450, result.steps.length * 120 + result.resources.length * 250),
    outputTokens: result.tokenEstimate
  });
  return {
    summary: result.summary,
    resources: result.resources,
    telemetry,
    warnings: result.warnings,
    data: { passed: result.passed, steps: result.steps }
  };
}

async function runDiagnosticsPackWorkflow(input: WorkflowInput) {
  const result = await createDiagnosticsPack({
    root: input.root,
    resourceStore: input.resourceStore,
    sourceNames: input.sourceNames ?? [],
    workflowNames: input.workflowNames ?? [],
    extensionPoolStats: input.extensionPoolStats ?? [],
    policySummary: input.securityPolicy?.summary()
  });
  const telemetry = input.telemetry.record({
    capability: "workflow.diagnostics_pack",
    estimatedToolCostTokens: estimateTokens(result.summary),
    estimatedSavedTokens: 800,
    outputTokens: estimateTokens(result.summary)
  });
  return {
    summary: result.summary,
    resources: result.resources,
    telemetry,
    warnings: [],
    data: result.pack
  };
}

function parseBrowserScenarioSteps(value: unknown): BrowserScenarioStep[] {
  const candidate = Array.isArray(value) ? value : value && typeof value === "object" ? (value as { steps?: unknown }).steps : undefined;
  if (!Array.isArray(candidate)) {
    throw new Error("browser_scenario input must be an array of steps or an object with steps.");
  }
  return candidate.map(parseBrowserScenarioStep);
}

function parseBrowserScenarioStep(value: unknown): BrowserScenarioStep {
  if (!value || typeof value !== "object") {
    throw new Error("browser_scenario steps must be objects.");
  }
  const step = value as Record<string, unknown>;
  if (step.action === "click" && typeof step.selector === "string") {
    return { action: "click", selector: step.selector };
  }
  if (step.action === "fill" && typeof step.selector === "string" && typeof step.value === "string") {
    return { action: "fill", selector: step.selector, value: step.value };
  }
  if (step.action === "press" && typeof step.selector === "string" && typeof step.key === "string") {
    return { action: "press", selector: step.selector, key: step.key };
  }
  if (step.action === "waitForText" && typeof step.text === "string") {
    return { action: "waitForText", text: step.text, timeoutMs: typeof step.timeoutMs === "number" ? step.timeoutMs : undefined };
  }
  if (step.action === "expectText" && typeof step.text === "string") {
    return { action: "expectText", text: step.text };
  }
  if (step.action === "screenshot") {
    return { action: "screenshot", label: typeof step.label === "string" ? step.label : undefined };
  }
  throw new Error(`Unsupported browser_scenario step: ${String(step.action)}`);
}

function parseValidationCommand(input: WorkflowInput): { executable: string; args: string[]; display: string } {
  const requestedCommand = input.command ?? "npm";
  const args = input.args ?? ["test"];
  const normalizedCommand = requestedCommand.toLowerCase().replace(/\.cmd$/, "");
  const allowedArgs = [
    ["test"],
    ["run", "lint"],
    ["run", "build"]
  ];
  const isAllowed = normalizedCommand === "npm" && allowedArgs.some((allowed) => arraysEqual(allowed, args));
  if (!isAllowed) {
    throw new Error("validate supports only npm test, npm run lint, or npm run build.");
  }
  const npmCommand = resolveNpmCommand(args);
  return { ...npmCommand, display: `npm ${args.join(" ")}` };
}

function resolveNpmCommand(args: string[]): { executable: string; args: string[] } {
  if (process.platform !== "win32") {
    return { executable: "npm", args };
  }

  const candidates = [
    process.env.npm_execpath,
    join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js")
  ].filter((candidate): candidate is string => Boolean(candidate));
  const npmCli = candidates.find((candidate) => candidate.endsWith("npm-cli.js") && existsSync(candidate));

  if (npmCli) {
    return { executable: process.execPath, args: [npmCli, ...args] };
  }

  return { executable: "npm", args };
}

function arraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function redactSecrets(text: string): string {
  return text.replace(/(token|api[_-]?key|password|secret)=\S+/gi, "$1=[redacted]");
}

function parseFilesystemAction(action: string | undefined): "write" | "move" | "delete" | "tree" {
  if (action === "write" || action === "move" || action === "delete" || action === "tree") return action;
  throw new Error("filesystem_action requires action write, move, delete, or tree.");
}

function parseGitAction(action: string | undefined): "status" | "diff" | "show" | "stage" | "commit" | "branch" {
  if (action === "status" || action === "diff" || action === "show" || action === "stage" || action === "commit" || action === "branch") {
    return action;
  }
  throw new Error("git_action requires action status, diff, show, stage, commit, or branch.");
}
