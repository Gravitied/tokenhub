import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { ResourceStore } from "../core/resources.js";
import { TokenTelemetry } from "../core/telemetry.js";
import { loadExtensionConfigSync, type ExtensionConfig } from "./config.js";
import { ExtensionManager } from "./manager.js";

export type ExtensionDoctorCheck = {
  level: "info" | "warning" | "error";
  extensionId?: string;
  message: string;
};

export type ExtensionTestResult = {
  extensionId: string;
  toolName: string;
  ok: boolean;
  summary: string;
  warnings: string[];
};

export async function lintExtensionManifest(input: { root: string; configPath?: string }): Promise<{
  ok: boolean;
  configPath: string;
  checks: ExtensionDoctorCheck[];
}> {
  try {
    const config = loadExtensionConfigSync({ root: input.root, configPath: input.configPath });
    const checks: ExtensionDoctorCheck[] = [];
    if (config.extensions.length === 0) {
      checks.push({ level: "warning", message: `No extensions configured in ${config.configPath}.` });
    }
    for (const extension of config.extensions) {
      checks.push(...lintExtension(input.root, extension));
    }
    return {
      ok: checks.every((check) => check.level !== "error"),
      configPath: config.configPath,
      checks
    };
  } catch (error) {
    return {
      ok: false,
      configPath: input.configPath ?? "",
      checks: [{ level: "error", message: error instanceof Error ? error.message : String(error) }]
    };
  }
}

export async function testExtensionManifest(input: {
  root: string;
  configPath?: string;
  extensionId?: string;
  toolName?: string;
  input?: unknown;
  budgetTokens?: number;
}): Promise<{
  ok: boolean;
  results: ExtensionTestResult[];
}> {
  const config = loadExtensionConfigSync({ root: input.root, configPath: input.configPath });
  const resourceStore = new ResourceStore({ rootDir: resolve(input.root, ".tokenhub", "resources") });
  const manager = new ExtensionManager({ root: input.root, config, resourceStore });
  const telemetry = new TokenTelemetry({ roiThreshold: 3 });
  const extensions = config.extensions.filter((extension) => !input.extensionId || extension.id === input.extensionId);
  const results: ExtensionTestResult[] = [];

  try {
    for (const extension of extensions) {
      for (const toolName of toolNamesForTest(extension, input.toolName)) {
        try {
          const result = await manager.call({
            extensionId: extension.id,
            toolName,
            input: input.input ?? {},
            budgetTokens: input.budgetTokens ?? 400,
            includeRaw: false
          });
          telemetry.record({
            capability: `extension.${extension.id}.${toolName}`,
            estimatedToolCostTokens: 50,
            estimatedSavedTokens: result.estimatedSavedTokens,
            outputTokens: 50
          });
          results.push({ extensionId: extension.id, toolName, ok: result.warnings.length === 0, summary: result.summary, warnings: result.warnings });
        } catch (error) {
          results.push({
            extensionId: extension.id,
            toolName,
            ok: false,
            summary: error instanceof Error ? error.message : String(error),
            warnings: [error instanceof Error ? error.message : String(error)]
          });
        }
      }
    }
  } finally {
    await manager.close();
  }

  return { ok: results.every((result) => result.ok), results };
}

function lintExtension(root: string, extension: ExtensionConfig): ExtensionDoctorCheck[] {
  const checks: ExtensionDoctorCheck[] = [];
  if (isAbsolute(extension.command) && !existsSync(extension.command)) {
    checks.push({ level: "error", extensionId: extension.id, message: `Configured command does not exist: ${extension.command}` });
  } else {
    checks.push({ level: "info", extensionId: extension.id, message: `Configured command is ${extension.command}.` });
  }

  const localScript = firstLocalScriptArg(extension.args);
  if (localScript && !existsSync(resolve(root, localScript))) {
    checks.push({ level: "error", extensionId: extension.id, message: `Configured script does not exist: ${localScript}` });
  }
  if (extension.type === "mcp" && extension.tools.includes("*")) {
    checks.push({ level: "warning", extensionId: extension.id, message: "Wildcard MCP tools are enabled; advertised tools are verified at call time." });
  }
  return checks;
}

function firstLocalScriptArg(args: string[]): string | undefined {
  return args.find((arg) => !arg.startsWith("-") && /\.(mjs|cjs|js|ts|py)$/i.test(arg) && !isAbsolute(arg));
}

function toolNamesForTest(extension: ExtensionConfig, requestedToolName: string | undefined): string[] {
  if (requestedToolName) {
    return [requestedToolName];
  }
  if (extension.type === "command") {
    return ["run"];
  }
  return extension.tools.filter((tool) => tool !== "*");
}
