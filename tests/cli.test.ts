import { describe, expect, test } from "vitest";
import { parseCliArgs } from "../src/cli-options.js";

describe("parseCliArgs", () => {
  const packageVersion = "1.2.3";

  test("starts in the current working directory when no arguments are provided", () => {
    expect(parseCliArgs([], packageVersion)).toEqual({ kind: "start", root: process.cwd() });
  });

  test("starts with an explicit Windows root path", () => {
    expect(parseCliArgs(["--root", "C:\\work"], packageVersion)).toEqual({ kind: "start", root: "C:\\work" });
  });

  test("starts with an explicit diagnostic log level", () => {
    expect(parseCliArgs(["--root", "C:\\work", "--log-level", "debug"], packageVersion)).toEqual({
      kind: "start",
      root: "C:\\work",
      logLevel: "debug"
    });
  });

  test("starts with an explicit extension manifest path", () => {
    expect(parseCliArgs(["--root", "C:\\work", "--extensions", "C:\\work\\tokenhub.extensions.json"], packageVersion)).toEqual({
      kind: "start",
      root: "C:\\work",
      extensionsPath: "C:\\work\\tokenhub.extensions.json"
    });
  });

  test("parses extension lint and test subcommands", () => {
    expect(parseCliArgs(["extensions", "lint", "--root", "C:\\work", "--extensions", "manifest.json"], packageVersion)).toEqual({
      kind: "extensions-lint",
      root: "C:\\work",
      extensionsPath: "manifest.json"
    });
    expect(
      parseCliArgs(
        ["extensions", "test", "--root", "C:\\work", "--extension", "local-echo", "--tool", "run", "--input-json", "{\"ok\":true}"],
        packageVersion
      )
    ).toEqual({
      kind: "extensions-test",
      root: "C:\\work",
      extensionId: "local-echo",
      toolName: "run",
      input: { ok: true }
    });
  });

  test("parses MCP Registry search and install subcommands", () => {
    expect(parseCliArgs(["registry", "search", "filesystem", "--limit", "3"], packageVersion)).toEqual({
      kind: "registry-search",
      query: "filesystem",
      limit: 3
    });
    expect(
      parseCliArgs(["registry", "install", "filesystem", "--root", "C:\\work", "--id", "filesystem", "--tools", "read,write"], packageVersion)
    ).toEqual({
      kind: "registry-install",
      query: "filesystem",
      root: "C:\\work",
      extensionId: "filesystem",
      tools: ["read", "write"]
    });
  });

  test("returns a structured error when --root is missing its path", () => {
    expect(parseCliArgs(["--root"], packageVersion)).toEqual({ kind: "error", code: "missing-root" });
  });

  test("returns a structured error when --log-level is invalid", () => {
    expect(parseCliArgs(["--log-level", "verbose"], packageVersion)).toEqual({ kind: "error", code: "invalid-log-level" });
  });

  test("returns a structured error when --extensions is missing its path", () => {
    expect(parseCliArgs(["--extensions"], packageVersion)).toEqual({ kind: "error", code: "missing-extensions" });
  });

  test("returns help text for --help", () => {
    const result = parseCliArgs(["--help"], packageVersion);

    expect(result.kind).toBe("help");
    expect(result).toEqual({ kind: "help", text: expect.any(String) });
    if (result.kind === "help") {
      expect(result.text).toContain("npx tokenhub-mcp --root");
      expect(result.text).toContain("--extensions <path>");
      expect(result.text).toContain("tokenhub-mcp extensions lint");
      expect(result.text).toContain("tokenhub-mcp registry install");
    }
  });

  test("returns the package version for --version", () => {
    expect(parseCliArgs(["--version"], packageVersion)).toEqual({ kind: "version", text: packageVersion });
  });

  test("returns a structured error for an unknown flag", () => {
    expect(parseCliArgs(["--bogus"], packageVersion)).toEqual({ kind: "error", code: "unknown-argument" });
  });
});
