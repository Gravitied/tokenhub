#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createRequire } from "node:module";
import { parseCliArgs, buildHelpText } from "./cli-options.js";
import { createMcpServer } from "./server.js";
import { createDiagnosticLogger, logLevelFromEnv } from "./core/logger.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

const parsed = parseCliArgs(process.argv.slice(2), version);

if (parsed.kind === "help") {
  console.log(parsed.text);
  process.exit(0);
}

if (parsed.kind === "version") {
  console.log(parsed.text);
  process.exit(0);
}

if (parsed.kind === "error") {
  console.error(formatCliError(parsed.code));
  console.error(buildHelpText(version));
  process.exit(1);
}

await startServer({ root: parsed.root, extensionsPath: parsed.extensionsPath, logLevel: parsed.logLevel ?? logLevelFromEnv() });

async function startServer(options: { root: string; extensionsPath?: string; logLevel: ReturnType<typeof logLevelFromEnv> }): Promise<void> {
  const logger = createDiagnosticLogger({ level: options.logLevel });
  logger.info("server.start", { root: options.root, extensionsPath: options.extensionsPath, logLevel: options.logLevel });
  const server = createMcpServer({ root: options.root, extensionConfigPath: options.extensionsPath, logger });
  await server.connect(new StdioServerTransport());
}

function formatCliError(code: "missing-root" | "missing-log-level" | "missing-extensions" | "invalid-log-level" | "unknown-argument"): string {
  if (code === "missing-root") {
    return "Missing value for --root.";
  }
  if (code === "missing-log-level") {
    return "Missing value for --log-level.";
  }
  if (code === "missing-extensions") {
    return "Missing value for --extensions.";
  }
  if (code === "invalid-log-level") {
    return "Invalid --log-level value; use error, info, or debug.";
  }
  return "Unknown argument.";
}
