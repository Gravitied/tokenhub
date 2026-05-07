import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";

const execFileAsync = promisify(execFile);
const nodeInstallNpmCli = join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
const npmCli = process.env.npm_execpath ?? (existsSync(nodeInstallNpmCli) ? nodeInstallNpmCli : undefined);
const repoRoot = process.cwd();

async function npmPackDryRun() {
  const command = npmCli ? process.execPath : "npm";
  const args = npmCli ? [npmCli, "pack", "--dry-run", "--json"] : ["pack", "--dry-run", "--json"];
  const { stdout } = await execFileAsync(command, args, {
    cwd: repoRoot,
    maxBuffer: 1024 * 1024
  });
  const packages = JSON.parse(stdout) as Array<{ files: Array<{ path: string }> }>;
  expect(packages).toHaveLength(1);
  return packages[0];
}

async function readPackageJson() {
  const text = await readFile(join(repoRoot, "package.json"), "utf8");
  return JSON.parse(text) as {
    name?: string;
    version?: string;
    type?: string;
    bin?: Record<string, string>;
    description?: string;
    engines?: Record<string, string>;
    files?: string[];
    keywords?: string[];
    license?: string;
    author?: string;
    repository?: { type?: string; url?: string };
    homepage?: string;
    bugs?: { url?: string };
  };
}

describe("npm package contents", () => {
  test("packs the downloadable runtime files and metadata only", async () => {
    const packed = await npmPackDryRun();
    const paths = packed.files.map((file) => `package/${file.path}`);
    const allowedPackageFiles = ["package/README.md", "package/LICENSE", "package/package.json"];
    const allowedPackagePrefixes = ["package/dist/"];
    const packageRoots = new Set(
      paths.map((path) => {
        if (path.startsWith("package/dist/")) {
          return "package/dist";
        }
        return path;
      })
    );

    expect(paths).toEqual(
      expect.arrayContaining([
        "package/dist/cli.js",
        "package/dist/server.js",
        "package/package.json",
        "package/README.md",
        "package/LICENSE"
      ])
    );
    expect([...packageRoots].sort()).toEqual(["package/LICENSE", "package/README.md", "package/dist", "package/package.json"]);

    for (const path of paths) {
      expect(allowedPackageFiles.includes(path) || allowedPackagePrefixes.some((prefix) => path.startsWith(prefix))).toBe(
        true
      );
    }
  });

  test("declares production package metadata", async () => {
    const packageJson = await readPackageJson();

    expect(packageJson.name).toBe("tokenhub-mcp");
    expect(packageJson.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(packageJson.type).toBe("module");
    expect(packageJson.bin?.["tokenhub-mcp"]).toBe("dist/cli.js");
    expect(packageJson.engines?.node).toBe(">=20");
    expect(packageJson.files).toEqual(["dist", "README.md", "LICENSE", "package.json"]);
    expect(packageJson.license).toBe("MIT");
    expect(packageJson.author).toBe("Gravitied");
    expect(packageJson.repository).toEqual({
      type: "git",
      url: "git+https://github.com/Gravitied/tokenhub.git"
    });
    expect(packageJson.homepage).toBe("https://github.com/Gravitied/tokenhub#readme");
    expect(packageJson.bugs?.url).toBe("https://github.com/Gravitied/tokenhub/issues");
    expect(packageJson.description).toBe(
      "A token-disciplined developer MCP hub with a tiny always-loaded surface and deferred internal capabilities."
    );
    expect(packageJson.keywords).toEqual([
      "mcp",
      "model-context-protocol",
      "developer-tools",
      "token-efficiency",
      "playwright",
      "automation"
    ]);
  });
});
