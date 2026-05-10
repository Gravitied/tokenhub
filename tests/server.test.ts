import { describe, expect, test } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTokenHubRuntime } from "../src/server.js";
import { estimateTokens } from "../src/core/token.js";
import { createDiagnosticLogger } from "../src/core/logger.js";

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

  test("rejects filesystem mutation workflows by default", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tokenhub-workflow-actions-"));
    try {
      const runtime = createTokenHubRuntime({ root: dir });

      await expect(
        runtime.runWorkflow({
          name: "filesystem_action",
          action: "write",
          path: "notes.txt",
          content: "hello"
        })
      ).rejects.toThrow(
        "filesystem write is disabled by default; set TOKENHUB_ENABLE_FS_MUTATIONS=true only for trusted local workspaces."
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("routes explicitly enabled filesystem actions through run_workflow", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tokenhub-workflow-actions-enabled-"));
    const previous = process.env.TOKENHUB_ENABLE_FS_MUTATIONS;
    process.env.TOKENHUB_ENABLE_FS_MUTATIONS = "true";
    try {
      const runtime = createTokenHubRuntime({ root: dir });
      const write = await runtime.runWorkflow({
        name: "filesystem_action",
        action: "write",
        path: "notes.txt",
        content: "hello"
      });

      expect(write.summary).toContain("wrote notes.txt");
      await expect(
        runtime.runWorkflow({ name: "filesystem_action", action: "write", path: "../escape.txt" })
      ).rejects.toThrow(/outside workspace/);
    } finally {
      if (previous === undefined) {
        delete process.env.TOKENHUB_ENABLE_FS_MUTATIONS;
      } else {
        process.env.TOKENHUB_ENABLE_FS_MUTATIONS = previous;
      }
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("applies response profiles and metrics to retrieval results", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tokenhub-profile-"));
    try {
      await writeFile(join(dir, "feature.ts"), "export const needle = 'TOKENHUB_PROFILE_NEEDLE';\n");
      const runtime = createTokenHubRuntime({ root: dir });

      const result = await runtime.retrieveContext({
        source: "files",
        query: "TOKENHUB_PROFILE_NEEDLE",
        limit: 1,
        responseProfile: "minimal"
      });

      expect(result).toMatchObject({
        profile: "minimal",
        metrics: {
          estimatedTokens: expect.any(Number),
          source: "files"
        }
      });
      expect(result).toHaveProperty("m");
      expect(result).not.toHaveProperty("matches");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("exposes modular source and workflow registries through the runtime", () => {
    const runtime = createTokenHubRuntime({ root: process.cwd() });

    expect(runtime.sourceNames()).toEqual([
      "files",
      "git",
      "web",
      "github",
      "search",
      "sqlite",
      "postgres",
      "docs",
      "sentry",
      "browser"
    ]);
    expect(runtime.workflowNames()).toEqual([
      "validate",
      "filesystem_action",
      "git_action",
      "answer_from_web",
      "resolve_request",
      "extension_call",
      "project_scan",
      "browser_scenario",
      "diagnostics_pack"
    ]);
  });

  test("discovers and accepts the dynamic resolve_request workflow", async () => {
    const runtime = createTokenHubRuntime({ root: process.cwd() });

    const capabilities = runtime.discoverCapabilities({ query: "dynamic request router", limit: 5 });

    expect(JSON.stringify(capabilities)).toContain("resolve");
    expect(runtime.publicToolNames()).toContain("run_workflow");
  });

  test("emits opt-in structured diagnostics around runtime tool calls", async () => {
    const lines: string[] = [];
    const runtime = createTokenHubRuntime({
      root: process.cwd(),
      logger: createDiagnosticLogger({ level: "debug", sink: (line) => lines.push(line) })
    });

    runtime.estimateCost({ operation: "inspect apiKey=secret-value", expectedInputTokens: 100, expectedOutputTokens: 50 });

    expect(lines).toHaveLength(2);
    expect(lines.map((line) => JSON.parse(line).event)).toEqual(["tool.start", "tool.end"]);
    expect(lines.map((line) => JSON.parse(line).requestId)).toEqual(["req_1", "req_1"]);
    expect(lines[0]).toContain("\"tool\":\"estimate_cost\"");
    expect(lines.join("\n")).not.toContain("secret-value");
  });

  test("emits opt-in structured diagnostics for runtime tool failures", async () => {
    const lines: string[] = [];
    const runtime = createTokenHubRuntime({
      root: process.cwd(),
      logger: createDiagnosticLogger({ level: "debug", sink: (line) => lines.push(line) })
    });

    await expect(runtime.retrieveContext({ source: "web" })).rejects.toThrow("retrieve_context source=web requires url.");

    expect(lines.map((line) => JSON.parse(line).event)).toEqual(["tool.start", "tool.error"]);
    expect(JSON.parse(lines[1])).toMatchObject({
      level: "error",
      event: "tool.error",
      requestId: "req_1",
      tool: "retrieve_context",
      error: "retrieve_context source=web requires url."
    });
  });
});
