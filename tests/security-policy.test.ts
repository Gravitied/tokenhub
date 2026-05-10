import { describe, expect, test } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSecurityPolicy } from "../src/core/security-policy.js";
import { assertAllowedNetworkUrl } from "../src/core/url-policy.js";
import { createTokenHubRuntime } from "../src/server.js";

describe("security policy", () => {
  test("denies configured workflows before dispatch", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tokenhub-policy-workflow-"));
    try {
      await writeFile(join(dir, "tokenhub.policy.json"), JSON.stringify({ version: 1, workflows: { deny: ["validate"] } }), "utf8");
      const runtime = createTokenHubRuntime({ root: dir });

      await expect(runtime.runWorkflow({ name: "validate", command: "npm", args: ["test"] })).rejects.toThrow(
        "Workflow validate is denied by security policy."
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("denies configured retrieval sources before dispatch", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tokenhub-policy-source-"));
    try {
      await writeFile(join(dir, "tokenhub.policy.json"), JSON.stringify({ version: 1, sources: { deny: ["files"] } }), "utf8");
      const runtime = createTokenHubRuntime({ root: dir });

      await expect(runtime.retrieveContext({ source: "files", query: "needle" })).rejects.toThrow(
        "Retrieval source files is denied by security policy."
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("denies configured extensions before adapter execution", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tokenhub-policy-extension-"));
    try {
      await writeFile(
        join(dir, "tokenhub.extensions.json"),
        JSON.stringify({
          version: 1,
          extensions: [{ id: "local-echo", type: "command", title: "Local Echo", command: process.execPath, args: ["-e", ""] }]
        }),
        "utf8"
      );
      await writeFile(join(dir, "tokenhub.policy.json"), JSON.stringify({ version: 1, extensions: { deny: ["local-echo"] } }), "utf8");
      const runtime = createTokenHubRuntime({ root: dir });

      await expect(
        runtime.runWorkflow({ name: "extension_call", extensionId: "local-echo", toolName: "run", input: {} })
      ).rejects.toThrow("Extension local-echo is denied by security policy.");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("enforces allowed host policy for network URLs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tokenhub-policy-network-"));
    try {
      await writeFile(
        join(dir, "tokenhub.policy.json"),
        JSON.stringify({ version: 1, network: { allowedHosts: ["example.com"] } }),
        "utf8"
      );
      const policy = loadSecurityPolicy({ root: dir });

      await expect(
        assertAllowedNetworkUrl("https://blocked.example/path", {
          networkPolicy: policy.networkPolicy(),
          lookupAddress: async () => [{ address: "93.184.216.34", family: 4 }]
        })
      ).rejects.toThrow("URL is not allowed: blocked.example is not in security policy allowedHosts.");

      await expect(
        assertAllowedNetworkUrl("https://example.com/path", {
          networkPolicy: policy.networkPolicy(),
          lookupAddress: async () => [{ address: "93.184.216.34", family: 4 }]
        })
      ).resolves.toBeInstanceOf(URL);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
