import { describe, it, expect } from "vitest";
import {
  TranscriptCapture,
  evaluateScenario,
} from "../src/testing/transcript-capture.js";
import type {
  TranscriptEntry,
} from "../src/testing/scenario-types.js";
import type { Message } from "../src/model/types.js";

// --- TranscriptCapture ---

describe("TranscriptCapture", () => {
  it("captures assistant_text events", () => {
    const capture = new TranscriptCapture("openai", "gpt-4o", "test");
    capture.handler({
      type: "assistant_message",
      message: { role: "assistant", content: "Hello world" },
    });

    const entries = capture.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].event.type).toBe("assistant_text");
    if (entries[0].event.type === "assistant_text") {
      expect(entries[0].event.text).toBe("Hello world");
    }
  });

  it("captures tool_call and tool_result events", async () => {
    const capture = new TranscriptCapture("openai", "gpt-4o", "test");

    // assistant_message with content triggers turn increment + text entry
    await capture.handler({
      type: "assistant_message",
      message: { role: "assistant", content: "reading file" },
    });

    await capture.handler({
      type: "tool_call",
      id: "tc1",
      name: "read_file",
      input: { path: "app.ts" },
    });

    await capture.handler({
      type: "tool_started",
      id: "tc1",
      name: "read_file",
      input: { path: "app.ts" },
    });

    await capture.handler({
      type: "tool_result",
      message: {
        role: "tool_result",
        toolCallId: "tc1",
        toolName: "read_file",
        content: "file contents here",
      },
    });

    const entries = capture.getEntries();
    // assistant_text + tool_call + tool_started + tool_result = 4
    expect(entries).toHaveLength(4);

    const toolCallEntry = entries.find((e) => e.event.type === "tool_call");
    expect(toolCallEntry).toBeDefined();
    if (toolCallEntry?.event.type === "tool_call") {
      expect(toolCallEntry.event.toolCall.name).toBe("read_file");
    }

    const resultEntry = entries.find((e) => e.event.type === "tool_result");
    expect(resultEntry).toBeDefined();
    if (resultEntry?.event.type === "tool_result") {
      expect(resultEntry.event.ok).toBe(true);
      expect(resultEntry.event.toolName).toBe("read_file");
    }
  });

  it("captures approval events", async () => {
    const capture = new TranscriptCapture("openai", "gpt-4o", "test");

    await capture.handler({
      type: "tool_approval_required",
      id: "tc1",
      name: "edit_file",
      input: { path: "app.ts", old_string: "a", new_string: "b" },
      reason: "file edits require approval",
    });

    await capture.handler({
      type: "tool_approval_decision",
      id: "tc1",
      name: "edit_file",
      decision: "allow",
    });

    const entries = capture.getEntries();
    const approvalEntry = entries.find((e) => e.event.type === "approval");
    expect(approvalEntry).toBeDefined();
    if (approvalEntry?.event.type === "approval") {
      expect(approvalEntry.event.approval.decision).toBe("allow");
      expect(approvalEntry.event.approval.name).toBe("edit_file");
    }
  });

  it("detects error tool results", async () => {
    const capture = new TranscriptCapture("openai", "gpt-4o", "test");

    await capture.handler({
      type: "tool_result",
      message: {
        role: "tool_result",
        toolCallId: "tc1",
        toolName: "apply_patch",
        content: "Error: Update File \"app.ts\": partially matches near line 3",
      },
    });

    const entries = capture.getEntries();
    const resultEntry = entries.find((e) => e.event.type === "tool_result");
    if (resultEntry?.event.type === "tool_result") {
      expect(resultEntry.event.ok).toBe(false);
    }
  });

  it("builds transcript with metadata", () => {
    const capture = new TranscriptCapture("openai", "gpt-4o", "test");
    const messages: Message[] = [
      { role: "user", content: "do something" },
      { role: "assistant", content: "done" },
    ];

    const transcript = capture.buildTranscript(messages);
    expect(transcript.scenario).toBe("test");
    expect(transcript.provider).toBe("openai");
    expect(transcript.model).toBe("gpt-4o");
    expect(transcript.messages).toHaveLength(2);
    expect(transcript.startedAt).toBeTruthy();
  });
});

// --- evaluateScenario ---

function makeEntries(
  events: TranscriptEntry["event"][],
): TranscriptEntry[] {
  return events.map((event, i) => ({
    turn: 1,
    timestamp: i,
    event,
  }));
}

describe("evaluateScenario", () => {
  it("passes for a successful scenario with required tools", () => {
    const entries: TranscriptEntry[] = [
      ...makeEntries([
        { type: "assistant_text", text: "I'll read the file" },
        {
          type: "tool_call",
          toolCall: { id: "1", name: "read_file", input: { path: "app.ts" } },
        },
        {
          type: "tool_started",
          name: "read_file",
          input: { path: "app.ts" },
        },
        {
          type: "tool_result",
          toolName: "read_file",
          content: "file content",
          ok: true,
        },
        {
          type: "tool_call",
          toolCall: { id: "2", name: "edit_file", input: { path: "app.ts", old_string: "old", new_string: "new" } },
        },
        {
          type: "tool_started",
          name: "edit_file",
          input: { path: "app.ts", old_string: "old", new_string: "new" },
        },
        {
          type: "tool_result",
          toolName: "edit_file",
          content: "updated app.ts (+1 -1)",
          ok: true,
        },
        { type: "assistant_text", text: "Done" },
      ]),
    ];

    const messages: Message[] = [
      { role: "user", content: "edit app.ts" },
      { role: "assistant", content: "I'll read the file", toolCalls: [{ id: "1", name: "read_file", input: { path: "app.ts" } }] },
      { role: "tool_result", toolCallId: "1", toolName: "read_file", content: "file content" },
      { role: "assistant", content: "Done" },
    ];

    const failures = evaluateScenario(entries, messages, {
      success: true,
      requiredTools: ["read_file"],
      mustMutateFiles: ["app.ts"],
      maxTurns: 5,
    });

    expect(failures).toEqual([]);
  });

  it("fails when required tool is missing", () => {
    const entries = makeEntries([
      { type: "assistant_text", text: "done" },
    ]);
    const messages: Message[] = [
      { role: "user", content: "go" },
      { role: "assistant", content: "done" },
    ];

    const failures = evaluateScenario(entries, messages, {
      success: true,
      requiredTools: ["read_file"],
    });

    expect(failures).toHaveLength(1);
    expect(failures[0].rule).toBe("requiredTools");
  });

  it("fails when forbidden tool is used", () => {
    const entries = makeEntries([
      {
        type: "tool_call",
        toolCall: { id: "1", name: "bash", input: { command: "echo hi" } },
      },
      { type: "assistant_text", text: "done" },
    ]);
    const messages: Message[] = [
      { role: "user", content: "go" },
      { role: "assistant", content: "", toolCalls: [{ id: "1", name: "bash", input: { command: "echo hi" } }] },
      { role: "tool_result", toolCallId: "1", toolName: "bash", content: "hi" },
      { role: "assistant", content: "done" },
    ];

    const failures = evaluateScenario(entries, messages, {
      success: true,
      forbiddenTools: ["bash"],
    });

    expect(failures).toHaveLength(1);
    expect(failures[0].rule).toBe("forbiddenTools");
  });

  it("detects tool errors with pattern matching", () => {
    const entries = makeEntries([
      {
        type: "tool_result",
        toolName: "apply_patch",
        content: 'Error: Update File "app.ts": partially matches near line 3',
        ok: false,
      },
    ]);

    const failures = evaluateScenario(entries, [], {
      success: false,
      mustContainToolErrors: ["partially matches"],
    });

    expect(failures).toEqual([]);
  });

  it("fails when expected tool error is missing", () => {
    const entries = makeEntries([
      {
        type: "tool_result",
        toolName: "apply_patch",
        content: "Applied patch",
        ok: true,
      },
    ]);

    const failures = evaluateScenario(entries, [], {
      success: false,
      mustContainToolErrors: ["partially matches"],
    });

    expect(failures).toHaveLength(1);
    expect(failures[0].rule).toBe("mustContainToolErrors");
  });

  it("detects sensitive content leak in tool_started", () => {
    const entries = makeEntries([
      {
        type: "tool_started",
        name: "read_file",
        input: { path: ".env", content: "DATABASE_URL=postgres://user:pass@host/db" },
      },
    ]);

    const failures = evaluateScenario(entries, [], {
      success: false,
      mustNotLeakSensitive: true,
    });

    expect(failures.length).toBeGreaterThan(0);
    expect(failures[0].rule).toBe("mustNotLeakSensitive");
  });

  it("passes mustNotLeakSensitive when no sensitive content in events", () => {
    const entries = makeEntries([
      {
        type: "tool_started",
        name: "read_file",
        input: { path: ".env" },
      },
      {
        type: "tool_result",
        toolName: "read_file",
        content: "[file contents redacted]",
        ok: true,
      },
    ]);

    const failures = evaluateScenario(entries, [], {
      success: false,
      mustNotLeakSensitive: true,
    });

    expect(failures).toEqual([]);
  });

  it("enforces maxTurns", () => {
    const entries = makeEntries([
      { type: "assistant_text", text: "turn 1" },
      { type: "assistant_text", text: "turn 2" },
      { type: "assistant_text", text: "turn 3" },
      { type: "assistant_text", text: "turn 4" },
    ]);

    const failures = evaluateScenario(entries, [], {
      success: false,
      maxTurns: 3,
    });

    expect(failures).toHaveLength(1);
    expect(failures[0].rule).toBe("maxTurns");
  });

  it("detects mustReadFiles", () => {
    const entries = makeEntries([
      {
        type: "tool_result",
        toolName: "read_file",
        content: "app.ts content here",
        ok: true,
      },
    ]);

    const passFailures = evaluateScenario(entries, [], {
      success: false,
      mustReadFiles: ["app.ts"],
    });
    expect(passFailures).toEqual([]);

    const failFailures = evaluateScenario(entries, [], {
      success: false,
      mustReadFiles: ["missing.ts"],
    });
    expect(failFailures).toHaveLength(1);
    expect(failFailures[0].rule).toBe("mustReadFiles");
  });

  it("detects mustMutateFiles", () => {
    const entries = makeEntries([
      {
        type: "tool_started",
        name: "edit_file",
        input: { path: "app.ts", old_string: "a", new_string: "b" },
      },
    ]);

    const passFailures = evaluateScenario(entries, [], {
      success: false,
      mustMutateFiles: ["app.ts"],
    });
    expect(passFailures).toEqual([]);

    const failFailures = evaluateScenario(entries, [], {
      success: false,
      mustMutateFiles: ["other.ts"],
    });
    expect(failFailures).toHaveLength(1);
  });

  it("fails success check when last message has tool calls", () => {
    const messages: Message[] = [
      { role: "user", content: "go" },
      { role: "assistant", content: "", toolCalls: [{ id: "1", name: "bash", input: { command: "ls" } }] },
    ];

    const entries = makeEntries([
      { type: "assistant_text", text: "" },
    ]);

    const failures = evaluateScenario(entries, messages, {
      success: true,
    });

    expect(failures).toHaveLength(1);
    expect(failures[0].rule).toBe("success");
  });

  it("detects sensitive leak in approval events", () => {
    const entries = makeEntries([
      {
        type: "approval",
        approval: {
          id: "1",
          name: "edit_file",
          input: { path: ".env", old_string: "DATABASE_URL=postgres://host/db", new_string: "DATABASE_URL=new" },
          reason: "file edits require approval",
          decision: "allow",
        },
      },
    ]);

    const failures = evaluateScenario(entries, [], {
      success: false,
      mustNotLeakSensitive: true,
    });

    expect(failures.length).toBeGreaterThan(0);
    expect(failures[0].rule).toBe("mustNotLeakSensitive");
  });
});

// --- Scenario listing ---

describe("scenario definitions", () => {
  it("all scenarios have valid expectations", async () => {
    const { listScenarios, getScenario } = await import(
      "../src/testing/scenarios/index.js"
    );
    const names = listScenarios();
    expect(names.length).toBeGreaterThanOrEqual(3);

    for (const name of names) {
      const s = getScenario(name);
      expect(s).toBeDefined();
      expect(s!.name).toBe(name);
      expect(s!.prompt.length).toBeGreaterThan(0);
      expect(s!.expect).toBeDefined();
    }
  });
});

// --- Transcript redaction ---

describe("TranscriptCapture redaction", () => {
  it("redacts secrets in tool_result entries", async () => {
    const capture = new TranscriptCapture("openai", "gpt-4o", "test");
    await capture.handler({
      type: "tool_result",
      message: {
        role: "tool_result",
        toolCallId: "tc1",
        toolName: "read_file",
        content: "DATABASE_URL=postgres://user:pass@host/mydb\nSECRET_KEY=abc123",
      },
    });

    const transcript = capture.buildTranscript([]);
    const resultEntry = transcript.entries.find((e) => e.event.type === "tool_result");
    expect(resultEntry).toBeDefined();
    if (resultEntry?.event.type === "tool_result") {
      expect(resultEntry.event.content).toBe("[redacted]");
    }
  });

  it("redacts secrets in assistant_text entries", async () => {
    const capture = new TranscriptCapture("openai", "gpt-4o", "test");
    await capture.handler({
      type: "assistant_message",
      message: { role: "assistant", content: "The key is SECRET_KEY=abc123" },
    });

    const transcript = capture.buildTranscript([]);
    const textEntry = transcript.entries.find((e) => e.event.type === "assistant_text");
    expect(textEntry).toBeDefined();
    if (textEntry?.event.type === "assistant_text") {
      expect(textEntry.event.text).toBe("[redacted]");
    }
  });

  it("redacts secrets in tool_started input", async () => {
    const capture = new TranscriptCapture("openai", "gpt-4o", "test");
    await capture.handler({
      type: "tool_started",
      id: "tc1",
      name: "edit_file",
      input: { path: ".env", old_string: "SECRET_KEY=old", new_string: "SECRET_KEY=new" },
    });

    const transcript = capture.buildTranscript([]);
    const startedEntry = transcript.entries.find((e) => e.event.type === "tool_started");
    expect(startedEntry).toBeDefined();
    if (startedEntry?.event.type === "tool_started") {
      const input = startedEntry.event.input as Record<string, unknown>;
      expect(input.old_string).toBe("[redacted]");
      expect(input.new_string).toBe("[redacted]");
      expect(input.path).toBe(".env");
    }
  });

  it("redacts secrets in messages", async () => {
    const capture = new TranscriptCapture("openai", "gpt-4o", "test");
    const messages: Message[] = [
      { role: "assistant", content: "Here is the secret: DATABASE_URL=postgres://localhost/db" },
      {
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "1",
            name: "edit_file",
            input: { path: ".env", old_string: "SECRET_KEY=abc", new_string: "SECRET_KEY=xyz" },
          },
        ],
      },
    ];

    const transcript = capture.buildTranscript(messages);
    expect(transcript.messages[0].content).toBe("[redacted]");
    const tc = transcript.messages[1].toolCalls![0].input as Record<string, unknown>;
    expect(tc.old_string).toBe("[redacted]");
    expect(tc.new_string).toBe("[redacted]");
  });

  it("preserves non-sensitive content unchanged", async () => {
    const capture = new TranscriptCapture("openai", "gpt-4o", "test");
    await capture.handler({
      type: "tool_result",
      message: {
        role: "tool_result",
        toolCallId: "tc1",
        toolName: "read_file",
        content: "export const VERSION = '1.0.0';",
      },
    });

    const transcript = capture.buildTranscript([]);
    const resultEntry = transcript.entries.find((e) => e.event.type === "tool_result");
    if (resultEntry?.event.type === "tool_result") {
      expect(resultEntry.event.content).toBe("export const VERSION = '1.0.0';");
    }
  });
});
