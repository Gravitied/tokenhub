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

  test("returns a structured error when --root is missing its path", () => {
    expect(parseCliArgs(["--root"], packageVersion)).toEqual({ kind: "error", code: "missing-root" });
  });

  test("returns help text for --help", () => {
    const result = parseCliArgs(["--help"], packageVersion);

    expect(result.kind).toBe("help");
    expect(result).toEqual({ kind: "help", text: expect.any(String) });
    if (result.kind === "help") {
      expect(result.text).toContain("npx tokenhub-mcp --root");
    }
  });

  test("returns the package version for --version", () => {
    expect(parseCliArgs(["--version"], packageVersion)).toEqual({ kind: "version", text: packageVersion });
  });

  test("returns a structured error for an unknown flag", () => {
    expect(parseCliArgs(["--bogus"], packageVersion)).toEqual({ kind: "error", code: "unknown-argument" });
  });
});
