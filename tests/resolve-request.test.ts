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
});
