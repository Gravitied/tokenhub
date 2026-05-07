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
  if (hasMismatchedAbsolutePath(requestedPath, pathApi)) {
    return outsideWorkspace(requestedPath);
  }

  const resolvedRoot = pathApi.resolve(root);
  const resolvedTarget = pathApi.resolve(resolvedRoot, requestedPath);
  const relativePath = pathApi.relative(resolvedRoot, resolvedTarget);

  if (isInsideWorkspace(relativePath, pathApi, pathApi === path.win32)) {
    return { ok: true, path: resolvedTarget };
  }

  return outsideWorkspace(requestedPath);
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
  if (options.platform === "native") {
    return path;
  }
  if (hasWindowsShape(root)) {
    return path.win32;
  }
  if (hasPosixShape(root)) {
    return path.posix;
  }
  return path;
}

function hasWindowsShape(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value) || /^[/\\]{2}[^/\\]+[/\\][^/\\]+/.test(value);
}

function hasPosixShape(value: string): boolean {
  return value.startsWith("/");
}

function hasMismatchedAbsolutePath(requestedPath: string, pathApi: path.PlatformPath): boolean {
  if (pathApi === path.posix) {
    return hasWindowsShape(requestedPath);
  }
  if (pathApi === path.win32) {
    return hasPosixShape(requestedPath) && !hasWindowsShape(requestedPath);
  }
  return hasWindowsShape(requestedPath) && !path.isAbsolute(requestedPath);
}

function isInsideWorkspace(relativePath: string, pathApi: path.PlatformPath, windowsComparison: boolean): boolean {
  const comparable = windowsComparison ? relativePath.toLowerCase() : relativePath;
  return comparable === "" || (!comparable.startsWith("..") && !pathApi.isAbsolute(relativePath));
}

function outsideWorkspace(requestedPath: string): WorkspacePathResult {
  return {
    ok: false,
    reason: "outside-workspace",
    message: `Refusing filesystem action outside workspace: ${requestedPath}`
  };
}
