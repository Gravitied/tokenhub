import { describe, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ResourceStore } from "../src/core/resources.js";
import { runBrowserScenario } from "../src/modules/browser-scenario.js";

describe("browser scenario runner", () => {
  test("runs scripted browser steps and stores a trace resource", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tokenhub-browser-scenario-"));
    const store = new ResourceStore({ rootDir: join(dir, ".tokenhub", "resources") });
    const calls: string[] = [];
    try {
      const result = await runBrowserScenario({
        url: "https://example.test/app",
        resourceStore: store,
        urlLookup: async () => [{ address: "93.184.216.34", family: 4 }],
        launch: async () => fakeScenarioBrowser(calls, "Ready"),
        steps: [
          { action: "fill", selector: "#q", value: "tokenhub" },
          { action: "click", selector: "button" },
          { action: "expectText", text: "Ready" },
          { action: "screenshot", label: "after-click" }
        ]
      });

      expect(result.summary).toContain("Browser scenario passed");
      expect(calls).toEqual(["goto:https://example.test/app", "fill:#q:tokenhub", "click:button", "screenshot"]);
      expect(result.resources.map((resource) => resource.kind)).toEqual(["screenshot", "log"]);
      const trace = await store.read(result.resources.at(-1)?.uri ?? "", { mode: "full" });
      expect(trace.content).toContain("\"action\": \"expectText\"");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("fails clearly when an expected text step is absent", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tokenhub-browser-scenario-fail-"));
    const store = new ResourceStore({ rootDir: join(dir, ".tokenhub", "resources") });
    try {
      const result = await runBrowserScenario({
        url: "https://example.test/app",
        resourceStore: store,
        urlLookup: async () => [{ address: "93.184.216.34", family: 4 }],
        launch: async () => fakeScenarioBrowser([], "Different"),
        steps: [{ action: "expectText", text: "Ready" }]
      });

      expect(result.summary).toContain("Browser scenario failed");
      expect(result.warnings[0]).toContain("Expected text not found: Ready");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

function fakeScenarioBrowser(calls: string[], text: string) {
  const page = {
    async route() {
      return undefined;
    },
    async goto(url: string) {
      calls.push(`goto:${url}`);
    },
    locator(selector: string) {
      return {
        async click() {
          calls.push(`click:${selector}`);
        },
        async fill(value: string) {
          calls.push(`fill:${selector}:${value}`);
        },
        async press(key: string) {
          calls.push(`press:${selector}:${key}`);
        },
        async count() {
          return text.includes(selector.replace(/^text=/, "")) ? 1 : 0;
        }
      };
    },
    async screenshot() {
      calls.push("screenshot");
      return Buffer.from("png");
    },
    async title() {
      return "Fixture";
    },
    url() {
      return "https://example.test/app";
    },
    async close() {
      return undefined;
    }
  };
  return {
    async newPage() {
      return page;
    },
    async close() {
      return undefined;
    }
  };
}
