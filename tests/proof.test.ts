import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProofPage } from "../src/proof.js";

describe("proof page", () => {
  test("creates a deterministic html proof page from command results", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tokenhub-proof-"));
    try {
      const htmlPath = await createProofPage({
        outDir: dir,
        generatedAt: "2026-05-06T12:00:00.000Z",
        commands: [
          { command: "npm test", exitCode: 0, summary: "4 files passed" },
          { command: "npm run build", exitCode: 0, summary: "TypeScript compiled" }
        ],
        repoState: "clean"
      });

      expect(existsSync(htmlPath)).toBe(true);
      const html = readFileSync(htmlPath, "utf8");
      expect(html).toContain("TokenHub MCP Proof");
      expect(html).toContain("npm test");
      expect(html).toContain("4 files passed");
      expect(html).not.toContain("{");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
