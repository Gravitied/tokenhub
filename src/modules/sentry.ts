import { estimateTokens, truncateToTokens } from "../core/token.js";
import type { FetchLike } from "./github.js";

export type SentryIssue = {
  title?: string;
  culprit?: string;
  count?: string | number;
  userCount?: string | number;
  level?: string;
  status?: string;
  permalink?: string;
};

export function summarizeSentryIssues(issues: SentryIssue[], options: { budgetTokens?: number } = {}): {
  summary: string;
  clusters: Array<{ culprit: string; issues: number; events: number; users: number }>;
  issueDetails: Array<{ title: string; culprit: string; events: number; users: number; level: string; status: string }>;
  tokenEstimate: number;
} {
  const grouped = new Map<string, { culprit: string; issues: number; events: number; users: number }>();
  for (const issue of issues) {
    const culprit = issue.culprit || "unknown";
    const current = grouped.get(culprit) ?? { culprit, issues: 0, events: 0, users: 0 };
    current.issues += 1;
    current.events += Number(issue.count ?? 0) || 0;
    current.users += Number(issue.userCount ?? 0) || 0;
    grouped.set(culprit, current);
  }
  const clusters = [...grouped.values()].sort((a, b) => b.events - a.events);
  const issueDetails = issues.slice(0, 10).map((issue) => ({
    title: issue.title || "Untitled issue",
    culprit: issue.culprit || "unknown",
    events: Number(issue.count ?? 0) || 0,
    users: Number(issue.userCount ?? 0) || 0,
    level: issue.level || "",
    status: issue.status || ""
  }));
  const summary = truncateToTokens(
    [
      clusters.map((cluster) => `${cluster.culprit}: ${cluster.issues} issues, ${cluster.events} events, ${cluster.users} users`).join("\n"),
      issueDetails.map((issue) => `${issue.status || "unknown"} ${issue.level || "unknown"} ${issue.title}`).join("\n")
    ]
      .filter(Boolean)
      .join("\n"),
    options.budgetTokens ?? 300
  ).text;
  return {
    summary,
    clusters,
    issueDetails,
    tokenEstimate: estimateTokens(summary)
  };
}

export async function fetchSentryIssues(input: {
  organization: string;
  project?: string;
  token: string;
  query?: string;
  fetchImpl?: FetchLike;
  budgetTokens?: number;
}): Promise<ReturnType<typeof summarizeSentryIssues>> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const projectPath = input.project ? `/projects/${input.organization}/${input.project}` : `/organizations/${input.organization}`;
  const url = new URL(`https://sentry.io/api/0${projectPath}/issues/`);
  if (input.query) url.searchParams.set("query", input.query);
  const response = await fetchImpl(url, {
    headers: { authorization: `Bearer ${input.token}`, accept: "application/json" }
  });
  if (!response.ok) {
    throw new Error(`Sentry issue lookup failed: HTTP ${response.status}`);
  }
  return summarizeSentryIssues((await response.json()) as SentryIssue[], { budgetTokens: input.budgetTokens });
}
