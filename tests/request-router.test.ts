import { describe, expect, test } from "vitest";
import { inferRequestPlan } from "../src/core/request-router.js";
import { normalizeRequestHints } from "../src/core/request-shape.js";

describe("request shape", () => {
  test("normalizes empty hints into safe defaults", () => {
    expect(normalizeRequestHints({})).toEqual({
      depth: "standard",
      evidence: "resource_links",
      execution: "answer_only"
    });
  });

  test("preserves explicit advanced hints", () => {
    expect(
      normalizeRequestHints({
        depth: "deep",
        evidence: "snippets",
        execution: "implement_and_verify"
      })
    ).toEqual({
      depth: "deep",
      evidence: "snippets",
      execution: "implement_and_verify"
    });
  });
});

describe("request router", () => {
  test("infers web research summary for latest papers", () => {
    const plan = inferRequestPlan({
      request: "Give me a 1 paragraph summary of the latest DeepSeek research papers"
    });

    expect(plan.intent).toBe("research");
    expect(plan.subject).toBe("paper");
    expect(plan.outputShape).toBe("paragraph");
    expect(plan.sources).toEqual(expect.arrayContaining(["web_search", "web_pages"]));
    expect(plan.searchQueries[0]).toContain("DeepSeek research papers");
    expect(plan.execution).toBe("answer_only");
  });

  test("infers external code comparison with implementation plan", () => {
    const plan = inferRequestPlan({
      request:
        "Look for similar professional optimized implementations of this feature and compare it to this code, then implement the gaps",
      hints: { execution: "implement_and_verify" }
    });

    expect(plan.intent).toBe("implement");
    expect(plan.subject).toBe("code");
    expect(plan.outputShape).toBe("patch_plan");
    expect(plan.sources).toEqual(expect.arrayContaining(["local_files", "web_search", "github_code", "docs"]));
    expect(plan.execution).toBe("implement_and_verify");
    expect(plan.depth).toBe("deep");
  });

  test("routes current official docs requests to web evidence instead of local-only context", () => {
    const plan = inferRequestPlan({
      request: "Find current Vitest official config docs for TypeScript projects and summarize setup"
    });

    expect(plan.subject).toBe("docs");
    expect(plan.sources).toEqual(expect.arrayContaining(["docs", "web_search"]));
    expect(plan.sources).not.toEqual(["local_files"]);
  });
});
