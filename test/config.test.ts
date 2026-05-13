import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  ConfigSchema,
  globalConfigPath,
  localConfigPath,
  loadConfig,
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

  it("accepts nested provider config and secrets", () => {
    const input = {
      $schema: "https://myagent.dev/config.json",
      provider: "openai" as const,
      approval: "on-request" as const,
      maxTurns: 12,
      providers: {
        openai: {
          model: "gpt-4o",
          baseUrl: "https://api.example.com/v1",
          apiKey: "sk-test",
          maxOutputTokens: 4096,
          protocol: "responses",
          models: {
            fast: {
              name: "Fast model",
              model: "gpt-4o-mini",
              maxOutputTokens: 2048,
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
      JSON.stringify({ provider: "openai", providers: { openai: { model: "gpt-4o" } } }),
    );

    const original = process.env.MYAGENT_HOME;
    process.env.MYAGENT_HOME = homeDir;
    try {
      const config = loadConfig({ workspaceRoot: tmp });
      expect(config.provider).toBe("openai");
      expect(config.providers?.openai?.model).toBe("gpt-4o");
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
      JSON.stringify({ approval: "auto", providers: { openai: { model: "gpt-4o" } } }),
    );
    await writeFile(
      join(myagentDir, "config.local.json"),
      JSON.stringify({ approval: "on-request", providers: { openai: { model: "gpt-4o-mini" } } }),
    );

    const original = process.env.MYAGENT_HOME;
    process.env.MYAGENT_HOME = join(tmp, "empty-home");
    await mkdir(process.env.MYAGENT_HOME, { recursive: true });
    try {
      const config = loadConfig({ workspaceRoot: tmp });
      expect(config.approval).toBe("on-request");
      expect(config.providers?.openai?.model).toBe("gpt-4o-mini");
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
      provider: "openai" as const,
      model: "gpt-4o",
      apiKey: "sk-flat",
      baseUrl: "https://flat.example",
      maxOutputTokens: 1024,
      providers: {
        openai: {
          model: "gpt-4o-mini",
          apiKey: "sk-openai",
          baseUrl: "https://openai.example",
          maxOutputTokens: 2048,
          protocol: "responses" as const,
        },
      },
    };
    expect(resolveProviderConfig(config, "openai")).toEqual({
      type: "openai",
      name: undefined,
      model: "gpt-4o-mini",
      apiKey: "sk-openai",
      authToken: undefined,
      baseUrl: "https://openai.example",
      maxOutputTokens: 2048,
      protocol: "responses",
      models: undefined,
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
      model: "mimo/fast",
      providers: {
        mimo: {
          type: "openai" as const,
          baseUrl: "https://openai.example/v1",
          apiKey: "sk-openai",
          protocol: "chat" as const,
          models: {
            fast: {
              name: "Fast",
              model: "mimo-v2.5-pro",
              maxOutputTokens: 2048,
            },
            accurate: {
              model: "gpt-4o",
              protocol: "responses" as const,
            },
          },
        },
        "mimo-claude": {
          type: "anthropic" as const,
          baseUrl: "https://anthropic.example",
          authToken: "sk-ant",
          models: {
            sonnet: { model: "claude-sonnet-4-5" },
          },
        },
      },
    };

    expect(resolveModelProfiles(config)).toEqual([
      {
        id: "mimo/fast",
        provider: "mimo",
        type: "openai",
        model: "mimo-v2.5-pro",
        name: "Fast",
        baseUrl: "https://openai.example/v1",
        apiKey: "sk-openai",
        authToken: undefined,
        maxOutputTokens: 2048,
        protocol: "chat",
      },
      {
        id: "mimo/accurate",
        provider: "mimo",
        type: "openai",
        model: "gpt-4o",
        name: undefined,
        baseUrl: "https://openai.example/v1",
        apiKey: "sk-openai",
        authToken: undefined,
        maxOutputTokens: undefined,
        protocol: "responses",
      },
      {
        id: "mimo-claude/sonnet",
        provider: "mimo-claude",
        type: "anthropic",
        model: "claude-sonnet-4-5",
        name: undefined,
        baseUrl: "https://anthropic.example",
        apiKey: undefined,
        authToken: "sk-ant",
        maxOutputTokens: undefined,
        protocol: undefined,
      },
    ]);
    expect(resolveModelProfile(config)).toMatchObject({
      id: "mimo/fast",
      model: "mimo-v2.5-pro",
    });
    expect(resolveModelProfile(config, "sonnet")).toMatchObject({
      id: "mimo-claude/sonnet",
      provider: "mimo-claude",
      type: "anthropic",
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
        type: "anthropic",
        model: "claude-test",
        name: undefined,
        baseUrl: "https://anthropic.example",
        apiKey: undefined,
        authToken: "sk-ant",
        maxOutputTokens: undefined,
        protocol: undefined,
      },
    ]);
  });
});
