import { describe, expect, test } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ResourceStore } from "../src/core/resources.js";
import { fetchAndScrape } from "../src/modules/web.js";
import { createTokenHubRuntime } from "../src/server.js";

describe("security boundaries", () => {
  test("validate workflow rejects arbitrary command execution", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tokenhub-security-validate-"));
    try {
      const runtime = createTokenHubRuntime({ root: dir });

      await expect(
        runtime.runWorkflow({
          name: "validate",
          command: process.execPath,
          args: ["-e", "console.log('TOKENHUB_VALIDATE_EXECUTED')"]
        })
      ).rejects.toThrow(/validate supports only/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("web retrieval rejects localhost and private network targets before fetching", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tokenhub-security-web-"));
    const store = new ResourceStore({ rootDir: join(dir, ".tokenhub", "resources") });
    try {
      let fetched = false;

      await expect(
        fetchAndScrape({
          url: "http://127.0.0.1:4567/metadata",
          resourceStore: store,
          fetchImpl: async () => {
            fetched = true;
            return new Response("<title>metadata</title><p>INTERNAL_METADATA_SECRET=leak-me</p>", { status: 200 });
          }
        })
      ).rejects.toThrow(/not allowed/);
      expect(fetched).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("browser retrieval rejects localhost targets before launching a browser", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tokenhub-security-browser-"));
    try {
      const runtime = createTokenHubRuntime({ root: dir });

      await expect(
        runtime.retrieveContext({
          source: "browser",
          url: "http://localhost:3000/admin"
        })
      ).rejects.toThrow(/not allowed/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("resource manifests cannot traverse outside the resource store", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tokenhub-security-resource-"));
    const rootDir = join(dir, "resources");
    const id = "11111111-1111-4111-8111-111111111111";
    const uri = `tokenhub://resource/${id}`;
    const store = new ResourceStore({ rootDir });
    try {
      await mkdir(rootDir, { recursive: true });
      await writeFile(join(dir, "secret.txt"), "OUTSIDE_SECRET_TOKEN=leak-me", "utf8");
      await writeFile(
        join(rootDir, `${id}.json`),
        JSON.stringify(
          {
            uri,
            kind: "text",
            label: "poisoned manifest",
            bytes: 0,
            tokens: 0,
            sha256: "0".repeat(64),
            contentFile: "../secret.txt"
          },
          null,
          2
        ),
        "utf8"
      );

      await expect(store.read(uri, { mode: "full" })).rejects.toThrow(/Invalid resource manifest/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("public workflow callers cannot enable filesystem mutations per request", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tokenhub-security-fs-"));
    try {
      const runtime = createTokenHubRuntime({ root: dir });
      const untrustedInput = {
        name: "filesystem_action",
        action: "write",
        path: "notes.txt",
        content: "hello",
        allowUnsafeMutations: true
      } as unknown as Parameters<typeof runtime.runWorkflow>[0];

      await expect(runtime.runWorkflow(untrustedInput)).rejects.toThrow(/TOKENHUB_ENABLE_FS_MUTATIONS=true/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
