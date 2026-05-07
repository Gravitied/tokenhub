import { describe, expect, test } from "vitest";
import { redactSensitiveOutput } from "../tools/mcp-warden-server/server.mjs";

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
});
