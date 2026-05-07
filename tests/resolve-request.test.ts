import { describe, expect, test } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ResourceStore } from "../src/core/resources.js";
import { TokenTelemetry } from "../src/core/telemetry.js";
import { runWorkflow } from "../src/workflows/index.js";

describe("resolve_request workflow", () => {
  test("resolves latest paper summary through dynamic routing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tokenhub-resolve-summary-"));
    const resourceStore = new ResourceStore({ rootDir: join(dir, ".tokenhub", "resources") });
    try {
      const result = await runWorkflow({
        name: "resolve_request",
        root: dir,
        request: "Give me a 1 paragraph summary of the latest DeepSeek research papers",
        provider: "tavily",
        apiKey: "test-key",
        resourceStore,
        telemetry: new TokenTelemetry({ roiThreshold: 3 }),
        urlLookup: testUrlLookup,
        fetchImpl: async (url) => {
          const urlText = url.toString();
          if (urlText.includes("api.tavily.com")) {
            return new Response(
              JSON.stringify({
                results: [
                  {
                    title: "DeepSeek-V3.2",
                    url: "https://arxiv.org/abs/2512.02556",
                    content: "DeepSeek-V3.2 introduces DeepSeek Sparse Attention and improved reasoning."
                  }
                ]
              }),
              { status: 200 }
            );
          }
          return new Response(
            "<html><title>DeepSeek-V3.2</title><body><p>Abstract: DeepSeek Sparse Attention improves long-context efficiency and reasoning.</p></body></html>",
            { status: 200, headers: { "content-type": "text/html" } }
          );
        }
      });

      expect(result.summary).toContain("DeepSeek");
      expect(result.summary).toContain("Sources:");
      expect(JSON.stringify(result.data)).toContain("requestPlan");
      expect(result.resources[0].uri).toMatch(/^tokenhub:\/\/resource\//);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("creates agent context for external implementation comparison without editing files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tokenhub-resolve-code-"));
    await writeFile(join(dir, "feature.ts"), "export function feature() { return 'basic'; }", "utf8");
    const resourceStore = new ResourceStore({ rootDir: join(dir, ".tokenhub", "resources") });
    try {
      const result = await runWorkflow({
        name: "resolve_request",
        root: dir,
        request: "Look for similar professional optimized implementations of this feature and compare it to this code, then implement the gaps",
        execution: "plan_only",
        resourceStore,
        telemetry: new TokenTelemetry({ roiThreshold: 3 }),
        urlLookup: testUrlLookup,
        fetchImpl: async (url) => {
          if (url.toString().includes("duckduckgo.com")) {
            return new Response(
              '<html><body><a class="result__a" href="https://example.test/pro-feature">Professional feature implementation</a><a class="result__snippet">Uses validation, caching, and typed errors.</a></body></html>',
              { status: 200 }
            );
          }
          return new Response("<html><body><pre>function feature(input) { validate(input); return cached(input); }</pre></body></html>", {
            status: 200
          });
        }
      });

      expect(result.summary).toContain("Request plan");
      expect(result.summary).toContain("implementation");
      expect(result.warnings).not.toContain("Files modified");
      expect(JSON.stringify(result.data)).toContain("patch_plan");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("executes planned package registry and docs sources", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tokenhub-resolve-package-"));
    const resourceStore = new ResourceStore({ rootDir: join(dir, ".tokenhub", "resources") });
    try {
      const result = await runWorkflow({
        name: "resolve_request",
        root: dir,
        request: "Collect npm package metadata for zod and return a table",
        resourceStore,
        telemetry: new TokenTelemetry({ roiThreshold: 3 }),
        urlLookup: testUrlLookup,
        fetchImpl: async (url) => {
          const urlText = url.toString();
          if (urlText.includes("registry.npmjs.org")) {
            return new Response(
              JSON.stringify({
                name: "zod",
                description: "TypeScript-first schema validation",
                "dist-tags": { latest: "4.0.0" },
                versions: { "3.0.0": {}, "4.0.0": {} },
                repository: { url: "git+https://github.com/colinhacks/zod.git" }
              }),
              { status: 200 }
            );
          }
          if (urlText.includes("duckduckgo.com")) {
            return new Response(
              '<a class="result__a" href="https://zod.dev/">Zod documentation</a><a class="result__snippet">Official Zod docs for schema validation.</a>',
              { status: 200 }
            );
          }
          return new Response("<title>Zod</title><main><p>Zod validates TypeScript schemas.</p></main>", { status: 200 });
        }
      });

      expect(result.summary).toContain("Package registry");
      expect(result.summary).toContain("zod@4.0.0");
      expect(JSON.stringify(result.data)).toContain("packageRegistry");
      expect(JSON.stringify(result.data)).toContain("docs");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("rejects implementation execution modes instead of returning fake success", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tokenhub-resolve-implement-"));
    const resourceStore = new ResourceStore({ rootDir: join(dir, ".tokenhub", "resources") });
    try {
      await expect(
        runWorkflow({
          name: "resolve_request",
          root: dir,
          request: "Fix this failing test and implement the smallest safe fix.",
          execution: "implement",
          resourceStore,
          telemetry: new TokenTelemetry({ roiThreshold: 3 })
        })
      ).rejects.toThrow(/not enabled/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

async function testUrlLookup() {
  return [{ address: "93.184.216.34", family: 4 as const }];
}
