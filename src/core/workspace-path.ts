import path from "node:path";

export type WorkspacePathResult =
  | { ok: true; path: string }
  | { ok: false; reason: "outside-workspace" | "invalid-path"; message: string };

export type WorkspacePathOptions = {
  platform?: "native" | "posix" | "win32";
};

export function resolveWorkspacePath(root: string, requestedPath: string, options: WorkspacePathOptions = {}): WorkspacePathResult {
  if (hasInvalidPathInput(root) || hasInvalidPathInput(requestedPath)) {
    return { ok: false, reason: "invalid-path", message: "Path contains invalid characters." };
  }

  const pathApi = selectPathApi(root, requestedPath, options);
  const resolvedRoot = pathApi.resolve(root);
  const resolvedTarget = pathApi.resolve(resolvedRoot, requestedPath);
  const relativePath = pathApi.relative(resolvedRoot, resolvedTarget);

  if (isInsideWorkspace(relativePath, pathApi, pathApi === path.win32)) {
    return { ok: true, path: resolvedTarget };
  }

  return {
    ok: false,
    reason: "outside-workspace",
    message: `Refusing filesystem action outside workspace: ${requestedPath}`
  };
}

function hasInvalidPathInput(value: string): boolean {
  return value.length === 0 || value.includes("\0");
}

function selectPathApi(root: string, requestedPath: string, options: WorkspacePathOptions): path.PlatformPath {
  if (options.platform === "posix") {
    return path.posix;
  }
  if (options.platform === "win32") {
    return path.win32;
  }
  if (hasWindowsShape(root) || hasWindowsShape(requestedPath)) {
    return path.win32;
  }
  if (hasPosixShape(root) && !hasWindowsShape(requestedPath)) {
    return path.posix;
  }
  return path;
}

function hasWindowsShape(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value) || /^\\\\[^\\]+\\[^\\]+/.test(value);
}

function hasPosixShape(value: string): boolean {
  return value.startsWith("/");
}

function isInsideWorkspace(relativePath: string, pathApi: path.PlatformPath, windowsComparison: boolean): boolean {
  const comparable = windowsComparison ? relativePath.toLowerCase() : relativePath;
  return comparable === "" || (!comparable.startsWith("..") && !pathApi.isAbsolute(relativePath));
}
