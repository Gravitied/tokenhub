import { describe, expect, test } from "vitest";
import { createTokenHubRuntime } from "../src/server.js";

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
});
