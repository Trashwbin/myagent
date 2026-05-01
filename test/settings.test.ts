import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  SettingsSchema,
  loadSettings,
  resolveSetting,
  resolveApprovalMode,
  globalSettingsPath,
  projectSettingsPath,
  localSettingsPath,
} from "../src/config/settings.js";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// --- Schema validation ---

describe("SettingsSchema", () => {
  it("accepts empty object", () => {
    expect(SettingsSchema.parse({})).toEqual({});
  });

  it("accepts full valid settings", () => {
    const input = {
      provider: "openai" as const,
      model: "gpt-4o",
      baseUrl: "https://api.example.com/v1",
      maxOutputTokens: 8192,
      maxTurns: 20,
      approval: "on-request" as const,
    };
    expect(SettingsSchema.parse(input)).toEqual(input);
  });

  it("rejects invalid provider", () => {
    expect(() => SettingsSchema.parse({ provider: "fake" })).toThrow();
  });

  it("rejects invalid approval", () => {
    expect(() => SettingsSchema.parse({ approval: "never" })).toThrow();
  });

  it("rejects negative maxOutputTokens", () => {
    expect(() => SettingsSchema.parse({ maxOutputTokens: -1 })).toThrow();
  });

  it("rejects non-integer maxOutputTokens", () => {
    expect(() => SettingsSchema.parse({ maxOutputTokens: 1.5 })).toThrow();
  });

  it("rejects unknown keys", () => {
    expect(() => SettingsSchema.parse({ apiKey: "sk-123" })).toThrow();
  });

  it("rejects non-object input", () => {
    expect(() => SettingsSchema.parse("string")).toThrow();
    expect(() => SettingsSchema.parse(42)).toThrow();
    expect(() => SettingsSchema.parse([])).toThrow();
  });
});

// --- Path helpers ---

describe("settings paths", () => {
  it("global path uses MYAGENT_HOME or ~/.myagent", () => {
    const path = globalSettingsPath();
    expect(path).toMatch(/\.myagent\/settings\.json$/);
  });

  it("project path is under workspace .myagent/", () => {
    const path = projectSettingsPath("/workspace");
    expect(path).toBe("/workspace/.myagent/settings.json");
  });

  it("local path ends with settings.local.json", () => {
    const path = localSettingsPath("/workspace");
    expect(path).toBe("/workspace/.myagent/settings.local.json");
  });
});

// --- File reading and merge ---

describe("loadSettings", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "myagent-settings-"));
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true });
  });

  it("returns empty when no settings files exist", () => {
    const settings = loadSettings({ workspaceRoot: tmp });
    expect(settings).toEqual({});
  });

  it("reads global settings", async () => {
    const globalDir = join(tmp, "home");
    await mkdir(globalDir, { recursive: true });
    const globalFile = join(globalDir, "settings.json");
    await writeFile(globalFile, JSON.stringify({ provider: "openai", model: "gpt-4o" }));

    // Override MYAGENT_HOME temporarily
    const origHome = process.env.MYAGENT_HOME;
    process.env.MYAGENT_HOME = globalDir;
    try {
      const settings = loadSettings({ workspaceRoot: tmp });
      expect(settings.provider).toBe("openai");
      expect(settings.model).toBe("gpt-4o");
    } finally {
      process.env.MYAGENT_HOME = origHome;
    }
  });

  it("reads project settings", async () => {
    const myagentDir = join(tmp, ".myagent");
    await mkdir(myagentDir, { recursive: true });
    await writeFile(
      join(myagentDir, "settings.json"),
      JSON.stringify({ provider: "anthropic", model: "claude-haiku-4-5" }),
    );

    // Ensure MYAGENT_HOME points somewhere without settings
    const origHome = process.env.MYAGENT_HOME;
    process.env.MYAGENT_HOME = join(tmp, "empty-home");
    await mkdir(join(tmp, "empty-home"), { recursive: true });
    try {
      const settings = loadSettings({ workspaceRoot: tmp });
      expect(settings.provider).toBe("anthropic");
      expect(settings.model).toBe("claude-haiku-4-5");
    } finally {
      process.env.MYAGENT_HOME = origHome;
    }
  });

  it("local overrides project", async () => {
    const myagentDir = join(tmp, ".myagent");
    await mkdir(myagentDir, { recursive: true });
    await writeFile(
      join(myagentDir, "settings.json"),
      JSON.stringify({ provider: "openai", model: "gpt-4o" }),
    );
    await writeFile(
      join(myagentDir, "settings.local.json"),
      JSON.stringify({ model: "gpt-4o-mini" }),
    );

    const origHome = process.env.MYAGENT_HOME;
    process.env.MYAGENT_HOME = join(tmp, "empty-home");
    await mkdir(join(tmp, "empty-home"), { recursive: true });
    try {
      const settings = loadSettings({ workspaceRoot: tmp });
      expect(settings.provider).toBe("openai");
      expect(settings.model).toBe("gpt-4o-mini");
    } finally {
      process.env.MYAGENT_HOME = origHome;
    }
  });

  it("project overrides global", async () => {
    const globalDir = join(tmp, "home");
    await mkdir(globalDir, { recursive: true });
    await writeFile(
      join(globalDir, "settings.json"),
      JSON.stringify({ provider: "openai", maxTurns: 5 }),
    );

    const myagentDir = join(tmp, ".myagent");
    await mkdir(myagentDir, { recursive: true });
    await writeFile(
      join(myagentDir, "settings.json"),
      JSON.stringify({ maxTurns: 10 }),
    );

    const origHome = process.env.MYAGENT_HOME;
    process.env.MYAGENT_HOME = globalDir;
    try {
      const settings = loadSettings({ workspaceRoot: tmp });
      expect(settings.provider).toBe("openai");
      expect(settings.maxTurns).toBe(10);
    } finally {
      process.env.MYAGENT_HOME = origHome;
    }
  });

  it("reports clear error for invalid JSON", async () => {
    const myagentDir = join(tmp, ".myagent");
    await mkdir(myagentDir, { recursive: true });
    await writeFile(join(myagentDir, "settings.json"), "{bad json");

    const origHome = process.env.MYAGENT_HOME;
    process.env.MYAGENT_HOME = join(tmp, "empty-home");
    await mkdir(join(tmp, "empty-home"), { recursive: true });
    try {
      expect(() => loadSettings({ workspaceRoot: tmp })).toThrow(/invalid JSON/);
    } finally {
      process.env.MYAGENT_HOME = origHome;
    }
  });

  it("reports clear error for schema violations", async () => {
    const myagentDir = join(tmp, ".myagent");
    await mkdir(myagentDir, { recursive: true });
    await writeFile(
      join(myagentDir, "settings.json"),
      JSON.stringify({ provider: "invalid-provider" }),
    );

    const origHome = process.env.MYAGENT_HOME;
    process.env.MYAGENT_HOME = join(tmp, "empty-home");
    await mkdir(join(tmp, "empty-home"), { recursive: true });
    try {
      expect(() => loadSettings({ workspaceRoot: tmp })).toThrow(/invalid schema/);
    } finally {
      process.env.MYAGENT_HOME = origHome;
    }
  });

  it("reports clear error for array instead of object", async () => {
    const myagentDir = join(tmp, ".myagent");
    await mkdir(myagentDir, { recursive: true });
    await writeFile(join(myagentDir, "settings.json"), "[1,2,3]");

    const origHome = process.env.MYAGENT_HOME;
    process.env.MYAGENT_HOME = join(tmp, "empty-home");
    await mkdir(join(tmp, "empty-home"), { recursive: true });
    try {
      expect(() => loadSettings({ workspaceRoot: tmp })).toThrow(/expected a JSON object/);
    } finally {
      process.env.MYAGENT_HOME = origHome;
    }
  });

  it("ignores empty files", async () => {
    const myagentDir = join(tmp, ".myagent");
    await mkdir(myagentDir, { recursive: true });
    await writeFile(join(myagentDir, "settings.json"), "");

    const origHome = process.env.MYAGENT_HOME;
    process.env.MYAGENT_HOME = join(tmp, "empty-home");
    await mkdir(join(tmp, "empty-home"), { recursive: true });
    try {
      const settings = loadSettings({ workspaceRoot: tmp });
      expect(settings).toEqual({});
    } finally {
      process.env.MYAGENT_HOME = origHome;
    }
  });
});

// --- resolveSetting ---

describe("resolveSetting", () => {
  it("prefers CLI value over everything", () => {
    expect(resolveSetting("cli", "env", "settings", "default")).toBe("cli");
  });

  it("falls back to env when CLI is undefined", () => {
    expect(resolveSetting(undefined, "env", "settings", "default")).toBe("env");
  });

  it("falls back to settings when CLI and env are undefined", () => {
    expect(resolveSetting(undefined, undefined, "settings", "default")).toBe("settings");
  });

  it("falls back to default when all others are undefined", () => {
    expect(resolveSetting(undefined, undefined, undefined, "default")).toBe("default");
  });
});

// --- maxOutputTokens provider integration ---

describe("maxOutputTokens provider integration", () => {
  it("OpenAI provider uses configured maxOutputTokens", async () => {
    const { OpenAICompatibleProvider } = await import(
      "../src/model/openai-compatible.js"
    );
    const provider = new OpenAICompatibleProvider({
      provider: "openai",
      model: "test",
      apiKey: "test-key",
      maxOutputTokens: 2048,
    });
    expect(provider.name).toBe("openai");
  });

  it("OpenAI provider works without maxOutputTokens", async () => {
    const { OpenAICompatibleProvider } = await import(
      "../src/model/openai-compatible.js"
    );
    const provider = new OpenAICompatibleProvider({
      provider: "openai",
      model: "test",
      apiKey: "test-key",
    });
    expect(provider.name).toBe("openai");
  });

  it("Anthropic provider uses configured maxOutputTokens", async () => {
    const { AnthropicCompatibleProvider } = await import(
      "../src/model/anthropic-compatible.js"
    );
    const provider = new AnthropicCompatibleProvider({
      provider: "anthropic",
      model: "test",
      maxOutputTokens: 4096,
    });
    expect(provider.name).toBe("anthropic");
  });

  it("Anthropic provider works without maxOutputTokens", async () => {
    const { AnthropicCompatibleProvider } = await import(
      "../src/model/anthropic-compatible.js"
    );
    const provider = new AnthropicCompatibleProvider({
      provider: "anthropic",
      model: "test",
    });
    expect(provider.name).toBe("anthropic");
  });
});

// --- resolveApprovalMode ---

describe("resolveApprovalMode", () => {
  it("defaults to auto when nothing is specified", () => {
    const result = resolveApprovalMode(["node", "cli.js"], "auto", undefined, {});
    expect(result).toBe("auto");
  });

  it("uses env var when CLI is not explicit", () => {
    const result = resolveApprovalMode(["node", "cli.js"], "auto", "on-request", {});
    expect(result).toBe("on-request");
  });

  it("uses settings when CLI and env are not set", () => {
    const result = resolveApprovalMode(["node", "cli.js"], "auto", undefined, {
      approval: "on-request",
    });
    expect(result).toBe("on-request");
  });

  it("CLI --approval auto overrides settings on-request", () => {
    const result = resolveApprovalMode(
      ["node", "cli.js", "--approval", "auto"],
      "auto",
      undefined,
      { approval: "on-request" },
    );
    expect(result).toBe("auto");
  });

  it("CLI --approval on-request overrides settings auto", () => {
    const result = resolveApprovalMode(
      ["node", "cli.js", "--approval", "on-request"],
      "on-request",
      undefined,
      { approval: "auto" },
    );
    expect(result).toBe("on-request");
  });

  it("CLI --approval auto overrides env on-request", () => {
    const result = resolveApprovalMode(
      ["node", "cli.js", "--approval", "auto"],
      "auto",
      "on-request",
      {},
    );
    expect(result).toBe("auto");
  });

  it("CLI --approval=on-request (equals form) is detected as explicit", () => {
    const result = resolveApprovalMode(
      ["node", "cli.js", "--approval=on-request"],
      "on-request",
      undefined,
      { approval: "auto" },
    );
    expect(result).toBe("on-request");
  });

  it("env overrides settings when CLI is not explicit", () => {
    const result = resolveApprovalMode(
      ["node", "cli.js"],
      "auto",
      "on-request",
      { approval: "auto" },
    );
    expect(result).toBe("on-request");
  });
});
