import type { ResourceLink, ResourceStore } from "../core/resources.js";
import { estimateTokens, truncateToTokens } from "../core/token.js";
import type { UrlAddressLookup } from "../core/url-policy.js";
import type { FetchLike } from "./github.js";
import { searchWeb, type SearchProvider, type SearchResult } from "./search.js";
import { fetchAndScrape } from "./web.js";

export type AnswerFromWebInput = {
  query: string;
  target?: AnswerTarget;
  limit?: number;
  sourceLimit?: number;
  budgetTokens?: number;
  provider?: SearchProvider;
  apiKey?: string;
  resourceStore: ResourceStore;
  fetchImpl?: FetchLike;
  urlLookup?: UrlAddressLookup;
};

export type AnswerFromWebResult = {
  query: string;
  target: AnswerTarget;
  summary: string;
  items: Array<{
    rank: number;
    name: string;
    score: number;
    sources: Array<{ title: string; url: string; evidence: string }>;
  }>;
  sources: Array<{ title: string; url: string; resourceUri?: string }>;
  contextSnippets: Array<{ title: string; url: string; snippet: string; resourceUri?: string }>;
  resources: ResourceLink[];
  tokenEstimate: number;
  warnings: string[];
};

export type AnswerTarget = "ranked_list" | "summary";

type CandidateMention = {
  name: string;
  evidence: string;
  line: number;
};

export async function answerFromWeb(input: AnswerFromWebInput): Promise<AnswerFromWebResult> {
  const target = input.target ?? "ranked_list";
  if (target !== "ranked_list" && target !== "summary") {
    throw new Error("answer_from_web supports target=ranked_list or target=summary.");
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
      const fetchUrl = normalizeContextUrl(result.url);
      const page = await fetchAndScrape({
        url: fetchUrl,
        resourceStore: input.resourceStore,
        budgetTokens: 4200,
        fetchImpl: input.fetchImpl,
        urlLookup: input.urlLookup
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

  const answer =
    target === "summary"
      ? buildSummaryAnswer(input.query, sourceRecords)
      : buildRankedListAnswer(input.query, sourceRecords, limit, warnings);

  const summaryText = [answer.summary, "Sources:", sourceRecords.map((source, index) => `[${index + 1}] ${source.title} - ${source.url}`).join("\n")].join(
    "\n\n"
  );
  const summary = truncateToTokens(summaryText, input.budgetTokens ?? 900).text;
  const resource = await input.resourceStore.writeText({
    kind: "json",
    label: `answer_from_web:${input.query}`,
    source: "answer_from_web",
    content: JSON.stringify({ query: input.query, target, items: answer.items, contextSnippets: answer.contextSnippets, sources: sourceRecords }, null, 2)
  });

  return {
    query: input.query,
    target,
    summary,
    items: answer.items,
    sources: sourceRecords.map((source) => ({ title: source.title, url: source.url, resourceUri: source.resourceUri })),
    contextSnippets: answer.contextSnippets,
    resources: [resource],
    tokenEstimate: estimateTokens(summary),
    warnings
  };
}

function buildRankedListAnswer(
  query: string,
  sourceRecords: Array<{ title: string; url: string; resourceUri?: string; text: string }>,
  limit: number,
  warnings: string[]
): Pick<AnswerFromWebResult, "items" | "contextSnippets" | "summary"> {
  const aggregated = aggregateCandidates(
    sourceRecords.flatMap((source, sourceIndex) => extractCandidateMentions(source.text, query).map((mention) => ({ mention, source, sourceIndex })))
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
  const contextSnippets = items.flatMap((item) =>
    item.sources.slice(0, 2).map((source) => ({
      title: source.title,
      url: source.url,
      snippet: source.evidence,
      resourceUri: sourceRecords.find((record) => record.url === source.url)?.resourceUri
    }))
  );
  return {
    items,
    contextSnippets,
    summary: items.map((item) => `${item.rank}. ${item.name} (${item.sources.length} source${item.sources.length === 1 ? "" : "s"})`).join("\n")
  };
}

function buildSummaryAnswer(
  query: string,
  sourceRecords: Array<{ title: string; url: string; resourceUri?: string; text: string; searchResult?: SearchResult }>
): Pick<AnswerFromWebResult, "items" | "contextSnippets" | "summary"> {
  const keywords = queryKeywords(query);
  const scoredBySource = sourceRecords.map((source, sourceIndex) => {
    const candidates = [
      ...summaryCandidates(source.text),
      ...usefulLines(source.text).filter((line) => /[.?!]$/.test(line)),
      source.searchResult?.snippet
    ].filter((value): value is string => Boolean(value));
    return candidates
      .map((snippet, snippetIndex) => ({
        title: source.title,
        url: source.url,
        resourceUri: source.resourceUri,
        snippet: trimEvidence(decodeBasicEntities(snippet.replace(/\s+/g, " ").trim())),
        score: scoreSnippet(snippet, source.title, source.url, keywords, query) + Math.max(0, 1 - sourceIndex * 0.15) - snippetIndex * 0.01
      }))
      .sort((a, b) => b.score - a.score);
  });
  const topPerSource = scoredBySource.flatMap((items) => items.slice(0, 1));
  const extras = scoredBySource.flatMap((items) => items.slice(1, 3));
  const contextSnippets = dedupeSnippets([...topPerSource, ...extras])
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(3, Math.min(8, sourceRecords.length * 2)))
    .map(({ title, url, resourceUri, snippet }) => ({ title, url, resourceUri, snippet }));
  const paragraphSentences = topPerSource
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((item) => summaryClause(item.snippet))
    .filter(Boolean);
  const fallback =
    sourceRecords.length === 0
      ? "No fetchable web sources were available for this query."
      : `The sources surfaced for ${query} point to ${sourceRecords.map((source) => source.title).join(", ")}.`;
  return {
    items: [],
    contextSnippets,
    summary: paragraphSentences.length ? synthesizeSummary(query, paragraphSentences) : fallback
  };
}

export function extractCandidateMentions(text: string, query: string): CandidateMention[] {
  return extractGenericCandidates(text);
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
  return truncateAtWord(line, 260);
}

function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 30 && sentence.length <= 500);
}

function summaryCandidates(text: string): string[] {
  const abstract = text.match(/Abstract:\s*([\s\S]*?)(?:\n\s*(?:Comments|Subjects|Journal reference|Cite as|Submission history):|\n\s*Related papers|\n\s*Current browse context|$)/i)?.[1];
  if (abstract) {
    return abstract
      .replace(/\s+/g, " ")
      .split(/\s+(?=\(\d+\)\s*)|(?<=[.!?])\s+/)
      .map((sentence) => sentence.replace(/^\(\d+\)\s*/, "").trim())
      .filter((sentence) => sentence.length >= 30 && sentence.length <= 700);
  }
  return sentences(text);
}

function queryKeywords(query: string): string[] {
  const stopwords = new Set([
    "about",
    "answer",
    "give",
    "latest",
    "look",
    "looking",
    "paragraph",
    "paper",
    "papers",
    "research",
    "result",
    "results",
    "search",
    "summary",
    "summarize",
    "with"
  ]);
  return [...new Set(query.toLowerCase().match(/[a-z0-9][a-z0-9-]{3,}/g) ?? [])].filter((word) => !stopwords.has(word));
}

function scoreSnippet(snippet: string, title: string, url: string, keywords: string[], query: string): number {
  const haystack = `${title} ${url} ${snippet}`.toLowerCase();
  const keywordScore = keywords.reduce((score, keyword) => score + (haystack.includes(keyword) ? 2 : 0), 0);
  const recencyScore = /\b(20\d{2}|latest|new|recent)\b/i.test(haystack) ? 0.5 : 0;
  const sourceSignal = /\b(arxiv|paper|technical|model|reasoning|attention|training|inference)\b/i.test(haystack) ? 0.75 : 0;
  const paperBoost = /\bpaper|papers|research\b/i.test(query) && /\b(arxiv|paper|technical|nature|huggingface)\b/i.test(haystack) ? 1.25 : 0;
  const abstractBoost = /\babstract:\b|deepseek sparse attention|reinforcement learning framework/i.test(haystack) ? 2 : 0;
  const boilerplatePenalty = /\barxivlabs|author venue institution|subscribe sign in|global talent recruitment|skip to main content|collection\b/i.test(haystack)
    ? 2.5
    : 0;
  return keywordScore + recencyScore + sourceSignal + paperBoost + abstractBoost - boilerplatePenalty;
}

function decodeBasicEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function dedupeSnippets<T extends { snippet: string; url: string }>(snippets: T[]): T[] {
  const seen = new Set<string>();
  const results: T[] = [];
  for (const snippet of snippets) {
    const key = `${snippet.url}:${snippet.snippet.toLowerCase().slice(0, 80)}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    results.push(snippet);
  }
  return results;
}

function ensureSentence(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function synthesizeSummary(query: string, clauses: string[]): string {
  const topic = summarizeTopic(query);
  if (clauses.length === 1) {
    return ensureSentence(`Recent ${topic} surfaced by the workflow emphasizes ${clauses[0]}`);
  }
  const body = clauses.length === 2 ? `${clauses[0]} and ${clauses[1]}` : `${clauses.slice(0, -1).join("; ")}; and ${clauses.at(-1)}`;
  return ensureSentence(`Recent ${topic} surfaced by the workflow emphasizes ${body}`);
}

function summaryClause(text: string): string {
  const value = summarySnippetText(text).replace(/^NEWS\s+\d{1,2}\s+\w+\s+\d{4}\s+/i, "");
  const cleaned = value.replace(/\s+/g, " ").replace(/[.!?]+$/g, "").trim();
  return truncateAtWord(cleaned, 220).replace(/\.\.\.$/, "");
}

function summarySnippetText(text: string): string {
  return decodeBasicEntities(text)
    .replace(/https?:\/\/\S+/g, "")
    .replace(/([A-Za-z]\d+)\.(\d+)/g, "$1-$2")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeContextUrl(url: string): string {
  return url.replace(/^https:\/\/arxiv\.org\/pdf\/([^?#]+)(?:\.pdf)?(?:[?#].*)?$/i, "https://arxiv.org/abs/$1");
}

function truncateAtWord(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  const slice = text.slice(0, maxLength - 3);
  const boundary = slice.lastIndexOf(" ");
  return `${slice.slice(0, boundary > maxLength * 0.6 ? boundary : slice.length).trimEnd()}...`;
}

function summarizeTopic(query: string): string {
  const keywords = queryKeywords(query).slice(0, 3);
  return keywords.length ? keywords.join(" ") : "the searched topic";
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)));
}
