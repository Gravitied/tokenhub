#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createRequire } from "node:module";
import { parseCliArgs, buildHelpText } from "./cli-options.js";
import { createMcpServer } from "./server.js";
import { createDiagnosticLogger, logLevelFromEnv } from "./core/logger.js";
import { lintExtensionManifest, testExtensionManifest } from "./extensions/doctor.js";
import { installMcpRegistryServer, searchMcpRegistry } from "./extensions/mcp-registry.js";

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

if (parsed.kind === "extensions-lint") {
  const result = await lintExtensionManifest({ root: parsed.root, configPath: parsed.extensionsPath });
  printExtensionChecks(result.checks);
  process.exit(result.ok ? 0 : 1);
}

if (parsed.kind === "extensions-test") {
  const result = await testExtensionManifest({
    root: parsed.root,
    configPath: parsed.extensionsPath,
    extensionId: parsed.extensionId,
    toolName: parsed.toolName,
    input: parsed.input
  });
  for (const item of result.results) {
    console.log(`${item.ok ? "ok" : "fail"} ${item.extensionId}.${item.toolName}: ${firstLine(item.summary)}`);
  }
  process.exit(result.ok ? 0 : 1);
}

if (parsed.kind === "registry-search") {
  const result = await searchMcpRegistry({ query: parsed.query, limit: parsed.limit });
  for (const server of result.servers) {
    console.log(`${server.name}\t${server.title}\t${server.packageIdentifier ?? "no stdio package"}`);
  }
  process.exit(0);
}

if (parsed.kind === "registry-install") {
  const result = await installMcpRegistryServer({
    root: parsed.root,
    configPath: parsed.extensionsPath,
    query: parsed.query,
    extensionId: parsed.extensionId,
    tools: parsed.tools
  });
  console.log(`installed ${result.extension.id} from ${result.server.name} into ${result.configPath}`);
  process.exit(0);
}

await startServer({ root: parsed.root, extensionsPath: parsed.extensionsPath, logLevel: parsed.logLevel ?? logLevelFromEnv() });

async function startServer(options: { root: string; extensionsPath?: string; logLevel: ReturnType<typeof logLevelFromEnv> }): Promise<void> {
  const logger = createDiagnosticLogger({ level: options.logLevel });
  logger.info("server.start", { root: options.root, extensionsPath: options.extensionsPath, logLevel: options.logLevel });
  const server = createMcpServer({ root: options.root, extensionConfigPath: options.extensionsPath, logger });
  await server.connect(new StdioServerTransport());
}

function formatCliError(code: Extract<typeof parsed, { kind: "error" }>["code"]): string {
  if (code === "missing-root") {
    return "Missing value for --root.";
  }
  if (code === "missing-log-level") {
    return "Missing value for --log-level.";
  }
  if (code === "missing-extensions") {
    return "Missing value for --extensions.";
  }
  if (code === "missing-extension") {
    return "Missing value for --extension.";
  }
  if (code === "missing-tool") {
    return "Missing value for --tool.";
  }
  if (code === "missing-input-json") {
    return "Missing value for --input-json.";
  }
  if (code === "invalid-input-json") {
    return "Invalid --input-json value; expected JSON.";
  }
  if (code === "missing-query") {
    return "Missing registry search/install query.";
  }
  if (code === "missing-limit") {
    return "Missing value for --limit.";
  }
  if (code === "invalid-limit") {
    return "Invalid --limit value; expected an integer from 1 to 100.";
  }
  if (code === "missing-id") {
    return "Missing value for --id.";
  }
  if (code === "missing-tools") {
    return "Missing value for --tools.";
  }
  if (code === "invalid-log-level") {
    return "Invalid --log-level value; use error, info, or debug.";
  }
  return "Unknown argument.";
}

function printExtensionChecks(checks: Array<{ level: string; extensionId?: string; message: string }>): void {
  for (const check of checks) {
    console.log(`${check.level} ${check.extensionId ? `${check.extensionId}: ` : ""}${check.message}`);
  }
}

function firstLine(value: string): string {
  return value.split(/\r?\n/)[0] ?? "";
}
