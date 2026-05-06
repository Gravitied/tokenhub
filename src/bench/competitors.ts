import type { TaskComparison } from "./scoring.js";
import { compareBenchmarkResults } from "./scoring.js";

export type CompetitorInfo = {
  name: string;
  kind: "mcp" | "cli";
  command: string;
  license: string;
  source: string;
  requiresAuth?: boolean;
  benchmarkStatus?: "live" | "auth-gated" | "metadata-only";
  strengths?: string[];
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
      source: "https://www.npmjs.com/package/@modelcontextprotocol/server-filesystem",
      benchmarkStatus: "live",
      strengths: ["read", "write", "move", "directory_tree", "allowed_directories"]
    },
    {
      name: "official-git-mcp",
      kind: "mcp",
      command: "uvx mcp-server-git --repository <root>",
      license: "MIT",
      source: "https://github.com/modelcontextprotocol/servers",
      benchmarkStatus: "live",
      strengths: ["status", "log", "diff", "add", "commit", "checkout"]
    },
    {
      name: "official-fetch-mcp",
      kind: "mcp",
      command: "uvx mcp-server-fetch",
      license: "MIT",
      source: "https://github.com/modelcontextprotocol/servers",
      benchmarkStatus: "live",
      strengths: ["fetch", "markdown", "raw"]
    },
    {
      name: "official-postgres-mcp",
      kind: "mcp",
      command: "npx -y @modelcontextprotocol/server-postgres <connection-string>",
      license: "MIT",
      source: "https://github.com/modelcontextprotocol/servers",
      requiresAuth: true,
      benchmarkStatus: "auth-gated",
      strengths: ["schema", "read_query"]
    },
    {
      name: "official-brave-search-mcp",
      kind: "mcp",
      command: "npx -y @modelcontextprotocol/server-brave-search",
      license: "MIT",
      source: "https://github.com/modelcontextprotocol/servers",
      requiresAuth: true,
      benchmarkStatus: "auth-gated",
      strengths: ["web_search", "local_search"]
    },
    {
      name: "official-github-mcp",
      kind: "mcp",
      command: "docker run -i --rm -e GITHUB_PERSONAL_ACCESS_TOKEN ghcr.io/github/github-mcp-server",
      license: "MIT",
      source: "https://github.com/github/github-mcp-server",
      requiresAuth: true,
      benchmarkStatus: "auth-gated",
      strengths: ["repo", "issues", "pull_requests", "actions", "code_search"]
    },
    {
      name: "playwright-mcp",
      kind: "mcp",
      command: "npx -y @playwright/mcp",
      license: "Apache-2.0",
      source: "https://www.npmjs.com/package/@playwright/mcp",
      benchmarkStatus: "metadata-only",
      strengths: ["browser_actions", "accessibility_snapshot", "screenshots"]
    },
    {
      name: "charlotte-compact-browser-mcp",
      kind: "mcp",
      command: "npx/uvx charlotte browser MCP server when package is available",
      license: "OSS",
      source: "https://www.reddit.com/r/Anthropic/comments/1rbtqxi/i_built_an_open_source_browser_mcp_server_that/",
      benchmarkStatus: "metadata-only",
      strengths: ["compact_page_maps", "multi_detail_snapshots", "token_efficiency"]
    },
    {
      name: "context7-mcp",
      kind: "mcp",
      command: "npx -y @upstash/context7-mcp",
      license: "MIT",
      source: "https://www.npmjs.com/package/@upstash/context7-mcp",
      benchmarkStatus: "metadata-only",
      strengths: ["library_resolution", "versioned_docs"]
    },
    {
      name: "sentry-mcp-server",
      kind: "mcp",
      command: "npx -y @sentry/mcp-server",
      license: "FSL-1.1-ALv2",
      source: "https://www.npmjs.com/package/@sentry/mcp-server",
      requiresAuth: true,
      benchmarkStatus: "auth-gated",
      strengths: ["issues", "stacktraces", "projects", "organization"]
    },
    {
      name: "git-grep-cli",
      kind: "cli",
      command: "git grep <query>",
      license: "GPL-2.0-only",
      source: "https://git-scm.com/docs/git-grep",
      benchmarkStatus: "live",
      strengths: ["fast_search"]
    },
    {
      name: "git-cli",
      kind: "cli",
      command: "git status/log/diff",
      license: "GPL-2.0-only",
      source: "https://git-scm.com",
      benchmarkStatus: "live",
      strengths: ["status", "log", "diff"]
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
