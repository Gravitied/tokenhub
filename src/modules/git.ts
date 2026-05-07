import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ResourceStore } from "../core/resources.js";
import { estimateTokens, truncateToTokens } from "../core/token.js";

const execFileAsync = promisify(execFile);

export type GitSummaryInput = {
  root: string;
  resourceStore: ResourceStore;
  budgetTokens?: number;
};

export type GitChangedFile = { path: string; status: "modified" | "added" | "deleted" | "untracked" | "renamed" | "other" };

export type GitActionInput = {
  root: string;
  action: "status" | "diff" | "show" | "stage" | "commit" | "branch";
  paths?: string[];
  message?: string;
  ref?: string;
  branch?: string;
  budgetTokens?: number;
};

export async function summarizeGit(input: GitSummaryInput): Promise<{
  isRepo: boolean;
  summary: string;
  rawResourceUri?: string;
  changedFiles: GitChangedFile[];
  tokenEstimate: number;
  warnings: string[];
}> {
  const isRepo = await isGitRepo(input.root);
  if (!isRepo) {
    return {
      isRepo: false,
      summary: "Not a Git repository.",
      changedFiles: [],
      tokenEstimate: 6,
      warnings: []
    };
  }

  const [status, log, diffStat] = await Promise.all([
    runGitSafe(input.root, ["status", "--short"]),
    runGitSafe(input.root, ["log", "--oneline", "-5"]),
    runGitSafe(input.root, ["diff", "--stat"])
  ]);
  const raw = [`$ git status --short\n${status}`, `$ git log --oneline -5\n${log}`, `$ git diff --stat\n${diffStat}`].join(
    "\n\n"
  );
  const link = await input.resourceStore.writeText({
    kind: "log",
    label: "git summary raw output",
    source: input.root,
    content: raw
  });

  const statusSummary = summarizeStatus(status);
  const compact = [`Git repository detected.`, statusSummary, log ? `Recent commits:\n${log}` : "No commits yet.", diffStat]
    .filter(Boolean)
    .join("\n\n");
  const truncated = truncateToTokens(compact, input.budgetTokens ?? 500);

  return {
    isRepo: true,
    summary: truncated.text,
    rawResourceUri: link.uri,
    changedFiles: parseChangedFiles(status),
    tokenEstimate: estimateTokens(truncated.text),
    warnings: truncated.truncated ? ["Git summary was truncated; raw output is available as a resource."] : []
  };
}

export async function runGitAction(input: GitActionInput): Promise<{ summary: string; output: string; warnings: string[] }> {
  const warnings: string[] = [];
  let args: string[];
  if (input.action === "status") {
    args = ["status", "--short"];
  } else if (input.action === "diff") {
    args = ["diff", "--stat", ...(input.paths ?? [])];
  } else if (input.action === "show") {
    args = ["show", "--stat", "--oneline", "--no-renames", input.ref ?? "HEAD"];
  } else if (input.action === "stage") {
    const paths = input.paths?.filter(Boolean);
    if (!paths?.length) throw new Error("git stage requires at least one path.");
    args = ["add", "--", ...paths];
  } else if (input.action === "commit") {
    if (!input.message?.trim()) throw new Error("git commit requires message.");
    args = ["commit", "-m", input.message.trim()];
  } else {
    args = input.branch ? ["branch", input.branch] : ["branch", "--show-current"];
  }

  let failed = false;
  const output = await runGit(input.root, args).catch((error: Error) => {
    failed = true;
    warnings.push(error.message.trim());
    return error.message.trim();
  });
  const redacted = redactSecrets(output);
  return {
    summary: summarizeGitAction(input.action, redacted, failed),
    output: truncateToTokens(redacted, input.budgetTokens ?? 500).text,
    warnings
  };
}

async function isGitRepo(root: string): Promise<boolean> {
  const result = await runGit(root, ["rev-parse", "--is-inside-work-tree"]).catch(() => "");
  return result.trim() === "true";
}

async function runGit(root: string, args: string[]): Promise<string> {
  const { stdout, stderr } = await execFileAsync("git", args, {
    cwd: root,
    timeout: 10000,
    maxBuffer: 1024 * 1024
  });
  return `${stdout}${stderr}`.trimEnd();
}

async function runGitSafe(root: string, args: string[]): Promise<string> {
  return runGit(root, args).catch((error: Error) => error.message.trim());
}

function summarizeStatus(status: string): string {
  if (!status.trim()) {
    return "Working tree status: clean.";
  }

  const lines = status
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const code = line.slice(0, 2);
      const file = line.slice(3);
      if (code.includes("M")) {
        return `modified: ${file}`;
      }
      if (code.includes("A")) {
        return `added: ${file}`;
      }
      if (code.includes("D")) {
        return `deleted: ${file}`;
      }
      if (code.includes("?")) {
        return `untracked: ${file}`;
      }
      return `${code.trim()}: ${file}`;
    });

  return `Working tree status:\n${lines.join("\n")}`;
}

function parseChangedFiles(status: string): GitChangedFile[] {
  return status
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const code = line.slice(0, 2);
      const path = line.slice(3).split(" -> ").pop() ?? line.slice(3);
      return { path, status: statusName(code) };
    });
}

function statusName(code: string): GitChangedFile["status"] {
  if (code.includes("R")) return "renamed";
  if (code.includes("?")) return "untracked";
  if (code.includes("M")) return "modified";
  if (code.includes("A")) return "added";
  if (code.includes("D")) return "deleted";
  return "other";
}

function summarizeGitAction(action: GitActionInput["action"], output: string, failed: boolean): string {
  if (failed) return `${action} failed\n${output}`;
  if (action === "stage") return "staged requested paths";
  if (action === "commit") return `committed changes\n${output}`;
  if (action === "status") return summarizeStatus(output);
  return output || `${action} completed`;
}

function redactSecrets(text: string): string {
  return text
    .replace(/(password|secret|token|api[_-]?key)(\s*[:=]\s*)["']?[^"'\s;]+["']?/gi, "$1$2[redacted]")
    .replace(/SECRET_[A-Z0-9_:-]+/g, "[redacted]");
}
