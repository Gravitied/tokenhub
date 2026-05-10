import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { ResourceLink, ResourceStore } from "../core/resources.js";
import { estimateTokens, truncateToTokens } from "../core/token.js";
import type { McpExtensionConfig } from "./config.js";
import { redactSecrets, type ExtensionAdapterResult } from "./command-adapter.js";
import { buildExtensionEnvironment } from "./environment.js";

type McpToolResult = Awaited<ReturnType<Client["callTool"]>>;
type McpContentBlock = Extract<McpToolResult, { content: unknown[] }>["content"][number];
type PooledClient = {
  extensionId: string;
  client: Client;
  toolNames: Set<string>;
  createdAt: number;
  lastUsedAt: number;
  uses: number;
};

export async function runMcpExtension(input: {
  root: string;
  extension: McpExtensionConfig;
  toolName: string;
  toolInput: unknown;
  budgetTokens?: number;
  includeRaw?: boolean;
  resourceStore: ResourceStore;
  pool?: McpExtensionPool;
}): Promise<ExtensionAdapterResult> {
  if (!input.extension.tools.includes("*") && !input.extension.tools.includes(input.toolName)) {
    throw new Error(`Extension ${input.extension.id} does not expose tool: ${input.toolName}`);
  }

  if (input.extension.pool?.enabled && input.pool) {
    return input.pool.call(input);
  }

  const pooled = await createPooledClient(input.root, input.extension);
  try {
    return await callWithClient({
      ...input,
      client: pooled.client,
      toolNames: pooled.toolNames
    });
  } finally {
    await pooled.client.close().catch(() => undefined);
  }
}

export class McpExtensionPool {
  private readonly clients = new Map<string, PooledClient>();

  async call(input: {
    root: string;
    extension: McpExtensionConfig;
    toolName: string;
    toolInput: unknown;
    budgetTokens?: number;
    includeRaw?: boolean;
    resourceStore: ResourceStore;
  }): Promise<ExtensionAdapterResult> {
    const entry = await this.clientFor(input.root, input.extension);
    const result = await callWithClient({
      ...input,
      client: entry.client,
      toolNames: entry.toolNames
    });
    entry.uses += 1;
    entry.lastUsedAt = Date.now();
    if (entry.uses >= (input.extension.pool?.maxUses ?? 100)) {
      await this.closeEntry(input.extension.id);
    }
    return result;
  }

  stats(): Array<{ extensionId: string; uses: number; active: boolean }> {
    return [...this.clients.values()].map((entry) => ({
      extensionId: entry.extensionId,
      uses: entry.uses,
      active: true
    }));
  }

  async close(): Promise<void> {
    await Promise.all([...this.clients.keys()].map((id) => this.closeEntry(id)));
  }

  private async clientFor(root: string, extension: McpExtensionConfig): Promise<PooledClient> {
    const existing = this.clients.get(extension.id);
    if (existing && !isExpired(existing, extension.pool?.ttlMs ?? 30000)) {
      return existing;
    }
    if (existing) {
      await this.closeEntry(extension.id);
    }
    const created = await createPooledClient(root, extension);
    const entry: PooledClient = {
      extensionId: extension.id,
      ...created,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      uses: 0
    };
    this.clients.set(extension.id, entry);
    return entry;
  }

  private async closeEntry(extensionId: string): Promise<void> {
    const entry = this.clients.get(extensionId);
    if (!entry) {
      return;
    }
    this.clients.delete(extensionId);
    await entry.client.close().catch(() => undefined);
  }
}

async function createPooledClient(root: string, extension: McpExtensionConfig): Promise<{ client: Client; toolNames: Set<string> }> {
  const client = new Client({ name: "tokenhub-extension-client", version: "0.1.0" });
  const transport = new StdioClientTransport({
    command: extension.command,
    args: extension.args,
    cwd: root,
    env: buildExtensionEnvironment(extension.env),
    stderr: "pipe"
  });
  try {
    await client.connect(transport, { timeout: extension.timeoutMs, maxTotalTimeout: extension.timeoutMs });
    const tools = await client.listTools(undefined, {
      timeout: extension.timeoutMs,
      maxTotalTimeout: extension.timeoutMs
    });
    return { client, toolNames: new Set(tools.tools.map((tool) => tool.name)) };
  } catch (error) {
    await client.close().catch(() => undefined);
    throw error;
  }
}

async function callWithClient(input: {
  root: string;
  extension: McpExtensionConfig;
  toolName: string;
  toolInput: unknown;
  budgetTokens?: number;
  includeRaw?: boolean;
  resourceStore: ResourceStore;
  client: Client;
  toolNames: Set<string>;
}): Promise<ExtensionAdapterResult> {
  if (!input.toolNames.has(input.toolName)) {
    throw new Error(`MCP extension ${input.extension.id} did not advertise tool: ${input.toolName}`);
  }
  const result = await input.client.callTool(
    { name: input.toolName, arguments: objectToolInput(input.toolInput) },
    undefined,
    { timeout: input.extension.timeoutMs, maxTotalTimeout: input.extension.timeoutMs }
  );
  const rendered = redactSecrets(renderMcpToolResult(result));
  const link = await input.resourceStore.writeText({
    kind: "log",
    label: `extension:${input.extension.id}:${input.toolName}`,
    source: input.root,
    content: rendered
  });
  const summary = truncateToTokens(
    `Extension ${input.extension.id}.${input.toolName} completed\n${rendered}`,
    input.budgetTokens ?? 600
  );
  return {
    summary: summary.text,
    resources: [link],
    warnings: hasMcpError(result) ? ["MCP extension tool reported an error result."] : [],
    data: input.includeRaw ? { output: rendered, isError: hasMcpError(result) } : undefined,
    estimatedSavedTokens: Math.max(300, estimateTokens(rendered) + 400)
  };
}

function isExpired(entry: PooledClient, ttlMs: number): boolean {
  return Date.now() - entry.lastUsedAt > ttlMs;
}

function objectToolInput(value: unknown): Record<string, unknown> {
  if (value === undefined) {
    return {};
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new Error("MCP extension input must be a JSON object.");
}

function renderMcpToolResult(result: McpToolResult): string {
  if ("toolResult" in result) {
    return JSON.stringify(result.toolResult, null, 2);
  }
  return result.content.map(renderMcpContentBlock).join("\n").trim() || "(no output)";
}

function renderMcpContentBlock(block: McpContentBlock): string {
  if (block.type === "text") {
    return block.text;
  }
  if (block.type === "resource") {
    if ("text" in block.resource) {
      return block.resource.text;
    }
    return `[resource ${block.resource.uri}]`;
  }
  if (block.type === "resource_link") {
    return `[resource ${block.name}: ${block.uri}]`;
  }
  if (block.type === "image") {
    return `[image ${block.mimeType}]`;
  }
  if (block.type === "audio") {
    return `[audio ${block.mimeType}]`;
  }
  return JSON.stringify(block);
}

function hasMcpError(result: McpToolResult): boolean {
  return "isError" in result && result.isError === true;
}
