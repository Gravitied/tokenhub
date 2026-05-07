import { dirname, join } from "node:path";
import { describe, expect, test } from "vitest";
import { appendBoundedOutput, redactSensitiveOutput, resolveWardenCommand } from "../tools/mcp-warden-server/server.mjs";

describe("mcp-warden Codex adapter", () => {
  test("redacts key-value secret output before returning it to Codex", () => {
    const output = redactSensitiveOutput("apiKey=abc123456789 token:secret-value password = hunter2");

    expect(output).toContain("apiKey=[REDACTED]");
    expect(output).toContain("token:[REDACTED]");
    expect(output).toContain("password = [REDACTED]");
    expect(output).not.toContain("abc123456789");
    expect(output).not.toContain("secret-value");
    expect(output).not.toContain("hunter2");
  });

  test("bounds captured child-process output before final truncation", () => {
    const capture = { text: "", truncated: false };

    appendBoundedOutput(capture, "x".repeat(26000), 24000);
    appendBoundedOutput(capture, "more output", 24000);

    expect(capture.text).toHaveLength(24000);
    expect(capture.truncated).toBe(true);
    expect(capture.text).not.toContain("more output");
  });

  test("resolves npx from the active Node installation instead of a machine-specific path", () => {
    const execPath = join("virtual-node", "bin", "node");
    const npxCli = join(dirname(execPath), "node_modules", "npm", "bin", "npx-cli.js");

    const command = resolveWardenCommand({
      execPath,
      env: {},
      exists: (path) => path === npxCli
    });

    expect(command).toEqual({ executable: execPath, args: [npxCli] });
  });
});
