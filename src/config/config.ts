import { z } from "zod";
import { join } from "node:path";
import { homedir } from "node:os";
import { readFileSync, existsSync } from "node:fs";

const ProviderNameSchema = z.enum(["openai", "anthropic"]);

const ProviderConfigSchema = z.strictObject({
  model: z.string().optional(),
  baseUrl: z.string().optional(),
  apiKey: z.string().optional(),
  authToken: z.string().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
});

export const ConfigSchema = z.strictObject({
  $schema: z.string().optional(),
  provider: ProviderNameSchema.optional(),
  model: z.string().optional(),
  approval: z.enum(["auto", "on-request", "never"]).optional(),
  maxTurns: z.number().int().positive().optional(),
  // Flat compatibility keys. New configs should prefer the nested `providers` map.
  baseUrl: z.string().optional(),
  apiKey: z.string().optional(),
  authToken: z.string().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  providers: z
    .object({
      openai: ProviderConfigSchema.optional(),
      anthropic: ProviderConfigSchema.optional(),
    })
    .partial()
    .optional(),
});

export type ProviderName = z.infer<typeof ProviderNameSchema>;
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
export type Config = z.infer<typeof ConfigSchema>;

export function globalConfigPath(): string {
  const home = process.env.MYAGENT_HOME ?? join(homedir(), ".myagent");
  return join(home, "config.json");
}

export function projectConfigPath(workspaceRoot: string): string {
  return join(workspaceRoot, ".myagent", "config.json");
}

export function localConfigPath(workspaceRoot: string): string {
  return join(workspaceRoot, ".myagent", "config.local.json");
}

function globalLegacySettingsPath(): string {
  const home = process.env.MYAGENT_HOME ?? join(homedir(), ".myagent");
  return join(home, "settings.json");
}

function projectLegacySettingsPath(workspaceRoot: string): string {
  return join(workspaceRoot, ".myagent", "settings.json");
}

function localLegacySettingsPath(workspaceRoot: string): string {
  return join(workspaceRoot, ".myagent", "settings.local.json");
}

function readJsonObject(filePath: string): unknown {
  const raw = readFileSync(filePath, "utf-8").trim();
  if (!raw) return undefined;
  const parsed = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(
      `Config file ${filePath}: expected a JSON object, got ${Array.isArray(parsed) ? "array" : typeof parsed}`,
    );
  }
  return parsed;
}

function readConfigFile(filePath: string): Config | undefined {
  if (!existsSync(filePath)) return undefined;
  try {
    const parsed = readJsonObject(filePath);
    if (parsed === undefined) return undefined;
    return ConfigSchema.parse(parsed);
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      const issues = err.issues
        .map((i) => `  ${i.path.join(".")}: ${i.message}`)
        .join("\n");
      throw new Error(`Config file ${filePath} has invalid schema:\n${issues}`);
    }
    if (err instanceof SyntaxError) {
      throw new Error(`Config file ${filePath}: invalid JSON — ${err.message}`);
    }
    throw err;
  }
}

function mergeConfig(base: Config, override: Config): Config {
  const result: Config = { ...base };
  for (const [key, value] of Object.entries(override) as [keyof Config, Config[keyof Config]][]) {
    if (value === undefined) continue;
    if (key === "providers") {
      const providers = value as Config["providers"];
      result.providers = {
        ...(result.providers ?? {}),
        ...(providers ?? {}),
      };
      continue;
    }
    (result as Record<string, unknown>)[key] = value;
  }
  return result;
}

function mergeLayer(primaryPath: string, legacyPath: string): Config {
  const legacy = readConfigFile(legacyPath) ?? {};
  const primary = readConfigFile(primaryPath) ?? {};
  return mergeConfig(legacy, primary);
}

export type LoadConfigOptions = {
  workspaceRoot: string;
};

function envConfig(): Config {
  const provider = process.env.MYAGENT_PROVIDER;
  const model = process.env.MYAGENT_MODEL;
  const baseUrl = process.env.MYAGENT_BASE_URL;
  const apiKey = process.env.MYAGENT_API_KEY;
  const authToken = process.env.MYAGENT_AUTH_TOKEN;
  const maxOutputTokensRaw = process.env.MYAGENT_MAX_OUTPUT_TOKENS;
  const approval = process.env.MYAGENT_APPROVAL;

  const config: Config = {};
  if (provider === "openai" || provider === "anthropic") config.provider = provider;
  if (approval === "auto" || approval === "on-request" || approval === "never") {
    config.approval = approval;
  }

  const selectedProvider = config.provider ?? "openai";
  const providerConfig: ProviderConfig = {};
  if (model) providerConfig.model = model;
  if (baseUrl) providerConfig.baseUrl = baseUrl;
  if (apiKey) providerConfig.apiKey = apiKey;
  if (authToken) providerConfig.authToken = authToken;
  if (maxOutputTokensRaw) {
    const parsed = Number.parseInt(maxOutputTokensRaw, 10);
    if (Number.isInteger(parsed) && parsed > 0) providerConfig.maxOutputTokens = parsed;
  }

  if (Object.keys(providerConfig).length > 0) {
    config.providers = { [selectedProvider]: providerConfig };
  }
  return config;
}

/**
 * Load and merge config from three layers:
 * 1. global (~/.myagent/config.json)
 * 2. project (<workspace>/.myagent/config.json)
 * 3. local  (<workspace>/.myagent/config.local.json)
 *
 * Legacy settings.json/settings.local.json files are still read as fallback within
 * the same layer, but config.json wins when both exist.
 */
export function loadConfig(options: LoadConfigOptions): Config {
  const global = mergeLayer(globalConfigPath(), globalLegacySettingsPath());
  const project = mergeLayer(projectConfigPath(options.workspaceRoot), projectLegacySettingsPath(options.workspaceRoot));
  const local = mergeLayer(localConfigPath(options.workspaceRoot), localLegacySettingsPath(options.workspaceRoot));
  return mergeConfig(mergeConfig(mergeConfig(global, project), local), envConfig());
}

export function resolveConfigValue<T>(...values: Array<T | undefined>): T | undefined {
  for (const value of values) {
    if (value !== undefined) return value;
  }
  return undefined;
}

export function resolveApprovalMode(
  config: Config,
): "auto" | "on-request" | "never" {
  return config.approval ?? "auto";
}

export function resolveProviderConfig(
  config: Config,
  provider: ProviderName,
): ProviderConfig {
  return {
    model: resolveConfigValue(config.providers?.[provider]?.model, config.model),
    baseUrl: resolveConfigValue(config.providers?.[provider]?.baseUrl, config.baseUrl),
    apiKey: resolveConfigValue(config.providers?.[provider]?.apiKey, config.apiKey),
    authToken: resolveConfigValue(
      config.providers?.[provider]?.authToken,
      config.authToken,
    ),
    maxOutputTokens: resolveConfigValue(
      config.providers?.[provider]?.maxOutputTokens,
      config.maxOutputTokens,
    ),
  };
}

export function resolveProviderName(config: Config): ProviderName {
  return config.provider ?? "openai";
}

export function resolveModelName(
  config: Config,
  provider: ProviderName,
): string {
  const providerConfig = resolveProviderConfig(config, provider);
  return providerConfig.model ?? (provider === "openai" ? "gpt-4o" : "claude-sonnet-4-5");
}
