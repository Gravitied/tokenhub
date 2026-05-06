import { describe, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CapabilityRegistry } from "../src/core/registry.js";
import { ResourceStore } from "../src/core/resources.js";
import { TokenTelemetry } from "../src/core/telemetry.js";
import { estimateTokens, truncateToTokens } from "../src/core/token.js";

describe("token utilities", () => {
  test("estimates tokens and truncates with a deterministic marker", () => {
    const text = "alpha ".repeat(120);
    expect(estimateTokens(text)).toBeGreaterThan(100);

    const truncated = truncateToTokens(text, 10);
    expect(estimateTokens(truncated.text)).toBeLessThanOrEqual(12);
    expect(truncated.truncated).toBe(true);
    expect(truncated.text).toContain("[truncated");
  });
});

describe("token telemetry", () => {
  test("graduates a capability only when estimated savings clear the ROI threshold", () => {
    const telemetry = new TokenTelemetry({ roiThreshold: 3 });

    const weak = telemetry.record({
      capability: "web.search",
      estimatedToolCostTokens: 100,
      estimatedSavedTokens: 250,
      outputTokens: 40
    });
    const strong = telemetry.record({
      capability: "filesystem.search",
      estimatedToolCostTokens: 100,
      estimatedSavedTokens: 350,
      outputTokens: 32
    });

    expect(weak.graduated).toBe(false);
    expect(strong.graduated).toBe(true);
    expect(telemetry.summary().graduatedCapabilities).toEqual(["filesystem.search"]);
  });
});

describe("capability registry", () => {
  test("returns compact ranked manifests without exposing internal schemas", () => {
    const registry = new CapabilityRegistry();
    registry.register({
      id: "filesystem.search",
      module: "filesystem",
      title: "Search files",
      summary: "Find matching files and snippets under a workspace.",
      keywords: ["files", "repo", "search", "grep"],
      costHintTokens: 40,
      inputSchema: { hidden: "large schema" }
    });
    registry.register({
      id: "browser.screenshot",
      module: "browser",
      title: "Capture screenshot",
      summary: "Capture a compact browser screenshot artifact.",
      keywords: ["browser", "screenshot", "page"],
      costHintTokens: 90,
      inputSchema: { hidden: "large schema" }
    });

    const results = registry.discover("find matching source files", { limit: 1 });

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("filesystem.search");
    expect(results[0]).not.toHaveProperty("inputSchema");
    expect(results[0].score).toBeGreaterThan(0);
  });
});

describe("resource store", () => {
  test("writes large artifacts and progressively reads snippets, ranges, and full content", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tokenhub-resources-"));
    const store = new ResourceStore({ rootDir: dir });
    try {
      const content = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join("\n");
      const link = await store.writeText({
        kind: "text",
        label: "sample log",
        content,
        source: "unit-test"
      });

      expect(link.uri).toMatch(/^tokenhub:\/\/resource\//);
      expect(link.sha256).toHaveLength(64);

      const snippet = await store.read(link.uri, { mode: "snippet", budgetTokens: 8 });
      expect(snippet.truncated).toBe(true);
      expect(snippet.content).toContain("[truncated");

      const range = await store.read(link.uri, { mode: "range", startLine: 10, endLine: 12 });
      expect(range.content).toBe("line 10\nline 11\nline 12");

      const full = await store.read(link.uri, { mode: "full" });
      expect(full.content).toBe(content);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
