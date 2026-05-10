import { describe, expect, test } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ResourceStore } from "../src/core/resources.js";
import { createMcpServer } from "../src/server.js";

describe("MCP-native resources", () => {
  test("lists stored resources from the ResourceStore", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tokenhub-resource-list-"));
    try {
      const store = new ResourceStore({ rootDir: join(dir, ".tokenhub", "resources") });
      const link = await store.writeText({ kind: "text", label: "notes", content: "hello resources" });

      await expect(store.list()).resolves.toEqual([expect.objectContaining({ uri: link.uri, label: "notes" })]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("exposes TokenHub artifacts through MCP resource templates", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tokenhub-mcp-resources-"));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "resource-test-client", version: "1.0.0" });
    const server = createMcpServer({ root: dir });
    try {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
      const capture = await client.callTool({
        name: "capture_state",
        arguments: { label: "mcp native", text: "native resource body" }
      });
      const uri = (capture.structuredContent as { resources: Array<{ uri: string }> }).resources[0].uri;

      const templates = await client.listResourceTemplates();
      const listed = await client.listResources();
      const read = await client.readResource({ uri });

      expect(templates.resourceTemplates).toEqual([
        expect.objectContaining({ uriTemplate: "tokenhub://resource/{id}", name: "tokenhub-artifacts" })
      ]);
      expect(listed.resources).toEqual([expect.objectContaining({ uri, name: "mcp native" })]);
      expect(read.contents).toEqual([
        expect.objectContaining({ uri, mimeType: "text/plain", text: expect.stringContaining("native resource body") })
      ]);
    } finally {
      await client.close().catch(() => undefined);
      await server.close().catch(() => undefined);
      await rm(dir, { recursive: true, force: true });
    }
  });
});
