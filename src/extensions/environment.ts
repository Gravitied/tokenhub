const SAFE_INHERITED_ENV = [
  "PATH",
  "Path",
  "PATHEXT",
  "SystemRoot",
  "TEMP",
  "TMP",
  "HOME",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA"
];

export function buildExtensionEnvironment(
  allowedNames: string[] = [],
  baseEnv: NodeJS.ProcessEnv = process.env
): Record<string, string> {
  const output: Record<string, string> = {};
  for (const requestedName of [...SAFE_INHERITED_ENV, ...allowedNames]) {
    const actualName = findEnvName(requestedName, baseEnv);
    if (actualName && typeof baseEnv[actualName] === "string") {
      output[actualName] = baseEnv[actualName];
    }
  }
  return output;
}

function findEnvName(name: string, env: NodeJS.ProcessEnv): string | undefined {
  if (Object.prototype.hasOwnProperty.call(env, name)) {
    return name;
  }
  const normalized = name.toLowerCase();
  return Object.keys(env).find((key) => key.toLowerCase() === normalized);
}
