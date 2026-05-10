import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
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
    const content = Buffer.isBuffer(input.content) ? input.content : Buffer.from(input.content, "utf8");
    const sha256 = createHash("sha256").update(content).digest("hex");
    const id = createResourceId(input.kind, sha256);
    const uri = `tokenhub://resource/${id}`;
    const contentFile = `${id}.bin`;
    const existing = await readFile(join(this.rootDir, `${id}.json`), "utf8")
      .then((raw) => JSON.parse(raw) as ResourceManifest)
      .catch(() => undefined);
    if (existing?.uri === uri && existing.contentFile === contentFile && existing.sha256 === sha256 && existing.kind === input.kind) {
      return publicLink(existing);
    }
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
    const rawBytes = await readFile(this.contentPathForManifest(id, manifest, uri));
    if (manifest.kind === "screenshot") {
      const content = `data:image/png;base64,${rawBytes.toString("base64")}`;
      return {
        ...publicLink(manifest),
        content,
        truncated: false
      };
    }

    const raw = rawBytes.toString("utf8");
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

  async list(): Promise<ResourceLink[]> {
    const entries = await readdir(this.rootDir).catch(() => []);
    const manifests = await Promise.all(
      entries
        .filter((entry) => entry.endsWith(".json"))
        .map(async (entry) => {
          const manifest = JSON.parse(await readFile(join(this.rootDir, entry), "utf8")) as ResourceManifest;
          return publicLink(manifest);
        })
    );
    return manifests.sort((left, right) => left.label.localeCompare(right.label) || left.uri.localeCompare(right.uri));
  }

  private contentPathForManifest(id: string, manifest: ResourceManifest, uri: string): string {
    if (manifest.uri !== uri || manifest.contentFile !== `${id}.bin`) {
      throw new Error(`Invalid resource manifest: ${uri}`);
    }
    const root = resolve(this.rootDir);
    const contentPath = resolve(root, manifest.contentFile);
    const relativePath = relative(root, contentPath);
    if (isAbsolute(relativePath) || relativePath === ".." || relativePath.startsWith(`..\\`) || relativePath.startsWith("../")) {
      throw new Error(`Invalid resource manifest: ${uri}`);
    }
    return contentPath;
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

function createResourceId(kind: ResourceKind, sha256: string): string {
  return createHash("sha256").update(`${kind}\0${sha256}`).digest("hex").slice(0, 32);
}
