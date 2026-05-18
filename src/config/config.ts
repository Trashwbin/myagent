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

const ProviderOptionsSchema = z.object({
  baseURL: z.string().optional(),
  baseUrl: z.string().optional(),
  apiKey: z.string().optional(),
  authToken: z.string().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  mode: ModelModeSchema.optional(),
  store: z.boolean().optional(),
}).passthrough();

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

const OpenCodeModelConfigSchema = z.object({
  name: z.string().optional(),
  model: z.string().optional(),
  adapter: ProviderAdapterSchema.optional(),
  npm: ProviderAdapterSchema.optional(),
  options: ProviderOptionsSchema.optional(),
  limit: z
    .strictObject({
      context: z.number().int().positive().optional(),
      output: z.number().int().positive().optional(),
    })
    .optional(),
  variants: z.record(z.unknown()).optional(),
  attachment: z.boolean().optional(),
  tool_call: z.boolean().optional(),
  family: z.string().optional(),
  cost: z
    .strictObject({
      input: z.number().optional(),
      output: z.number().optional(),
    })
    .optional(),
  modalities: z
    .strictObject({
      input: z.array(z.string()).optional(),
      output: z.array(z.string()).optional(),
    })
    .optional(),
}).passthrough();

const OpenCodeProviderConfigSchema = z.object({
  name: z.string().optional(),
  npm: ProviderAdapterSchema.optional(),
  adapter: ProviderAdapterSchema.optional(),
  options: ProviderOptionsSchema.optional(),
  models: z.record(OpenCodeModelConfigSchema).optional(),
}).passthrough();

export const ConfigSchema = z.strictObject({
  $schema: z.string().optional(),
  provider: z.union([ProviderIdSchema, z.record(OpenCodeProviderConfigSchema)]).optional(),
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
export type OpenCodeProviderConfig = z.infer<typeof OpenCodeProviderConfigSchema>;
export type OpenCodeModelConfig = z.infer<typeof OpenCodeModelConfigSchema>;
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
    if (key === "provider" && isProviderMap(value)) {
      result.provider = isProviderMap(result.provider)
        ? mergeProviderMap(result.provider, value)
        : value;
      continue;
    }
    if (key === "providers") {
      const providers = value as Config["providers"];
      result.providers = mergeProviderMap(result.providers ?? {}, providers ?? {}) as Config["providers"];
      continue;
    }
    (result as Record<string, unknown>)[key] = value;
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProviderMap(value: unknown): value is Record<string, OpenCodeProviderConfig> {
  return isRecord(value);
}

function mergeProviderMap<T extends Record<string, unknown>>(
  base: T,
  override: T,
): T {
  const merged = { ...base };
  for (const [provider, incoming] of Object.entries(override)) {
    const existing = merged[provider];
    if (!isRecord(existing) || !isRecord(incoming)) {
      (merged as Record<string, unknown>)[provider] = incoming;
      continue;
    }
    const next: Record<string, unknown> = { ...existing, ...incoming };
    if (isRecord(existing.options) || isRecord(incoming.options)) {
      next.options = {
        ...(isRecord(existing.options) ? existing.options : {}),
        ...(isRecord(incoming.options) ? incoming.options : {}),
      };
    }
    if (isRecord(existing.models) || isRecord(incoming.models)) {
      const models: Record<string, unknown> = { ...(isRecord(existing.models) ? existing.models : {}) };
      for (const [model, modelConfig] of Object.entries(
        isRecord(incoming.models) ? incoming.models : {},
      )) {
        const current = models[model];
        if (isRecord(current) && isRecord(modelConfig)) {
          models[model] = {
            ...current,
            ...modelConfig,
            options:
              isRecord(current.options) || isRecord(modelConfig.options)
                ? {
                    ...(isRecord(current.options) ? current.options : {}),
                    ...(isRecord(modelConfig.options) ? modelConfig.options : {}),
                  }
                : undefined,
          };
          if ((models[model] as Record<string, unknown>).options === undefined) {
            delete (models[model] as Record<string, unknown>).options;
          }
        } else {
          models[model] = modelConfig;
        }
      }
      next.models = models;
    }
    (merged as Record<string, unknown>)[provider] = next;
  }
  return merged;
}

function mergeLayer(primaryPath: string, legacyPath: string): Config {
  const legacy = readConfigFile(legacyPath) ?? {};
  const primary = readConfigFile(primaryPath) ?? {};
  return mergeConfig(legacy, primary);
}

export type LoadConfigOptions = {
  workspaceRoot?: string;
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
  if (!options.workspaceRoot) return global;
  const project = mergeLayer(projectConfigPath(options.workspaceRoot), projectLegacySettingsPath(options.workspaceRoot));
  const local = mergeLayer(localConfigPath(options.workspaceRoot), localLegacySettingsPath(options.workspaceRoot));
  return mergeConfig(mergeConfig(global, project), local);
}

export function loadGlobalConfig(): Config {
  return loadConfig({});
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
  const providerConfig = getProviderConfig(config, provider);
  const options = getProviderOptions(providerConfig);
  return {
    adapter: resolveProviderAdapter(config, provider),
    name: getString(providerConfig, "name"),
    model: modelNameFromConfig(config, provider),
    baseUrl: resolveConfigValue(
      getString(options, "baseURL"),
      getString(options, "baseUrl"),
      getString(providerConfig, "baseUrl"),
      config.baseUrl,
    ),
    apiKey: resolveConfigValue(
      getString(options, "apiKey"),
      getString(providerConfig, "apiKey"),
      config.apiKey,
    ),
    authToken: resolveConfigValue(
      getString(options, "authToken"),
      getString(providerConfig, "authToken"),
      config.authToken,
    ),
    maxOutputTokens: resolveConfigValue(
      getPositiveInt(options, "maxOutputTokens"),
      getPositiveInt(providerConfig, "maxOutputTokens"),
      config.maxOutputTokens,
    ),
    mode: resolveConfigValue(getMode(options), getMode(providerConfig)),
    models: getModels(providerConfig) as ProviderConfig["models"],
  };
}

export function resolveProviderName(config: Config): ProviderName {
  const parsed = parseModelProfileId(config.model);
  return parsed?.provider ?? legacyProviderName(config) ?? firstConfiguredProvider(config) ?? "openai";
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
  const providers = getConfiguredProviders(config);

  for (const provider of Object.keys(providers)) {
    const providerConfig = providers[provider];
    if (!providerConfig) continue;

    const base = resolveProviderBaseConfig(config, provider);
    const models = getModels(providerConfig);
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
  const provider = legacyProviderName(config) ?? firstConfiguredProvider(config) ?? "openai";
  return `${provider}/${modelNameFromConfig(config, provider)}`;
}

function resolveProviderBaseConfig(
  config: Config,
  provider: ProviderName,
): ProviderModelConfig & { adapter: ProviderAdapter } {
  const providerConfig = getProviderConfig(config, provider);
  const options = getProviderOptions(providerConfig);
  return {
    adapter: resolveProviderAdapter(config, provider),
    name: getString(providerConfig, "name"),
    baseUrl: resolveConfigValue(
      getString(options, "baseURL"),
      getString(options, "baseUrl"),
      getString(providerConfig, "baseUrl"),
      config.baseUrl,
    ),
    apiKey: resolveConfigValue(
      getString(options, "apiKey"),
      getString(providerConfig, "apiKey"),
      config.apiKey,
    ),
    authToken: resolveConfigValue(
      getString(options, "authToken"),
      getString(providerConfig, "authToken"),
      config.authToken,
    ),
    maxOutputTokens: resolveConfigValue(
      getPositiveInt(options, "maxOutputTokens"),
      getPositiveInt(providerConfig, "maxOutputTokens"),
      config.maxOutputTokens,
    ),
    mode: resolveConfigValue(getMode(options), getMode(providerConfig)),
  };
}

function buildModelProfile(
  provider: ProviderName,
  modelId: string,
  base: ProviderModelConfig & { adapter: ProviderAdapter },
  modelConfig: ProviderModelConfig | OpenCodeModelConfig,
): ModelProfile {
  const options = getProviderOptions(modelConfig);
  const model = getString(modelConfig, "model") ?? modelId;
  const adapter = resolveConfigValue(
    getAdapter(modelConfig, "adapter"),
    getAdapter(modelConfig, "npm"),
    base.adapter,
  )!;
  const mode = normalizeModelMode(
    adapter,
    resolveConfigValue(getMode(options), getMode(modelConfig), base.mode),
  );
  return {
    id: `${provider}/${modelId}`,
    provider,
    adapter,
    model,
    name: getString(modelConfig, "name") ?? base.name,
    baseUrl: resolveConfigValue(
      getString(options, "baseURL"),
      getString(options, "baseUrl"),
      getString(modelConfig, "baseUrl"),
      base.baseUrl,
    ),
    apiKey: resolveConfigValue(
      getString(options, "apiKey"),
      getString(modelConfig, "apiKey"),
      base.apiKey,
    ),
    authToken: resolveConfigValue(
      getString(options, "authToken"),
      getString(modelConfig, "authToken"),
      base.authToken,
    ),
    maxOutputTokens: resolveConfigValue(
      getPositiveInt(options, "maxOutputTokens"),
      getPositiveInt(modelConfig, "maxOutputTokens"),
      getOutputLimit(modelConfig),
      base.maxOutputTokens,
    ),
    mode,
  };
}

function modelNameFromConfig(config: Config, provider: ProviderName): string {
  const parsed = parseModelProfileId(config.model);
  if (parsed?.provider === provider) return parsed.model;
  const providerModel = getString(getProviderConfig(config, provider), "model");
  if (providerModel) return stripProviderPrefix(providerModel, provider);
  if (legacyProviderName(config) === provider && config.model) {
    return stripProviderPrefix(config.model, provider);
  }
  if (!legacyProviderName(config) && config.model && !config.model.includes("/")) return config.model;
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
  const providerConfig = getProviderConfig(config, provider);
  const configured = getAdapter(providerConfig, "adapter") ?? getAdapter(providerConfig, "npm");
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

function legacyProviderName(config: Config): ProviderName | undefined {
  return typeof config.provider === "string" ? config.provider : undefined;
}

function firstConfiguredProvider(config: Config): ProviderName | undefined {
  return Object.keys(getConfiguredProviders(config))[0];
}

function getConfiguredProviders(config: Config): Record<string, ProviderConfig | OpenCodeProviderConfig> {
  return {
    ...(config.providers ?? {}),
    ...(isProviderMap(config.provider) ? config.provider : {}),
  };
}

function getProviderConfig(
  config: Config,
  provider: ProviderName,
): ProviderConfig | OpenCodeProviderConfig | undefined {
  return getConfiguredProviders(config)[provider];
}

function getProviderOptions(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  return isRecord(value.options) ? value.options : undefined;
}

function getModels(value: unknown): Record<string, ProviderModelConfig | OpenCodeModelConfig> | undefined {
  if (!isRecord(value) || !isRecord(value.models)) return undefined;
  return value.models as Record<string, ProviderModelConfig | OpenCodeModelConfig>;
}

function getString(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined;
  const item = value[key];
  return typeof item === "string" ? item : undefined;
}

function getPositiveInt(value: unknown, key: string): number | undefined {
  if (!isRecord(value)) return undefined;
  const item = value[key];
  return typeof item === "number" && Number.isInteger(item) && item > 0 ? item : undefined;
}

function getAdapter(value: unknown, key: string): ProviderAdapter | undefined {
  const item = getString(value, key);
  return ProviderAdapterSchema.safeParse(item).success ? (item as ProviderAdapter) : undefined;
}

function getMode(value: unknown): ModelMode | undefined {
  const item = getString(value, "mode");
  return ModelModeSchema.safeParse(item).success ? (item as ModelMode) : undefined;
}

function getOutputLimit(value: unknown): number | undefined {
  if (!isRecord(value) || !isRecord(value.limit)) return undefined;
  return getPositiveInt(value.limit, "output");
}
