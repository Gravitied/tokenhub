import { describe, expect, test } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  installMcpRegistryServer,
  registryServerToExtension,
  searchMcpRegistry
} from "../src/extensions/mcp-registry.js";
import { createTokenHubRuntime } from "../src/server.js";

describe("MCP Registry install flow", () => {
  test("searches and normalizes registry server responses", async () => {
    const result = await searchMcpRegistry({
      query: "filesystem",
      fetchImpl: async (url) => {
        expect(url.toString()).toContain("/v0/servers?");
        expect(url.toString()).toContain("search=filesystem");
        return new Response(JSON.stringify({ servers: [registryFixture()], metadata: { count: 1 } }), { status: 200 });
      }
    });

    expect(result.servers).toEqual([
      expect.objectContaining({
        name: "io.github.example/filesystem",
        title: "Filesystem",
        description: "Filesystem access",
        packageIdentifier: "@example/filesystem-mcp"
      })
    ]);
  });

  test("maps an npm stdio registry package to a TokenHub MCP extension", () => {
    const extension = registryServerToExtension(registryFixture(), { id: "filesystem", tools: ["read_file"] });

    expect(extension).toEqual({
      id: "filesystem",
      type: "mcp",
      title: "Filesystem",
      summary: "Filesystem access",
      command: "npx",
      args: ["-y", "@example/filesystem-mcp@1.2.3"],
      env: [],
      tools: ["read_file"],
      timeoutMs: 30000
    });
  });

  test("installs a registry server into the extension manifest with wildcard tools", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tokenhub-registry-install-"));
    try {
      await installMcpRegistryServer({
        root: dir,
        query: "filesystem",
        fetchImpl: async () => new Response(JSON.stringify({ servers: [registryFixture()], metadata: { count: 1 } }), { status: 200 })
      });

      const manifest = JSON.parse(await readFile(join(dir, "tokenhub.extensions.json"), "utf8")) as {
        extensions: Array<{ id: string; tools: string[] }>;
      };
      expect(manifest.extensions[0]).toMatchObject({ id: "filesystem", tools: ["*"] });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("wildcard MCP extensions discover as generic capabilities and still verify advertised tools at call time", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tokenhub-registry-wildcard-"));
    try {
      await mkdir(join(dir, "tools"), { recursive: true });
      await writeFile(join(dir, "tools", "server.mjs"), wildcardMcpFixtureServer(), "utf8");
      await writeFile(
        join(dir, "tokenhub.extensions.json"),
        JSON.stringify({
          version: 1,
          extensions: [
            {
              id: "wildcard",
              type: "mcp",
              title: "Wildcard MCP",
              command: process.execPath,
              args: ["tools/server.mjs"],
              tools: ["*"]
            }
          ]
        }),
        "utf8"
      );
      const runtime = createTokenHubRuntime({ root: dir });

      expect(runtime.discoverCapabilities({ query: "wildcard", limit: 5 }).map((capability) => capability.id)).toContain(
        "extension.wildcard.tool"
      );
      const result = await runtime.runWorkflow({
        name: "extension_call",
        extensionId: "wildcard",
        toolName: "lookup",
        input: { query: "ok" }
      });

      expect(result.summary).toContain("wildcard lookup: ok");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

function registryFixture() {
  return {
    server: {
      name: "io.github.example/filesystem",
      title: "Filesystem",
      description: "Filesystem access",
      version: "1.2.3",
      packages: [
        {
          registryType: "npm",
          identifier: "@example/filesystem-mcp",
          version: "1.2.3",
          transport: { type: "stdio" }
        }
      ]
    },
    _meta: { "io.modelcontextprotocol.registry/official": true }
  };
}

function wildcardMcpFixtureServer(): string {
  return `
import { McpServer } from ${JSON.stringify(toFileUrl("node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js"))};
import { StdioServerTransport } from ${JSON.stringify(toFileUrl("node_modules/@modelcontextprotocol/sdk/dist/esm/server/stdio.js"))};
import { z } from ${JSON.stringify(toFileUrl("node_modules/zod/index.js"))};

const server = new McpServer({ name: "wildcard-fixture", version: "1.0.0" });
server.registerTool("lookup", { inputSchema: { query: z.string() } }, async ({ query }) => ({
  content: [{ type: "text", text: \`wildcard lookup: \${query}\` }]
}));
await server.connect(new StdioServerTransport());
`;
}

function toFileUrl(relativePath: string): string {
  return new URL(relativePath.replaceAll("\\", "/"), `file:///${process.cwd().replaceAll("\\", "/")}/`).href;
}
