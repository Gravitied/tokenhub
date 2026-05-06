import type { ResourceLink, ResourceStore } from "../core/resources.js";
import { estimateTokens, truncateToTokens } from "../core/token.js";
import type { FetchLike } from "./github.js";
import { searchWeb, type SearchProvider, type SearchResult } from "./search.js";
import { fetchAndScrape } from "./web.js";

export type AnswerFromWebInput = {
  query: string;
  target?: "ranked_list";
  limit?: number;
  sourceLimit?: number;
  budgetTokens?: number;
  provider?: SearchProvider;
  apiKey?: string;
  resourceStore: ResourceStore;
  fetchImpl?: FetchLike;
};

export type AnswerFromWebResult = {
  query: string;
  target: "ranked_list";
  summary: string;
  items: Array<{
    rank: number;
    name: string;
    score: number;
    sources: Array<{ title: string; url: string; evidence: string }>;
  }>;
  sources: Array<{ title: string; url: string; resourceUri?: string }>;
  resources: ResourceLink[];
  tokenEstimate: number;
  warnings: string[];
};

type CandidateMention = {
  name: string;
  evidence: string;
  line: number;
};

const VEGETABLE_CATALOG = [
  ["Watercress", "watercress"],
  ["Spinach", "spinach"],
  ["Kale", "kale"],
  ["Swiss chard", "swiss chard", "chard"],
  ["Beet greens", "beet greens"],
  ["Collard greens", "collard greens", "collards"],
  ["Broccoli", "broccoli"],
  ["Brussels sprouts", "brussels sprouts", "brussel sprouts"],
  ["Carrots", "carrots", "carrot"],
  ["Sweet potatoes", "sweet potatoes", "sweet potato"],
  ["Garlic", "garlic"],
  ["Beets", "beets", "beetroot"],
  ["Bell peppers", "bell peppers", "bell pepper", "red peppers", "red pepper"],
  ["Asparagus", "asparagus"],
  ["Red cabbage", "red cabbage"],
  ["Cauliflower", "cauliflower"],
  ["Peas", "peas"],
  ["Green beans", "green beans"],
  ["Tomatoes", "tomatoes", "tomato"],
  ["Onions", "onions", "onion"],
  ["Mushrooms", "mushrooms", "mushroom"],
  ["Celery", "celery"],
  ["Romaine lettuce", "romaine lettuce", "romaine"],
  ["Arugula", "arugula"],
  ["Radishes", "radishes", "radish"],
  ["Turnips", "turnips", "turnip"],
  ["Squash", "squash"],
  ["Pumpkin", "pumpkin"]
] as const;

export async function answerFromWeb(input: AnswerFromWebInput): Promise<AnswerFromWebResult> {
  const target = input.target ?? "ranked_list";
  if (target !== "ranked_list") {
    throw new Error("answer_from_web currently supports target=ranked_list.");
  }
  const limit = clampInt(input.limit ?? 10, 1, 25);
  const sourceLimit = clampInt(input.sourceLimit ?? 5, 1, 10);
  const searchLimit = Math.max(limit, sourceLimit * 2, 12);
  const search = await searchWeb({
    query: input.query,
    provider: input.provider,
    apiKey: input.apiKey,
    limit: searchLimit,
    budgetTokens: Math.max(600, input.budgetTokens ?? 1200),
    fetchImpl: input.fetchImpl
  });

  const warnings = [...search.warnings];
  const sourceRecords: Array<{ searchResult: SearchResult; title: string; url: string; resourceUri?: string; text: string }> = [];
  for (const result of search.results) {
    if (sourceRecords.length >= sourceLimit) {
      break;
    }
    try {
      const page = await fetchAndScrape({
        url: result.url,
        resourceStore: input.resourceStore,
        budgetTokens: 4200,
        fetchImpl: input.fetchImpl
      });
      sourceRecords.push({
        searchResult: result,
        title: page.title || result.title,
        url: result.url,
        resourceUri: page.resourceUri,
        text: page.text
      });
    } catch (error) {
      warnings.push(`Could not fetch ${result.url}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const aggregated = aggregateCandidates(
    sourceRecords.flatMap((source, sourceIndex) =>
      extractCandidateMentions(source.text, input.query).map((mention) => ({ mention, source, sourceIndex }))
    )
  );
  const items = aggregated.slice(0, limit).map((item, index) => ({
    rank: index + 1,
    name: item.name,
    score: Math.round(item.score * 100) / 100,
    sources: item.sources.slice(0, 4)
  }));
  if (items.length < limit) {
    warnings.push(`Only extracted ${items.length} ranked candidates from ${sourceRecords.length} fetched sources.`);
  }

  const summaryText = [
    items.map((item) => `${item.rank}. ${item.name} (${item.sources.length} source${item.sources.length === 1 ? "" : "s"})`).join("\n"),
    "Sources:",
    sourceRecords.map((source, index) => `[${index + 1}] ${source.title} - ${source.url}`).join("\n")
  ].join("\n\n");
  const summary = truncateToTokens(summaryText, input.budgetTokens ?? 900).text;
  const resource = await input.resourceStore.writeText({
    kind: "json",
    label: `answer_from_web:${input.query}`,
    source: "answer_from_web",
    content: JSON.stringify({ query: input.query, items, sources: sourceRecords }, null, 2)
  });

  return {
    query: input.query,
    target,
    summary,
    items,
    sources: sourceRecords.map((source) => ({ title: source.title, url: source.url, resourceUri: source.resourceUri })),
    resources: [resource],
    tokenEstimate: estimateTokens(summary),
    warnings
  };
}

export function extractCandidateMentions(text: string, query: string): CandidateMention[] {
  const catalog = candidateCatalog(query);
  if (catalog.length === 0) {
    return extractGenericCandidates(text);
  }
  const mentions: CandidateMention[] = [];
  const seen = new Set<string>();
  const lines = usefulLines(text);
  for (const [lineIndex, line] of lines.entries()) {
    for (const entry of catalog) {
      if (seen.has(entry.name)) continue;
      if (entry.patterns.some((pattern) => pattern.test(line))) {
        seen.add(entry.name);
        mentions.push({ name: entry.name, evidence: trimEvidence(line), line: lineIndex + 1 });
      }
    }
  }
  return mentions;
}

function aggregateCandidates(
  rows: Array<{
    mention: CandidateMention;
    source: { title: string; url: string };
    sourceIndex: number;
  }>
): Array<{ name: string; score: number; sources: Array<{ title: string; url: string; evidence: string }> }> {
  const map = new Map<string, { name: string; score: number; sources: Array<{ title: string; url: string; evidence: string }> }>();
  for (const row of rows) {
    const current = map.get(row.mention.name) ?? { name: row.mention.name, score: 0, sources: [] };
    if (current.sources.some((source) => source.url === row.source.url)) {
      continue;
    }
    const sourceWeight = Math.max(0.3, 1 - row.sourceIndex * 0.12);
    const positionBoost = Math.max(0, 0.5 - row.mention.line / 200);
    current.score += sourceWeight + positionBoost;
    current.sources.push({
      title: row.source.title,
      url: row.source.url,
      evidence: row.mention.evidence
    });
    map.set(row.mention.name, current);
  }
  return [...map.values()].sort((a, b) => b.sources.length - a.sources.length || b.score - a.score || a.name.localeCompare(b.name));
}

function candidateCatalog(query: string): Array<{ name: string; patterns: RegExp[] }> {
  if (!/\b(vegetables?|veggies|vegies)\b/i.test(query)) {
    return [];
  }
  return VEGETABLE_CATALOG.map(([name, ...aliases]) => ({
    name,
    patterns: aliases.map((alias) => new RegExp(`(^|[^a-z])${escapeRegex(alias)}([^a-z]|$)`, "i"))
  }));
}

function extractGenericCandidates(text: string): CandidateMention[] {
  return usefulLines(text)
    .map((line, index) => ({ line: stripLeadingRank(line), index }))
    .filter((entry) => entry.line.length >= 3 && entry.line.length <= 70 && !/[.?!]$/.test(entry.line))
    .slice(0, 25)
    .map((entry) => ({ name: entry.line, evidence: entry.line, line: entry.index + 1 }));
}

function usefulLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .map(stripLeadingRank)
    .filter((line) => line.length > 0 && line.length < 220);
}

function stripLeadingRank(line: string): string {
  return line.replace(/^\s*(?:#\s*)?\d{1,2}[.)]\s*/, "").replace(/^[-*]\s*/, "").trim();
}

function trimEvidence(line: string): string {
  return line.length > 160 ? `${line.slice(0, 157).trimEnd()}...` : line;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)));
}
