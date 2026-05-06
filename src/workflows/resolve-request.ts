import type { ResourceLink, ResourceStore } from "../core/resources.js";
import type { TokenTelemetry } from "../core/telemetry.js";
import { estimateTokens, truncateToTokens } from "../core/token.js";
import { inferRequestPlan } from "../core/request-router.js";
import type { EvidenceMode, ExecutionMode, OutputShape, RequestDepth, RequestHints } from "../core/request-shape.js";
import { answerFromWeb } from "../modules/answer-web.js";
import { searchFiles } from "../modules/filesystem.js";
import type { FetchLike } from "../modules/github.js";
import type { SearchProvider } from "../modules/search.js";

export type ResolveRequestWorkflowInput = {
  root: string;
  request: string;
  budgetTokens?: number;
  provider?: SearchProvider;
  apiKey?: string;
  resourceStore: ResourceStore;
  telemetry: TokenTelemetry;
  fetchImpl?: FetchLike;
  depth?: RequestDepth;
  outputShape?: OutputShape;
  evidence?: EvidenceMode;
  execution?: ExecutionMode;
};

export async function runResolveRequestWorkflow(input: ResolveRequestWorkflowInput): Promise<{
  summary: string;
  resources: ResourceLink[];
  telemetry: ReturnType<TokenTelemetry["record"]>;
  warnings: string[];
  data: unknown;
}> {
  const hints: RequestHints = {
    depth: input.depth,
    outputShape: input.outputShape,
    evidence: input.evidence,
    execution: input.execution
  };
  const requestPlan = inferRequestPlan({ request: input.request, hints });
  const warnings: string[] = [];
  const resources: ResourceLink[] = [];
  const sections: string[] = [];
  const data: Record<string, unknown> = { requestPlan };

  if (requestPlan.sources.includes("local_files")) {
    const local = await searchBestLocalContext({
      root: input.root,
      queries: requestPlan.localQueries.length ? requestPlan.localQueries : [input.request],
      limit: requestPlan.depth === "deep" || requestPlan.depth === "exhaustive" ? 20 : 8,
      budgetTokens: Math.floor((input.budgetTokens ?? 1600) / 3),
      resourceStore: input.resourceStore
    });
    data.local = local.matches;
    sections.push(
      local.matches.length
        ? `Local context\n${local.matches.map((match) => `- ${match.path}:${match.line} ${match.snippet}`).join("\n")}`
        : "Local context\nNo matching local files found."
    );
    warnings.push(...local.warnings);
  }

  if (requestPlan.sources.includes("web_search") || requestPlan.sources.includes("web_pages")) {
    const target =
      requestPlan.outputShape === "list" && (requestPlan.intent === "answer" || requestPlan.intent === "research" || requestPlan.intent === "extract")
        ? "ranked_list"
        : "summary";
    const web = await answerFromWeb({
      query: requestPlan.searchQueries[0] ?? input.request,
      target,
      limit: target === "ranked_list" ? 10 : 1,
      sourceLimit: requestPlan.depth === "deep" || requestPlan.depth === "exhaustive" ? 5 : 3,
      budgetTokens: Math.floor((input.budgetTokens ?? 1600) / 2),
      provider: input.provider,
      apiKey: input.apiKey,
      resourceStore: input.resourceStore,
      fetchImpl: input.fetchImpl
    });
    data.web = {
      summary: web.summary,
      items: web.items,
      sources: web.sources,
      contextSnippets: web.contextSnippets
    };
    resources.push(...web.resources);
    warnings.push(...web.warnings);
    sections.push(`Web context\n${web.summary}`);
  }

  sections.push(
    [
      "Request plan",
      `intent=${requestPlan.intent}`,
      `subject=${requestPlan.subject}`,
      `outputShape=${requestPlan.outputShape}`,
      `sources=${requestPlan.sources.join(",")}`,
      `depth=${requestPlan.depth}`,
      `execution=${requestPlan.execution}`
    ].join("\n")
  );

  if (requestPlan.execution === "implement" || requestPlan.execution === "implement_and_verify") {
    warnings.push("Implementation execution is planned but not yet enabled in resolve_request; returning gap context only.");
  }

  const summary = truncateToTokens(sections.join("\n\n"), input.budgetTokens ?? 1400).text;
  const link = await input.resourceStore.writeText({
    kind: "json",
    label: `resolve_request:${input.request}`,
    source: "resolve_request",
    content: JSON.stringify(data, null, 2)
  });
  resources.unshift(link);

  const telemetry = input.telemetry.record({
    capability: "workflow.resolve_request",
    estimatedToolCostTokens: estimateTokens(summary),
    estimatedSavedTokens: Math.max(900, resources.length * 300 + estimateTokens(JSON.stringify(data))),
    outputTokens: estimateTokens(summary)
  });

  return { summary, resources, telemetry, warnings, data };
}

async function searchBestLocalContext(input: {
  root: string;
  queries: string[];
  limit: number;
  budgetTokens: number;
  resourceStore: ResourceStore;
}): ReturnType<typeof searchFiles> {
  let best: Awaited<ReturnType<typeof searchFiles>> | undefined;
  for (const query of input.queries) {
    const current = await searchFiles({
      root: input.root,
      query,
      limit: input.limit,
      budgetTokens: input.budgetTokens,
      resourceStore: input.resourceStore
    });
    if (!best || current.matches.length > best.matches.length) {
      best = current;
    }
    if (current.matches.length > 0) {
      return current;
    }
  }
  return best ?? searchFiles({ root: input.root, query: input.queries[0] ?? "", limit: input.limit, budgetTokens: input.budgetTokens, resourceStore: input.resourceStore });
}
