import { describe, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBenchmarkFixtures } from "../src/bench/fixtures.js";
import {
  assertSignificantlyBetter,
  compareBenchmarkResults,
  scoreBenchmarkResult
} from "../src/bench/scoring.js";
import { createBenchmarkReport, freeCompetitorCatalog } from "../src/bench/competitors.js";

describe("benchmark scoring", () => {
  test("rewards expected facts, links, warnings, and compact token usage", () => {
    const tokenhub = scoreBenchmarkResult({
      name: "tokenhub",
      outputText: "summary alpha tokenhub://resource/123 warning: truncated",
      estimatedTokens: 120,
      expectedFacts: ["alpha"],
      requiredPatterns: [/tokenhub:\/\/resource\//],
      forbiddenPatterns: [/SECRET_VALUE/],
      lowerIsBetterTokenBaseline: 600
    });
    const baseline = scoreBenchmarkResult({
      name: "baseline",
      outputText: "summary alpha SECRET_VALUE " + "raw ".repeat(500),
      estimatedTokens: 600,
      expectedFacts: ["alpha"],
      requiredPatterns: [],
      forbiddenPatterns: [/SECRET_VALUE/],
      lowerIsBetterTokenBaseline: 600
    });

    expect(tokenhub.qualityScore).toBeGreaterThan(baseline.qualityScore);
    expect(tokenhub.tokenEfficiencyScore).toBeGreaterThan(baseline.tokenEfficiencyScore);
    expect(assertSignificantlyBetter(tokenhub, baseline).passed).toBe(true);
  });

  test("compares a result set and identifies weak TokenHub tasks", () => {
    const report = compareBenchmarkResults([
      {
        task: "filesystem-marker",
        tokenhub: scoreBenchmarkResult({
          name: "tokenhub",
          outputText: "missing",
          estimatedTokens: 200,
          expectedFacts: ["needle"],
          requiredPatterns: [/tokenhub:\/\/resource\//],
          forbiddenPatterns: []
        }),
        competitors: [
          scoreBenchmarkResult({
            name: "official-filesystem",
            outputText: "needle",
            estimatedTokens: 250,
            expectedFacts: ["needle"],
            requiredPatterns: [],
            forbiddenPatterns: []
          })
        ]
      }
    ]);

    expect(report.weakTasks).toEqual(["filesystem-marker"]);
    expect(report.taskResults[0].passed).toBe(false);
  });
});

describe("benchmark fixtures and report", () => {
  test("creates deterministic fixtures with marker, secret, git, and html content", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tokenhub-bench-"));
    try {
      const fixture = await createBenchmarkFixtures(dir);

      expect(fixture.marker).toBe("TOKENHUB_BENCHMARK_NEEDLE");
      expect(fixture.secret).toBe("SECRET_VALUE_DO_NOT_RETURN");
      expect(fixture.paths.sourceFile.endsWith("src/feature.ts")).toBe(true);
      expect(fixture.urls.fixturePage).toMatch(/^http:\/\/127\.0\.0\.1:/);

      await fixture.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("catalogs free MCP and CLI competitors without provider keys", () => {
    const names = freeCompetitorCatalog().map((competitor) => competitor.name);

    expect(names).toContain("official-filesystem-mcp");
    expect(names).toContain("official-git-mcp");
    expect(names).toContain("official-fetch-mcp");
    expect(names).toContain("git-grep-cli");
    expect(names).toContain("git-cli");
  });

  test("creates a compact benchmark report with pass/fail and source metadata", () => {
    const report = createBenchmarkReport({
      generatedAt: "2026-05-06T12:00:00.000Z",
      sources: ["https://github.com/modelcontextprotocol/servers"],
      tasks: [
        {
          task: "filesystem-marker",
          tokenhub: scoreBenchmarkResult({
            name: "tokenhub",
            outputText: "TOKENHUB_BENCHMARK_NEEDLE tokenhub://resource/abc",
            estimatedTokens: 80,
            expectedFacts: ["TOKENHUB_BENCHMARK_NEEDLE"],
            requiredPatterns: [/tokenhub:\/\/resource\//],
            forbiddenPatterns: []
          }),
          competitors: [
            scoreBenchmarkResult({
              name: "ripgrep-cli",
              outputText: "TOKENHUB_BENCHMARK_NEEDLE",
              estimatedTokens: 300,
              expectedFacts: ["TOKENHUB_BENCHMARK_NEEDLE"],
              requiredPatterns: [],
              forbiddenPatterns: []
            })
          ]
        }
      ]
    });

    expect(report.summary).toContain("1/1 tasks passed");
    expect(report.sources[0]).toContain("modelcontextprotocol");
  });
});
