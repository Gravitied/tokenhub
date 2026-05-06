import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ResourceLink, ResourceStore } from "../core/resources.js";
import type { TokenTelemetry } from "../core/telemetry.js";
import { estimateTokens, truncateToTokens } from "../core/token.js";
import { searchFiles } from "../modules/filesystem.js";
import { summarizeGit } from "../modules/git.js";

const execFileAsync = promisify(execFile);

export type WorkflowInput = {
  name: string;
  root: string;
  budgetTokens?: number;
  includeRaw?: boolean;
  command?: string;
  args?: string[];
  resourceStore: ResourceStore;
  telemetry: TokenTelemetry;
};

export async function runWorkflow(input: WorkflowInput): Promise<{
  summary: string;
  resources: ResourceLink[];
  telemetry: ReturnType<TokenTelemetry["record"]>;
  warnings: string[];
}> {
  if (input.name === "validate") {
    return runValidation(input);
  }
  return runProjectScan(input);
}

async function runProjectScan(input: WorkflowInput) {
  const git = await summarizeGit({
    root: input.root,
    resourceStore: input.resourceStore,
    budgetTokens: Math.floor((input.budgetTokens ?? 600) / 2)
  });
  const files = await searchFiles({
    root: input.root,
    query: "tokenhub",
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
  const command = input.command ?? "npm";
  const args = input.args ?? ["test"];
  const result = await execFileAsync(command, args, {
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
    label: `validation:${command} ${args.join(" ")}`,
    source: input.root,
    content: redacted
  });
  const summary = truncateToTokens(
    `Validation ${result.exitCode === 0 ? "passed" : "failed"}: ${command} ${args.join(" ")}\n${redacted}`,
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

function redactSecrets(text: string): string {
  return text.replace(/(token|api[_-]?key|password|secret)=\S+/gi, "$1=[redacted]");
}
