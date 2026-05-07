import type { ResourceStore } from "../core/resources.js";
import { estimateTokens, truncateToTokens } from "../core/token.js";
import { assertAllowedNetworkUrl, type UrlAddressLookup } from "../core/url-policy.js";
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
}> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchWithAllowedRedirects(
    fetchImpl,
    input.url,
    {
    headers: {
      "user-agent": "tokenhub-mcp/0.1 (+https://github.com/tokenhub-mcp/tokenhub-mcp)"
    }
    },
    input.timeoutMs ?? 5000,
    input.urlLookup
  );
  if (!response.ok) {
    throw new Error(`Fetch failed for ${input.url}: HTTP ${response.status}`);
  }
  const html = await response.text();
  const cleaned = cleanHtmlToText(html);
  const link = await input.resourceStore.writeText({
    kind: "html",
    label: cleaned.title ?? input.url,
    source: input.url,
    content: input.includeRaw ? html : cleaned.text
  });
  const truncated = truncateToTokens(cleaned.text, input.budgetTokens ?? 800);

  return {
    title: cleaned.title,
    text: truncated.text,
    resourceUri: link.uri,
    tokenEstimate: estimateTokens(truncated.text),
    warnings: truncated.truncated ? ["Web content was truncated; read_resource can expand the artifact."] : []
  };
}

async function fetchWithAllowedRedirects(
  fetchImpl: FetchLike,
  initialUrl: string,
  init: RequestInit,
  timeoutMs: number,
  urlLookup?: UrlAddressLookup
): Promise<Response> {
  let currentUrl = initialUrl;
  for (let redirectCount = 0; redirectCount <= 5; redirectCount++) {
    const checkedUrl = await assertAllowedNetworkUrl(currentUrl, { lookupAddress: urlLookup });
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
