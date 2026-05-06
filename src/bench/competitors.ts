import type { TaskComparison } from "./scoring.js";
import { compareBenchmarkResults } from "./scoring.js";

export type CompetitorInfo = {
  name: string;
  kind: "mcp" | "cli";
  command: string;
  license: string;
  source: string;
};

export type BenchmarkReportInput = {
  generatedAt: string;
  sources: string[];
  tasks: TaskComparison[];
};

export type BenchmarkReport = {
  generatedAt: string;
  sources: string[];
  competitors: CompetitorInfo[];
  summary: string;
  taskResults: ReturnType<typeof compareBenchmarkResults>["taskResults"];
  weakTasks: string[];
};

export function freeCompetitorCatalog(): CompetitorInfo[] {
  return [
    {
      name: "official-filesystem-mcp",
      kind: "mcp",
      command: "npx -y @modelcontextprotocol/server-filesystem <root>",
      license: "MIT",
      source: "https://www.npmjs.com/package/@modelcontextprotocol/server-filesystem"
    },
    {
      name: "official-git-mcp",
      kind: "mcp",
      command: "uvx mcp-server-git --repository <root>",
      license: "MIT",
      source: "https://github.com/modelcontextprotocol/servers"
    },
    {
      name: "official-fetch-mcp",
      kind: "mcp",
      command: "uvx mcp-server-fetch",
      license: "MIT",
      source: "https://github.com/modelcontextprotocol/servers"
    },
    {
      name: "git-grep-cli",
      kind: "cli",
      command: "git grep <query>",
      license: "GPL-2.0-only",
      source: "https://git-scm.com/docs/git-grep"
    },
    {
      name: "git-cli",
      kind: "cli",
      command: "git status/log/diff",
      license: "GPL-2.0-only",
      source: "https://git-scm.com"
    }
  ];
}

export function createBenchmarkReport(input: BenchmarkReportInput): BenchmarkReport {
  const compared = compareBenchmarkResults(input.tasks);
  const passed = compared.taskResults.filter((task) => task.passed).length;

  return {
    generatedAt: input.generatedAt,
    sources: input.sources,
    competitors: freeCompetitorCatalog(),
    summary: `${passed}/${input.tasks.length} tasks passed significantly-better threshold.`,
    taskResults: compared.taskResults,
    weakTasks: compared.weakTasks
  };
}
