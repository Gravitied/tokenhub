import { isLogLevel, type DiagnosticLogLevel } from "./core/logger.js";

export type CliArgsResult =
  | { kind: "start"; root: string; logLevel?: Exclude<DiagnosticLogLevel, "silent">; extensionsPath?: string }
  | { kind: "help"; text: string }
  | { kind: "version"; text: string }
  | { kind: "error"; code: "missing-root" | "missing-log-level" | "missing-extensions" | "invalid-log-level" | "unknown-argument" };

export function parseCliArgs(argv: string[], packageVersion: string): CliArgsResult {
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

export function buildHelpText(packageVersion: string): string {
  return [
    `tokenhub-mcp ${packageVersion}`,
    "",
    "Usage:",
    "  npx tokenhub-mcp --root <path>",
    "",
    "Options:",
    "  --root <path>                Workspace root to serve.",
    "  --extensions <path>          Optional extension manifest path.",
    "  --log-level <error|info|debug>  Emit opt-in structured diagnostics to stderr.",
    "  -h, --help                   Show this help.",
    "  -v, --version                Show the package version."
  ].join("\n");
}
