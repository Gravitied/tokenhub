import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";

const stringListSchema = z.array(z.string().min(1)).default([]);

const policySchema = z.object({
  version: z.literal(1),
  workflows: z.object({ allow: stringListSchema.optional(), deny: stringListSchema.optional() }).default({}),
  sources: z.object({ allow: stringListSchema.optional(), deny: stringListSchema.optional() }).default({}),
  extensions: z.object({ allow: stringListSchema.optional(), deny: stringListSchema.optional() }).default({}),
  network: z
    .object({
      allowPrivateNetwork: z.boolean().optional(),
      allowedHosts: stringListSchema.optional(),
      blockedHosts: stringListSchema.optional()
    })
    .default({})
});

export type SecurityPolicyConfig = z.infer<typeof policySchema>;

export type NetworkSecurityPolicy = {
  allowPrivateNetwork?: boolean;
  allowedHosts: string[];
  blockedHosts: string[];
};

export class SecurityPolicy {
  constructor(
    readonly config: SecurityPolicyConfig,
    readonly configPath: string,
    readonly loaded: boolean
  ) {}

  assertWorkflow(name: string): void {
    assertAllowedByList("Workflow", name, this.config.workflows.allow ?? [], this.config.workflows.deny ?? []);
  }

  assertSource(name: string): void {
    assertAllowedByList("Retrieval source", name, this.config.sources.allow ?? [], this.config.sources.deny ?? []);
  }

  assertExtension(id: string | undefined): void {
    if (!id) {
      return;
    }
    assertAllowedByList("Extension", id, this.config.extensions.allow ?? [], this.config.extensions.deny ?? []);
  }

  networkPolicy(): NetworkSecurityPolicy {
    return {
      allowPrivateNetwork: this.config.network.allowPrivateNetwork,
      allowedHosts: this.config.network.allowedHosts ?? [],
      blockedHosts: this.config.network.blockedHosts ?? []
    };
  }

  summary(): Record<string, unknown> {
    return {
      loaded: this.loaded,
      configPath: this.configPath,
      workflows: summarizeRules(this.config.workflows.allow, this.config.workflows.deny),
      sources: summarizeRules(this.config.sources.allow, this.config.sources.deny),
      extensions: summarizeRules(this.config.extensions.allow, this.config.extensions.deny),
      network: {
        allowPrivateNetwork: this.config.network.allowPrivateNetwork === true,
        allowedHosts: this.config.network.allowedHosts?.length ?? 0,
        blockedHosts: this.config.network.blockedHosts?.length ?? 0
      }
    };
  }
}

export function loadSecurityPolicy(input: { root: string; policyPath?: string; env?: NodeJS.ProcessEnv }): SecurityPolicy {
  const env = input.env ?? process.env;
  const configuredPath = input.policyPath ?? env.TOKENHUB_POLICY;
  const configPath = configuredPath ? resolve(input.root, configuredPath) : join(resolve(input.root), "tokenhub.policy.json");
  if (!existsSync(configPath)) {
    return new SecurityPolicy(policySchema.parse({ version: 1 }), configPath, false);
  }
  const parsed = policySchema.parse(JSON.parse(readFileSync(configPath, "utf8")));
  return new SecurityPolicy(parsed, configPath, true);
}

function assertAllowedByList(label: string, name: string, allow: string[], deny: string[]): void {
  if (matchesAny(name, deny)) {
    throw new Error(`${label} ${name} is denied by security policy.`);
  }
  if (allow.length > 0 && !matchesAny(name, allow)) {
    throw new Error(`${label} ${name} is not allowed by security policy.`);
  }
}

function matchesAny(value: string, patterns: string[]): boolean {
  return patterns.some((pattern) => pattern === "*" || pattern.toLowerCase() === value.toLowerCase());
}

function summarizeRules(allow: string[] | undefined, deny: string[] | undefined): Record<string, number> {
  return { allow: allow?.length ?? 0, deny: deny?.length ?? 0 };
}
