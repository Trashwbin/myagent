import { z } from "zod";
import { join } from "node:path";
import { homedir } from "node:os";
import { readFileSync, existsSync } from "node:fs";

// --- Schema ---

export const SettingsSchema = z.strictObject({
  provider: z.enum(["openai", "anthropic"]).optional(),
  model: z.string().optional(),
  baseUrl: z.string().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  maxTurns: z.number().int().positive().optional(),
  approval: z.enum(["auto", "on-request"]).optional(),
});

export type Settings = z.infer<typeof SettingsSchema>;

// --- Paths ---

export function globalSettingsPath(): string {
  const home = process.env.MYAGENT_HOME ?? join(homedir(), ".myagent");
  return join(home, "settings.json");
}

export function projectSettingsPath(workspaceRoot: string): string {
  return join(workspaceRoot, ".myagent", "settings.json");
}

export function localSettingsPath(workspaceRoot: string): string {
  return join(workspaceRoot, ".myagent", "settings.local.json");
}

// --- File reading ---

function readSettingsFile(filePath: string): Settings | undefined {
  if (!existsSync(filePath)) return undefined;
  try {
    const raw = readFileSync(filePath, "utf-8").trim();
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error(
        `Settings file ${filePath}: expected a JSON object, got ${Array.isArray(parsed) ? "array" : typeof parsed}`,
      );
    }
    return SettingsSchema.parse(parsed);
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      const issues = err.issues
        .map((i) => `  ${i.path.join(".")}: ${i.message}`)
        .join("\n");
      throw new Error(`Settings file ${filePath} has invalid schema:\n${issues}`);
    }
    if (err instanceof SyntaxError) {
      throw new Error(`Settings file ${filePath}: invalid JSON — ${err.message}`);
    }
    throw err;
  }
}

// --- Merge ---

function mergeSettings(base: Settings, override: Settings): Settings {
  const result: Settings = { ...base };
  for (const [key, value] of Object.entries(override) as [keyof Settings, Settings[keyof Settings]][]) {
    if (value !== undefined) {
      (result as Record<string, unknown>)[key] = value;
    }
  }
  return result;
}

export type LoadSettingsOptions = {
  workspaceRoot: string;
};

/**
 * Load and merge settings from all three layers:
 * 1. global (~/.myagent/settings.json)
 * 2. project (<workspace>/.myagent/settings.json)
 * 3. local  (<workspace>/.myagent/settings.local.json)
 *
 * Later layers override earlier ones. Missing files are silently skipped.
 * Schema errors and JSON parse errors are thrown with actionable messages.
 */
export function loadSettings(options: LoadSettingsOptions): Settings {
  const global = readSettingsFile(globalSettingsPath()) ?? {};
  const project = readSettingsFile(projectSettingsPath(options.workspaceRoot)) ?? {};
  const local = readSettingsFile(localSettingsPath(options.workspaceRoot)) ?? {};
  return mergeSettings(mergeSettings(global, project), local);
}

/**
 * Resolve a single setting value with full priority:
 * 1. Explicit value (from CLI flag)
 * 2. Environment variable
 * 3. Merged file settings
 * 4. Default value
 */
export function resolveSetting<T>(
  cliValue: T | undefined,
  envValue: T | undefined,
  settingsValue: T | undefined,
  defaultValue: T,
): T {
  if (cliValue !== undefined) return cliValue;
  if (envValue !== undefined) return envValue;
  if (settingsValue !== undefined) return settingsValue;
  return defaultValue;
}

export function resolveApprovalMode(
  argv: string[],
  optionsApproval: string,
  envApproval: string | undefined,
  settings: Settings,
): "auto" | "on-request" {
  const explicit =
    argv.includes("--approval") || argv.some((a) => a.startsWith("--approval="));
  return resolveSetting(
    explicit ? (optionsApproval as "auto" | "on-request") : undefined,
    envApproval as "auto" | "on-request" | undefined,
    settings.approval,
    "auto",
  ) as "auto" | "on-request";
}
