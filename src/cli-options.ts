export type CliArgsResult =
  | { kind: "start"; root: string }
  | { kind: "help"; text: string }
  | { kind: "version"; text: string }
  | { kind: "error"; code: "missing-root" | "unknown-argument" };

export function parseCliArgs(argv: string[], packageVersion: string): CliArgsResult {
  let root = process.cwd();

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

    return { kind: "error", code: "unknown-argument" };
  }

  return { kind: "start", root };
}

export function buildHelpText(packageVersion: string): string {
  return [
    `tokenhub-mcp ${packageVersion}`,
    "",
    "Usage:",
    "  npx tokenhub-mcp --root <path>",
    "",
    "Options:",
    "  --root <path>   Workspace root to serve.",
    "  -h, --help      Show this help.",
    "  -v, --version   Show the package version."
  ].join("\n");
}
