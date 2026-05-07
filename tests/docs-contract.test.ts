import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

export const requiredReadmeHeadings = [
  "## Install",
  "## Quick Start",
  "## MCP Client Configuration",
  "## Tools",
  "## Workflows",
  "## Retrieval Sources",
  "## Environment Variables",
  "## Security Notes",
  "## Troubleshooting",
  "## Release Verification"
] as const;

export const advertisedCapabilities = [
  "resolve_request",
  "answer_from_web",
  "web_fetch",
  "web_search",
  "filesystem",
  "git"
] as const;

export const documentedRetrievalSources = [
  "browser",
  "sqlite",
  "postgres",
  "npm",
  "github",
  "sentry",
  "filesystem",
  "git",
  "web"
] as const;

export const publicMcpTools = [
  "discover_capabilities",
  "run_workflow",
  "retrieve_context",
  "read_resource",
  "capture_state",
  "estimate_cost"
] as const;

export function readReadme(): string {
  return readFileSync(join(process.cwd(), "README.md"), "utf8");
}

describe("README contract", () => {
  test("contains the required production documentation sections", () => {
    const readme = readReadme();

    for (const heading of requiredReadmeHeadings) {
      expect(readme, `missing README heading: ${heading}`).toContain(heading);
    }
  });

  test("documents advertised capabilities and the actual public MCP tool surface", () => {
    const readme = readReadme();

    for (const capability of advertisedCapabilities) {
      expect(readme, `missing advertised capability: ${capability}`).toContain(`\`${capability}\``);
    }

    for (const tool of publicMcpTools) {
      expect(readme, `missing public MCP tool: ${tool}`).toContain(`\`${tool}\``);
    }
  });

  test("documents every advertised retrieval source", () => {
    const readme = readReadme();

    for (const source of documentedRetrievalSources) {
      expect(readme, `missing retrieval source: ${source}`).toContain(`\`${source}\``);
    }
  });
});
