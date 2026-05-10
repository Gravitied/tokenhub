import type { ResourceStore } from "../core/resources.js";
import type { CapabilityRegistry } from "../core/registry.js";
import type { ExtensionConfig, LoadedExtensionConfig } from "./config.js";
import { runCommandExtension, type ExtensionAdapterResult } from "./command-adapter.js";
import { McpExtensionPool, runMcpExtension } from "./mcp-adapter.js";

export type ExtensionCallInput = {
  extensionId?: string;
  toolName?: string;
  input?: unknown;
  budgetTokens?: number;
  includeRaw?: boolean;
};

export class ExtensionManager {
  private readonly extensions = new Map<string, ExtensionConfig>();
  private readonly mcpPool = new McpExtensionPool();

  constructor(
    private readonly options: {
      root: string;
      config: LoadedExtensionConfig;
      resourceStore: ResourceStore;
    }
  ) {
    for (const extension of options.config.extensions) {
      this.extensions.set(extension.id, extension);
    }
  }

  registerCapabilities(registry: CapabilityRegistry): void {
    for (const extension of this.extensions.values()) {
      if (extension.type === "command") {
        registry.register({
          id: `extension.${extension.id}.run`,
          module: "extension",
          title: `${extension.title}: run`,
          summary: extension.summary ?? `Run configured local command extension ${extension.title}.`,
          keywords: capabilityKeywords(extension, ["command", "local", "run"]),
          costHintTokens: 140,
          inputSchema: { deferred: true }
        });
        continue;
      }

      for (const toolName of extension.tools.includes("*") ? ["tool"] : extension.tools) {
        registry.register({
          id: `extension.${extension.id}.${toolName}`,
          module: "extension",
          title: `${extension.title}: ${toolName}`,
          summary: extension.summary ?? `Call ${extension.tools.includes("*") ? "an advertised" : "allowlisted"} MCP tool from ${extension.title}.`,
          keywords: capabilityKeywords(extension, ["mcp", toolName]),
          costHintTokens: 160,
          inputSchema: { deferred: true }
        });
      }
    }
  }

  async call(input: ExtensionCallInput): Promise<ExtensionAdapterResult> {
    const extensionId = requireExtensionField(input.extensionId, "extensionId");
    const toolName = requireExtensionField(input.toolName, "toolName");
    const extension = this.extensions.get(extensionId);
    if (!extension) {
      throw new Error(`Unknown extension: ${extensionId}`);
    }

    if (extension.type === "command") {
      return runCommandExtension({
        root: this.options.root,
        extension,
        toolName,
        toolInput: input.input,
        budgetTokens: input.budgetTokens,
        includeRaw: input.includeRaw,
        resourceStore: this.options.resourceStore
      });
    }

    return runMcpExtension({
      root: this.options.root,
      extension,
      toolName,
      toolInput: input.input,
      budgetTokens: input.budgetTokens,
      includeRaw: input.includeRaw,
      resourceStore: this.options.resourceStore,
      pool: this.mcpPool
    });
  }

  poolStats(): Array<{ extensionId: string; uses: number; active: boolean }> {
    return this.mcpPool.stats();
  }

  async close(): Promise<void> {
    await this.mcpPool.close();
  }
}

function requireExtensionField(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`extension_call requires ${name}.`);
  }
  return value;
}

function capabilityKeywords(extension: ExtensionConfig, extra: string[]): string[] {
  return [...new Set([...tokenize(extension.id), ...tokenize(extension.title), ...(extension.keywords ?? []), "extension", ...extra])];
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_.-]+/g)
    .filter(Boolean);
}
