import { describe, it, expect } from "vitest";
import {
  normalizeProviderError,
  formatProviderError,
  ProviderRuntimeError,
} from "../src/model/errors.js";

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
