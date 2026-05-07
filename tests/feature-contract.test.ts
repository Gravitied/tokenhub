import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  advertisedCapabilities,
  documentedRetrievalSources,
  publicMcpTools,
  readReadme,
  requiredReadmeHeadings
} from "./docs-contract.test.js";

const evidenceContracts = [
  { capability: "tools", files: ["src/server.ts"] },
  { capability: "workflows", files: ["src/workflows/index.ts"] },
  { capability: "retrieval sources", files: ["src/server.ts", "src/core/resources.ts"] },
  { capability: "eval artifacts", files: ["artifacts/evals/resolve-request-eval.json", "artifacts/evals/resolve-request-live-eval.json"] },
  { capability: "README sections", files: ["tests/docs-contract.test.ts", "README.md"] }
] as const;

const documentedWorkflowNames = [
  "resolve_request",
  "answer_from_web",
  "validate",
  "filesystem_action",
  "git_action",
  "project_scan"
] as const;

const retrievalSourceRuntimeNames: Record<(typeof documentedRetrievalSources)[number], string[]> = {
  browser: ["browser"],
  sqlite: ["sqlite"],
  postgres: ["postgres"],
  npm: ["docs"],
  github: ["github"],
  sentry: ["sentry"],
  filesystem: ["files"],
  git: ["git"],
  web: ["web", "search"]
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

  test("backs every documented retrieval source with the runtime source enum or schema", () => {
    const readme = readReadme();
    const server = readWorkspaceFile("src/server.ts");

    for (const source of documentedRetrievalSources) {
      expect(readme, `README missing retrieval source ${source}`).toContain(`\`${source}\``);
      for (const runtimeSource of retrievalSourceRuntimeNames[source]) {
        expect(server, `runtime source schema missing ${runtimeSource} for documented ${source}`).toContain(`"${runtimeSource}"`);
      }
    }
  });

  test("backs every README workflow with the runtime workflow dispatcher", () => {
    const readme = readReadme();
    const workflows = readWorkspaceFile("src/workflows/index.ts");

    for (const workflow of documentedWorkflowNames) {
      expect(readme, `README missing workflow ${workflow}`).toContain(`\`${workflow}\``);
      expect(workflows, `workflow dispatcher missing ${workflow}`).toContain(`input.name === "${workflow}"`);
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
