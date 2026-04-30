import type { ProviderKind } from "./types.js";

export type ProviderErrorKind =
  | "auth"
  | "quota"
  | "rate_limit"
  | "model"
  | "upstream"
  | "network"
  | "stream"
  | "unknown";

export class ProviderRuntimeError extends Error {
  override readonly name = "ProviderRuntimeError";
  readonly provider: ProviderKind;
  readonly kind: ProviderErrorKind;
  readonly status?: number;
  readonly requestId?: string | null;
  readonly hint?: string;
  override readonly cause?: unknown;

  constructor(
    provider: ProviderKind,
    kind: ProviderErrorKind,
    message: string,
    options?: {
      status?: number;
      requestId?: string | null;
      hint?: string;
      cause?: unknown;
    },
  ) {
    super(message);
    this.provider = provider;
    this.kind = kind;
    this.status = options?.status;
    this.requestId = options?.requestId;
    this.hint = options?.hint;
    this.cause = options?.cause;
  }
}

function extractMessage(err: Record<string, unknown>): string {
  if (typeof err.message === "string" && err.message.length > 0) return err.message;
  if (typeof err.error === "object" && err.error !== null) {
    const inner = err.error as Record<string, unknown>;
    if (typeof inner.message === "string") return inner.message;
  }
  return String(err);
}

function extractRequestId(err: Record<string, unknown>): string | null {
  if (typeof err.requestID === "string") return err.requestID;
  if (typeof err.request_id === "string") return err.request_id;
  if (typeof err.requestId === "string") return err.requestId;
  return null;
}

const HINTS: Record<ProviderErrorKind, string> = {
  auth: "check API key, bearer token, base URL, and provider family",
  quota: "check provider quota or account balance",
  rate_limit: "provider rate limited the request; retry later",
  model:
    "check model name and whether this endpoint supports the requested provider format",
  upstream: "gateway or upstream provider failed; retry or check upstream account health",
  network: "check network connectivity, base URL, or proxy",
  stream: "provider returned malformed streaming tool-call data",
  unknown: "inspect provider logs or enable debug mode later",
};

export function normalizeProviderError(
  provider: ProviderKind,
  error: unknown,
): ProviderRuntimeError {
  if (error instanceof ProviderRuntimeError) return error;

  const err = (
    typeof error === "object" && error !== null ? error : { message: String(error) }
  ) as Record<string, unknown>;

  const status =
    typeof err.status === "number"
      ? err.status
      : typeof err.statusCode === "number"
        ? err.statusCode
        : undefined;

  const message = extractMessage(err);
  const requestId = extractRequestId(err);
  const code = typeof err.code === "string" ? err.code : "";
  const lowerMessage = message.toLowerCase();

  // HTTP status classification
  if (status === 401 || status === 403) {
    return new ProviderRuntimeError(provider, "auth", message, {
      status,
      requestId,
      hint: HINTS.auth,
      cause: error,
    });
  }

  if (status === 402) {
    return new ProviderRuntimeError(provider, "quota", message, {
      status,
      requestId,
      hint: HINTS.quota,
      cause: error,
    });
  }

  if (status === 429) {
    return new ProviderRuntimeError(provider, "rate_limit", message, {
      status,
      requestId,
      hint: HINTS.rate_limit,
      cause: error,
    });
  }

  if (status === 404) {
    return new ProviderRuntimeError(provider, "model", message, {
      status,
      requestId,
      hint: HINTS.model,
      cause: error,
    });
  }

  if (status !== undefined && status >= 500 && status < 600) {
    return new ProviderRuntimeError(provider, "upstream", message, {
      status,
      requestId,
      hint: HINTS.upstream,
      cause: error,
    });
  }

  // Network errors
  if (
    ["ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN"].includes(code) ||
    lowerMessage.includes("fetch failed")
  ) {
    return new ProviderRuntimeError(provider, "network", message, {
      hint: HINTS.network,
      cause: error,
    });
  }

  return new ProviderRuntimeError(provider, "unknown", message, {
    status,
    requestId,
    hint: HINTS.unknown,
    cause: error,
  });
}

export function formatProviderError(err: ProviderRuntimeError): string {
  const lines: string[] = [];
  lines.push(`Provider error [${err.provider}/${err.kind}]: ${err.message}`);
  if (err.hint) lines.push(`Hint: ${err.hint}`);
  if (err.status) lines.push(`Status: ${err.status}`);
  if (err.requestId) lines.push(`Request ID: ${err.requestId}`);
  return lines.join("\n");
}
