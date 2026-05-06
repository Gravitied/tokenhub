import { estimateTokens, truncateToTokens } from "../core/token.js";

export type FetchLike = (url: string | URL, init?: RequestInit) => Promise<Response>;

export type GitHubSummaryInput = {
  owner: string;
  repo: string;
  token?: string;
  fetchImpl?: FetchLike;
  limit?: number;
  budgetTokens?: number;
};

export type GitHubSummary = {
  summary: string;
  repo: {
    fullName: string;
    description: string;
    stars: number;
    openIssues: number;
    defaultBranch: string;
  };
  issues: Array<{ number: number; title: string; state: string }>;
  pullRequests: Array<{ number: number; title: string; state: string; author: string }>;
  workflowRuns: Array<{ name: string; status: string; conclusion: string; branch: string }>;
  tokenEstimate: number;
};

export async function summarizeGitHubRepo(input: GitHubSummaryInput): Promise<GitHubSummary> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const headers = githubHeaders(input.token);
  const repoUrl = `https://api.github.com/repos/${input.owner}/${input.repo}`;
  const issuesUrl = `${repoUrl}/issues?state=open&per_page=${input.limit ?? 5}`;
  const pullsUrl = `${repoUrl}/pulls?state=open&per_page=${input.limit ?? 5}`;
  const runsUrl = `${repoUrl}/actions/runs?per_page=${input.limit ?? 5}`;

  const [repoResponse, issuesResponse, pullsResponse, runsResponse] = await Promise.all([
    fetchImpl(repoUrl, { headers }),
    fetchImpl(issuesUrl, { headers }),
    fetchImpl(pullsUrl, { headers }),
    fetchImpl(runsUrl, { headers })
  ]);
  if (!repoResponse.ok) {
    throw new Error(`GitHub repo lookup failed: HTTP ${repoResponse.status}`);
  }
  const repoJson = (await repoResponse.json()) as Record<string, unknown>;
  const issuesJson = issuesResponse.ok ? ((await issuesResponse.json()) as Array<Record<string, unknown>>) : [];
  const pullsJson = pullsResponse.ok ? ((await pullsResponse.json()) as Array<Record<string, unknown>>) : [];
  const runsJson = runsResponse.ok ? ((await runsResponse.json()) as { workflow_runs?: Array<Record<string, unknown>> }) : {};
  const repo = {
    fullName: stringValue(repoJson.full_name),
    description: stringValue(repoJson.description),
    stars: numberValue(repoJson.stargazers_count),
    openIssues: numberValue(repoJson.open_issues_count),
    defaultBranch: stringValue(repoJson.default_branch)
  };
  const issues = issuesJson
    .filter((issue) => !("pull_request" in issue))
    .slice(0, input.limit ?? 5)
    .map((issue) => ({
      number: numberValue(issue.number),
      title: stringValue(issue.title),
      state: stringValue(issue.state)
    }));
  const pullRequests = pullsJson.slice(0, input.limit ?? 5).map((pull) => ({
    number: numberValue(pull.number),
    title: stringValue(pull.title),
    state: stringValue(pull.state),
    author: stringAtRecord(pull, ["user", "login"])
  }));
  const workflowRuns = (runsJson.workflow_runs ?? []).slice(0, input.limit ?? 5).map((run) => ({
    name: stringValue(run.name),
    status: stringValue(run.status),
    conclusion: stringValue(run.conclusion),
    branch: stringValue(run.head_branch)
  }));
  const issueSummary = issues.length
    ? `Open issues: ${issues.map((issue) => `#${issue.number} ${issue.title}`).join("; ")}`
    : "Open issues: none returned.";
  const prSummary = pullRequests.length
    ? `Open PRs: ${pullRequests.map((pull) => `#${pull.number} ${pull.title}`).join("; ")}`
    : "Open PRs: none returned.";
  const runSummary = workflowRuns.length
    ? `Workflow runs: ${workflowRuns.map((run) => `${run.name} ${run.status}/${run.conclusion}`).join("; ")}`
    : "Workflow runs: none returned.";
  const summary = truncateToTokens(
    `${repo.fullName}: ${repo.description || "No description"}; ${repo.stars} stars; ${repo.openIssues} open issues; default ${repo.defaultBranch}. ${issueSummary} ${prSummary} ${runSummary}`,
    input.budgetTokens ?? 400
  ).text;

  return {
    summary,
    repo,
    issues,
    pullRequests,
    workflowRuns,
    tokenEstimate: estimateTokens(summary)
  };
}

function githubHeaders(token?: string): HeadersInit {
  return {
    accept: "application/vnd.github+json",
    "user-agent": "tokenhub-mcp/0.1",
    ...(token ? { authorization: `Bearer ${token}` } : {})
  };
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function stringAtRecord(value: Record<string, unknown>, path: string[]): string {
  let current: unknown = value;
  for (const key of path) {
    current = typeof current === "object" && current !== null ? (current as Record<string, unknown>)[key] : undefined;
  }
  return stringValue(current);
}

function numberValue(value: unknown): number {
  return typeof value === "number" ? value : Number(value ?? 0) || 0;
}
