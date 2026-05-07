import { describe, expect, test } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { ResourceStore } from "../src/core/resources.js";
import { searchFiles } from "../src/modules/filesystem.js";
import { summarizeGit } from "../src/modules/git.js";
import { cleanHtmlToText, fetchAndScrape } from "../src/modules/web.js";

const execFileAsync = promisify(execFile);

describe("filesystem retrieval", () => {
  test("returns token-budgeted snippets with resource links for matching files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tokenhub-fs-"));
    const store = new ResourceStore({ rootDir: join(dir, ".tokenhub", "resources") });
    try {
      await writeFile(join(dir, "alpha.ts"), "export const needle = 'found';\n".repeat(30));
      await writeFile(join(dir, "beta.txt"), "nothing here");

      const result = await searchFiles({
        root: dir,
        query: "needle",
        limit: 5,
        budgetTokens: 80,
        resourceStore: store
      });

      expect(result.matches).toHaveLength(1);
      expect(result.matches[0].path).toBe("alpha.ts");
      expect(result.matches[0].snippet).toContain("needle");
      expect(result.matches[0].resourceUri).toMatch(/^tokenhub:\/\/resource\//);
      expect(result.tokenEstimate).toBeLessThanOrEqual(90);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("redacts secret-looking values from model-facing snippets", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tokenhub-fs-redact-"));
    const store = new ResourceStore({ rootDir: join(dir, ".tokenhub", "resources") });
    try {
      await writeFile(
        join(dir, "secrets.ts"),
        "export const marker = 'TOKENHUB_BENCHMARK_NEEDLE';\nexport const password = 'SECRET_VALUE_DO_NOT_RETURN';\n"
      );

      const result = await searchFiles({
        root: dir,
        query: "TOKENHUB_BENCHMARK_NEEDLE",
        limit: 5,
        budgetTokens: 80,
        resourceStore: store
      });

      expect(result.matches[0].snippet).toContain("TOKENHUB_BENCHMARK_NEEDLE");
      expect(result.matches[0].snippet).not.toContain("SECRET_VALUE_DO_NOT_RETURN");
      expect(result.matches[0].snippet).toContain("[redacted]");

      const full = await store.read(result.matches[0].resourceUri, { mode: "full" });
      expect(full.content).not.toContain("SECRET_VALUE_DO_NOT_RETURN");
      expect(full.content).toContain("[redacted]");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("git retrieval", () => {
  test("summarizes status and log without returning raw command floods", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tokenhub-git-"));
    const store = new ResourceStore({ rootDir: join(dir, ".tokenhub", "resources") });
    try {
      await execFileAsync("git", ["init"], { cwd: dir });
      await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
      await execFileAsync("git", ["config", "user.name", "Test User"], { cwd: dir });
      await writeFile(join(dir, "README.md"), "# demo\n");
      await execFileAsync("git", ["add", "README.md"], { cwd: dir });
      await execFileAsync("git", ["commit", "-m", "init"], { cwd: dir });
      await writeFile(join(dir, "README.md"), "# demo\nchanged\n");

      const result = await summarizeGit({ root: dir, resourceStore: store, budgetTokens: 120 });

      expect(result.isRepo).toBe(true);
      expect(result.summary).toContain("modified");
      expect(result.summary).toContain("init");
      expect(result.rawResourceUri).toMatch(/^tokenhub:\/\/resource\//);
      expect(result.tokenEstimate).toBeLessThanOrEqual(130);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("web cleanup", () => {
  test("extracts clean text and title from html without script/style noise", () => {
    const result = cleanHtmlToText(`<!doctype html>
      <html><head><title>Docs Page</title><style>.x{}</style></head>
      <body><h1>API Docs</h1><script>bad()</script><p>Use the client.</p></body></html>`);

    expect(result.title).toBe("Docs Page");
    expect(result.text).toContain("API Docs");
    expect(result.text).toContain("Use the client.");
    expect(result.text).not.toContain("bad()");
  });

  test("times out stalled page fetches", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tokenhub-web-timeout-"));
    const store = new ResourceStore({ rootDir: join(dir, ".tokenhub", "resources") });
    try {
      await expect(
        fetchAndScrape({
          url: "https://example.test/slow",
          resourceStore: store,
          timeoutMs: 5,
          urlLookup: async () => [{ address: "93.184.216.34", family: 4 }],
          fetchImpl: () => new Promise<Response>(() => undefined)
        })
      ).rejects.toThrow(/timed out/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
