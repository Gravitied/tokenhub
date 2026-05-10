import { describe, expect, test } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ResourceStore } from "../src/core/resources.js";
import { createDiagnosticsPack } from "../src/core/diagnostics-pack.js";
import { createTokenHubRuntime } from "../src/server.js";

describe("diagnostics packs", () => {
  test("creates a structured redacted diagnostics artifact", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tokenhub-diagnostics-"));
    const store = new ResourceStore({ rootDir: join(dir, ".tokenhub", "resources") });
    const previous = process.env.TOKENHUB_SAMPLE_TOKEN;
    process.env.TOKENHUB_SAMPLE_TOKEN = "secret-value";
    try {
      await writeFile(join(dir, "README.md"), "# diagnostics\n", "utf8");
      const result = await createDiagnosticsPack({
        root: dir,
        resourceStore: store,
        sourceNames: ["files", "git"],
        workflowNames: ["project_scan", "diagnostics_pack"],
        extensionPoolStats: []
      });

      expect(result.summary).toContain("Diagnostics pack captured");
      expect(result.pack.runtime.node).toMatch(/^v/);
      expect(result.pack.workspace.indexedFiles).toBe(1);
      expect(JSON.stringify(result.pack)).not.toContain("secret-value");
      expect(result.resources[0].uri).toMatch(/^tokenhub:\/\/resource\//);
    } finally {
      if (previous === undefined) {
        delete process.env.TOKENHUB_SAMPLE_TOKEN;
      } else {
        process.env.TOKENHUB_SAMPLE_TOKEN = previous;
      }
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("exposes diagnostics as a workflow", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tokenhub-diagnostics-workflow-"));
    try {
      const runtime = createTokenHubRuntime({ root: dir });
      const result = await runtime.runWorkflow({ name: "diagnostics_pack" });

      expect(result.summary).toContain("Diagnostics pack captured");
      expect(result.resources[0].kind).toBe("json");
      expect(result.data).toMatchObject({ runtime: expect.any(Object), workspace: expect.any(Object) });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
