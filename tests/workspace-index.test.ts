import { describe, expect, test } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ResourceStore } from "../src/core/resources.js";
import { buildWorkspaceIndex, searchWorkspaceIndex, type WorkspaceCommandRunner } from "../src/core/workspace-index.js";
import { searchFiles } from "../src/modules/filesystem.js";

describe("workspace index", () => {
  test("indexes workspace files with stable POSIX paths and ignores generated directories", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tokenhub-workspace-index-"));
    try {
      await mkdir(join(dir, "src"), { recursive: true });
      await mkdir(join(dir, "node_modules", "pkg"), { recursive: true });
      await mkdir(join(dir, ".git"), { recursive: true });
      await writeFile(join(dir, "src", "app.ts"), "export const needle = true;\n", "utf8");
      await writeFile(join(dir, "node_modules", "pkg", "index.js"), "ignored\n", "utf8");
      await writeFile(join(dir, ".git", "HEAD"), "ignored\n", "utf8");

      const index = await buildWorkspaceIndex({ root: dir, preferRg: false });

      expect(index.backend).toBe("walk");
      expect(index.files.map((file) => file.path)).toEqual(["src/app.ts"]);
      expect(index.files[0]).toEqual(expect.objectContaining({ extension: ".ts", bytes: expect.any(Number) }));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("uses rg output when a command runner supplies it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tokenhub-workspace-rg-"));
    const runner: WorkspaceCommandRunner = async (_command, args) => {
      expect(args).toContain("--files");
      return { exitCode: 0, stdout: "src/app.ts\nREADME.md\nnode_modules/pkg/index.js\n", stderr: "" };
    };
    try {
      await mkdir(join(dir, "src"), { recursive: true });
      await writeFile(join(dir, "src", "app.ts"), "export const marker = 'needle';\n", "utf8");
      await writeFile(join(dir, "README.md"), "# Demo\n", "utf8");

      const result = await searchWorkspaceIndex({ root: dir, query: "needle", limit: 5, runner });

      expect(result.backend).toBe("rg");
      expect(result.matches).toEqual([
        expect.objectContaining({ path: "src/app.ts", line: 1, snippet: expect.stringContaining("needle") })
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("searchFiles reports the backend used without changing resource output", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tokenhub-search-files-index-"));
    const store = new ResourceStore({ rootDir: join(dir, ".tokenhub", "resources") });
    try {
      await writeFile(join(dir, "notes.txt"), "alpha\nneedle\nomega\n", "utf8");

      const result = await searchFiles({ root: dir, query: "needle", limit: 1, resourceStore: store, preferRg: false });

      expect(result.backend).toBe("walk");
      expect(result.indexedFiles).toBe(1);
      expect(result.matches[0].resourceUri).toMatch(/^tokenhub:\/\/resource\//);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
