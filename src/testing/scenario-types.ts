import type { Message } from "../model/types.js";

// --- Scenario definition ---

export type ScenarioWorkspaceSetup = {
  files?: Record<string, string>;
  externalFiles?: Record<string, string>;
};

export type ScenarioDefinition = {
  name: string;
  description: string;
  prompt: string;
  setup?: ScenarioWorkspaceSetup;
  expect: ScenarioExpectation;
  run?: {
    maxTurns?: number;
    maxOutputTokens?: number;
    autoApprove?: boolean;
  };
};

// --- Expectation model ---

export type ScenarioExpectation = {
  /** Whether the task should complete successfully (no tool errors blocking completion) */
  success: boolean;

  /** Tools that must be called at least once */
  requiredTools?: string[];

  /** Tools that must NOT be called */
  forbiddenTools?: string[];

  /** Maximum number of agent turns before we consider it a failure */
  maxTurns?: number;

  /** Files that must be read during the scenario */
  mustReadFiles?: string[];

  /** Files that must exist in workspace after scenario completes */
  mustReachFiles?: string[];

  /** Tool error patterns that must appear at least once (e.g. patch failure → recover) */
  mustContainToolErrors?: string[];

  /** If true, no sensitive content may appear in tool_started or approval text */
  mustNotLeakSensitive?: boolean;

  /** If true, the scenario fails when any turn was truncated by maxOutputTokens */
  mustNotTruncate?: boolean;

  /** Files that must be mutated (written/edited/patched) during the scenario */
  mustMutateFiles?: string[];

  /** Tool names that must trigger at least one approval request */
  requiredApprovalTools?: string[];
};

// --- Transcript ---

export type TranscriptToolCall = {
  id: string;
  name: string;
  input: unknown;
};

export type TranscriptApproval = {
  id: string;
  name: string;
  input: unknown;
  reason: string;
  metadata?: Record<string, unknown>;
  decision: "allow" | "deny";
};

export type TranscriptEntry = {
  /** 0-based turn index */
  turn: number;
  /** Seconds since scenario start */
  timestamp: number;
  event:
    | { type: "assistant_text"; text: string }
    | { type: "tool_call"; toolCall: TranscriptToolCall }
    | { type: "tool_result"; toolName: string; content: string; ok: boolean }
    | { type: "approval"; approval: TranscriptApproval }
    | { type: "tool_started"; name: string; input: unknown }
    | { type: "truncated" };
};

export type ScenarioTranscript = {
  scenario: string;
  provider: string;
  model: string;
  startedAt: string;
  finishedAt?: string;
  entries: TranscriptEntry[];
  messages: Message[];
};

// --- Result ---

export type ExpectationFailure = {
  rule: string;
  detail: string;
};

export type ScenarioResult = {
  scenario: string;
  provider: string;
  model: string;
  passed: boolean;
  failures: ExpectationFailure[];
  transcriptPath: string;
  durationMs: number;
};

// --- Config ---

export type LiveScenarioConfig = {
  provider: "openai" | "anthropic";
  model: string;
  baseUrl?: string;
  apiKey?: string;
  authToken?: string;
  mode?: "chat" | "responses" | "messages";
  cwd: string;
  maxTurns?: number;
  maxOutputTokens?: number;
  /** Auto-approve all non-sensitive tool requests */
  autoApprove?: boolean;
  /** Transcript output directory */
  outputDir?: string;
};
