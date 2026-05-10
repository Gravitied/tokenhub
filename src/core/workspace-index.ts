import { execFile } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";

const IGNORED_DIRS = new Set([".git", "node_modules", "dist", "dist-bench", "artifacts", ".tokenhub"]);

export type WorkspaceCommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type WorkspaceCommandRunner = (command: string, args: string[], options: { cwd: string }) => Promise<WorkspaceCommandResult>;

export type WorkspaceIndexFile = {
  path: string;
  absolutePath: string;
  extension: string;
  bytes: number;
};

export type WorkspaceIndex = {
  root: string;
  backend: "rg" | "walk";
  files: WorkspaceIndexFile[];
  warnings: string[];
};

export type WorkspaceSearchMatch = {
  path: string;
  absolutePath: string;
  line: number;
  snippet: string;
};

export async function buildWorkspaceIndex(input: {
  root: string;
  preferRg?: boolean;
  runner?: WorkspaceCommandRunner;
}): Promise<WorkspaceIndex> {
  const root = resolve(input.root);
  if (input.preferRg !== false) {
    const rg = await buildWithRg(root, input.runner ?? runCommand);
    if (rg) {
      return rg;
    }
  }
  return buildWithWalk(root);
}

export async function searchWorkspaceIndex(input: {
  root: string;
  query?: string;
  limit?: number;
  preferRg?: boolean;
  runner?: WorkspaceCommandRunner;
}): Promise<{
  backend: "rg" | "walk";
  indexedFiles: number;
  matches: WorkspaceSearchMatch[];
  warnings: string[];
}> {
  const index = await buildWorkspaceIndex({ root: input.root, preferRg: input.preferRg, runner: input.runner });
  const query = input.query?.toLowerCase().trim() ?? "";
  const matches: WorkspaceSearchMatch[] = [];

  for (const file of index.files) {
    if (matches.length >= (input.limit ?? 10)) {
      break;
    }
    const content = await readFile(file.absolutePath, "utf8").catch(() => undefined);
    if (content === undefined) {
      continue;
    }
    const lower = content.toLowerCase();
    const indexOfMatch = query ? lower.indexOf(query) : 0;
    if (indexOfMatch === -1) {
      continue;
    }
    const line = content.slice(0, indexOfMatch).split(/\r?\n/).length;
    matches.push({
      path: file.path,
      absolutePath: file.absolutePath,
      line,
      snippet: surroundingLines(content, line)
    });
  }

  return {
    backend: index.backend,
    indexedFiles: index.files.length,
    matches,
    warnings: index.warnings
  };
}

async function buildWithRg(root: string, runner: WorkspaceCommandRunner): Promise<WorkspaceIndex | undefined> {
  const result = await runner(
    "rg",
    [
      "--files",
      "--hidden",
      "--glob",
      "!.git/**",
      "--glob",
      "!node_modules/**",
      "--glob",
      "!dist/**",
      "--glob",
      "!dist-bench/**",
      "--glob",
      "!artifacts/**",
      "--glob",
      "!.tokenhub/**"
    ],
    { cwd: root }
  ).catch(() => undefined);
  if (!result || result.exitCode !== 0) {
    return undefined;
  }

  const files = await Promise.all(
    result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((path) => indexedFileFromRelative(root, path))
  );
  return {
    root,
    backend: "rg",
    files: files.filter((file): file is WorkspaceIndexFile => Boolean(file)).sort(compareIndexFiles),
    warnings: result.stderr.trim() ? [result.stderr.trim()] : []
  };
}

async function buildWithWalk(root: string): Promise<WorkspaceIndex> {
  const absoluteFiles = await walk(root);
  const files = await Promise.all(absoluteFiles.map((file) => indexedFileFromAbsolute(root, file)));
  return {
    root,
    backend: "walk",
    files: files.filter((file): file is WorkspaceIndexFile => Boolean(file)).sort(compareIndexFiles),
    warnings: []
  };
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

async function indexedFileFromRelative(root: string, relativePath: string): Promise<WorkspaceIndexFile | undefined> {
  if (isIgnoredRelativePath(relativePath)) {
    return undefined;
  }
  const absolutePath = resolve(root, relativePath);
  return indexedFileFromAbsolute(root, absolutePath);
}

async function indexedFileFromAbsolute(root: string, absolutePath: string): Promise<WorkspaceIndexFile | undefined> {
  const relativePath = relative(root, absolutePath);
  if (!isInsideWorkspace(relativePath) || isIgnoredRelativePath(relativePath)) {
    return undefined;
  }
  const info = await stat(absolutePath).catch(() => undefined);
  if (!info?.isFile()) {
    return undefined;
  }
  return {
    path: normalizePath(relativePath),
    absolutePath,
    extension: extname(absolutePath),
    bytes: info.size
  };
}

function isInsideWorkspace(relativePath: string): boolean {
  return relativePath !== "" && !relativePath.startsWith("..") && !isAbsolute(relativePath);
}

function isIgnoredRelativePath(relativePath: string): boolean {
  return normalizePath(relativePath)
    .split("/")
    .some((part) => IGNORED_DIRS.has(part));
}

function normalizePath(path: string): string {
  return path.split(sep).join("/");
}

function surroundingLines(content: string, line: number): string {
  const lines = content.split(/\r?\n/);
  const start = Math.max(1, line - 2);
  const end = Math.min(lines.length, line + 2);
  return lines.slice(start - 1, end).map((value, index) => `${start + index}: ${value}`).join("\n");
}

function compareIndexFiles(left: WorkspaceIndexFile, right: WorkspaceIndexFile): number {
  return left.path.localeCompare(right.path);
}

function runCommand(command: string, args: string[], options: { cwd: string }): Promise<WorkspaceCommandResult> {
  return new Promise((resolve) => {
    execFile(command, args, { cwd: options.cwd, windowsHide: true, maxBuffer: 1024 * 1024 * 8 }, (error, stdout, stderr) => {
      const errorCode = (error as NodeJS.ErrnoException | null)?.code;
      resolve({
        exitCode: error ? (typeof errorCode === "number" ? errorCode : 1) : 0,
        stdout,
        stderr
      });
    });
  });
}
