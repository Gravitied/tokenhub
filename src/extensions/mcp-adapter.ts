import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { ResourceLink, ResourceStore } from "../core/resources.js";
import { estimateTokens, truncateToTokens } from "../core/token.js";
import type { McpExtensionConfig } from "./config.js";
import { redactSecrets, type ExtensionAdapterResult } from "./command-adapter.js";
import { buildExtensionEnvironment } from "./environment.js";

type McpToolResult = Awaited<ReturnType<Client["callTool"]>>;
type McpContentBlock = Extract<McpToolResult, { content: unknown[] }>["content"][number];

export async function runMcpExtension(input: {
  root: string;
  extension: McpExtensionConfig;
  toolName: string;
  toolInput: unknown;
  budgetTokens?: number;
  includeRaw?: boolean;
  resourceStore: ResourceStore;
}): Promise<ExtensionAdapterResult> {
  if (!input.extension.tools.includes(input.toolName)) {
    throw new Error(`Extension ${input.extension.id} does not expose tool: ${input.toolName}`);
  }

  const client = new Client({ name: "tokenhub-extension-client", version: "0.1.0" });
  const transport = new StdioClientTransport({
    command: input.extension.command,
    args: input.extension.args,
    cwd: input.root,
    env: buildExtensionEnvironment(input.extension.env),
    stderr: "pipe"
  });
  try {
    await client.connect(transport, { timeout: input.extension.timeoutMs, maxTotalTimeout: input.extension.timeoutMs });
    const tools = await client.listTools(undefined, {
      timeout: input.extension.timeoutMs,
      maxTotalTimeout: input.extension.timeoutMs
    });
    if (!tools.tools.some((tool) => tool.name === input.toolName)) {
      throw new Error(`MCP extension ${input.extension.id} did not advertise tool: ${input.toolName}`);
    }
    const result = await client.callTool(
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
  } finally {
    await client.close().catch(() => undefined);
  }
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
