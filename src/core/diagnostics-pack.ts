import { platform, release, type } from "node:os";
import { buildWorkspaceIndex } from "./workspace-index.js";
import type { ResourceLink, ResourceStore } from "./resources.js";
import { summarizeGit } from "../modules/git.js";

const SECRET_ENV_PATTERN = /(token|secret|password|api[_-]?key|authorization|connection)/i;

export type DiagnosticsPack = {
  createdAt: string;
  runtime: {
    node: string;
    platform: string;
    os: string;
  };
  workspace: {
    root: string;
    indexBackend: "rg" | "walk";
    indexedFiles: number;
    sampleFiles: string[];
  };
  git: {
    isRepo: boolean;
    changedFiles: number;
    warnings: string[];
  };
  tokenhub: {
    sources: string[];
    workflows: string[];
    extensionPoolStats: Array<Record<string, unknown>>;
    policy?: Record<string, unknown>;
  };
  environment: Record<string, string>;
};

export async function createDiagnosticsPack(input: {
  root: string;
  resourceStore: ResourceStore;
  sourceNames: string[];
  workflowNames: string[];
  extensionPoolStats: Array<Record<string, unknown>>;
  policySummary?: Record<string, unknown>;
  now?: () => Date;
}): Promise<{
  summary: string;
  pack: DiagnosticsPack;
  resources: ResourceLink[];
}> {
  const workspace = await buildWorkspaceIndex({ root: input.root });
  const git = await summarizeGit({ root: input.root, resourceStore: input.resourceStore, budgetTokens: 300 }).catch((error) => ({
    isRepo: false,
    changedFiles: [],
    warnings: [error instanceof Error ? error.message : String(error)]
  }));
  const pack: DiagnosticsPack = {
    createdAt: (input.now ?? (() => new Date()))().toISOString(),
    runtime: {
      node: process.version,
      platform: process.platform,
      os: `${type()} ${release()}`
    },
    workspace: {
      root: input.root,
      indexBackend: workspace.backend,
      indexedFiles: workspace.files.length,
      sampleFiles: workspace.files.slice(0, 25).map((file) => file.path)
    },
    git: {
      isRepo: Boolean(git.isRepo),
      changedFiles: Array.isArray(git.changedFiles) ? git.changedFiles.length : 0,
      warnings: git.warnings ?? []
    },
    tokenhub: {
      sources: input.sourceNames,
      workflows: input.workflowNames,
      extensionPoolStats: input.extensionPoolStats,
      ...(input.policySummary ? { policy: input.policySummary } : {})
    },
    environment: redactedTokenHubEnvironment()
  };
  const link = await input.resourceStore.writeText({
    kind: "json",
    label: "tokenhub diagnostics pack",
    source: input.root,
    content: JSON.stringify(pack, null, 2)
  });
  return {
    summary: `Diagnostics pack captured ${pack.workspace.indexedFiles} workspace files using ${pack.workspace.indexBackend}.`,
    pack,
    resources: [link]
  };
}

function redactedTokenHubEnvironment(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env)
      .filter(([key]) => key.startsWith("TOKENHUB_"))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key, SECRET_ENV_PATTERN.test(key) ? "[redacted]" : value ?? ""])
  );
}
