import { estimateTokens, truncateToTokens } from "../core/token.js";
import type { FetchLike } from "./github.js";

export type SearchProvider = "brave" | "exa" | "tavily" | "serpapi" | "duckduckgo";

const SEARCH_PROVIDER_SETUP_ERROR =
  "Search requires BRAVE_SEARCH_API_KEY, EXA_API_KEY, TAVILY_API_KEY, SERPAPI_API_KEY, or apiKey with provider.";

export type SearchResult = {
  title: string;
  url: string;
  snippet: string;
  provider: string;
  confidence: number;
  fields: string[];
};

export type SearchInput = {
  query: string;
  provider?: SearchProvider;
  apiKey?: string;
  limit?: number;
  budgetTokens?: number;
  fetchImpl?: FetchLike;
};

export async function searchWeb(input: SearchInput): Promise<{
  summary: string;
  results: SearchResult[];
  tokenEstimate: number;
  warnings: string[];
}> {
  const provider = input.provider ?? providerFromEnv();
  const fetchImpl = input.fetchImpl ?? fetch;
  const raw = await fetchProvider(provider, input.query, input.apiKey ?? apiKeyFromEnv(provider), fetchImpl, input.limit ?? 5);
  const results = normalizeSearchResults(raw).slice(0, input.limit ?? 5);
  const summaryText = results
    .map((result, index) => `${index + 1}. ${result.title} - ${result.url} - ${result.snippet}`)
    .join("\n");
  const summary = truncateToTokens(summaryText, input.budgetTokens ?? 500).text;

  return {
    summary,
    results,
    tokenEstimate: estimateTokens(summary),
    warnings: provider === "duckduckgo" ? ["Using no-key DuckDuckGo HTML fallback; provider freshness metadata is limited."] : []
  };
}

export function normalizeSearchResults(
  rawResults: Array<{ title: string; url: string; snippet?: string; provider: string }>
): SearchResult[] {
  const seen = new Set<string>();
  const results: SearchResult[] = [];
  for (const raw of rawResults) {
    const url = normalizeUrl(raw.url);
    if (!url || seen.has(url)) {
      continue;
    }
    seen.add(url);
    const confidence = raw.provider === "brave" || raw.provider === "exa" ? 0.86 : 0.74;
    results.push({
      title: raw.title.trim(),
      url,
      snippet: (raw.snippet ?? "").trim(),
      provider: raw.provider,
      confidence,
      fields: ["title", "url", "snippet", "provider", "confidence"]
    });
  }
  return results;
}

async function fetchProvider(
  provider: SearchProvider,
  query: string,
  apiKey: string | undefined,
  fetchImpl: FetchLike,
  limit: number
): Promise<Array<{ title: string; url: string; snippet?: string; provider: string }>> {
  if (provider === "brave") {
    if (!apiKey) throw new Error("Brave search requires BRAVE_SEARCH_API_KEY or apiKey.");
    const response = await fetchImpl(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${limit}`, {
      headers: { accept: "application/json", "x-subscription-token": apiKey }
    });
    const json = (await response.json()) as { web?: { results?: Array<{ title: string; url: string; description?: string }> } };
    return (json.web?.results ?? []).map((item) => ({
      title: item.title,
      url: item.url,
      snippet: item.description,
      provider
    }));
  }

  if (provider === "tavily") {
    if (!apiKey) throw new Error("Tavily search requires TAVILY_API_KEY or apiKey.");
    const response = await fetchImpl("https://api.tavily.com/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ api_key: apiKey, query, max_results: limit })
    });
    const json = (await response.json()) as { results?: Array<{ title: string; url: string; content?: string }> };
    return (json.results ?? []).map((item) => ({ title: item.title, url: item.url, snippet: item.content, provider }));
  }

  if (provider === "serpapi") {
    if (!apiKey) throw new Error("SerpAPI search requires SERPAPI_API_KEY or apiKey.");
    const response = await fetchImpl(
      `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(query)}&num=${limit}&api_key=${encodeURIComponent(apiKey)}`
    );
    const json = (await response.json()) as { organic_results?: Array<{ title: string; link: string; snippet?: string }> };
    return (json.organic_results ?? []).map((item) => ({
      title: item.title,
      url: item.link,
      snippet: item.snippet,
      provider
    }));
  }

  if (provider === "exa") {
    if (!apiKey) throw new Error("Exa search requires EXA_API_KEY or apiKey.");
    const response = await fetchImpl("https://api.exa.ai/search", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify({ query, numResults: limit })
    });
    const json = (await response.json()) as { results?: Array<{ title: string; url: string; text?: string }> };
    return (json.results ?? []).map((item) => ({ title: item.title, url: item.url, snippet: item.text, provider }));
  }

  const response = await fetchImpl(`https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`);
  const html = await response.text();
  return [...html.matchAll(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)]
    .slice(0, limit)
    .map((match) => ({
      title: stripHtml(match[2]),
      url: decodeDuckDuckGoUrl(match[1]),
      snippet: stripHtml(match[3]),
      provider
    }));
}

function providerFromEnv(): SearchProvider {
  if (process.env.BRAVE_SEARCH_API_KEY) return "brave";
  if (process.env.EXA_API_KEY) return "exa";
  if (process.env.TAVILY_API_KEY) return "tavily";
  if (process.env.SERPAPI_API_KEY) return "serpapi";
  return "duckduckgo";
}

function apiKeyFromEnv(provider: SearchProvider): string | undefined {
  if (provider === "brave") return process.env.BRAVE_SEARCH_API_KEY;
  if (provider === "exa") return process.env.EXA_API_KEY;
  if (provider === "tavily") return process.env.TAVILY_API_KEY;
  if (provider === "serpapi") return process.env.SERPAPI_API_KEY;
  return undefined;
}

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function decodeDuckDuckGoUrl(value: string): string {
  const decoded = value.replace(/&amp;/g, "&");
  try {
    const url = new URL(decoded, "https://duckduckgo.com");
    return url.searchParams.get("uddg") ?? decoded;
  } catch {
    return decoded;
  }
}
