import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { estimateTokens, truncateToTokens } from "./token.js";

export type ResourceKind = "text" | "log" | "screenshot" | "json" | "html";

export type ResourceLink = {
  uri: string;
  kind: ResourceKind;
  label: string;
  source?: string;
  bytes: number;
  tokens: number;
  sha256: string;
};

export type ResourceWriteInput = {
  kind: ResourceKind;
  label: string;
  content: string | Buffer;
  source?: string;
};

export type ResourceReadOptions = {
  mode?: "snippet" | "range" | "full";
  budgetTokens?: number;
  startLine?: number;
  endLine?: number;
};

export type ResourceReadResult = ResourceLink & {
  content: string;
  truncated: boolean;
};

type ResourceManifest = ResourceLink & {
  contentFile: string;
};

export class ResourceStore {
  private readonly rootDir: string;

  constructor(options: { rootDir: string }) {
    this.rootDir = options.rootDir;
  }

  async writeText(input: ResourceWriteInput): Promise<ResourceLink> {
    await mkdir(this.rootDir, { recursive: true });
    const id = randomUUID();
    const uri = `tokenhub://resource/${id}`;
    const content = Buffer.isBuffer(input.content) ? input.content : Buffer.from(input.content, "utf8");
    const contentFile = `${id}.bin`;
    const sha256 = createHash("sha256").update(content).digest("hex");
    const link: ResourceManifest = {
      uri,
      kind: input.kind,
      label: input.label,
      source: input.source,
      bytes: content.byteLength,
      tokens: estimateTokens(content.toString("utf8")),
      sha256,
      contentFile
    };

    await writeFile(join(this.rootDir, contentFile), content);
    await writeFile(join(this.rootDir, `${id}.json`), JSON.stringify(link, null, 2));

    return publicLink(link);
  }

  async read(uri: string, options: ResourceReadOptions = {}): Promise<ResourceReadResult> {
    const id = uri.replace("tokenhub://resource/", "");
    if (!id || id.includes("/") || id.includes("\\") || id.includes("..")) {
      throw new Error(`Invalid resource URI: ${uri}`);
    }

    const manifest = JSON.parse(await readFile(join(this.rootDir, `${id}.json`), "utf8")) as ResourceManifest;
    const raw = await readFile(join(this.rootDir, manifest.contentFile), "utf8");
    const mode = options.mode ?? "snippet";
    const selected = mode === "range" ? selectLineRange(raw, options.startLine, options.endLine) : raw;
    const truncated =
      mode === "full"
        ? { text: selected, truncated: false }
        : truncateToTokens(selected, options.budgetTokens ?? 500);

    return {
      ...publicLink(manifest),
      content: truncated.text,
      truncated: truncated.truncated
    };
  }
}

function selectLineRange(text: string, startLine = 1, endLine = startLine): string {
  const lines = text.split(/\r?\n/);
  const start = Math.max(1, startLine);
  const end = Math.max(start, endLine);
  return lines.slice(start - 1, end).join("\n");
}

function publicLink(manifest: ResourceManifest): ResourceLink {
  const { contentFile: _contentFile, ...link } = manifest;
  return link;
}
