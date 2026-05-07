import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const nodeInstallNpmCli = join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
const npmCli = process.env.npm_execpath ?? (existsSync(nodeInstallNpmCli) ? nodeInstallNpmCli : undefined);

function npmCommand(args) {
  return npmCli ? { command: process.execPath, args: [npmCli, ...args] } : { command: "npm", args };
}

async function run(command, args, options = {}) {
  try {
    return await execFileAsync(command, args, {
      cwd: options.cwd ?? repoRoot,
      maxBuffer: 1024 * 1024 * 10
    });
  } catch (error) {
    const details = [
      `Command failed: ${command} ${args.join(" ")}`,
      error.stdout ? `stdout:\n${error.stdout}` : "",
      error.stderr ? `stderr:\n${error.stderr}` : ""
    ]
      .filter(Boolean)
      .join("\n\n");
    throw new Error(details, { cause: error });
  }
}

async function runNpm(args, cwd = repoRoot) {
  const npm = npmCommand(args);
  return run(npm.command, npm.args, { cwd });
}

async function main() {
  let tempDir;
  let tarballPath;

  try {
    const packageJson = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8"));
    const expectedVersion = packageJson.version;
    if (typeof expectedVersion !== "string" || expectedVersion.length === 0) {
      throw new Error("package.json must declare a version for install smoke assertions.");
    }

    await runNpm(["run", "build"]);

    tempDir = await mkdtemp(join(tmpdir(), "tokenhub-install-smoke-"));

    const { stdout } = await runNpm(["pack", "--json"]);
    const packages = JSON.parse(stdout);
    if (!Array.isArray(packages) || packages.length !== 1 || typeof packages[0].filename !== "string") {
      throw new Error(`Unexpected npm pack output: ${stdout}`);
    }

    tarballPath = join(repoRoot, packages[0].filename);
    await runNpm(["install", tarballPath, "--ignore-scripts"], tempDir);

    const cliPath = join(tempDir, "node_modules", "tokenhub-mcp", "dist", "cli.js");
    const help = await run(process.execPath, [cliPath, "--help"], { cwd: tempDir });
    if (!help.stdout.includes("npx tokenhub-mcp --root")) {
      throw new Error(`Installed CLI help output did not include the expected usage.\n\nstdout:\n${help.stdout}`);
    }

    const version = await run(process.execPath, [cliPath, "--version"], { cwd: tempDir });
    if (version.stdout.trim() !== expectedVersion) {
      throw new Error(
        `Installed CLI version output did not match package.json version. Expected ${expectedVersion}, got ${version.stdout.trim()}.`
      );
    }
  } finally {
    let cleanupError;
    if (tarballPath) {
      await unlink(tarballPath).catch((error) => {
        if (error?.code !== "ENOENT") {
          cleanupError = error;
        }
      });
    }
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
    if (cleanupError) {
      throw cleanupError;
    }
  }
}

await main();
