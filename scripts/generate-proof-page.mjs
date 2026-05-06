import { execFile } from "node:child_process";
import { mkdir, readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { chromium } from "playwright";
import { createProofPage } from "../dist/proof.js";

const execFileAsync = promisify(execFile);
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const outDir = join(root, "artifacts", "proof");

const commands = [];
commands.push(await run("npm", ["test"]));
commands.push(await run("npm", ["run", "build"]));
commands.push(await run("npm", ["run", "bench"]));

const repoState = await gitState();
const benchmarkSummary = await readBenchmarkSummary();
const htmlPath = await createProofPage({
  outDir,
  generatedAt: new Date().toISOString(),
  commands,
  repoState,
  benchmarkSummary
});

const pngPath = join(outDir, "tokenhub-proof.png");
await mkdir(outDir, { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 });
  await page.goto(`file:///${htmlPath.replaceAll("\\", "/")}`);
  await page.screenshot({ path: pngPath, fullPage: true });
} finally {
  await browser.close();
}

const png = await stat(pngPath);
console.log(`PNG proof written: ${pngPath} (${png.size} bytes)`);

if (commands.some((command) => command.exitCode !== 0)) {
  process.exitCode = 1;
}

async function run(command, args) {
  const rendered = [command, ...args].join(" ");
  const started = Date.now();
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd: root,
      timeout: 180000,
      maxBuffer: 1024 * 1024 * 8,
      shell: process.platform === "win32"
    });
    return {
      command: rendered,
      exitCode: 0,
      summary: summarize(`${stdout}${stderr}`, Date.now() - started)
    };
  } catch (error) {
    return {
      command: rendered,
      exitCode: typeof error.code === "number" ? error.code : 1,
      summary: summarize(`${error.stdout ?? ""}${error.stderr ?? ""}${error.message}`, Date.now() - started)
    };
  }
}

async function gitState() {
  try {
    const { stdout } = await execFileAsync("git", ["status", "--short"], {
      cwd: root,
      timeout: 10000,
      shell: process.platform === "win32"
    });
    return stdout.trim() ? "working tree has local changes" : "clean";
  } catch {
    return "git unavailable";
  }
}

function summarize(output, durationMs) {
  const clean = output.replace(/\x1b\[[0-9;]*m/g, "").trim();
  const meaningful = clean
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-8)
    .join(" | ");
  return `${meaningful || "no output"} (${Math.round(durationMs / 100) / 10}s)`;
}

async function readBenchmarkSummary() {
  try {
    const report = JSON.parse(await readFile(join(root, "artifacts", "benchmarks", "competitive-report.json"), "utf8"));
    const weak = report.weakTasks?.length ? ` Weak tasks: ${report.weakTasks.join(", ")}.` : " No weak tasks.";
    return `${report.summary}${weak}`;
  } catch {
    return "Benchmark report was not available.";
  }
}
