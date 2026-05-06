import { describe, expect, test } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTokenHubRuntime } from "../src/server.js";
import { estimateTokens } from "../src/core/token.js";

describe("MCP runtime", () => {
  test("advertises exactly the six always-loaded top-level tools", () => {
    const runtime = createTokenHubRuntime({ root: process.cwd() });

    expect(runtime.publicToolNames()).toEqual([
      "discover_capabilities",
      "run_workflow",
      "retrieve_context",
      "read_resource",
      "capture_state",
      "estimate_cost"
    ]);
  });

  test("batches project scan workflow and returns resources for raw output", async () => {
    const runtime = createTokenHubRuntime({ root: process.cwd() });

    const result = await runtime.runWorkflow({
      name: "project_scan",
      budgetTokens: 180,
      includeRaw: false
    });

    expect(result.summary).toContain("Project scan");
    expect(result.resources.length).toBeGreaterThan(0);
    expect(result.telemetry.estimatedSavedTokens).toBeGreaterThan(result.telemetry.estimatedToolCostTokens);
  });

  test("returns compact file retrieval tuples when returnMode is compact", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tokenhub-compact-"));
    try {
      await writeFile(
        join(dir, "feature.ts"),
        "export const marker = 'TOKENHUB_BENCHMARK_NEEDLE';\nexport const secret = 'SECRET_VALUE_DO_NOT_RETURN';\n"
      );
      const runtime = createTokenHubRuntime({ root: dir });

      const result = await runtime.retrieveContext({
        source: "files",
        query: "TOKENHUB_BENCHMARK_NEEDLE",
        limit: 1,
        budgetTokens: 80,
        returnMode: "compact"
      });
      const text = JSON.stringify(result);

      expect(result).toHaveProperty("m");
      expect(result).not.toHaveProperty("matches");
      expect(text).toContain("TOKENHUB_BENCHMARK_NEEDLE");
      expect(text).toContain("feature.ts");
      expect(text).toContain("tokenhub://resource/");
      expect(text).not.toContain("SECRET_VALUE_DO_NOT_RETURN");
      expect(estimateTokens(text)).toBeLessThan(90);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
