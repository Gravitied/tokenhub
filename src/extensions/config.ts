import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";

const MAX_TIMEOUT_MS = 120000;
const DEFAULT_TIMEOUT_MS = 30000;
const EXTENSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const TOOL_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

const jsonSchemaObject = z.record(z.string(), z.unknown());

const baseExtensionSchema = z.object({
  id: z.string().regex(EXTENSION_ID_PATTERN),
  title: z.string().min(1).max(120),
  summary: z.string().min(1).max(500).optional(),
  keywords: z.array(z.string().min(1).max(80)).max(30).optional(),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  env: z.array(z.string().regex(ENV_NAME_PATTERN)).default([]),
  timeoutMs: z.number().int().positive().max(MAX_TIMEOUT_MS).default(DEFAULT_TIMEOUT_MS)
});

const commandExtensionSchema = baseExtensionSchema.extend({
  type: z.literal("command"),
  inputSchema: jsonSchemaObject.optional(),
  output: z.enum(["summary", "raw"]).default("summary")
});

const mcpExtensionSchema = baseExtensionSchema.extend({
  type: z.literal("mcp"),
  tools: z.array(z.string().regex(TOOL_NAME_PATTERN)).min(1).max(100)
});

const extensionManifestSchema = z.object({
  version: z.literal(1),
  extensions: z.array(z.discriminatedUnion("type", [commandExtensionSchema, mcpExtensionSchema])).default([])
});

export type CommandExtensionConfig = z.infer<typeof commandExtensionSchema>;
export type McpExtensionConfig = z.infer<typeof mcpExtensionSchema>;
export type ExtensionConfig = CommandExtensionConfig | McpExtensionConfig;

export type LoadedExtensionConfig = {
  configPath: string;
  extensions: ExtensionConfig[];
  warnings: string[];
};

export type ExtensionConfigLoadOptions = {
  root: string;
  configPath?: string;
  env?: NodeJS.ProcessEnv;
};

export async function loadExtensionConfig(options: ExtensionConfigLoadOptions): Promise<LoadedExtensionConfig> {
  return loadExtensionConfigSync(options);
}

export function loadExtensionConfigSync(options: ExtensionConfigLoadOptions): LoadedExtensionConfig {
  const env = options.env ?? process.env;
  const configuredPath = options.configPath ?? env.TOKENHUB_EXTENSIONS;
  const configPath = resolveExtensionConfigPath(options.root, configuredPath);

  if (!existsSync(configPath)) {
    if (configuredPath) {
      throw new Error(`Extension config not found: ${configPath}`);
    }
    return { configPath, extensions: [], warnings: [] };
  }

  const parsed = extensionManifestSchema.parse(JSON.parse(readFileSync(configPath, "utf8")));
  assertUniqueExtensionIds(parsed.extensions);

  return {
    configPath,
    extensions: parsed.extensions,
    warnings: []
  };
}

export function resolveExtensionConfigPath(root: string, configPath?: string): string {
  if (configPath) {
    return resolve(root, configPath);
  }
  return join(resolve(root), "tokenhub.extensions.json");
}

function assertUniqueExtensionIds(extensions: ExtensionConfig[]): void {
  const seen = new Set<string>();
  for (const extension of extensions) {
    const normalized = extension.id.toLowerCase();
    if (seen.has(normalized)) {
      throw new Error(`Duplicate extension id: ${extension.id}`);
    }
    seen.add(normalized);
  }
}
