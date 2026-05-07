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
    bin?: Record<string, string>;
    description?: string;
    engines?: Record<string, string>;
    files?: string[];
    keywords?: string[];
    license?: string;
  };
}

describe("npm package contents", () => {
  test("packs the downloadable runtime files and metadata only", async () => {
    const packed = await npmPackDryRun();
    const paths = packed.files.map((file) => `package/${file.path}`);

    expect(paths).toEqual(
      expect.arrayContaining([
        "package/dist/cli.js",
        "package/dist/server.js",
        "package/package.json",
        "package/README.md",
        "package/LICENSE"
      ])
    );

    for (const excludedPath of [
      "package/src/",
      "package/tests/",
      "package/scripts/",
      "package/artifacts/",
      "package/.tokenhub/",
      "package/.worktrees/"
    ]) {
      expect(paths.some((path) => path.startsWith(excludedPath))).toBe(false);
    }
  });

  test("declares production package metadata", async () => {
    const packageJson = await readPackageJson();

    expect(packageJson.bin?.["tokenhub-mcp"]).toBe("dist/cli.js");
    expect(packageJson.engines?.node).toBe(">=20");
    expect(packageJson.files).toEqual(["dist", "README.md", "LICENSE", "package.json"]);
    expect(packageJson.license).toBe("MIT");
    expect(packageJson.description?.trim().length).toBeGreaterThan(20);
    expect(packageJson.keywords).toEqual(expect.arrayContaining(["mcp", "model-context-protocol"]));
  });
});
