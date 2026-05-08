import { describe, expect, test } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { loadExtensionConfig } from "../src/extensions/config.js";
import { createTokenHubRuntime } from "../src/server.js";

function mcpFixtureServer(): string {
  const mcpModule = pathToFileURL(
    join(process.cwd(), "node_modules", "@modelcontextprotocol", "sdk", "dist", "esm", "server", "mcp.js")
  ).href;
  const stdioModule = pathToFileURL(
    join(process.cwd(), "node_modules", "@modelcontextprotocol", "sdk", "dist", "esm", "server", "stdio.js")
  ).href;
  const zodModule = pathToFileURL(join(process.cwd(), "node_modules", "zod", "index.js")).href;

  return `
import { McpServer } from ${JSON.stringify(mcpModule)};
import { StdioServerTransport } from ${JSON.stringify(stdioModule)};
import { z } from ${JSON.stringify(zodModule)};

const server = new McpServer({ name: "fixture-mcp", version: "1.0.0" });

server.registerTool(
  "lookup",
  {
    title: "Lookup",
    description: "Lookup fixture values.",
    inputSchema: { query: z.string() }
  },
  async ({ query }) => ({
    content: [{ type: "text", text: \`fixture lookup: \${query}\` }]
  })
);

await server.connect(new StdioServerTransport());
`;
}

describe("extension config", () => {
  test("loads command and mcp extension manifests from json", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tokenhub-extensions-"));
    try {
      const manifestPath = join(dir, "tokenhub.extensions.json");
      await writeFile(
        manifestPath,
        JSON.stringify({
          version: 1,
          extensions: [
            {
              id: "local-echo",
              type: "command",
              title: "Local Echo",
              command: "node",
              args: ["tools/echo.mjs"],
              inputSchema: { type: "object" },
              timeoutMs: 5000
            },
            {
              id: "demo-mcp",
              type: "mcp",
              title: "Demo MCP",
              command: "node",
              args: ["tools/demo-mcp.mjs"],
              env: ["DEMO_TOKEN"],
              tools: ["lookup"]
            }
          ]
        }),
        "utf8"
      );

      const config = await loadExtensionConfig({ root: dir, configPath: manifestPath });

      expect(config.extensions.map((extension) => extension.id)).toEqual(["local-echo", "demo-mcp"]);
      expect(config.extensions[0]).toMatchObject({ type: "command", timeoutMs: 5000 });
      expect(config.extensions[1]).toMatchObject({ type: "mcp", tools: ["lookup"] });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("returns an empty config when the default manifest is absent", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tokenhub-no-extensions-"));
    try {
      await expect(loadExtensionConfig({ root: dir })).resolves.toEqual({
        configPath: join(dir, "tokenhub.extensions.json"),
        extensions: [],
        warnings: []
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("extension runtime", () => {
  test("discovers and runs a configured local command extension", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tokenhub-command-extension-"));
    try {
      await mkdir(join(dir, "tools"), { recursive: true });
      await writeFile(
        join(dir, "tools", "echo.mjs"),
        [
          "let body = '';",
          "process.stdin.on('data', chunk => body += chunk);",
          "process.stdin.on('end', () => {",
          "  const input = JSON.parse(body || '{}');",
          "  console.log(JSON.stringify({ ok: true, message: input.message }));",
          "});"
        ].join("\n"),
        "utf8"
      );
      await writeFile(
        join(dir, "tokenhub.extensions.json"),
        JSON.stringify({
          version: 1,
          extensions: [
            {
              id: "local-echo",
              type: "command",
              title: "Local Echo",
              command: process.execPath,
              args: ["tools/echo.mjs"],
              inputSchema: { type: "object" },
              timeoutMs: 5000
            }
          ]
        }),
        "utf8"
      );

      const runtime = createTokenHubRuntime({ root: dir });
      const capabilities = runtime.discoverCapabilities({ query: "echo", limit: 5 });
      expect(capabilities.map((capability) => capability.id)).toContain("extension.local-echo.run");

      const result = await runtime.runWorkflow({
        name: "extension_call",
        extensionId: "local-echo",
        toolName: "run",
        input: { message: "hello" },
        budgetTokens: 200
      });

      expect(result.summary).toContain("hello");
      expect(result.resources[0].uri).toMatch(/^tokenhub:\/\/resource\//);
      expect(result.telemetry.estimatedSavedTokens).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("rejects unknown extension ids and unconfigured tool names", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tokenhub-extension-reject-"));
    try {
      await writeFile(
        join(dir, "tokenhub.extensions.json"),
        JSON.stringify({
          version: 1,
          extensions: [
            {
              id: "local-echo",
              type: "command",
              title: "Local Echo",
              command: process.execPath,
              args: ["-e", "console.log('ok')"]
            }
          ]
        }),
        "utf8"
      );
      const runtime = createTokenHubRuntime({ root: dir });

      await expect(
        runtime.runWorkflow({ name: "extension_call", extensionId: "missing", toolName: "run", input: {} })
      ).rejects.toThrow("Unknown extension: missing");

      await expect(
        runtime.runWorkflow({ name: "extension_call", extensionId: "local-echo", toolName: "delete_everything", input: {} })
      ).rejects.toThrow("Extension local-echo does not expose tool: delete_everything");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("passes only allowlisted env vars to command extensions and redacts their output", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tokenhub-command-extension-env-"));
    const previousSecret = process.env.EXTENSION_SECRET_TOKEN;
    process.env.EXTENSION_SECRET_TOKEN = "super-secret-value";
    try {
      await mkdir(join(dir, "tools"), { recursive: true });
      await writeFile(
        join(dir, "tools", "env-check.mjs"),
        "console.log(`EXTENSION_SECRET_TOKEN=${process.env.EXTENSION_SECRET_TOKEN ?? 'missing'}`);",
        "utf8"
      );
      await writeFile(
        join(dir, "tokenhub.extensions.json"),
        JSON.stringify({
          version: 1,
          extensions: [
            {
              id: "env-check",
              type: "command",
              title: "Env Check",
              command: process.execPath,
              args: ["tools/env-check.mjs"],
              env: ["EXTENSION_SECRET_TOKEN"]
            }
          ]
        }),
        "utf8"
      );
      const runtime = createTokenHubRuntime({ root: dir });

      const result = await runtime.runWorkflow({
        name: "extension_call",
        extensionId: "env-check",
        toolName: "run",
        input: {},
        includeRaw: true
      });

      expect(result.summary).toContain("[redacted]");
      expect(result.summary).not.toContain("super-secret-value");
      expect(JSON.stringify(result.data)).toContain("[redacted]");
      expect(JSON.stringify(result.data)).not.toContain("super-secret-value");
    } finally {
      if (previousSecret === undefined) {
        delete process.env.EXTENSION_SECRET_TOKEN;
      } else {
        process.env.EXTENSION_SECRET_TOKEN = previousSecret;
      }
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("discovers and calls an allowlisted MCP extension tool", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tokenhub-mcp-extension-"));
    try {
      await mkdir(join(dir, "tools"), { recursive: true });
      await writeFile(join(dir, "tools", "fixture-mcp.mjs"), mcpFixtureServer(), "utf8");
      await writeFile(
        join(dir, "tokenhub.extensions.json"),
        JSON.stringify({
          version: 1,
          extensions: [
            {
              id: "fixture-mcp",
              type: "mcp",
              title: "Fixture MCP",
              command: process.execPath,
              args: ["tools/fixture-mcp.mjs"],
              tools: ["lookup"]
            }
          ]
        }),
        "utf8"
      );

      const runtime = createTokenHubRuntime({ root: dir });
      const capabilities = runtime.discoverCapabilities({ query: "lookup", limit: 5 });
      expect(capabilities.map((capability) => capability.id)).toContain("extension.fixture-mcp.lookup");

      const result = await runtime.runWorkflow({
        name: "extension_call",
        extensionId: "fixture-mcp",
        toolName: "lookup",
        input: { query: "alpha" }
      });

      expect(result.summary).toContain("fixture lookup: alpha");
      expect(result.resources[0].uri).toMatch(/^tokenhub:\/\/resource\//);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
