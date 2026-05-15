import { z } from "zod";
import { join } from "node:path";
import { homedir } from "node:os";
import { readFileSync, existsSync } from "node:fs";

const ProviderAdapterSchema = z.enum([
  "@ai-sdk/openai",
  "@ai-sdk/openai-compatible",
  "@ai-sdk/anthropic",
]);
const ModelModeSchema = z.enum(["chat", "responses", "messages"]);
const ProviderIdSchema = z.string().min(1);

const ProviderModelConfigSchema = z.strictObject({
  name: z.string().optional(),
  model: z.string().optional(),
  adapter: ProviderAdapterSchema.optional(),
  baseUrl: z.string().optional(),
  apiKey: z.string().optional(),
  authToken: z.string().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  mode: ModelModeSchema.optional(),
});

const ProviderConfigSchema = ProviderModelConfigSchema.extend({
  models: z.record(ProviderModelConfigSchema).optional(),
});

export const ConfigSchema = z.strictObject({
  $schema: z.string().optional(),
  provider: ProviderIdSchema.optional(),
  model: z.string().optional(),
  approval: z.enum(["auto", "on-request", "never"]).optional(),
  // Flat compatibility keys. New configs should prefer the nested `providers` map.
  baseUrl: z.string().optional(),
  apiKey: z.string().optional(),
  authToken: z.string().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  providers: z.record(ProviderConfigSchema).optional(),
});

export type ProviderName = z.infer<typeof ProviderIdSchema>;
export type ProviderAdapter = z.infer<typeof ProviderAdapterSchema>;
export type ModelMode = z.infer<typeof ModelModeSchema>;
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
export type ProviderModelConfig = z.infer<typeof ProviderModelConfigSchema>;
export type Config = z.infer<typeof ConfigSchema>;

export type ModelProfile = {
  id: string;
  provider: ProviderName;
  adapter: ProviderAdapter;
  model: string;
  name?: string;
  baseUrl?: string;
  apiKey?: string;
  authToken?: string;
  maxOutputTokens?: number;
  mode?: ModelMode;
};

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
      const merged = { ...(result.providers ?? {}) };
      for (const [provider, incoming] of Object.entries(providers ?? {})) {
        const existing = merged[provider];
        merged[provider] = {
          ...(existing ?? {}),
          ...incoming,
          models:
            existing?.models || incoming.models
              ? { ...(existing?.models ?? {}), ...(incoming.models ?? {}) }
              : undefined,
        };
      }
      result.providers = merged;
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
  return mergeConfig(mergeConfig(global, project), local);
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
    adapter: resolveProviderAdapter(config, provider),
    name: config.providers?.[provider]?.name,
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
    mode: config.providers?.[provider]?.mode,
    models: config.providers?.[provider]?.models,
  };
}

export function resolveProviderName(config: Config): ProviderName {
  const parsed = parseModelProfileId(config.model);
  return parsed?.provider ?? config.provider ?? "openai";
}

export function resolveModelName(
  config: Config,
  provider: ProviderName,
): string {
  const model = modelNameFromConfig(config, provider);
  return findModelProfile(resolveModelProfiles(config), `${provider}/${model}`)?.model ?? model;
}

export function resolveModelProfiles(config: Config): ModelProfile[] {
  const profiles = new Map<string, ModelProfile>();

  for (const provider of Object.keys(config.providers ?? {})) {
    const providerConfig = config.providers?.[provider];
    if (!providerConfig) continue;

    const base = resolveProviderBaseConfig(config, provider);
    const models = providerConfig.models;
    if (models && Object.keys(models).length > 0) {
      for (const [modelId, modelConfig] of Object.entries(models)) {
        const profile = buildModelProfile(provider, modelId, base, modelConfig);
        profiles.set(profile.id, profile);
      }
      continue;
    }

    const model = modelNameFromConfig(config, provider);
    const profile = buildModelProfile(provider, model, base, { model });
    profiles.set(profile.id, profile);
  }

  if (profiles.size === 0) {
    const provider = resolveProviderName(config);
    const model = modelNameFromConfig(config, provider);
    const profile = buildModelProfile(
      provider,
      model,
      resolveProviderBaseConfig(config, provider),
      { model },
    );
    profiles.set(profile.id, profile);
  }

  return [...profiles.values()];
}

export function resolveModelProfile(config: Config, requestedId?: string): ModelProfile {
  const profiles = resolveModelProfiles(config);
  const selectedId = requestedId ?? defaultModelProfileId(config);
  const selected = findModelProfile(profiles, selectedId);
  if (selected) return selected;

  const fallback = findModelProfile(profiles, defaultModelProfileId(config));
  if (fallback) return fallback;

  return profiles[0]!;
}

export function findModelProfile(
  profiles: ModelProfile[],
  requestedId: string | undefined,
): ModelProfile | undefined {
  if (!requestedId) return undefined;
  const normalized = normalizeModelProfileId(requestedId);
  const exact = profiles.find((profile) => profile.id === normalized);
  if (exact) return exact;

  const parsed = parseModelProfileId(normalized);
  if (parsed) {
    return profiles.find(
      (profile) =>
        profile.provider === parsed.provider &&
        (profile.id === `${parsed.provider}/${parsed.model}` ||
          profile.model === parsed.model),
    );
  }

  const byModel = profiles.filter(
    (profile) =>
      profile.model === normalized ||
      profile.id.endsWith(`/${normalized}`) ||
      profile.name === normalized,
  );
  return byModel.length === 1 ? byModel[0] : undefined;
}

export function defaultModelProfileId(config: Config): string {
  const parsed = parseModelProfileId(config.model);
  if (parsed) return `${parsed.provider}/${parsed.model}`;
  const provider = config.provider ?? "openai";
  return `${provider}/${modelNameFromConfig(config, provider)}`;
}

function resolveProviderBaseConfig(
  config: Config,
  provider: ProviderName,
): ProviderModelConfig & { adapter: ProviderAdapter } {
  const providerConfig = config.providers?.[provider];
  return {
    adapter: resolveProviderAdapter(config, provider),
    name: providerConfig?.name,
    baseUrl: resolveConfigValue(providerConfig?.baseUrl, config.baseUrl),
    apiKey: resolveConfigValue(providerConfig?.apiKey, config.apiKey),
    authToken: resolveConfigValue(providerConfig?.authToken, config.authToken),
    maxOutputTokens: resolveConfigValue(
      providerConfig?.maxOutputTokens,
      config.maxOutputTokens,
    ),
    mode: providerConfig?.mode,
  };
}

function buildModelProfile(
  provider: ProviderName,
  modelId: string,
  base: ProviderModelConfig & { adapter: ProviderAdapter },
  modelConfig: ProviderModelConfig,
): ModelProfile {
  const model = modelConfig.model ?? modelId;
  const adapter = resolveConfigValue(modelConfig.adapter, base.adapter)!;
  const mode = normalizeModelMode(
    adapter,
    resolveConfigValue(modelConfig.mode, base.mode),
  );
  return {
    id: `${provider}/${modelId}`,
    provider,
    adapter,
    model,
    name: modelConfig.name ?? base.name,
    baseUrl: resolveConfigValue(modelConfig.baseUrl, base.baseUrl),
    apiKey: resolveConfigValue(modelConfig.apiKey, base.apiKey),
    authToken: resolveConfigValue(modelConfig.authToken, base.authToken),
    maxOutputTokens: resolveConfigValue(
      modelConfig.maxOutputTokens,
      base.maxOutputTokens,
    ),
    mode,
  };
}

function modelNameFromConfig(config: Config, provider: ProviderName): string {
  const parsed = parseModelProfileId(config.model);
  if (parsed?.provider === provider) return parsed.model;
  const providerModel = config.providers?.[provider]?.model;
  if (providerModel) return stripProviderPrefix(providerModel, provider);
  if (config.provider === provider && config.model) {
    return stripProviderPrefix(config.model, provider);
  }
  if (!config.provider && config.model && !config.model.includes("/")) return config.model;
  return isOpenAIAdapter(resolveProviderAdapter(config, provider))
    ? "gpt-4o"
    : "claude-sonnet-4-5";
}

function parseModelProfileId(
  value: string | undefined,
): { provider: ProviderName; model: string } | undefined {
  if (!value) return undefined;
  const slash = value.indexOf("/");
  if (slash <= 0 || slash === value.length - 1) return undefined;
  const provider = value.slice(0, slash);
  if (!ProviderIdSchema.safeParse(provider).success) return undefined;
  return { provider, model: value.slice(slash + 1) };
}

function normalizeModelProfileId(value: string): string {
  return value.trim();
}

function stripProviderPrefix(value: string, provider: ProviderName): string {
  const prefix = `${provider}/`;
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

function resolveProviderAdapter(config: Config, provider: ProviderName): ProviderAdapter {
  const configured = config.providers?.[provider]?.adapter;
  if (configured) return configured;
  if (provider === "anthropic") return "@ai-sdk/anthropic";
  if (provider === "openai") return "@ai-sdk/openai";
  return "@ai-sdk/openai-compatible";
}

function isOpenAIAdapter(adapter: ProviderAdapter): boolean {
  return adapter === "@ai-sdk/openai" || adapter === "@ai-sdk/openai-compatible";
}

function normalizeModelMode(
  adapter: ProviderAdapter,
  mode: ModelMode | undefined,
): ModelMode | undefined {
  if (adapter === "@ai-sdk/openai-compatible") return "chat";
  if (adapter === "@ai-sdk/anthropic") return "messages";
  return mode;
}
