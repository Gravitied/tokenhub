import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { FetchLike } from "../modules/github.js";
import { resolveExtensionConfigPath, type ExtensionConfig, type McpExtensionConfig } from "./config.js";

const DEFAULT_REGISTRY_URL = "https://registry.modelcontextprotocol.io";

export type RegistryServerResponse = {
  server?: {
    name?: string;
    title?: string;
    description?: string;
    version?: string;
    packages?: Array<{
      registryType?: string;
      identifier?: string;
      version?: string;
      runtimeHint?: string;
      runtimeArguments?: Array<{ value?: string }>;
      packageArguments?: Array<{ value?: string }>;
      transport?: { type?: string };
    }> | null;
  };
  _meta?: Record<string, unknown>;
};

type RegistryPackage = NonNullable<NonNullable<RegistryServerResponse["server"]>["packages"]>[number];

export type NormalizedRegistryServer = {
  name: string;
  title: string;
  description: string;
  version: string;
  packageIdentifier?: string;
  raw: RegistryServerResponse;
};

export async function searchMcpRegistry(input: {
  query: string;
  limit?: number;
  registryUrl?: string;
  fetchImpl?: FetchLike;
}): Promise<{ servers: NormalizedRegistryServer[] }> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const url = new URL("/v0/servers", input.registryUrl ?? DEFAULT_REGISTRY_URL);
  url.searchParams.set("search", input.query);
  url.searchParams.set("version", "latest");
  url.searchParams.set("limit", String(input.limit ?? 10));
  const response = await fetchImpl(url.toString(), {
    headers: { accept: "application/json", "user-agent": "tokenhub-mcp/0.1" }
  });
  if (!response.ok) {
    throw new Error(`MCP Registry search failed: HTTP ${response.status}`);
  }
  const json = (await response.json()) as { servers?: RegistryServerResponse[] };
  return { servers: (json.servers ?? []).map(normalizeServer).filter((server): server is NormalizedRegistryServer => Boolean(server)) };
}

export function registryServerToExtension(
  response: RegistryServerResponse,
  options: { id?: string; tools?: string[] } = {}
): McpExtensionConfig {
  const server = response.server;
  if (!server?.name) {
    throw new Error("Registry server response is missing server.name.");
  }
  const selectedPackage = selectStdioPackage(server.packages ?? []);
  if (!selectedPackage) {
    throw new Error(`Registry server ${server.name} does not expose a supported npm stdio package.`);
  }
  const version = selectedPackage.version ?? server.version;
  if (!version) {
    throw new Error(`Registry server ${server.name} package is missing an exact version.`);
  }
  const runtime = selectedPackage.runtimeHint || (selectedPackage.registryType === "npm" ? "npx" : undefined);
  if (runtime !== "npx") {
    throw new Error(`Registry server ${server.name} uses unsupported runtime ${runtime ?? "unknown"}.`);
  }
  const args = [
    "-y",
    `${selectedPackage.identifier}@${version}`,
    ...argumentValues(selectedPackage.runtimeArguments),
    ...argumentValues(selectedPackage.packageArguments)
  ];
  return {
    id: options.id ?? defaultExtensionId(server.name),
    type: "mcp",
    title: server.title ?? server.name,
    summary: server.description,
    command: "npx",
    args,
    env: [],
    tools: options.tools?.length ? options.tools : ["*"],
    timeoutMs: 30000
  };
}

export async function installMcpRegistryServer(input: {
  root: string;
  query: string;
  configPath?: string;
  extensionId?: string;
  tools?: string[];
  registryUrl?: string;
  fetchImpl?: FetchLike;
}): Promise<{ configPath: string; server: NormalizedRegistryServer; extension: McpExtensionConfig }> {
  const search = await searchMcpRegistry({
    query: input.query,
    limit: 10,
    registryUrl: input.registryUrl,
    fetchImpl: input.fetchImpl
  });
  const server = selectServer(search.servers, input.query);
  if (!server) {
    throw new Error(`No MCP Registry server matched ${input.query}.`);
  }
  const extension = registryServerToExtension(server.raw, { id: input.extensionId, tools: input.tools });
  const configPath = resolveExtensionConfigPath(input.root, input.configPath);
  const manifest = await readManifest(configPath);
  if (manifest.extensions.some((existing) => existing.id.toLowerCase() === extension.id.toLowerCase())) {
    throw new Error(`Extension already exists in manifest: ${extension.id}`);
  }
  manifest.extensions.push(extension);
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { configPath, server, extension };
}

function normalizeServer(response: RegistryServerResponse): NormalizedRegistryServer | undefined {
  const server = response.server;
  if (!server?.name) {
    return undefined;
  }
  const selectedPackage = selectStdioPackage(server.packages ?? []);
  return {
    name: server.name,
    title: server.title ?? server.name,
    description: server.description ?? "",
    version: server.version ?? selectedPackage?.version ?? "",
    packageIdentifier: selectedPackage?.identifier,
    raw: response
  };
}

function selectServer(servers: NormalizedRegistryServer[], query: string): NormalizedRegistryServer | undefined {
  const normalizedQuery = query.toLowerCase();
  return servers.find((server) => server.name.toLowerCase() === normalizedQuery) ?? servers[0];
}

function selectStdioPackage(packages: NonNullable<RegistryServerResponse["server"]>["packages"]): RegistryPackage | undefined {
  return packages?.find((pkg) => pkg.registryType === "npm" && pkg.identifier && pkg.transport?.type === "stdio");
}

function defaultExtensionId(serverName: string): string {
  return serverName
    .split("/")
    .at(-1)!
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function argumentValues(args: Array<{ value?: string }> | null | undefined): string[] {
  return (args ?? []).map((arg) => arg.value).filter((value): value is string => Boolean(value));
}

async function readManifest(configPath: string): Promise<{ version: 1; extensions: ExtensionConfig[] }> {
  const raw = await readFile(configPath, "utf8").catch(() => undefined);
  if (!raw) {
    return { version: 1, extensions: [] };
  }
  const parsed = JSON.parse(raw) as { version?: number; extensions?: ExtensionConfig[] };
  if (parsed.version !== 1 || !Array.isArray(parsed.extensions)) {
    throw new Error(`Extension manifest must have version 1 and an extensions array: ${configPath}`);
  }
  return { version: 1, extensions: parsed.extensions };
}
