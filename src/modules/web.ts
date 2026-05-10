import type { ResourceStore } from "../core/resources.js";
import type { CacheStatus, MemoryCache } from "../core/cache.js";
import { estimateTokens, truncateToTokens } from "../core/token.js";
import { assertAllowedNetworkUrl, type UrlAddressLookup } from "../core/url-policy.js";
import type { NetworkSecurityPolicy } from "../core/security-policy.js";
import type { FetchLike } from "./github.js";

export type CleanHtmlResult = {
  title?: string;
  text: string;
};

export type FetchWebInput = {
  url: string;
  resourceStore: ResourceStore;
  budgetTokens?: number;
  includeRaw?: boolean;
  fetchImpl?: FetchLike;
  urlLookup?: UrlAddressLookup;
  timeoutMs?: number;
  cache?: MemoryCache<CachedWebPage>;
  networkPolicy?: NetworkSecurityPolicy;
};

export type CachedWebPage = {
  title?: string;
  text: string;
  storedContent: string;
};

export function cleanHtmlToText(html: string): CleanHtmlResult {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim();
  const withoutNoise = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  const text = decodeEntities(
    withoutNoise
      .replace(/<\/(h[1-6]|p|li|tr|section|article|div)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s+/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );

  return { title: title ? decodeEntities(title) : undefined, text };
}

export async function fetchAndScrape(input: FetchWebInput): Promise<{
  title?: string;
  text: string;
  resourceUri: string;
  tokenEstimate: number;
  warnings: string[];
  cacheStatus: CacheStatus;
}> {
  const fetchImpl = input.fetchImpl ?? fetch;
  await assertAllowedNetworkUrl(input.url, { lookupAddress: input.urlLookup, networkPolicy: input.networkPolicy });
  const cacheKey = `${input.includeRaw ? "raw" : "clean"}:${input.url}`;
  const cached = input.cache?.get(cacheKey);
  const page = cached ?? (await fetchPage(fetchImpl, input));
  if (!cached) {
    input.cache?.set(cacheKey, page);
  }
  const link = await input.resourceStore.writeText({
    kind: "html",
    label: page.title ?? input.url,
    source: input.url,
    content: page.storedContent
  });
  const truncated = truncateToTokens(page.text, input.budgetTokens ?? 800);

  return {
    title: page.title,
    text: truncated.text,
    resourceUri: link.uri,
    tokenEstimate: estimateTokens(truncated.text),
    warnings: truncated.truncated ? ["Web content was truncated; read_resource can expand the artifact."] : [],
    cacheStatus: cached ? "hit" : "miss"
  };
}

async function fetchPage(fetchImpl: FetchLike, input: FetchWebInput): Promise<CachedWebPage> {
  const response = await fetchWithAllowedRedirects(
    fetchImpl,
    input.url,
    {
      headers: {
        "user-agent": "tokenhub-mcp/0.1 (+https://github.com/Gravitied/tokenhub)"
      }
    },
    input.timeoutMs ?? 5000,
    input.urlLookup,
    input.networkPolicy
  );
  if (!response.ok) {
    throw new Error(`Fetch failed for ${input.url}: HTTP ${response.status}`);
  }
  const html = await response.text();
  const cleaned = cleanHtmlToText(html);
  return {
    title: cleaned.title,
    text: cleaned.text,
    storedContent: input.includeRaw ? html : cleaned.text
  };
}

async function fetchWithAllowedRedirects(
  fetchImpl: FetchLike,
  initialUrl: string,
  init: RequestInit,
  timeoutMs: number,
  urlLookup?: UrlAddressLookup,
  networkPolicy?: NetworkSecurityPolicy
): Promise<Response> {
  let currentUrl = initialUrl;
  for (let redirectCount = 0; redirectCount <= 5; redirectCount++) {
    const checkedUrl = await assertAllowedNetworkUrl(currentUrl, { lookupAddress: urlLookup, networkPolicy });
    const response = await fetchWithTimeout(fetchImpl, checkedUrl.toString(), { ...init, redirect: "manual" }, timeoutMs);
    if (![301, 302, 303, 307, 308].includes(response.status)) {
      return response;
    }
    const location = response.headers.get("location");
    if (!location) {
      return response;
    }
    currentUrl = new URL(location, checkedUrl).toString();
  }
  throw new Error(`Fetch failed for ${initialUrl}: too many redirects.`);
}

async function fetchWithTimeout(fetchImpl: FetchLike, url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const abortTimeout = setTimeout(() => controller.abort(), timeoutMs);
  let rejectTimeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fetchImpl(url, { ...init, signal: controller.signal }),
      new Promise<Response>((_resolve, reject) => {
        rejectTimeout = setTimeout(() => reject(new Error(`Fetch timed out after ${timeoutMs}ms for ${url}`)), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(abortTimeout);
    if (rejectTimeout) clearTimeout(rejectTimeout);
  }
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
