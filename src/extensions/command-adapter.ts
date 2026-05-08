import { spawn } from "node:child_process";
import type { ResourceLink, ResourceStore } from "../core/resources.js";
import { estimateTokens, truncateToTokens } from "../core/token.js";
import type { CommandExtensionConfig } from "./config.js";
import { buildExtensionEnvironment } from "./environment.js";

const MAX_OUTPUT_BYTES = 1024 * 1024 * 4;

export type ExtensionAdapterResult = {
  summary: string;
  resources: ResourceLink[];
  warnings: string[];
  data?: unknown;
  estimatedSavedTokens: number;
};

export async function runCommandExtension(input: {
  root: string;
  extension: CommandExtensionConfig;
  toolName: string;
  toolInput: unknown;
  budgetTokens?: number;
  includeRaw?: boolean;
  resourceStore: ResourceStore;
}): Promise<ExtensionAdapterResult> {
  if (input.toolName !== "run") {
    throw new Error(`Extension ${input.extension.id} does not expose tool: ${input.toolName}`);
  }

  const result = await spawnWithJsonInput({
    root: input.root,
    extension: input.extension,
    toolInput: input.toolInput
  });
  const redacted = redactSecrets(formatCommandOutput(result.stdout, result.stderr));
  const link = await input.resourceStore.writeText({
    kind: "log",
    label: `extension:${input.extension.id}:run`,
    source: input.root,
    content: redacted
  });
  const status = result.exitCode === 0 && !result.timedOut ? "completed" : "failed";
  const summary = truncateToTokens(
    `Extension ${input.extension.id}.run ${status}\n${redacted}`,
    input.budgetTokens ?? 600
  );
  const warnings = [
    ...(result.exitCode === 0 ? [] : [`Extension command exited with ${result.exitCode}.`]),
    ...(result.timedOut ? [`Extension command timed out after ${input.extension.timeoutMs}ms.`] : []),
    ...(result.outputTruncated ? [`Extension output exceeded ${MAX_OUTPUT_BYTES} bytes and was truncated.`] : [])
  ];

  return {
    summary: summary.text,
    resources: [link],
    warnings,
    data: input.includeRaw
      ? { stdout: redactSecrets(result.stdout), stderr: redactSecrets(result.stderr), exitCode: result.exitCode }
      : undefined,
    estimatedSavedTokens: Math.max(250, estimateTokens(redacted) + 350)
  };
}

function spawnWithJsonInput(input: {
  root: string;
  extension: CommandExtensionConfig;
  toolInput: unknown;
}): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  outputTruncated: boolean;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(input.extension.command, input.extension.args, {
      cwd: input.root,
      env: buildExtensionEnvironment(input.extension.env),
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let capturedBytes = 0;
    let outputTruncated = false;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, input.extension.timeoutMs);

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.stdout.on("data", (chunk: Buffer) => appendBoundedChunk(stdout, chunk));
    child.stderr.on("data", (chunk: Buffer) => appendBoundedChunk(stderr, chunk));
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        exitCode,
        timedOut,
        outputTruncated
      });
    });
    child.stdin.end(JSON.stringify(input.toolInput ?? {}));

    function appendBoundedChunk(target: Buffer[], chunk: Buffer): void {
      const remainingBytes = MAX_OUTPUT_BYTES - capturedBytes;
      if (remainingBytes <= 0) {
        outputTruncated = true;
        return;
      }
      const selected = chunk.byteLength > remainingBytes ? chunk.subarray(0, remainingBytes) : chunk;
      target.push(selected);
      capturedBytes += selected.byteLength;
      outputTruncated = outputTruncated || selected.byteLength !== chunk.byteLength;
    }
  });
}

function formatCommandOutput(stdout: string, stderr: string): string {
  const parts = [];
  if (stdout.trim()) {
    parts.push(stdout.trim());
  }
  if (stderr.trim()) {
    parts.push(`stderr:\n${stderr.trim()}`);
  }
  return parts.join("\n\n") || "(no output)";
}

export function redactSecrets(text: string): string {
  return text
    .replace(/(password|secret|token|api[_-]?key)(\s*[:=]\s*)["']?[^"'\s;]+["']?/gi, "$1$2[redacted]")
    .replace(/SECRET_[A-Z0-9_:-]+/g, "[redacted]");
}
