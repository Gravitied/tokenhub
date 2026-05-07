#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createRequire } from "node:module";
import { parseCliArgs, buildHelpText } from "./cli-options.js";
import { createMcpServer } from "./server.js";

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

await startServer({ root: parsed.root });

async function startServer(options: { root: string }): Promise<void> {
  const server = createMcpServer(options);
  await server.connect(new StdioServerTransport());
}

function formatCliError(code: "missing-root" | "unknown-argument"): string {
  if (code === "missing-root") {
    return "Missing value for --root.";
  }
  return "Unknown argument.";
}
