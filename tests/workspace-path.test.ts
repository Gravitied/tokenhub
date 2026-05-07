import { describe, expect, test } from "vitest";
import { resolveWorkspacePath } from "../src/core/workspace-path.js";

describe("resolveWorkspacePath", () => {
  test("resolves POSIX paths inside the workspace", () => {
    expect(resolveWorkspacePath("/repo", "src/a.ts")).toEqual({ ok: true, path: "/repo/src/a.ts" });
  });

  test("rejects POSIX paths outside the workspace", () => {
    expect(resolveWorkspacePath("/repo", "../secret.txt")).toEqual({
      ok: false,
      reason: "outside-workspace",
      message: expect.any(String)
    });
  });

  test("resolves Windows paths inside the workspace", () => {
    expect(resolveWorkspacePath("C:\\repo", "src\\a.ts")).toEqual({ ok: true, path: "C:\\repo\\src\\a.ts" });
  });

  test("rejects Windows paths outside the workspace", () => {
    expect(resolveWorkspacePath("C:\\repo", "..\\secret.txt")).toEqual({
      ok: false,
      reason: "outside-workspace",
      message: expect.any(String)
    });
  });

  test("rejects Windows absolute paths on another drive", () => {
    expect(resolveWorkspacePath("C:\\repo", "D:\\other\\secret.txt")).toEqual({
      ok: false,
      reason: "outside-workspace",
      message: expect.any(String)
    });
  });

  test("allows resolving the root itself", () => {
    expect(resolveWorkspacePath("/repo", ".")).toEqual({ ok: true, path: "/repo" });
  });
});
