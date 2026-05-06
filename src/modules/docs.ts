import { estimateTokens, truncateToTokens } from "../core/token.js";
import type { FetchLike } from "./github.js";

export type PackageLookupInput = {
  name: string;
  fetchImpl?: FetchLike;
  budgetTokens?: number;
};

export async function lookupNpmPackage(input: PackageLookupInput): Promise<{
  summary: string;
  name: string;
  latest: string;
  description: string;
  versions: string[];
  links: string[];
  tokenEstimate: number;
}> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(`https://registry.npmjs.org/${encodeURIComponent(input.name)}`);
  if (!response.ok) {
    throw new Error(`npm package lookup failed: HTTP ${response.status}`);
  }
  const json = (await response.json()) as Record<string, unknown>;
  const versions = Object.keys((json.versions as Record<string, unknown> | undefined) ?? {}).sort(compareVersionsDesc).slice(0, 5);
  const latest = stringAt(json, ["dist-tags", "latest"]) || versions[0] || "";
  const links = [
    typeof json.homepage === "string" ? json.homepage : "",
    repositoryUrl(json.repository)
  ].filter(Boolean);
  const description = typeof json.description === "string" ? json.description : "";
  const summary = truncateToTokens(
    `${input.name}@${latest}: ${description}. Recent versions: ${versions.join(", ")}. Links: ${links.join(", ")}`,
    input.budgetTokens ?? 300
  ).text;

  return {
    summary,
    name: input.name,
    latest,
    description,
    versions,
    links,
    tokenEstimate: estimateTokens(summary)
  };
}

function stringAt(value: Record<string, unknown>, path: string[]): string {
  let current: unknown = value;
  for (const key of path) {
    current = typeof current === "object" && current !== null ? (current as Record<string, unknown>)[key] : undefined;
  }
  return typeof current === "string" ? current : "";
}

function repositoryUrl(value: unknown): string {
  if (typeof value === "string") return value.replace(/^git\+/, "");
  if (typeof value === "object" && value !== null && typeof (value as { url?: unknown }).url === "string") {
    return (value as { url: string }).url.replace(/^git\+/, "");
  }
  return "";
}

function compareVersionsDesc(a: string, b: string): number {
  return b.localeCompare(a, undefined, { numeric: true, sensitivity: "base" });
}
