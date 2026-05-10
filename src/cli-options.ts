import { isLogLevel, type DiagnosticLogLevel } from "./core/logger.js";

export type CliArgsResult =
  | { kind: "start"; root: string; logLevel?: Exclude<DiagnosticLogLevel, "silent">; extensionsPath?: string }
  | { kind: "extensions-lint"; root: string; logLevel?: Exclude<DiagnosticLogLevel, "silent">; extensionsPath?: string }
  | {
      kind: "extensions-test";
      root: string;
      logLevel?: Exclude<DiagnosticLogLevel, "silent">;
      extensionsPath?: string;
      extensionId?: string;
      toolName?: string;
      input?: unknown;
    }
  | { kind: "registry-search"; query: string; limit?: number }
  | { kind: "registry-install"; query: string; root: string; extensionsPath?: string; extensionId?: string; tools?: string[] }
  | { kind: "help"; text: string }
  | { kind: "version"; text: string }
  | {
      kind: "error";
      code:
        | "missing-root"
        | "missing-log-level"
        | "missing-extensions"
        | "missing-extension"
        | "missing-tool"
        | "missing-input-json"
        | "invalid-input-json"
        | "missing-query"
        | "missing-limit"
        | "invalid-limit"
        | "missing-id"
        | "missing-tools"
        | "invalid-log-level"
        | "unknown-argument";
    };

export function parseCliArgs(argv: string[], packageVersion: string): CliArgsResult {
  if (argv[0] === "extensions") {
    return parseExtensionsArgs(argv.slice(1), packageVersion);
  }
  if (argv[0] === "registry") {
    return parseRegistryArgs(argv.slice(1), packageVersion);
  }

  let root = process.cwd();
  let logLevel: Exclude<DiagnosticLogLevel, "silent"> | undefined;
  let extensionsPath: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      return { kind: "help", text: buildHelpText(packageVersion) };
    }

    if (arg === "--version" || arg === "-v") {
      return { kind: "version", text: packageVersion };
    }

    if (arg === "--root") {
      const value = argv[index + 1];
      if (!value || value.startsWith("-")) {
        return { kind: "error", code: "missing-root" };
      }
      root = value;
      index += 1;
      continue;
    }

    if (arg === "--log-level") {
      const value = argv[index + 1];
      if (!value || value.startsWith("-")) {
        return { kind: "error", code: "missing-log-level" };
      }
      if (!isLogLevel(value)) {
        return { kind: "error", code: "invalid-log-level" };
      }
      logLevel = value;
      index += 1;
      continue;
    }

    if (arg === "--extensions") {
      const value = argv[index + 1];
      if (!value || value.startsWith("-")) {
        return { kind: "error", code: "missing-extensions" };
      }
      extensionsPath = value;
      index += 1;
      continue;
    }

    return { kind: "error", code: "unknown-argument" };
  }

  return { kind: "start", root, ...(logLevel ? { logLevel } : {}), ...(extensionsPath ? { extensionsPath } : {}) };
}

function parseExtensionsArgs(argv: string[], packageVersion: string): CliArgsResult {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    return { kind: "help", text: buildHelpText(packageVersion) };
  }
  const command = argv[0];
  if (command !== "lint" && command !== "test") {
    return { kind: "error", code: "unknown-argument" };
  }
  let root = process.cwd();
  let logLevel: Exclude<DiagnosticLogLevel, "silent"> | undefined;
  let extensionsPath: string | undefined;
  let extensionId: string | undefined;
  let toolName: string | undefined;
  let input: unknown;

  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") {
      const value = argv[index + 1];
      if (!value || value.startsWith("-")) return { kind: "error", code: "missing-root" };
      root = value;
      index += 1;
      continue;
    }
    if (arg === "--extensions") {
      const value = argv[index + 1];
      if (!value || value.startsWith("-")) return { kind: "error", code: "missing-extensions" };
      extensionsPath = value;
      index += 1;
      continue;
    }
    if (arg === "--log-level") {
      const value = argv[index + 1];
      if (!value || value.startsWith("-")) return { kind: "error", code: "missing-log-level" };
      if (!isLogLevel(value)) return { kind: "error", code: "invalid-log-level" };
      logLevel = value;
      index += 1;
      continue;
    }
    if (arg === "--extension") {
      const value = argv[index + 1];
      if (!value || value.startsWith("-")) return { kind: "error", code: "missing-extension" };
      extensionId = value;
      index += 1;
      continue;
    }
    if (arg === "--tool") {
      const value = argv[index + 1];
      if (!value || value.startsWith("-")) return { kind: "error", code: "missing-tool" };
      toolName = value;
      index += 1;
      continue;
    }
    if (arg === "--input-json") {
      const value = argv[index + 1];
      if (!value || value.startsWith("-")) return { kind: "error", code: "missing-input-json" };
      try {
        input = JSON.parse(value);
      } catch {
        return { kind: "error", code: "invalid-input-json" };
      }
      index += 1;
      continue;
    }
    return { kind: "error", code: "unknown-argument" };
  }

  if (command === "lint") {
    return { kind: "extensions-lint", root, ...(logLevel ? { logLevel } : {}), ...(extensionsPath ? { extensionsPath } : {}) };
  }
  return {
    kind: "extensions-test",
    root,
    ...(logLevel ? { logLevel } : {}),
    ...(extensionsPath ? { extensionsPath } : {}),
    ...(extensionId ? { extensionId } : {}),
    ...(toolName ? { toolName } : {}),
    ...(input !== undefined ? { input } : {})
  };
}

function parseRegistryArgs(argv: string[], packageVersion: string): CliArgsResult {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    return { kind: "help", text: buildHelpText(packageVersion) };
  }
  const command = argv[0];
  if (command !== "search" && command !== "install") {
    return { kind: "error", code: "unknown-argument" };
  }
  const query = argv[1];
  if (!query || query.startsWith("-")) {
    return { kind: "error", code: "missing-query" };
  }
  let root = process.cwd();
  let extensionsPath: string | undefined;
  let extensionId: string | undefined;
  let tools: string[] | undefined;
  let limit: number | undefined;

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") {
      const value = argv[index + 1];
      if (!value || value.startsWith("-")) return { kind: "error", code: "missing-root" };
      root = value;
      index += 1;
      continue;
    }
    if (arg === "--extensions") {
      const value = argv[index + 1];
      if (!value || value.startsWith("-")) return { kind: "error", code: "missing-extensions" };
      extensionsPath = value;
      index += 1;
      continue;
    }
    if (arg === "--id") {
      const value = argv[index + 1];
      if (!value || value.startsWith("-")) return { kind: "error", code: "missing-id" };
      extensionId = value;
      index += 1;
      continue;
    }
    if (arg === "--tools") {
      const value = argv[index + 1];
      if (!value || value.startsWith("-")) return { kind: "error", code: "missing-tools" };
      tools = value.split(",").map((tool) => tool.trim()).filter(Boolean);
      index += 1;
      continue;
    }
    if (arg === "--limit") {
      const value = argv[index + 1];
      if (!value || value.startsWith("-")) return { kind: "error", code: "missing-limit" };
      limit = Number(value);
      if (!Number.isInteger(limit) || limit <= 0 || limit > 100) return { kind: "error", code: "invalid-limit" };
      index += 1;
      continue;
    }
    return { kind: "error", code: "unknown-argument" };
  }

  if (command === "search") {
    return { kind: "registry-search", query, ...(limit ? { limit } : {}) };
  }
  return {
    kind: "registry-install",
    query,
    root,
    ...(extensionsPath ? { extensionsPath } : {}),
    ...(extensionId ? { extensionId } : {}),
    ...(tools ? { tools } : {})
  };
}

export function buildHelpText(packageVersion: string): string {
  return [
    `tokenhub-mcp ${packageVersion}`,
    "",
    "Usage:",
    "  npx tokenhub-mcp --root <path>",
    "  tokenhub-mcp extensions lint --root <path>",
    "  tokenhub-mcp extensions test --root <path> --extension <id> --tool <name>",
    "  tokenhub-mcp registry search <query>",
    "  tokenhub-mcp registry install <query> --root <path>",
    "",
    "Options:",
    "  --root <path>                Workspace root to serve.",
    "  --extensions <path>          Optional extension manifest path.",
    "  --log-level <error|info|debug>  Emit opt-in structured diagnostics to stderr.",
    "  --input-json <json>          JSON object passed to an extension test.",
    "  --tools <a,b>                Comma-separated MCP tool allowlist for registry install.",
    "  -h, --help                   Show this help.",
    "  -v, --version                Show the package version."
  ].join("\n");
}
