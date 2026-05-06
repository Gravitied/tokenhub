import { readdir, readFile, stat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import type { ResourceStore } from "../core/resources.js";
import { estimateTokens, truncateToTokens } from "../core/token.js";

const IGNORED_DIRS = new Set([".git", "node_modules", "dist", "artifacts", ".tokenhub"]);

export type FileSearchInput = {
  root: string;
  query?: string;
  limit?: number;
  budgetTokens?: number;
  resourceStore: ResourceStore;
};

export type FileSearchMatch = {
  path: string;
  snippet: string;
  line: number;
  resourceUri: string;
};

export async function searchFiles(input: FileSearchInput): Promise<{
  matches: FileSearchMatch[];
  tokenEstimate: number;
  warnings: string[];
}> {
  const root = resolve(input.root);
  const query = input.query?.toLowerCase().trim() ?? "";
  const files = await walk(root);
  const matches: FileSearchMatch[] = [];
  const warnings: string[] = [];

  for (const file of files) {
    if (matches.length >= (input.limit ?? 10)) {
      break;
    }

    const content = await readFile(file, "utf8").catch(() => undefined);
    if (content === undefined) {
      continue;
    }
    const lower = content.toLowerCase();
    const index = query ? lower.indexOf(query) : 0;
    if (index === -1) {
      continue;
    }

    const line = content.slice(0, index).split(/\r?\n/).length;
    const snippet = buildSnippet(content, line, input.budgetTokens ?? 200);
    const link = await input.resourceStore.writeText({
      kind: "text",
      label: `file:${relative(root, file)}`,
      source: file,
      content
    });
    matches.push({
      path: relative(root, file).split(sep).join("/"),
      snippet,
      line,
      resourceUri: link.uri
    });
  }

  const tokenEstimate = estimateTokens(JSON.stringify(matches));
  if (tokenEstimate > (input.budgetTokens ?? 800)) {
    warnings.push("File search result exceeded budget; snippets were truncated and full files are available as resources.");
  }

  return { matches, tokenEstimate, warnings };
}

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) {
        files.push(...(await walk(resolve(dir, entry.name))));
      }
      continue;
    }
    if (entry.isFile()) {
      files.push(resolve(dir, entry.name));
    }
  }
  return files;
}

function buildSnippet(content: string, matchLine: number, budgetTokens: number): string {
  const lines = content.split(/\r?\n/);
  const start = Math.max(1, matchLine - 2);
  const end = Math.min(lines.length, matchLine + 2);
  const numbered = lines.slice(start - 1, end).map((line, index) => `${start + index}: ${line}`);
  return truncateToTokens(redactSecrets(numbered.join("\n")), budgetTokens).text;
}

function redactSecrets(text: string): string {
  return text
    .replace(/(password|secret|token|api[_-]?key)(\s*[:=]\s*)["']?[^"'\s;]+["']?/gi, "$1$2[redacted]")
    .replace(/SECRET_[A-Z0-9_:-]+/g, "[redacted]");
}
