export type TruncateResult = {
  text: string;
  truncated: boolean;
  originalTokens: number;
  returnedTokens: number;
};

export function estimateTokens(value: unknown): number {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  if (!text) {
    return 0;
  }
  return Math.ceil(text.length / 4);
}

export function truncateToTokens(text: string, budgetTokens = 800): TruncateResult {
  const originalTokens = estimateTokens(text);
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
  const truncatedText = `${text.slice(0, maxChars).trimEnd()}${marker}`;

  return {
    text: truncatedText,
    truncated: true,
    originalTokens,
    returnedTokens: estimateTokens(truncatedText)
  };
}
