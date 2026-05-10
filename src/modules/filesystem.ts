import { mkdir, readdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { ResourceStore } from "../core/resources.js";
import { estimateTokens, truncateToTokens } from "../core/token.js";
import { resolveWorkspacePath } from "../core/workspace-path.js";
import { searchWorkspaceIndex, type WorkspaceCommandRunner } from "../core/workspace-index.js";

const IGNORED_DIRS = new Set([".git", "node_modules", "dist", "artifacts", ".tokenhub"]);

export type FileSearchInput = {
  root: string;
  query?: string;
  limit?: number;
  budgetTokens?: number;
  resourceStore: ResourceStore;
  preferRg?: boolean;
  runner?: WorkspaceCommandRunner;
};

export type FileSearchMatch = {
  path: string;
  snippet: string;
  line: number;
  resourceUri: string;
};

export type FilesystemActionInput = {
  root: string;
  action: "write" | "move" | "delete" | "tree";
  path?: string;
  destination?: string;
  content?: string;
  limit?: number;
};

export async function applyFilesystemAction(input: FilesystemActionInput): Promise<{
  summary: string;
  entries?: Array<{ path: string; type: "file" | "directory" }>;
}> {
  const root = workspacePathOrThrow(input.root, ".");
  const realRoot = await realpath(root);
  if (input.action === "tree") {
    const entries = (await walkEntries(root)).slice(0, input.limit ?? 100);
    return { summary: `listed ${entries.length} entries`, entries };
  }

  if (!mutationsEnabled()) {
    throw new Error(mutationDisabledMessage(input.action));
  }

  if (!input.path) {
    throw new Error(`filesystem ${input.action} requires path.`);
  }
  const target = await actionPathOrThrow(root, realRoot, input.path);
  const relTarget = relative(root, target).split(sep).join("/");

  if (input.action === "write") {
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, input.content ?? "", "utf8");
    return { summary: `wrote ${relTarget}` };
  }

  if (input.action === "move") {
    if (!input.destination) {
      throw new Error("filesystem move requires destination.");
    }
    const destination = await actionPathOrThrow(root, realRoot, input.destination);
    await mkdir(dirname(destination), { recursive: true });
    await rename(target, destination);
    return {
      summary: `moved ${relTarget} to ${relative(root, destination).split(sep).join("/")}`
    };
  }

  await rm(target, { recursive: true, force: true });
  return { summary: `deleted ${relTarget}` };
}

export async function searchFiles(input: FileSearchInput): Promise<{
  matches: FileSearchMatch[];
  tokenEstimate: number;
  warnings: string[];
  backend: "rg" | "walk";
  indexedFiles: number;
}> {
  const root = workspacePathOrThrow(input.root, ".");
  const search = await searchWorkspaceIndex({
    root,
    query: input.query,
    limit: input.limit,
    preferRg: input.preferRg,
    runner: input.runner
  });
  const matches: FileSearchMatch[] = [];
  const warnings: string[] = [...search.warnings];

  for (const match of search.matches) {
    const content = await readFile(match.absolutePath, "utf8").catch(() => undefined);
    if (content === undefined) {
      continue;
    }
    const snippet = buildSnippet(content, match.line, input.budgetTokens ?? 200, input.query?.toLowerCase().trim() ?? "");
    const redactedContent = redactSecrets(content);
    const link = await input.resourceStore.writeText({
      kind: "text",
      label: `file:${match.path}`,
      source: match.absolutePath,
      content: redactedContent
    });
    matches.push({
      path: match.path,
      snippet,
      line: match.line,
      resourceUri: link.uri
    });
  }

  const tokenEstimate = estimateTokens(JSON.stringify(matches));
  if (tokenEstimate > (input.budgetTokens ?? 800)) {
    warnings.push("File search result exceeded budget; snippets were truncated and full files are available as resources.");
  }

  return { matches, tokenEstimate, warnings, backend: search.backend, indexedFiles: search.indexedFiles };
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

async function walkEntries(root: string, dir = root): Promise<Array<{ path: string; type: "file" | "directory" }>> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const out: Array<{ path: string; type: "file" | "directory" }> = [];
  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) {
      continue;
    }
    const full = resolve(dir, entry.name);
    const path = relative(root, full).split(sep).join("/");
    if (entry.isDirectory()) {
      out.push({ path, type: "directory" });
      out.push(...(await walkEntries(root, full)));
    } else if (entry.isFile()) {
      out.push({ path, type: "file" });
    }
  }
  return out;
}

function workspacePathOrThrow(root: string, path: string): string {
  const result = resolveWorkspacePath(root, path);
  if (!result.ok) {
    throw new Error(result.message);
  }
  return result.path;
}

async function actionPathOrThrow(root: string, realRoot: string, path: string): Promise<string> {
  const target = workspacePathOrThrow(root, path);
  const realExistingPath = await realpath(target).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  });

  if (realExistingPath) {
    assertRealPathInsideWorkspace(realRoot, realExistingPath, path);
    return target;
  }

  const parent = await nearestExistingParent(dirname(target));
  assertRealPathInsideWorkspace(realRoot, parent, path);
  return target;
}

async function nearestExistingParent(path: string): Promise<string> {
  const realParent = await realpath(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") {
      throw error;
    }
    const parent = dirname(path);
    if (parent === path) {
      throw error;
    }
    return nearestExistingParent(parent);
  });
  return realParent;
}

function assertRealPathInsideWorkspace(realRoot: string, realPath: string, requestedPath: string): void {
  const relativeRealPath = relative(realRoot, realPath);
  const comparable = process.platform === "win32" ? relativeRealPath.toLowerCase() : relativeRealPath;
  if (comparable === "" || (comparable !== ".." && !comparable.startsWith(`..${sep}`) && !isAbsolute(relativeRealPath))) {
    return;
  }
  throw new Error(`Refusing filesystem action outside workspace: ${requestedPath}`);
}

function mutationDisabledMessage(action: "write" | "move" | "delete"): string {
  return `filesystem ${action} is disabled by default; set TOKENHUB_ENABLE_FS_MUTATIONS=true only for trusted local workspaces.`;
}

function mutationsEnabled(): boolean {
  return process.env.TOKENHUB_ENABLE_FS_MUTATIONS === "true";
}

function buildSnippet(content: string, matchLine: number, budgetTokens: number, query: string): string {
  const lines = content.split(/\r?\n/);
  const start = Math.max(1, matchLine - 2);
  const end = Math.min(lines.length, matchLine + 2);
  const numbered = lines.slice(start - 1, end).map((line, index) => `${start + index}: ${clipLineAroundQuery(line, query)}`);
  return truncateToTokens(redactSecrets(numbered.join("\n")), budgetTokens).text;
}

function clipLineAroundQuery(line: string, query: string): string {
  const maxLineLength = 96;
  if (line.length <= maxLineLength) {
    return line;
  }

  const lowerLine = line.toLowerCase();
  const matchIndex = query ? lowerLine.indexOf(query) : -1;
  if (matchIndex === -1) {
    return `${line.slice(0, maxLineLength - 3)}...`;
  }

  const context = Math.max(24, Math.floor((maxLineLength - query.length - 6) / 2));
  const start = Math.max(0, matchIndex - context);
  const end = Math.min(line.length, matchIndex + query.length + context);
  return `${start > 0 ? "..." : ""}${line.slice(start, end)}${end < line.length ? "..." : ""}`;
}

function redactSecrets(text: string): string {
  return text
    .replace(/(password|secret|token|api[_-]?key)(\s*[:=]\s*)["']?[^"'\s;]+["']?/gi, "$1$2[redacted]")
    .replace(/SECRET_[A-Z0-9_:-]+/g, "[redacted]");
}
