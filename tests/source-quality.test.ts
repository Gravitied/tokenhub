import { describe, expect, test } from "vitest";
import { scoreSourceQuality } from "../src/bench/source-quality.js";

describe("source quality scoring", () => {
  test("passes relevant live-looking sources with resource-backed snippets", () => {
    const result = scoreSourceQuality({
      request: "Compare Vitest and Jest for TypeScript projects",
      expectedKeywords: ["Vitest", "Jest", "TypeScript"],
      preferredDomains: ["vitest.dev", "jestjs.io"],
      sources: [
        { title: "Vitest Guide", url: "https://vitest.dev/guide/", resourceUri: "tokenhub://resource/a" },
        { title: "Jest Docs", url: "https://jestjs.io/docs/getting-started", resourceUri: "tokenhub://resource/b" }
      ],
      contextSnippets: [
        { title: "Vitest Guide", url: "https://vitest.dev/guide/", snippet: "Vitest supports TypeScript projects and modern ESM workflows." },
        { title: "Jest Docs", url: "https://jestjs.io/docs/getting-started", snippet: "Jest provides testing APIs for JavaScript and TypeScript." }
      ],
      summary: "Vitest and Jest both support TypeScript testing."
    });

    expect(result.passed).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(80);
    expect(result.checks.every((check) => check.ok)).toBe(true);
  });

  test("fails synthetic or thin evidence even when the summary contains keywords", () => {
    const result = scoreSourceQuality({
      request: "Summarize current Node docs",
      expectedKeywords: ["Node"],
      sources: [{ title: "Fake", url: "https://example.test/node", resourceUri: "tokenhub://resource/a" }],
      contextSnippets: [],
      summary: "Node docs summary."
    });

    expect(result.passed).toBe(false);
    expect(result.score).toBeLessThan(70);
    expect(result.checks.some((check) => check.reason.includes("synthetic"))).toBe(true);
  });
});
