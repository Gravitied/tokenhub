import { describe, expect, test } from "vitest";
import { createDiagnosticLogger, logLevelFromEnv, redactLogValue } from "../src/core/logger.js";

describe("diagnostic logger", () => {
  test("is silent by default", () => {
    const lines: string[] = [];
    const logger = createDiagnosticLogger({ level: "silent", sink: (line) => lines.push(line) });

    logger.info("server.start", { root: process.cwd() });

    expect(lines).toEqual([]);
  });

  test("emits structured JSON lines with redacted sensitive values when enabled", () => {
    const lines: string[] = [];
    const logger = createDiagnosticLogger({ level: "debug", sink: (line) => lines.push(line) });

    logger.debug("tool.start", {
      requestId: "req_1",
      tool: "retrieve_context",
      apiKey: "secret-api-key",
      nested: { token: "secret-token" }
    });

    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed).toMatchObject({
      level: "debug",
      event: "tool.start",
      requestId: "req_1",
      tool: "retrieve_context",
      apiKey: "[redacted]",
      nested: { token: "[redacted]" }
    });
    expect(lines[0]).not.toContain("secret-api-key");
    expect(lines[0]).not.toContain("secret-token");
  });

  test("normalizes log level from environment values", () => {
    expect(logLevelFromEnv({ TOKENHUB_LOG_LEVEL: "debug" })).toBe("debug");
    expect(logLevelFromEnv({ TOKENHUB_LOG_LEVEL: "INFO" })).toBe("info");
    expect(logLevelFromEnv({ TOKENHUB_LOG_LEVEL: "bogus" })).toBe("silent");
  });

  test("redacts key-value secret fragments inside strings", () => {
    expect(redactLogValue("failed with apiKey=abc123456789 and token: xyz987654321")).toBe(
      "failed with apiKey=[redacted] and token: [redacted]"
    );
  });
});
