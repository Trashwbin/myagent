import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  ConfigSchema,
  globalConfigPath,
  localConfigPath,
  loadConfig,
  loadGlobalConfig,
  projectConfigPath,
  resolveApprovalMode,
  resolveModelProfile,
  resolveModelProfiles,
  resolveModelName,
  resolveProviderConfig,
  resolveProviderName,
} from "../src/config/config.js";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("ConfigSchema", () => {
  it("accepts empty config", () => {
    expect(ConfigSchema.parse({})).toEqual({});
  });

  it("accepts OpenCode-style provider config and secrets", () => {
    const input = {
      $schema: "https://myagent.dev/config.json",
      approval: "on-request" as const,
      model: "openai/gpt-4o",
      provider: {
        openai: {
          npm: "@ai-sdk/openai" as const,
          options: {
            baseURL: "https://api.example.com/v1",
            apiKey: "sk-test",
            maxOutputTokens: 4096,
            mode: "responses",
          },
          models: {
            "gpt-4o": {
              name: "GPT-4o",
              limit: { context: 128000, output: 4096 },
              options: { store: false },
            },
          },
        },
      },
    };
    expect(ConfigSchema.parse(input)).toEqual(input);
  });

  it("rejects invalid provider", () => {
    expect(() => ConfigSchema.parse({ provider: "" })).toThrow();
  });

  it("rejects invalid approval", () => {
    expect(() => ConfigSchema.parse({ approval: "invalid-mode" })).toThrow();
  });

  it("rejects maxTurns because tool turn limits are not user config", () => {
    expect(() => ConfigSchema.parse({ maxTurns: 12 })).toThrow();
  });

  it("rejects unknown keys", () => {
    expect(() => ConfigSchema.parse({ unknown: true })).toThrow();
  });
});

describe("config paths", () => {
  it("global path uses config.json", () => {
    expect(globalConfigPath()).toMatch(/\.myagent\/config\.json$/);
  });

  it("project path is under workspace .myagent/config.json", () => {
    expect(projectConfigPath("/workspace")).toBe("/workspace/.myagent/config.json");
  });

  it("local path uses config.local.json", () => {
    expect(localConfigPath("/workspace")).toBe("/workspace/.myagent/config.local.json");
  });
});

describe("loadConfig", () => {
  let tmp: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "myagent-config-"));
    originalHome = process.env.MYAGENT_HOME;
    process.env.MYAGENT_HOME = join(tmp, "empty-home");
    await mkdir(process.env.MYAGENT_HOME, { recursive: true });
  });

  afterEach(async () => {
    if (originalHome === undefined) {
      delete process.env.MYAGENT_HOME;
    } else {
      process.env.MYAGENT_HOME = originalHome;
    }
    await rm(tmp, { recursive: true, force: true });
  });

  it("returns empty object when no config files exist", () => {
    expect(loadConfig({ workspaceRoot: tmp })).toEqual({});
  });

  it("reads global config", async () => {
    const homeDir = join(tmp, "home");
    await mkdir(homeDir, { recursive: true });
    await writeFile(
      join(homeDir, "config.json"),
      JSON.stringify({ provider: { openai: { models: { "gpt-4o": {} } } }, model: "openai/gpt-4o" }),
    );

    const original = process.env.MYAGENT_HOME;
    process.env.MYAGENT_HOME = homeDir;
    try {
      const config = loadConfig({ workspaceRoot: tmp });
      expect(config.model).toBe("openai/gpt-4o");
      expect(config.provider).toEqual({ openai: { models: { "gpt-4o": {} } } });
    } finally {
      process.env.MYAGENT_HOME = original;
    }
  });

  it("can load only global config without project overrides", async () => {
    const homeDir = join(tmp, "home-global-only");
    const projectDir = join(tmp, "project");
    await mkdir(homeDir, { recursive: true });
    await mkdir(join(projectDir, ".myagent"), { recursive: true });
    await writeFile(join(homeDir, "config.json"), JSON.stringify({ provider: "openai" }));
    await writeFile(
      join(projectDir, ".myagent", "config.json"),
      JSON.stringify({ provider: "anthropic" }),
    );

    const original = process.env.MYAGENT_HOME;
    process.env.MYAGENT_HOME = homeDir;
    try {
      expect(loadGlobalConfig()).toEqual({ provider: "openai" });
      expect(loadConfig({ workspaceRoot: projectDir })).toMatchObject({
        provider: "anthropic",
      });
    } finally {
      process.env.MYAGENT_HOME = original;
    }
  });

  it("prefers config.json over legacy settings.json in the same layer", async () => {
    const myagentDir = join(tmp, ".myagent");
    await mkdir(myagentDir, { recursive: true });
    await writeFile(join(myagentDir, "settings.json"), JSON.stringify({ provider: "anthropic" }));
    await writeFile(join(myagentDir, "config.json"), JSON.stringify({ provider: "openai" }));

    const original = process.env.MYAGENT_HOME;
    process.env.MYAGENT_HOME = join(tmp, "empty-home");
    await mkdir(process.env.MYAGENT_HOME, { recursive: true });
    try {
      const config = loadConfig({ workspaceRoot: tmp });
      expect(config.provider).toBe("openai");
    } finally {
      process.env.MYAGENT_HOME = original;
    }
  });

  it("reads legacy settings.json as fallback", async () => {
    const myagentDir = join(tmp, ".myagent");
    await mkdir(myagentDir, { recursive: true });
    await writeFile(
      join(myagentDir, "settings.json"),
      JSON.stringify({
        provider: "openai",
        model: "gpt-4o-mini",
        apiKey: "sk-legacy",
        maxOutputTokens: 2048,
      }),
    );

    const original = process.env.MYAGENT_HOME;
    process.env.MYAGENT_HOME = join(tmp, "empty-home");
    await mkdir(process.env.MYAGENT_HOME, { recursive: true });
    try {
      const config = loadConfig({ workspaceRoot: tmp });
      expect(config.provider).toBe("openai");
      expect(config.model).toBe("gpt-4o-mini");
      expect(config.apiKey).toBe("sk-legacy");
      expect(config.maxOutputTokens).toBe(2048);
    } finally {
      process.env.MYAGENT_HOME = original;
    }
  });

  it("local config overrides project config", async () => {
    const myagentDir = join(tmp, ".myagent");
    await mkdir(myagentDir, { recursive: true });
    await writeFile(
      join(myagentDir, "config.json"),
      JSON.stringify({ approval: "auto", provider: { openai: { models: { "gpt-4o": {} } } } }),
    );
    await writeFile(
      join(myagentDir, "config.local.json"),
      JSON.stringify({
        approval: "on-request",
        provider: { openai: { models: { "gpt-4o-mini": {} } } },
        model: "openai/gpt-4o-mini",
      }),
    );

    const original = process.env.MYAGENT_HOME;
    process.env.MYAGENT_HOME = join(tmp, "empty-home");
    await mkdir(process.env.MYAGENT_HOME, { recursive: true });
    try {
      const config = loadConfig({ workspaceRoot: tmp });
      expect(config.approval).toBe("on-request");
      expect(config.model).toBe("openai/gpt-4o-mini");
      expect(config.provider).toEqual({
        openai: {
          models: {
            "gpt-4o": {},
            "gpt-4o-mini": {},
          },
        },
      });
    } finally {
      process.env.MYAGENT_HOME = original;
    }
  });

  it("reports clear error for invalid JSON", async () => {
    const myagentDir = join(tmp, ".myagent");
    await mkdir(myagentDir, { recursive: true });
    await writeFile(join(myagentDir, "config.json"), "{bad json");

    const original = process.env.MYAGENT_HOME;
    process.env.MYAGENT_HOME = join(tmp, "empty-home");
    await mkdir(process.env.MYAGENT_HOME, { recursive: true });
    try {
      expect(() => loadConfig({ workspaceRoot: tmp })).toThrow(/invalid JSON/);
    } finally {
      process.env.MYAGENT_HOME = original;
    }
  });
});

describe("config resolution helpers", () => {
  it("defaults provider to openai", () => {
    expect(resolveProviderName({})).toBe("openai");
  });

  it("resolves provider-specific config before flat compatibility keys", () => {
    const config = {
      model: "openai/gpt-4o-mini",
      apiKey: "sk-flat",
      baseUrl: "https://flat.example",
      maxOutputTokens: 1024,
      provider: {
        openai: {
          npm: "@ai-sdk/openai" as const,
          options: {
            apiKey: "sk-openai",
            baseURL: "https://openai.example",
            maxOutputTokens: 2048,
            mode: "responses" as const,
          },
          models: {
            "gpt-4o-mini": {},
          },
        },
      },
    };
    expect(resolveProviderConfig(config, "openai")).toEqual({
      adapter: "@ai-sdk/openai",
      name: undefined,
      model: "gpt-4o-mini",
      apiKey: "sk-openai",
      authToken: undefined,
      baseUrl: "https://openai.example",
      maxOutputTokens: 2048,
      mode: "responses",
      models: { "gpt-4o-mini": {} },
    });
  });

  it("falls back to provider-specific defaults for model names", () => {
    expect(resolveModelName({}, "openai")).toBe("gpt-4o");
    expect(resolveModelName({}, "anthropic")).toBe("claude-sonnet-4-5");
  });

  it("defaults approval mode to auto", () => {
    expect(resolveApprovalMode({})).toBe("auto");
    expect(resolveApprovalMode({ approval: "on-request" })).toBe("on-request");
    expect(resolveApprovalMode({ approval: "never" })).toBe("never");
  });

  it("resolves configured provider model profiles", () => {
    const config = {
      model: "mimo/mimo-v2.5-pro",
      provider: {
        mimo: {
          npm: "@ai-sdk/openai-compatible" as const,
          options: {
            baseURL: "https://openai.example/v1",
            apiKey: "sk-openai",
            mode: "chat" as const,
          },
          models: {
            "mimo-v2.5-pro": {
              name: "mimo-v2.5-pro",
              limit: { output: 2048 },
            },
            "gpt-4o": {
              npm: "@ai-sdk/openai" as const,
              options: { mode: "responses" as const },
            },
          },
        },
        "mimo-claude": {
          npm: "@ai-sdk/anthropic" as const,
          options: {
            baseURL: "https://anthropic.example",
            authToken: "sk-ant",
          },
          models: {
            "claude-sonnet-4-5": {},
          },
        },
      },
    };

    expect(resolveModelProfiles(config)).toEqual([
      {
        id: "mimo/mimo-v2.5-pro",
        provider: "mimo",
        adapter: "@ai-sdk/openai-compatible",
        model: "mimo-v2.5-pro",
        name: "mimo-v2.5-pro",
        baseUrl: "https://openai.example/v1",
        apiKey: "sk-openai",
        authToken: undefined,
        maxOutputTokens: 2048,
        mode: "chat",
      },
      {
        id: "mimo/gpt-4o",
        provider: "mimo",
        adapter: "@ai-sdk/openai",
        model: "gpt-4o",
        name: undefined,
        baseUrl: "https://openai.example/v1",
        apiKey: "sk-openai",
        authToken: undefined,
        maxOutputTokens: undefined,
        mode: "responses",
      },
      {
        id: "mimo-claude/claude-sonnet-4-5",
        provider: "mimo-claude",
        adapter: "@ai-sdk/anthropic",
        model: "claude-sonnet-4-5",
        name: undefined,
        baseUrl: "https://anthropic.example",
        apiKey: undefined,
        authToken: "sk-ant",
        maxOutputTokens: undefined,
        mode: "messages",
      },
    ]);
    expect(resolveModelProfile(config)).toMatchObject({
      id: "mimo/mimo-v2.5-pro",
      model: "mimo-v2.5-pro",
    });
    expect(resolveModelProfile(config, "claude-sonnet-4-5")).toMatchObject({
      id: "mimo-claude/claude-sonnet-4-5",
      provider: "mimo-claude",
      adapter: "@ai-sdk/anthropic",
    });
  });

  it("expands OpenCode model variants without changing the request model name", () => {
    const config = {
      model: "mimo/gpt-5.4/high",
      provider: {
        mimo: {
          npm: "@ai-sdk/openai" as const,
          options: {
            baseURL: "https://openai.example/v1",
            apiKey: "sk-openai",
            mode: "responses" as const,
            store: false,
            systemMessageMode: "developer",
          },
          models: {
            "gpt-5.4": {
              name: "GPT-5.4",
              options: {
                reasoningSummary: "auto",
                textVerbosity: "medium",
              },
              variants: {
                low: {},
                high: { textVerbosity: "high" },
              },
            },
          },
        },
      },
    };

    expect(resolveModelProfiles(config)).toEqual([
      expect.objectContaining({
        id: "mimo/gpt-5.4",
        model: "gpt-5.4",
        variants: ["low", "high"],
        options: {
          store: false,
          systemMessageMode: "developer",
          reasoningSummary: "auto",
          textVerbosity: "medium",
        },
      }),
      expect.objectContaining({
        id: "mimo/gpt-5.4/low",
        model: "gpt-5.4",
        variant: "low",
        options: {
          store: false,
          systemMessageMode: "developer",
          reasoningSummary: "auto",
          textVerbosity: "medium",
          reasoningEffort: "low",
        },
      }),
      expect.objectContaining({
        id: "mimo/gpt-5.4/high",
        model: "gpt-5.4",
        variant: "high",
        options: {
          store: false,
          systemMessageMode: "developer",
          reasoningSummary: "auto",
          textVerbosity: "high",
          reasoningEffort: "high",
        },
      }),
    ]);
    expect(resolveModelProfile(config)).toMatchObject({
      id: "mimo/gpt-5.4/high",
      model: "gpt-5.4",
      variant: "high",
    });
  });

  it("normalizes adapter-specific model modes", () => {
    const config = {
      provider: {
        mimo: {
          npm: "@ai-sdk/openai-compatible" as const,
          options: {
            mode: "responses" as const,
            apiKey: "sk-test",
          },
          models: {
            "mimo-v2.5-pro": {},
          },
        },
        claude: {
          npm: "@ai-sdk/anthropic" as const,
          options: {
            mode: "chat" as const,
            authToken: "sk-test",
          },
          models: {
            "claude-test": {},
          },
        },
      },
    };

    expect(resolveModelProfile(config, "mimo/mimo-v2.5-pro")).toMatchObject({
      adapter: "@ai-sdk/openai-compatible",
      mode: "chat",
    });
    expect(resolveModelProfile(config, "claude/claude-test")).toMatchObject({
      adapter: "@ai-sdk/anthropic",
      mode: "messages",
    });
  });

  it("synthesizes one model profile from legacy provider fields", () => {
    const config = {
      provider: "anthropic" as const,
      providers: {
        anthropic: {
          model: "claude-test",
          baseUrl: "https://anthropic.example",
          authToken: "sk-ant",
        },
      },
    };

    expect(resolveModelProfiles(config)).toEqual([
      {
        id: "anthropic/claude-test",
        provider: "anthropic",
        adapter: "@ai-sdk/anthropic",
        model: "claude-test",
        name: undefined,
        baseUrl: "https://anthropic.example",
        apiKey: undefined,
        authToken: "sk-ant",
        maxOutputTokens: undefined,
        mode: "messages",
      },
    ]);
  });
});
