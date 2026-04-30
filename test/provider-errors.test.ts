import { describe, it, expect } from "vitest";
import {
  normalizeProviderError,
  formatProviderError,
  ProviderRuntimeError,
} from "../src/model/errors.js";
import { OpenAICompatibleProvider } from "../src/model/openai-compatible.js";
import { AnthropicCompatibleProvider } from "../src/model/anthropic-compatible.js";

async function collectEvents(stream: AsyncGenerator<unknown>): Promise<unknown[]> {
  const events: unknown[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe("normalizeProviderError", () => {
  it("openai 401 -> auth", () => {
    const err = normalizeProviderError("openai", {
      status: 401,
      message: "Invalid API key",
      requestID: null,
    });
    expect(err).toBeInstanceOf(ProviderRuntimeError);
    expect(err.kind).toBe("auth");
    expect(err.provider).toBe("openai");
    expect(err.status).toBe(401);
    expect(err.hint).toContain("API key");
  });

  it("anthropic 403 -> auth", () => {
    const err = normalizeProviderError("anthropic", {
      status: 403,
      message: "Your request was blocked.",
      request_id: "req_abc",
    });
    expect(err.kind).toBe("auth");
    expect(err.provider).toBe("anthropic");
    expect(err.requestId).toBe("req_abc");
  });

  it("402 -> quota", () => {
    const err = normalizeProviderError("openai", {
      status: 402,
      message: "Insufficient quota",
    });
    expect(err.kind).toBe("quota");
  });

  it("429 -> rate_limit", () => {
    const err = normalizeProviderError("openai", {
      status: 429,
      message: "Rate limit exceeded",
    });
    expect(err.kind).toBe("rate_limit");
  });

  it("404 -> model", () => {
    const err = normalizeProviderError("anthropic", {
      status: 404,
      message: "Model not found",
    });
    expect(err.kind).toBe("model");
  });

  it("502 no body -> upstream", () => {
    const err = normalizeProviderError("openai", {
      status: 502,
      message: "502 status code (no body)",
      requestID: null,
    });
    expect(err.kind).toBe("upstream");
    expect(err.status).toBe(502);
  });

  it("503 -> upstream", () => {
    const err = normalizeProviderError("openai", {
      status: 503,
      message: "Service unavailable",
    });
    expect(err.kind).toBe("upstream");
  });

  it("500 -> upstream", () => {
    const err = normalizeProviderError("openai", {
      status: 500,
      message: "Internal server error",
    });
    expect(err.kind).toBe("upstream");
  });

  it("ECONNRESET -> network", () => {
    const err = normalizeProviderError("openai", {
      message: "connection reset",
      code: "ECONNRESET",
    });
    expect(err.kind).toBe("network");
  });

  it("ETIMEDOUT -> network", () => {
    const err = normalizeProviderError("openai", {
      message: "timeout",
      code: "ETIMEDOUT",
    });
    expect(err.kind).toBe("network");
  });

  it("fetch failed -> network", () => {
    const err = normalizeProviderError("anthropic", {
      message: "fetch failed",
    });
    expect(err.kind).toBe("network");
  });

  it("Fetch failed -> network", () => {
    const err = normalizeProviderError("anthropic", {
      message: "Fetch failed",
    });
    expect(err.kind).toBe("network");
  });

  it("extracts camelCase requestId", () => {
    const err = normalizeProviderError("openai", {
      status: 500,
      message: "gateway error",
      requestId: "req_camel",
    });
    expect(err.requestId).toBe("req_camel");
  });

  it("already ProviderRuntimeError -> returns same instance", () => {
    const original = new ProviderRuntimeError("openai", "auth", "bad key");
    const result = normalizeProviderError("openai", original);
    expect(result).toBe(original);
  });

  it("unknown object -> unknown", () => {
    const err = normalizeProviderError("openai", { message: "something weird" });
    expect(err.kind).toBe("unknown");
  });

  it("extracts message from nested error object", () => {
    const err = normalizeProviderError("openai", {
      error: { message: "inner error message" },
    });
    expect(err.message).toBe("inner error message");
  });

  it("handles string error", () => {
    const err = normalizeProviderError("openai", "plain string error");
    expect(err.message).toBe("plain string error");
    expect(err.kind).toBe("unknown");
  });
});

describe("formatProviderError", () => {
  it("formats full error with all fields", () => {
    const err = new ProviderRuntimeError("openai", "upstream", "502 bad gateway", {
      status: 502,
      requestId: "req_123",
      hint: "check upstream",
    });
    const formatted = formatProviderError(err);
    expect(formatted).toContain("Provider error [openai/upstream]");
    expect(formatted).toContain("502 bad gateway");
    expect(formatted).toContain("Hint: check upstream");
    expect(formatted).toContain("Status: 502");
    expect(formatted).toContain("Request ID: req_123");
  });

  it("omits missing fields", () => {
    const err = new ProviderRuntimeError("anthropic", "auth", "bad key", {
      status: 401,
    });
    const formatted = formatProviderError(err);
    expect(formatted).not.toContain("Request ID");
  });
});

describe("OpenAI adapter error handling", () => {
  it("normalizes 502 from create()", async () => {
    const provider = new OpenAICompatibleProvider({
      provider: "openai",
      model: "test",
      apiKey: "key",
    });

    (provider as any).client = {
      chat: {
        completions: {
          create: async () => {
            throw { status: 502, message: "502 status code (no body)", requestID: null };
          },
        },
      },
    };

    await expect(
      collectEvents(provider.stream([{ role: "user", content: "hi" }])),
    ).rejects.toThrow(ProviderRuntimeError);

    try {
      await collectEvents(provider.stream([{ role: "user", content: "hi" }]));
    } catch (err) {
      expect((err as ProviderRuntimeError).kind).toBe("upstream");
      expect((err as ProviderRuntimeError).status).toBe(502);
    }
  });

  it("throws stream error on malformed tool-call JSON", async () => {
    const provider = new OpenAICompatibleProvider({
      provider: "openai",
      model: "test",
      apiKey: "key",
    });

    async function* badStream() {
      yield {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "c1",
                  function: { name: "read_file", arguments: "{bad" },
                },
              ],
            },
          },
        ],
      };
      yield {
        choices: [{ delta: {}, finish_reason: "tool_calls" }],
      };
    }

    (provider as any).client = {
      chat: {
        completions: { create: async () => badStream() },
      },
    };

    await expect(
      collectEvents(provider.stream([{ role: "user", content: "go" }])),
    ).rejects.toThrow(ProviderRuntimeError);

    try {
      await collectEvents(provider.stream([{ role: "user", content: "go" }]));
    } catch (err) {
      expect((err as ProviderRuntimeError).kind).toBe("stream");
    }
  });
});

describe("Anthropic adapter error handling", () => {
  it("normalizes 401 from stream()", async () => {
    const provider = new AnthropicCompatibleProvider({
      provider: "anthropic",
      model: "test",
      apiKey: "key",
    });

    (provider as any).client = {
      messages: {
        stream: () => {
          const err = { status: 401, message: "invalid x-api-key", request_id: "req1" };
          throw err;
        },
      },
    };

    await expect(
      collectEvents(provider.stream([{ role: "user", content: "hi" }])),
    ).rejects.toThrow(ProviderRuntimeError);

    try {
      await collectEvents(provider.stream([{ role: "user", content: "hi" }]));
    } catch (err) {
      expect((err as ProviderRuntimeError).kind).toBe("auth");
      expect((err as ProviderRuntimeError).requestId).toBe("req1");
    }
  });

  it("throws stream error on malformed input_json_delta", async () => {
    const provider = new AnthropicCompatibleProvider({
      provider: "anthropic",
      model: "test",
      apiKey: "key",
    });

    async function* badStream() {
      yield {
        type: "content_block_start",
        content_block: { type: "tool_use", id: "tu1", name: "bash" },
      };
      yield {
        type: "content_block_delta",
        delta: { type: "input_json_delta", partial_json: "{invalid" },
      };
      yield { type: "content_block_stop" };
      yield { type: "message_delta", delta: { stop_reason: "tool_use" } };
    }

    (provider as any).client = {
      messages: { stream: () => badStream() },
    };

    await expect(
      collectEvents(provider.stream([{ role: "user", content: "go" }])),
    ).rejects.toThrow(ProviderRuntimeError);

    try {
      await collectEvents(provider.stream([{ role: "user", content: "go" }]));
    } catch (err) {
      expect((err as ProviderRuntimeError).kind).toBe("stream");
    }
  });
});
