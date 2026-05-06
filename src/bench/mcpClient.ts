import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, type StdioServerParameters } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { estimateTokens } from "../core/token.js";

export type McpInvocation = {
  toolsTokenEstimate: number;
  outputTokenEstimate: number;
  outputText: string;
};

export async function withMcpClient<T>(
  params: StdioServerParameters,
  callback: (client: Client) => Promise<T>
): Promise<T> {
  const transport = new StdioClientTransport({ ...params, stderr: "pipe" });
  const client = new Client({ name: "tokenhub-benchmark", version: "0.1.0" });
  try {
    await client.connect(transport, { timeout: 30000 });
    return await callback(client);
  } finally {
    await client.close().catch(() => undefined);
  }
}

export function extractToolText(result: CallToolResult): string {
  return result.content
    .map((item) => {
      if (item.type === "text") {
        return item.text;
      }
      if (item.type === "resource") {
        return "text" in item.resource ? item.resource.text : item.resource.uri;
      }
      if (item.type === "resource_link") {
        return item.uri;
      }
      return `[${item.type}]`;
    })
    .join("\n");
}

export function estimateToolSchemaTokens(tools: unknown): number {
  return estimateTokens(JSON.stringify(tools));
}
