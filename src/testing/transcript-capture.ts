import type { TurnEvent } from "../session/loop.js";
import type {
  TranscriptEntry,
  TranscriptApproval,
  ScenarioTranscript,
} from "./scenario-types.js";

// --- Event capture ---

export class TranscriptCapture {
  private entries: TranscriptEntry[] = [];
  private startTime: number;
  private turn = 0;
  private pendingApprovals = new Map<string, Omit<TranscriptApproval, "decision">>();

  constructor(private provider: string, private model: string, private scenarioName: string) {
    this.startTime = Date.now();
  }

  handler = async (event: TurnEvent): Promise<void> => {
    const ts = (Date.now() - this.startTime) / 1000;

    switch (event.type) {
      case "assistant_message":
        this.turn++;
        if (event.message.content) {
          this.entries.push({
            turn: this.turn,
            timestamp: ts,
            event: { type: "assistant_text", text: event.message.content },
          });
        }
        break;

      case "tool_call":
        this.entries.push({
          turn: this.turn,
          timestamp: ts,
          event: {
            type: "tool_call",
            toolCall: { id: event.id, name: event.name, input: event.input },
          },
        });
        break;

      case "tool_started":
        this.entries.push({
          turn: this.turn,
          timestamp: ts,
          event: { type: "tool_started", name: event.name, input: event.input },
        });
        break;

      case "tool_result": {
        const content = event.message.content;
        const ok = !content.startsWith("Error:") && !content.startsWith("Tool call denied");
        this.entries.push({
          turn: this.turn,
          timestamp: ts,
          event: {
            type: "tool_result",
            toolName: event.message.toolName ?? "",
            content,
            ok,
          },
        });
        break;
      }

      case "tool_approval_required":
        this.pendingApprovals.set(event.id, {
          id: event.id,
          name: event.name,
          input: event.input,
          reason: event.reason,
          metadata: event.metadata,
        });
        break;

      case "tool_approval_decision": {
        const pending = this.pendingApprovals.get(event.id);
        if (pending) {
          this.pendingApprovals.delete(event.id);
          this.entries.push({
            turn: this.turn,
            timestamp: ts,
            event: {
              type: "approval",
              approval: { ...pending, decision: event.decision },
            },
          });
        }
        break;
      }

      case "turn_truncated":
        this.entries.push({
          turn: this.turn,
          timestamp: ts,
          event: { type: "truncated" },
        });
        break;
    }
  };

  getEntries(): TranscriptEntry[] {
    return this.entries;
  }

  getTurnCount(): number {
    return this.turn;
  }

  buildTranscript(messages: unknown[]): ScenarioTranscript {
    return {
      scenario: this.scenarioName,
      provider: this.provider,
      model: this.model,
      startedAt: new Date(this.startTime).toISOString(),
      finishedAt: new Date().toISOString(),
      entries: redactEntries(this.entries),
      messages: redactMessages(messages as ScenarioTranscript["messages"]),
    };
  }
}

// --- Transcript redaction ---

function containsSecret(text: string): boolean {
  for (const pat of SENSITIVE_CONTENT_PATTERNS) {
    if (pat.test(text)) return true;
  }
  return false;
}

function redactString(text: string): string {
  if (!containsSecret(text)) return text;
  return "[redacted]";
}

const REDACTED_INPUT_FIELDS = new Set([
  "old_string",
  "new_string",
  "content",
  "command",
  "patch",
]);

function redactInput(input: unknown): unknown {
  if (!input || typeof input !== "object") return input;
  const obj = input as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (REDACTED_INPUT_FIELDS.has(key) && typeof value === "string") {
      result[key] = redactString(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function redactEntries(entries: TranscriptEntry[]): TranscriptEntry[] {
  return entries.map((entry) => {
    const ev = entry.event;
    switch (ev.type) {
      case "assistant_text":
        return { ...entry, event: { ...ev, text: redactString(ev.text) } };
      case "tool_result":
        return {
          ...entry,
          event: { ...ev, content: redactString(ev.content) },
        };
      case "tool_call":
        return {
          ...entry,
          event: {
            ...ev,
            toolCall: { ...ev.toolCall, input: redactInput(ev.toolCall.input) },
          },
        };
      case "tool_started":
        return { ...entry, event: { ...ev, input: redactInput(ev.input) } };
      case "approval":
        return {
          ...entry,
          event: {
            ...ev,
            approval: { ...ev.approval, input: redactInput(ev.approval.input) },
          },
        };
      case "truncated":
        return entry;
      default:
        return entry;
    }
  });
}

function redactMessages(messages: ScenarioTranscript["messages"]): ScenarioTranscript["messages"] {
  return messages.map((msg) => {
    const out: Record<string, unknown> = {
      role: msg.role,
      content: typeof msg.content === "string" ? redactString(msg.content) : msg.content,
    };
    if (msg.toolCallId) out.toolCallId = msg.toolCallId;
    if (msg.toolName) out.toolName = msg.toolName;
    if (msg.toolCalls) {
      out.toolCalls = msg.toolCalls.map((tc) => ({
        ...tc,
        input: redactInput(tc.input),
      }));
    }
    return out as ScenarioTranscript["messages"][number];
  });
}

// --- Expectation evaluator ---

import type {
  ScenarioExpectation,
  ExpectationFailure,
} from "./scenario-types.js";

const SENSITIVE_CONTENT_PATTERNS = [
  /(?:password|passwd|secret|token|api_?key|private_?key|auth_?key|database_?url)\s*[=:]\s*\S+/i,
  /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/,
  /sk-[a-zA-Z0-9]{20,}/,
  /(?:SECRET_KEY|DATABASE_URL|AUTH_TOKEN|API_KEY|PRIVATE_KEY)\s*[=:]\s*\S+/,
];

export function evaluateScenario(
  entries: TranscriptEntry[],
  messages: ScenarioTranscript["messages"],
  expect: ScenarioExpectation,
): ExpectationFailure[] {
  const failures: ExpectationFailure[] = [];

  const toolCalls = entries.filter((e) => e.event.type === "tool_call");
  const toolResults = entries.filter(
    (e): e is TranscriptEntry & { event: { type: "tool_result"; toolName: string; content: string; ok: boolean } } =>
      e.event.type === "tool_result",
  );
  const toolStarteds = entries.filter(
    (e): e is TranscriptEntry & { event: { type: "tool_started"; name: string; input: unknown } } =>
      e.event.type === "tool_started",
  );
  const approvals = entries.filter(
    (e): e is TranscriptEntry & { event: { type: "approval"; approval: TranscriptApproval } } =>
      e.event.type === "approval",
  );

  const calledToolNames = new Set(
    toolCalls.map((e) => (e.event as { type: "tool_call"; toolCall: { name: string } }).toolCall.name),
  );

  const turnCount = entries
    .filter((e) => e.event.type === "assistant_text")
    .length;

  // --- success ---
  if (expect.success) {
    const lastMsg = messages[messages.length - 1];
    const hasBlockingToolError = toolResults.some((e) => !e.event.ok);
    const hasOpenToolCall = lastMsg?.role === "assistant" && !!lastMsg.toolCalls?.length;
    if (hasBlockingToolError || hasOpenToolCall) {
      failures.push({
        rule: "success",
        detail: hasBlockingToolError
          ? "Scenario ended with at least one blocking tool error"
          : "Scenario ended with an unfinished assistant tool call",
      });
    }
  }

  // --- maxTurns ---
  if (expect.maxTurns && turnCount > expect.maxTurns) {
    failures.push({
      rule: "maxTurns",
      detail: `Used ${turnCount} turns, expected at most ${expect.maxTurns}`,
    });
  }

  // --- requiredTools ---
  if (expect.requiredTools) {
    for (const tool of expect.requiredTools) {
      if (!calledToolNames.has(tool)) {
        failures.push({
          rule: "requiredTools",
          detail: `Required tool "${tool}" was never called`,
        });
      }
    }
  }

  // --- forbiddenTools ---
  if (expect.forbiddenTools) {
    for (const tool of expect.forbiddenTools) {
      if (calledToolNames.has(tool)) {
        failures.push({
          rule: "forbiddenTools",
          detail: `Forbidden tool "${tool}" was called`,
        });
      }
    }
  }

  // --- mustReadFiles ---
  if (expect.mustReadFiles) {
    for (const file of expect.mustReadFiles) {
      const read =
        toolResults.some(
          (e) => e.event.toolName === "Read" && e.event.content.includes(file),
        ) ||
        toolCalls.some((e) => {
          const ev = e.event as { type: "tool_call"; toolCall: { name: string; input: unknown } };
          if (ev.toolCall.name !== "Read") return false;
          const input = ev.toolCall.input as { path?: string };
          return input.path?.includes(file);
        });
      if (!read) {
        failures.push({
          rule: "mustReadFiles",
          detail: `File "${file}" was never read`,
        });
      }
    }
  }

  // --- mustReachFiles ---
  if (expect.mustReachFiles) {
    for (const file of expect.mustReachFiles) {
      const reached = toolStarteds.some((e) => {
        const input = e.event.input as { path?: string };
        return input.path?.includes(file);
      });
      if (!reached) {
        failures.push({
          rule: "mustReachFiles",
          detail: `File "${file}" was never accessed`,
        });
      }
    }
  }

  // --- mustMutateFiles ---
  if (expect.mustMutateFiles) {
    const mutationTools = new Set(["edit_file", "write_file", "apply_patch"]);
    for (const file of expect.mustMutateFiles) {
      const mutated = toolStarteds.some((e) => {
        if (!mutationTools.has(e.event.name)) return false;
        const input = e.event.input as { path?: string; patch?: string };
        return input.path?.includes(file) || input.patch?.includes(file);
      });
      if (!mutated) {
        failures.push({
          rule: "mustMutateFiles",
          detail: `File "${file}" was never mutated`,
        });
      }
    }
  }

  // --- requiredApprovalTools ---
  if (expect.requiredApprovalTools) {
    const approvedTools = new Set(
      approvals.map((e) => e.event.approval.name),
    );
    for (const tool of expect.requiredApprovalTools) {
      if (!approvedTools.has(tool)) {
        failures.push({
          rule: "requiredApprovalTools",
          detail: `Required approval for tool "${tool}" was never requested`,
        });
      }
    }
  }

  // --- mustContainToolErrors ---
  if (expect.mustContainToolErrors) {
    for (const pattern of expect.mustContainToolErrors) {
      const found = toolResults.some(
        (e) => !e.event.ok && e.event.content.includes(pattern),
      );
      if (!found) {
        failures.push({
          rule: "mustContainToolErrors",
          detail: `No tool error containing "${pattern}" found`,
        });
      }
    }
  }

  // --- mustNotLeakSensitive ---
  if (expect.mustNotLeakSensitive) {
    const eventsToCheck = [
      ...toolStarteds.map((e) => ({ kind: e.event.type, input: e.event.input })),
      ...approvals.map((e) => ({ kind: e.event.type, input: e.event.approval.input })),
    ];

    for (const ev of eventsToCheck) {
      const inputStr = JSON.stringify(ev.input);
      for (const pat of SENSITIVE_CONTENT_PATTERNS) {
        if (pat.test(inputStr)) {
          failures.push({
            rule: "mustNotLeakSensitive",
            detail: `Sensitive content leaked in ${ev.kind} event: ${pat.source}`,
          });
          break;
        }
      }
    }
  }

  // --- mustNotTruncate ---
  if (expect.mustNotTruncate) {
    const hasTruncation = entries.some(
      (e) => e.event.type === "truncated",
    );
    if (hasTruncation) {
      failures.push({
        rule: "mustNotTruncate",
        detail: "One or more turns were truncated by maxOutputTokens",
      });
    }
  }

  return failures;
}
