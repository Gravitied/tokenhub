import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  advertisedCapabilities,
  publicMcpTools,
  readReadme,
  requiredReadmeHeadings
} from "./docs-contract.test.js";

const evidenceContracts = [
  { capability: "tools", files: ["src/server.ts"] },
  { capability: "workflows", files: ["src/workflows/index.ts"] },
  { capability: "retrieval sources", files: ["src/server.ts", "src/core/resources.ts"] },
  { capability: "extension system", files: ["src/extensions/config.ts", "src/extensions/manager.ts", "src/workflows/index.ts"] },
  { capability: "eval artifacts", files: ["artifacts/evals/resolve-request-eval.json", "artifacts/evals/resolve-request-live-eval.json"] },
  { capability: "README sections", files: ["tests/docs-contract.test.ts", "README.md"] }
] as const;

const retrievalSourceAliases: Record<string, string> = {
  filesystem: "files",
  npm: "docs",
  web_fetch: "web",
  web_search: "search"
};

function readWorkspaceFile(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

function flattenPassedValues(value: unknown): boolean[] {
  if (typeof value !== "object" || value === null) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap(flattenPassedValues);
  }

  const record = value as Record<string, unknown>;
  const direct = typeof record.passed === "boolean" ? [record.passed] : [];
  const allPassed = typeof record.allPassed === "boolean" ? [record.allPassed] : [];
  return [...direct, ...allPassed, ...Object.values(record).flatMap(flattenPassedValues)];
}

function markdownSection(markdown: string, heading: string): string {
  const normalized = markdown.replace(/\r\n/g, "\n");
  const start = normalized.indexOf(`${heading}\n`);
  expect(start, `missing markdown section ${heading}`).toBeGreaterThanOrEqual(0);
  const afterHeading = start + heading.length + 1;
  const nextHeading = normalized.slice(afterHeading).search(/^## /m);
  return nextHeading === -1 ? normalized.slice(afterHeading) : normalized.slice(afterHeading, afterHeading + nextHeading);
}

function markdownTableRows(section: string): string[][] {
  return section
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && line.endsWith("|"))
    .filter((line) => !/^\|\s*-/.test(line))
    .slice(1)
    .map((line) =>
      line
        .slice(1, -1)
        .split("|")
        .map((cell) => cell.trim())
    );
}

function backtickedValues(text: string): string[] {
  return [...text.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
}

function runtimeSourceFor(documentedSource: string): string {
  return retrievalSourceAliases[documentedSource] ?? documentedSource;
}

describe("feature evidence contract", () => {
  test("keeps every evidence file present for advertised capability groups", () => {
    for (const contract of evidenceContracts) {
      for (const file of contract.files) {
        const fullPath = join(process.cwd(), file);
        expect(existsSync(fullPath), `${contract.capability} evidence missing: ${file}`).toBe(true);
        expect(readFileSync(fullPath, "utf8").trim().length, `${contract.capability} evidence is empty: ${file}`).toBeGreaterThan(0);
      }
    }
  });

  test("backs every public MCP tool documented in README with src/server.ts registration", () => {
    const readme = readReadme();
    const server = readWorkspaceFile("src/server.ts");

    for (const tool of publicMcpTools) {
      expect(readme, `README missing public MCP tool ${tool}`).toContain(`\`${tool}\``);
      expect(server, `server is missing public tool constant ${tool}`).toContain(`"${tool}"`);
      expect(server, `server is missing registerTool for ${tool}`).toMatch(
        new RegExp(`server\\.registerTool\\(\\s*"${tool}"`)
      );
    }
  });

  test("backs documented resource handles with ResourceStore read and write evidence", () => {
    const readme = readReadme();
    const resources = readWorkspaceFile("src/core/resources.ts");

    expect(readme, "README should document TokenHub resource handles").toContain("`tokenhub://resource/...`");
    expect(resources, "ResourceStore class should back documented resource handles").toContain("export class ResourceStore");
    expect(resources, "ResourceStore should write text resources").toContain("async writeText");
    expect(resources, "ResourceStore should read stored resources").toContain("async read");
    expect(resources, "ResourceStore should mint tokenhub resource URIs").toContain("tokenhub://resource/");
    expect(resources, "ResourceStore should write resource manifests/content").toContain("writeFile");
    expect(resources, "ResourceStore should read resource manifests/content").toContain("readFile");
  });

  test("derives retrieval sources from README and backs them with the runtime source schema", () => {
    const readme = readReadme();
    const retrievalRows = markdownTableRows(markdownSection(readme, "## Retrieval Sources"));
    const server = readWorkspaceFile("src/server.ts");

    expect(retrievalRows.length, "README Retrieval Sources table should contain source rows").toBeGreaterThan(0);

    for (const row of retrievalRows) {
      const [documentedSourceCell, runtimeSourceCell] = row;
      const documentedSources = backtickedValues(documentedSourceCell);
      const runtimeSources = backtickedValues(runtimeSourceCell);

      expect(documentedSources.length, `row should document source aliases: ${documentedSourceCell}`).toBeGreaterThan(0);
      expect(runtimeSources.length, `row should document runtime source schema names: ${runtimeSourceCell}`).toBeGreaterThan(0);

      for (const runtimeSource of runtimeSources) {
        expect(server, `runtime source schema missing ${runtimeSource}`).toContain(`"${runtimeSource}"`);
      }

      for (const documentedSource of documentedSources) {
        const expectedRuntimeSource = runtimeSourceFor(documentedSource);
        expect(
          runtimeSources,
          `documented source ${documentedSource} should map explicitly to runtime source ${expectedRuntimeSource}`
        ).toContain(expectedRuntimeSource);
      }
    }
  });

  test("derives workflow names from README and backs each one with the runtime workflow dispatcher", () => {
    const readme = readReadme();
    const workflowRows = markdownTableRows(markdownSection(readme, "## Workflows"));
    const workflows = readWorkspaceFile("src/workflows/index.ts");

    expect(workflowRows.length, "README Workflows table should contain workflow rows").toBeGreaterThan(0);

    for (const row of workflowRows) {
      const [workflowCell] = row;
      const workflowNames = backtickedValues(workflowCell);

      expect(workflowNames.length, `workflow row should start with a backticked workflow name: ${workflowCell}`).toBe(1);
      const [workflow] = workflowNames;
      expect(workflows, `workflow registry missing ${workflow}`).toContain(`"${workflow}"`);
      expect(workflows, "workflow dispatcher should use the registry").toContain("registry.register");
    }
  });

  test("keeps advertised capability labels and README contract sections evidenced in docs", () => {
    const readme = readReadme();
    const docsContract = readWorkspaceFile("tests/docs-contract.test.ts");

    for (const capability of advertisedCapabilities) {
      expect(readme, `README missing advertised capability ${capability}`).toContain(`\`${capability}\``);
      expect(docsContract, `docs contract missing advertised capability ${capability}`).toContain(`"${capability}"`);
    }

    for (const heading of requiredReadmeHeadings) {
      expect(readme, `README missing heading ${heading}`).toContain(heading);
      expect(docsContract, `docs contract missing heading ${heading}`).toContain(`"${heading}"`);
    }
  });

  test("keeps local and live resolve_request eval artifacts passing", () => {
    const artifactPaths = ["artifacts/evals/resolve-request-eval.json", "artifacts/evals/resolve-request-live-eval.json"];

    for (const artifactPath of artifactPaths) {
      const artifact = JSON.parse(readWorkspaceFile(artifactPath)) as unknown;
      const passValues = flattenPassedValues(artifact);

      expect(passValues.length, `${artifactPath} should contain generated pass evidence`).toBeGreaterThan(0);
      expect(passValues.every(Boolean), `${artifactPath} contains failing generated eval cases`).toBe(true);
    }
  });
});
