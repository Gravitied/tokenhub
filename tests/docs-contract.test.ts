import { existsSync, readFileSync } from "node:fs";
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

describe("public release repository contract", () => {
  test("includes standard community and security files for a public release", () => {
    const requiredFiles = ["CHANGELOG.md", "CONTRIBUTING.md", "SECURITY.md", "CODE_OF_CONDUCT.md", ".github/workflows/ci.yml"];

    for (const file of requiredFiles) {
      expect(existsSync(join(process.cwd(), file)), `missing public release file: ${file}`).toBe(true);
    }
  });

  test("documents the public release support surfaces from the README", () => {
    const readme = readReadme();

    for (const file of ["CHANGELOG.md", "CONTRIBUTING.md", "SECURITY.md", "CODE_OF_CONDUCT.md"]) {
      expect(readme, `README should link ${file}`).toContain(file);
    }
  });

  test("keeps repository URLs aligned with the GitHub release repository", () => {
    const packageJson = readFileSync(join(process.cwd(), "package.json"), "utf8");
    const webModule = readFileSync(join(process.cwd(), "src", "modules", "web.ts"), "utf8");
    const expectedRepository = "https://github.com/Gravitied/tokenhub";

    expect(packageJson).toContain(expectedRepository);
    expect(webModule).toContain(expectedRepository);
  });

  test("installs Playwright browsers in CI before running browser integration tests", () => {
    const workflow = readFileSync(join(process.cwd(), ".github", "workflows", "ci.yml"), "utf8");

    expect(workflow).toContain("actions/checkout@v6");
    expect(workflow).toContain("actions/setup-node@v6");
    expect(workflow).toContain("node-version: [20, 22, 24]");
    expect(workflow).toContain("npx playwright install --with-deps chromium");
    expect(workflow).toContain("npx playwright install chromium");
    expect(workflow.indexOf("Install Playwright browsers")).toBeLessThan(workflow.indexOf("run: npm test"));
  });
});
