import { describe, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ResourceStore } from "../src/core/resources.js";
import { TokenTelemetry } from "../src/core/telemetry.js";
import { searchWeb } from "../src/modules/search.js";
import { answerFromWeb } from "../src/modules/answer-web.js";
import { runWorkflow } from "../src/workflows/index.js";

describe("search provider limits", () => {
  test("passes requested limits through provider calls", async () => {
    let requestBody: { max_results?: number } | undefined;
    const result = await searchWeb({
      query: "top 10 most healthy vegetables",
      provider: "tavily",
      apiKey: "test-key",
      limit: 10,
      fetchImpl: async (_url, init) => {
        requestBody = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({
            results: Array.from({ length: 10 }, (_value, index) => ({
              title: `Result ${index + 1}`,
              url: `https://example.com/${index + 1}`,
              content: `Snippet ${index + 1}`
            }))
          }),
          { status: 200 }
        );
      }
    });

    expect(requestBody?.max_results).toBe(10);
    expect(result.results).toHaveLength(10);
  });
});

describe("answer from web", () => {
  test("summarizes latest research papers from searched and scraped sources with context links", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tokenhub-answer-summary-"));
    const resourceStore = new ResourceStore({ rootDir: join(dir, ".tokenhub", "resources") });
    try {
      const result = await answerFromWeb({
        query: "1 paragraph summary of the latest DeepSeek research papers",
        target: "summary",
        limit: 1,
        sourceLimit: 3,
        provider: "tavily",
        apiKey: "test-key",
        resourceStore,
        fetchImpl: async (url, init) => {
          const urlText = url.toString();
          if (urlText.includes("api.tavily.com")) {
            expect(JSON.parse(String(init?.body)).max_results).toBeGreaterThanOrEqual(6);
            return new Response(
              JSON.stringify({
                results: [
                  {
                    title: "DeepSeek-V3.2: Pushing the Frontier of Open Large Language Models",
                    url: "https://arxiv.org/abs/2512.02556",
                    content: "DeepSeek-V3.2 introduces sparse attention and stronger reasoning for open LLMs."
                  },
                  {
                    title: "DeepSeek new models offer inference cost savings",
                    url: "https://example.test/deepseek-inference",
                    content: "The paper describes compressed sparse attention and heavy compressed attention."
                  },
                  {
                    title: "The DeepSeek Series: A Technical Overview",
                    url: "https://example.test/deepseek-overview",
                    content: "The overview connects DeepSeek-V3, R1 reasoning, and efficient MoE training."
                  }
                ]
              }),
              { status: 200 }
            );
          }
          return new Response(deepSeekPaperHtml(urlText), { status: 200, headers: { "content-type": "text/html" } });
        }
      });

      expect(result.target).toBe("summary");
      expect(result.items).toEqual([]);
      expect(result.summary.split(/\n\n/)[0].split(/[.!?]+/).filter(Boolean).length).toBeLessThanOrEqual(4);
      expect(result.summary).toContain("DeepSeek");
      expect(result.summary).toContain("sparse attention");
      expect(result.summary).toContain("reasoning");
      expect(result.summary).toContain("Sources:");
      expect(result.sources).toHaveLength(3);
      expect(result.sources.every((source) => source.resourceUri?.startsWith("tokenhub://resource/"))).toBe(true);
      expect(result.contextSnippets.length).toBeGreaterThanOrEqual(3);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("searches, scrapes, aggregates, and returns a cited top 10 vegetable list", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tokenhub-answer-web-"));
    const resourceStore = new ResourceStore({ rootDir: join(dir, ".tokenhub", "resources") });
    try {
      const result = await answerFromWeb({
        query: "top 10 most healthy vegetables",
        target: "ranked_list",
        limit: 10,
        sourceLimit: 3,
        provider: "tavily",
        apiKey: "test-key",
        resourceStore,
        fetchImpl: async (url, init) => {
          const urlText = url.toString();
          if (urlText.includes("api.tavily.com")) {
            expect(JSON.parse(String(init?.body)).max_results).toBeGreaterThanOrEqual(10);
            return new Response(
              JSON.stringify({
                results: [
                  { title: "Dietitian top 10 vegetables", url: "https://source.test/one", content: "Ranked vegetable list" },
                  { title: "Science backed vegetables", url: "https://source.test/two", content: "Healthy vegetables" },
                  { title: "CDC style vegetable density", url: "https://source.test/three", content: "Nutrient dense vegetables" }
                ]
              }),
              { status: 200 }
            );
          }
          return new Response(pageHtml(urlText), { status: 200, headers: { "content-type": "text/html" } });
        }
      });

      const names = result.items.map((item) => item.name);
      expect(result.items).toHaveLength(10);
      expect(names).toEqual(expect.arrayContaining(["Spinach", "Kale", "Broccoli", "Carrots", "Brussels sprouts"]));
      expect(names).not.toContain("Dietitian top 10 vegetables");
      expect(result.items[0].sources[0].url).toMatch(/^https:\/\/source\.test\//);
      expect(result.sources).toHaveLength(3);
      expect(result.summary).toContain("1.");
      expect(result.summary).toContain("Sources:");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("runs through the answer_from_web workflow surface", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tokenhub-answer-workflow-"));
    const resourceStore = new ResourceStore({ rootDir: join(dir, ".tokenhub", "resources") });
    try {
      const result = await runWorkflow({
        name: "answer_from_web",
        root: dir,
        query: "top 10 most healthy vegetables",
        target: "ranked_list",
        limit: 10,
        sourceLimit: 3,
        provider: "tavily",
        apiKey: "test-key",
        resourceStore,
        telemetry: new TokenTelemetry({ roiThreshold: 3 }),
        fetchImpl: async (url, init) => {
          const urlText = url.toString();
          if (urlText.includes("api.tavily.com")) {
            return new Response(
              JSON.stringify({
                results: [
                  { title: "Dietitian top 10 vegetables", url: "https://source.test/one", content: "Ranked vegetable list" },
                  { title: "Science backed vegetables", url: "https://source.test/two", content: "Healthy vegetables" },
                  { title: "CDC style vegetable density", url: "https://source.test/three", content: "Nutrient dense vegetables" }
                ]
              }),
              { status: 200 }
            );
          }
          expect(init?.headers).toEqual(expect.objectContaining({ "user-agent": expect.any(String) }));
          return new Response(pageHtml(urlText), { status: 200 });
        }
      });

      expect(result.summary).toContain("1.");
      expect(JSON.stringify(result.data)).toContain("Spinach");
      expect(result.resources[0].uri).toMatch(/^tokenhub:\/\/resource\//);
      expect(result.telemetry.capability).toBe("workflow.answer_from_web");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

function pageHtml(url: string): string {
  const lists: Record<string, string[]> = {
    "https://source.test/one": [
      "Spinach",
      "Kale",
      "Broccoli",
      "Carrots",
      "Sweet potatoes",
      "Brussels sprouts",
      "Garlic",
      "Beets",
      "Bell peppers",
      "Asparagus"
    ],
    "https://source.test/two": [
      "Kale",
      "Spinach",
      "Broccoli",
      "Watercress",
      "Carrots",
      "Red cabbage",
      "Brussels sprouts",
      "Garlic",
      "Bell peppers",
      "Sweet potatoes"
    ],
    "https://source.test/three": [
      "Watercress",
      "Spinach",
      "Swiss chard",
      "Beet greens",
      "Kale",
      "Broccoli",
      "Carrots",
      "Asparagus",
      "Brussels sprouts",
      "Beets"
    ]
  };
  return `<!doctype html><html><head><title>${url}</title><script>secret()</script></head><body><main><ol>${lists[url]
    .map((item) => `<li>${item}</li>`)
    .join("")}</ol></main></body></html>`;
}

function deepSeekPaperHtml(url: string): string {
  const pages: Record<string, string> = {
    "https://arxiv.org/abs/2512.02556":
      "DeepSeek-V3.2 pushes the frontier of open large language models. The paper reports better reasoning, agentic tool use, and efficient sparse attention while preserving open model availability.",
    "https://example.test/deepseek-inference":
      "DeepSeek researchers describe compressed sparse attention and heavy compressed attention. These mechanisms reduce inference cost, KV-cache memory, and long-context overhead.",
    "https://example.test/deepseek-overview":
      "The DeepSeek technical series connects V3 mixture-of-experts training with R1 reasoning models. It highlights efficient training, reinforcement learning for reasoning, and open research directions."
  };
  return `<!doctype html><html><head><title>${url}</title></head><body><article><p>${pages[url]}</p></article></body></html>`;
}
