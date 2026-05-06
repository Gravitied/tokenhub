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

export async function summarizeGit(input: GitSummaryInput): Promise<{
  isRepo: boolean;
  summary: string;
  rawResourceUri?: string;
  tokenEstimate: number;
  warnings: string[];
}> {
  const isRepo = await isGitRepo(input.root);
  if (!isRepo) {
    return {
      isRepo: false,
      summary: "Not a Git repository.",
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
    tokenEstimate: estimateTokens(truncated.text),
    warnings: truncated.truncated ? ["Git summary was truncated; raw output is available as a resource."] : []
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
  return `${stdout}${stderr}`.trim();
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
