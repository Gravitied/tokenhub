export type TruncateResult = {
  text: string;
  truncated: boolean;
  originalTokens: number;
  returnedTokens: number;
};

export type TokenEstimateOptions = {
  model?: string;
  encoding?: string;
};

export type TruncateOptions = TokenEstimateOptions & {
  preserve?: "head" | "tail" | "balanced";
};

export type ResponseProfile = "minimal" | "standard" | "detailed" | "audit";

export function estimateTokens(value: unknown, options: TokenEstimateOptions = {}): number {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  if (!text) {
    return 0;
  }
  if (options.model || options.encoding) {
    return estimateModelAwareTokens(text);
  }
  return Math.ceil(text.length / 4);
}

export function truncateToTokens(text: string, budgetTokens = 800, options: TruncateOptions = {}): TruncateResult {
  const originalTokens = estimateTokens(text, options);
  if (originalTokens <= budgetTokens) {
    return {
      text,
      truncated: false,
      originalTokens,
      returnedTokens: originalTokens
    };
  }

  const marker = "\n[truncated]";
  const maxChars = Math.max(0, budgetTokens * 4 - marker.length);
  const truncatedText = truncateChars(text, maxChars, marker, options.preserve ?? "head");

  return {
    text: truncatedText,
    truncated: true,
    originalTokens,
    returnedTokens: estimateTokens(truncatedText, options)
  };
}

export function responseProfileBudget(profile: ResponseProfile = "standard", baseBudgetTokens = 800): number {
  const safeBudget = Math.max(1, baseBudgetTokens);
  if (profile === "minimal") return Math.max(32, Math.floor(safeBudget * 0.45));
  if (profile === "detailed") return Math.ceil(safeBudget * 1.5);
  if (profile === "audit") return Math.ceil(safeBudget * 2.1);
  return safeBudget;
}

function truncateChars(text: string, maxChars: number, marker: string, preserve: NonNullable<TruncateOptions["preserve"]>): string {
  if (maxChars <= 0) {
    return marker.trimStart();
  }
  if (preserve === "tail") {
    return `${marker}\n${text.slice(-maxChars).trimStart()}`;
  }
  if (preserve === "balanced") {
    const headChars = Math.max(0, Math.floor(maxChars / 2));
    const tailChars = Math.max(0, maxChars - headChars);
    return `${text.slice(0, headChars).trimEnd()}${marker}\n${text.slice(-tailChars).trimStart()}`;
  }
  return `${text.slice(0, maxChars).trimEnd()}${marker}`;
}

function estimateModelAwareTokens(text: string): number {
  const base = Math.ceil(text.length / 4);
  const structural = (text.match(/[{}[\]();:,.?=&/\\|<>`'"]/g) ?? []).length;
  const lineBreaks = (text.match(/\n/g) ?? []).length;
  const longRuns = (text.match(/[A-Za-z0-9_-]{24,}/g) ?? []).length;
  return Math.max(1, Math.ceil(base + structural / 6 + lineBreaks / 3 + longRuns * 2));
}
