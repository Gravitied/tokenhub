import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type BenchmarkFixtures = {
  root: string;
  marker: string;
  secret: string;
  paths: {
    sourceFile: string;
    notesFile: string;
    htmlFile: string;
  };
  urls: {
    fixturePage: string;
  };
  close: () => Promise<void>;
};

export async function createBenchmarkFixtures(root: string): Promise<BenchmarkFixtures> {
  const marker = "TOKENHUB_BENCHMARK_NEEDLE";
  const secret = "SECRET_VALUE_DO_NOT_RETURN";
  const sourceDir = join(root, "src");
  const docsDir = join(root, "docs");
  await mkdir(sourceDir, { recursive: true });
  await mkdir(docsDir, { recursive: true });

  const sourceFile = join(sourceDir, "feature.ts");
  const notesFile = join(docsDir, "notes.md");
  const htmlFile = join(root, "fixture.html");
  await writeFile(
    sourceFile,
    `export const benchmarkMarker = "${marker}";\nexport const internalSecret = "${secret}";\nexport function answer() { return benchmarkMarker; }\n`,
    "utf8"
  );
  await writeFile(notesFile, `# Notes\nThe expected developer fact is ${marker}.\n`, "utf8");
  await writeFile(
    htmlFile,
    `<!doctype html><html><head><title>Benchmark Docs</title><style>.hidden{display:none}</style></head><body><h1>${marker}</h1><script>console.log("${secret}")</script><p>Clean docs paragraph.</p></body></html>`,
    "utf8"
  );

  await execFileAsync("git", ["init"], { cwd: root });
  await execFileAsync("git", ["config", "user.email", "bench@example.com"], { cwd: root });
  await execFileAsync("git", ["config", "user.name", "Benchmark User"], { cwd: root });
  await execFileAsync("git", ["add", "."], { cwd: root });
  await execFileAsync("git", ["commit", "-m", "initial benchmark fixture"], { cwd: root });
  await writeFile(notesFile, `# Notes\nThe expected developer fact is ${marker}.\nModified after commit.\n`, "utf8");

  const server = await serveFile(htmlFile);
  const address = server.address();
  if (typeof address === "string" || address === null) {
    throw new Error("Unable to create fixture HTTP server.");
  }

  return {
    root,
    marker,
    secret,
    paths: {
      sourceFile: toPortablePath(sourceFile),
      notesFile: toPortablePath(notesFile),
      htmlFile: toPortablePath(htmlFile)
    },
    urls: { fixturePage: `http://127.0.0.1:${address.port}/fixture.html` },
    close: () => new Promise((resolve) => server.close(() => resolve()))
  };
}

function toPortablePath(path: string): string {
  return path.replaceAll("\\", "/");
}

async function serveFile(htmlFile: string): Promise<Server> {
  const server = createServer(async (_request, response) => {
    const content = await import("node:fs/promises").then((fs) => fs.readFile(htmlFile, "utf8"));
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(content);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  return server;
}
