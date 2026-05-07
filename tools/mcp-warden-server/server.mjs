import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const MAX_OUTPUT = 24000;
const TOOL_TIMEOUT_MS = 120000;

const tools = [
  {
    name: "mcp_warden_audit_config",
    description: "Audit an MCP JSON config file for over-permissioned servers.",
    inputSchema: {
      type: "object",
      properties: {
        configPath: {
          type: "string",
          description: "Path to a JSON MCP client config file to audit."
        }
      },
      required: ["configPath"],
      additionalProperties: false
    }
  },
  {
    name: "mcp_warden_init_policy",
    description: "Generate a default mcp-warden policy JSON file.",
    inputSchema: {
      type: "object",
      properties: {
        outputPath: {
          type: "string",
          description: "Policy file path to write."
        },
        force: {
          type: "boolean",
          description: "Overwrite an existing policy file."
        }
      },
      required: ["outputPath"],
      additionalProperties: false
    }
  },
  {
    name: "mcp_warden_validate_policy",
    description: "Validate a GuardianPolicy JSON file.",
    inputSchema: {
      type: "object",
      properties: {
        policyPath: {
          type: "string",
          description: "Path to the policy JSON file to validate."
        }
      },
      required: ["policyPath"],
      additionalProperties: false
    }
  },
  {
    name: "mcp_warden_schema",
    description: "Print or write the GuardianPolicy JSON Schema.",
    inputSchema: {
      type: "object",
      properties: {
        outputPath: {
          type: "string",
          description: "Optional path to write the schema JSON file."
        }
      },
      additionalProperties: false
    }
  }
];

export function redactSensitiveOutput(text) {
  return text.replace(
    /\b((?:api[_-]?key|token|secret|password))(\s*[:=]\s*)["']?[^"'\s;]+["']?/gi,
    "$1$2[REDACTED]"
  );
}

export function appendBoundedOutput(capture, chunk, maxOutput = MAX_OUTPUT) {
  if (capture.text.length >= maxOutput) {
    capture.truncated = true;
    return;
  }

  const remaining = maxOutput - capture.text.length;
  capture.text += chunk.slice(0, remaining);
  if (chunk.length > remaining) {
    capture.truncated = true;
  }
}

export function resolveWardenCommand(options = {}) {
  const env = options.env ?? process.env;
  const execPath = options.execPath ?? process.execPath;
  const exists = options.exists ?? existsSync;
  const override = typeof env.MCP_WARDEN_NPX_CLI === "string" ? env.MCP_WARDEN_NPX_CLI.trim() : "";

  if (override) {
    return exists(override)
      ? { executable: execPath, args: [override] }
      : { error: `MCP_WARDEN_NPX_CLI does not exist: ${override}` };
  }

  const nodeDir = dirname(execPath);
  const candidates = [
    join(nodeDir, "node_modules", "npm", "bin", "npx-cli.js"),
    join(dirname(nodeDir), "node_modules", "npm", "bin", "npx-cli.js"),
    join(dirname(nodeDir), "lib", "node_modules", "npm", "bin", "npx-cli.js")
  ];
  const npxCli = candidates.find((candidate) => exists(candidate));
  if (!npxCli) {
    return {
      error:
        "Could not locate npm's npx-cli.js from the current Node installation. Set MCP_WARDEN_NPX_CLI to the full npx-cli.js path."
    };
  }
  return { executable: execPath, args: [npxCli] };
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function result(id, value) {
  send({ jsonrpc: "2.0", id, result: value });
}

function error(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

function requireString(args, name) {
  const value = args?.[name];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value;
}

function runWarden(args) {
  return new Promise((resolve) => {
    const command = resolveWardenCommand();
    if (command.error) {
      resolve({ code: -1, output: command.error });
      return;
    }

    const child = spawn(command.executable, [...command.args, "--yes", "mcp-warden", ...args], {
      windowsHide: true
    });
    const stdout = { text: "", truncated: false };
    const stderr = { text: "", truncated: false };
    let settled = false;
    const timeout = setTimeout(() => {
      child.kill();
      finish(-1, `mcp-warden timed out after ${TOOL_TIMEOUT_MS}ms`);
    }, TOOL_TIMEOUT_MS);

    function finish(code, fallbackOutput = "") {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      const combined = [stdout.text.trim(), stderr.text.trim(), fallbackOutput.trim()].filter(Boolean).join("\n");
      const redacted = redactSensitiveOutput(combined);
      const output =
        stdout.truncated || stderr.truncated
          ? `${redacted}\n\n[truncated after ${MAX_OUTPUT} characters per stream]`
          : redacted;
      resolve({ code: code ?? 0, output });
    }

    child.stdout.on("data", (chunk) => {
      appendBoundedOutput(stdout, chunk.toString("utf8"));
    });
    child.stderr.on("data", (chunk) => {
      appendBoundedOutput(stderr, chunk.toString("utf8"));
    });
    child.on("error", (err) => {
      finish(-1, err.message);
    });
    child.on("close", (code) => {
      finish(code);
    });
  });
}

async function callTool(name, args) {
  if (name === "mcp_warden_audit_config") {
    return runWarden(["audit", requireString(args, "configPath")]);
  }
  if (name === "mcp_warden_init_policy") {
    const cliArgs = ["init", "--output", requireString(args, "outputPath")];
    if (args?.force === true) {
      cliArgs.push("--force");
    }
    return runWarden(cliArgs);
  }
  if (name === "mcp_warden_validate_policy") {
    return runWarden(["validate", requireString(args, "policyPath")]);
  }
  if (name === "mcp_warden_schema") {
    const cliArgs = ["schema"];
    if (typeof args?.outputPath === "string" && args.outputPath.trim() !== "") {
      cliArgs.push("--output", args.outputPath);
    }
    return runWarden(cliArgs);
  }
  throw new Error(`Unknown tool: ${name}`);
}

export function startServer() {
  const lines = createInterface({ input: process.stdin });

  lines.on("line", async (line) => {
    if (!line.trim()) {
      return;
    }

    let message;
    try {
      message = JSON.parse(line);
    } catch (err) {
      error(null, -32700, err instanceof Error ? err.message : "Invalid JSON");
      return;
    }

    const { id, method, params } = message;

    try {
      if (method === "initialize") {
        result(id, {
          protocolVersion: params?.protocolVersion ?? "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "mcp-warden-adapter", version: "1.0.0" }
        });
        return;
      }

      if (method === "notifications/initialized") {
        return;
      }

      if (method === "tools/list") {
        result(id, { tools });
        return;
      }

      if (method === "tools/call") {
        const { code, output } = await callTool(params?.name, params?.arguments ?? {});
        result(id, {
          content: [{ type: "text", text: output || `mcp-warden exited with code ${code}` }],
          isError: code !== 0
        });
        return;
      }

      error(id, -32601, `Method not found: ${method}`);
    } catch (err) {
      error(id, -32602, err instanceof Error ? err.message : "Invalid request");
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startServer();
}
