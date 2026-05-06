export type SourceQualityInput = {
  request: string;
  expectedKeywords: string[];
  preferredDomains?: string[];
  sources: Array<{ title: string; url: string; resourceUri?: string }>;
  contextSnippets: Array<{ title: string; url: string; snippet: string; resourceUri?: string }>;
  summary: string;
  minSources?: number;
  minUniqueDomains?: number;
  minContextSnippets?: number;
  minKeywordCoverage?: number;
  minScore?: number;
};

export type SourceQualityCheck = {
  name: string;
  ok: boolean;
  reason: string;
  weight: number;
};

export type SourceQualityResult = {
  passed: boolean;
  score: number;
  checks: SourceQualityCheck[];
  uniqueDomains: string[];
  keywordCoverage: number;
};

const SYNTHETIC_HOSTS = new Set(["example.test", "example.com", "localhost", "127.0.0.1"]);

export function scoreSourceQuality(input: SourceQualityInput): SourceQualityResult {
  const minSources = input.minSources ?? 2;
  const minUniqueDomains = input.minUniqueDomains ?? 2;
  const minContextSnippets = input.minContextSnippets ?? 2;
  const minKeywordCoverage = input.minKeywordCoverage ?? 0.6;
  const minScore = input.minScore ?? 70;
  const urls = input.sources.map((source) => safeUrl(source.url)).filter((url): url is URL => Boolean(url));
  const uniqueDomains = [...new Set(urls.map((url) => normalizeDomain(url.hostname)))];
  const combinedText = [input.summary, ...input.sources.map((source) => source.title), ...input.contextSnippets.map((item) => item.snippet)].join(" ");
  const keywordCoverage = keywordCoverageRatio(input.expectedKeywords, combinedText);
  const preferredDomains = (input.preferredDomains ?? []).map(normalizeDomain);

  const checks: SourceQualityCheck[] = [
    {
      name: "source_count",
      ok: input.sources.length >= minSources,
      reason: `expected at least ${minSources} sources, got ${input.sources.length}`,
      weight: 18
    },
    {
      name: "unique_domains",
      ok: uniqueDomains.length >= minUniqueDomains,
      reason: `expected at least ${minUniqueDomains} unique domains, got ${uniqueDomains.length}`,
      weight: 14
    },
    {
      name: "valid_https_urls",
      ok: input.sources.length > 0 && urls.length === input.sources.length && urls.every((url) => url.protocol === "https:"),
      reason: "all sources should have valid https URLs",
      weight: 12
    },
    {
      name: "not_synthetic",
      ok: urls.every((url) => !SYNTHETIC_HOSTS.has(normalizeDomain(url.hostname))),
      reason: "sources must not use synthetic example, localhost, or test domains",
      weight: 16
    },
    {
      name: "resource_links",
      ok: input.sources.length > 0 && input.sources.every((source) => source.resourceUri?.startsWith("tokenhub://resource/")),
      reason: "each source should have a tokenhub resource link",
      weight: 12
    },
    {
      name: "context_snippets",
      ok: input.contextSnippets.filter((item) => item.snippet.trim().length >= 40).length >= minContextSnippets,
      reason: `expected at least ${minContextSnippets} non-trivial context snippets`,
      weight: 16
    },
    {
      name: "keyword_coverage",
      ok: keywordCoverage >= minKeywordCoverage,
      reason: `expected keyword coverage >= ${minKeywordCoverage}, got ${Math.round(keywordCoverage * 100) / 100}`,
      weight: 12
    },
    {
      name: "preferred_domain",
      ok: preferredDomains.length === 0 || uniqueDomains.some((domain) => preferredDomains.some((preferred) => domain === preferred || domain.endsWith(`.${preferred}`))),
      reason: preferredDomains.length ? `expected at least one preferred source domain: ${preferredDomains.join(", ")}` : "no preferred source domains requested",
      weight: preferredDomains.length ? 10 : 0
    }
  ];
  const totalWeight = checks.reduce((sum, check) => sum + check.weight, 0);
  const earned = checks.filter((check) => check.ok).reduce((sum, check) => sum + check.weight, 0);
  const score = Math.round((earned / totalWeight) * 100);

  return {
    passed: score >= minScore && checks.every((check) => check.ok || check.weight === 0),
    score,
    checks,
    uniqueDomains,
    keywordCoverage
  };
}

function keywordCoverageRatio(keywords: string[], text: string): number {
  const normalized = text.toLowerCase();
  const uniqueKeywords = [...new Set(keywords.map((keyword) => keyword.trim().toLowerCase()).filter(Boolean))];
  if (uniqueKeywords.length === 0) {
    return 1;
  }
  const hits = uniqueKeywords.filter((keyword) => normalized.includes(keyword.toLowerCase())).length;
  return hits / uniqueKeywords.length;
}

function safeUrl(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

function normalizeDomain(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, "");
}
