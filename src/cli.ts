#!/usr/bin/env node
import { Command } from "commander";
import { resolve } from "node:path";
import { realpathSync } from "node:fs";
import * as readline from "node:readline";
import { createProviderFromProfile } from "./model/provider-factory.js";
import { buildDefaultRegistry } from "./tools/default-registry.js";
import type { ToolRegistry } from "./tools/registry.js";
import { ReadStateTracker } from "./tools/file-mutation.js";
import { runTurn } from "./session/loop.js";
import type { ApprovalRequest, SessionState, TurnEvent } from "./session/loop.js";
import type { ApprovalMode } from "./permission/rules.js";
import type { Provider } from "./model/provider.js";
import { getGitDiffStat } from "./workspace/diff.js";
import { ProviderRuntimeError, formatProviderError } from "./model/errors.js";
import { openStore } from "./storage/store.js";
import type { TranscriptStore } from "./storage/store.js";
import { resolvePrimaryAnswer, resolveSecondaryAnswer } from "./cli/approval.js";
import { formatToolInputSummary } from "./cli/format-tool-input.js";
import type { ApprovalResponse, ApprovalRule } from "./permission/approval.js";
import {
  loadConfig,
  loadGlobalConfig,
  resolveApprovalMode,
  resolveModelProfile,
  resolveModelProfiles,
} from "./config/config.js";
import type { Config, ModelProfile, ProviderName } from "./config/config.js";
import { discoverSkills, summarizeSkills } from "./skill/discovery.js";
import type { SkillSummary } from "./skill/types.js";
import { compactSession } from "./session/compact.js";
import type { CompactResult } from "./session/compact.js";
import { formatRewindMessage, revertLast, rewindSession } from "./session/revert.js";
import {
  formatModelList,
  formatModelSwitch,
  formatUnknownModel,
  resolveRequestedModelProfile,
} from "./session/model-switch.js";

function canonicalWorkspaceRoot(path: string): string {
  return realpathSync.native(resolve(path));
}

function makeApprovalHandler(
  rl: readline.Interface,
): (request: ApprovalRequest) => Promise<ApprovalResponse> {
  return async (request: ApprovalRequest): Promise<ApprovalResponse> => {
    return new Promise((resolve) => {
      const allowAlways = request.metadata?.sensitive !== true;
      const primaryPrompt = allowAlways
        ? "Approve? [Enter/y once, a always, n abort] "
        : "Approve sensitive request? [Enter/y once, n abort] ";

      const askPrimary = () => {
        rl.question(primaryPrompt, (answer) => {
          const primary = resolvePrimaryAnswer(answer, { allowAlways });
          if (primary === "allow_once") {
            resolve("allow_once");
          } else if (primary === "always" && allowAlways) {
            askSecondary();
          } else {
            resolve("abort");
          }
        });
      };

      const askSecondary = () => {
        rl.question("Always allow? [s session, w workspace, n cancel] ", (answer) => {
          const secondary = resolveSecondaryAnswer(answer);
          if (secondary === "cancel") {
            askPrimary();
          } else {
            resolve(secondary);
          }
        });
      };

      askPrimary();
    });
  };
}

function askLine(rl: readline.Interface): Promise<string | null> {
  return new Promise((resolve) => {
    const onClose = () => resolve(null);
    rl.once("close", onClose);
    rl.question("> ", (answer) => {
      rl.removeListener("close", onClose);
      resolve(answer);
    });
  });
}

function makeEventRenderer(): (event: TurnEvent) => void {
  let streamedText = false;
  const sensitiveToolCalls = new Set<string>();

  return (event: TurnEvent) => {
    switch (event.type) {
      case "assistant_text_delta":
        process.stdout.write(event.text);
        streamedText = true;
        break;
      case "assistant_message":
        if (streamedText) {
          process.stdout.write("\n");
          streamedText = false;
        }
        break;
      case "tool_approval_required": {
        const meta = event.metadata;
        if (meta?.sensitive) sensitiveToolCalls.add(event.id);
        const inputSummary = formatToolInputSummary(event.input);
        const intentLabel =
          event.name === "bash" && meta?.intentKind
            ? `bash (${meta.intentKind as string})`
            : event.name;
        if (event.name === "bash" && meta?.externalDirectoryPattern) {
          console.log(`\n[approval] ${intentLabel}: ${event.reason}`);
          if (meta.externalDirectoryRoot)
            console.log(`  project: ${meta.externalDirectoryRoot}`);
          console.log(`  grants: ${meta.externalDirectoryPattern}`);
          if (meta.approvalPattern)
            console.log(`  command pattern: ${meta.approvalPattern}`);
          if (inputSummary) console.log(`  input: ${inputSummary}`);
          if (!meta.sensitive) {
            console.log(
              `  Tip: press "a" to reuse this approval for this session/workspace.`,
            );
          }
        } else if (meta?.externalDirectoryPattern) {
          console.log(`\n[approval] ${intentLabel}: ${event.reason}`);
          if (meta.externalDirectoryRoot)
            console.log(`  project: ${meta.externalDirectoryRoot}`);
          console.log(`  grants: ${meta.externalDirectoryPattern}`);
          if (inputSummary) console.log(`  input: ${inputSummary}`);
        } else if (event.name === "bash" && meta?.approvalPattern) {
          console.log(`\n[approval] ${intentLabel}: ${event.reason}`);
          console.log(`  command pattern: ${meta.approvalPattern}`);
          if (inputSummary) console.log(`  input: ${inputSummary}`);
        } else {
          console.log(`\n[approval] ${intentLabel}: ${event.reason}`);
          if (meta) {
            if (meta.realPath) console.log(`  path: ${meta.realPath}`);
            if (meta.insideWorkspace === false) console.log(`  [outside workspace]`);
            if (meta.sensitive) console.log(`  [sensitive]`);
            if (meta.additions !== undefined || meta.deletions !== undefined) {
              console.log(`  changes: +${meta.additions ?? 0} -${meta.deletions ?? 0}`);
            }
            if (typeof meta.diff === "string" && meta.diff) {
              console.log(meta.diff);
            }
          }
          const sensitiveSummary = formatToolInputSummary(event.input, {
            sensitive: meta?.sensitive === true,
          });
          console.log(`  input: ${sensitiveSummary}`);
        }
        break;
      }
      case "tool_started": {
        const sensitive = sensitiveToolCalls.has(event.id);
        const summary = formatToolInputSummary(event.input, { sensitive });
        const intentKind = (event.input as Record<string, unknown>)?.intentKind as
          | string
          | undefined;
        const label =
          event.name === "bash" && intentKind ? `bash (${intentKind})` : event.name;
        if (summary) {
          console.log(`[tool:${label}] ${summary}`);
        } else {
          console.log(`[tool:${label}] ...`);
        }
        break;
      }
      case "tool_result":
        console.log(`[tool:${event.message.toolName}] ${event.message.content}`);
        break;
      case "turn_truncated":
        console.log(
          "\n[truncated] Turn stopped because the model hit its output token limit.",
        );
        break;
    }
  };
}

function printSessionList(
  sessions: Array<{
    id: string;
    workspaceRoot: string;
    provider?: string;
    model?: string;
    title?: string;
    updatedAt: number;
  }>,
) {
  if (sessions.length === 0) {
    console.log("No sessions found.");
    return;
  }
  for (const s of sessions) {
    const time = new Date(s.updatedAt).toLocaleString();
    const title = s.title ?? "(untitled)";
    console.log(`${s.id}  ${title}`);
    console.log(`  workspace: ${s.workspaceRoot}`);
    console.log(`  provider: ${s.provider ?? "-"}  model: ${s.model ?? "-"}`);
    console.log(`  updated: ${time}`);
  }
}

function printRewindResult(
  action: "rewind" | "revert-last",
  result: { checkpointId: string; files: Array<{ path: string; existed: boolean }> },
): void {
  console.log(formatRewindMessage(action, result));
}

function printCompactResult(result: CompactResult): void {
  console.log(
    `Compacted ${result.compactedCount} messages; retained ${result.retainedCount} messages.`,
  );
}

async function handleSessionCommand(
  getProvider: () => Provider,
  setModelProfile: (profile: ModelProfile) => void,
  modelProfiles: ModelProfile[],
  session: SessionState,
  store: TranscriptStore,
  input: string,
): Promise<boolean> {
  const trimmed = input.trim();
  if (trimmed === "/model" || trimmed.startsWith("/model ")) {
    const requestedId = trimmed.slice("/model".length).trim();
    if (!requestedId) {
      console.log(formatModelList(modelProfiles, session.modelProfileId));
      return true;
    }
    const profile = resolveRequestedModelProfile(modelProfiles, requestedId);
    if (!profile) {
      console.log(formatUnknownModel(requestedId, modelProfiles));
      return true;
    }
    setModelProfile(profile);
    store.updateSessionModel(session.id, {
      modelProfileId: profile.id,
      provider: profile.provider,
      model: profile.model,
    });
    Object.assign(session, {
      modelProfileId: profile.id,
      provider: profile.provider,
      model: profile.model,
    });
    console.log(formatModelSwitch(profile));
    return true;
  }

  if (trimmed === "/compact") {
    try {
      const result = await compactSession(getProvider(), session);
      session.messages = result.messages;
      store.replaceMessages(session.id, result.messages);
      printCompactResult(result);
    } catch (err) {
      console.error(err instanceof Error ? err.message : "Compact failed");
    }
    return true;
  }

  if (trimmed.startsWith("/rewind ")) {
    const checkpointId = trimmed.slice("/rewind ".length).trim();
    if (!checkpointId) {
      console.log("Usage: /rewind <checkpointId>");
      return true;
    }
    const result = await rewindSession(session, checkpointId);
    const message = formatRewindMessage("rewind", result);
    store.appendMessages(session.id, [{ role: "assistant", content: message }]);
    session.messages.push({ role: "assistant", content: message });
    printRewindResult("rewind", result);
    return true;
  }

  if (trimmed === "/revert-last") {
    const result = await revertLast(session);
    const message = formatRewindMessage("revert-last", result);
    store.appendMessages(session.id, [{ role: "assistant", content: message }]);
    session.messages.push({ role: "assistant", content: message });
    printRewindResult("revert-last", result);
    return true;
  }

  return false;
}

function createProvider(config: Config): Provider {
  return createProviderForProfile(resolveModelProfile(config));
}

function createAppBootstrapProvider(): Provider {
  return {
    name: "app-bootstrap",
    async *stream() {
      throw new Error("No project session runtime is available for this request.");
    },
  };
}

function createProviderForProfile(profile: ModelProfile): Provider {
  try {
    return createProviderFromProfile(profile);
  } catch (err) {
    console.error(err instanceof Error ? err.message : "Failed to create provider");
    process.exit(1);
  }
}

function resolveSessionProvider(config: Config): {
  provider: ProviderName;
  model: string;
  modelProfileId: string;
} {
  const profile = resolveModelProfile(config);
  return {
    provider: profile.provider,
    model: profile.model,
    modelProfileId: profile.id,
  };
}

async function chatMode(
  provider: Provider,
  modelProfiles: ModelProfile[],
  registry: ToolRegistry,
  session: SessionState,
  approval: ApprovalMode,
  store: TranscriptStore,
  availableSkills: SkillSummary[] = [],
) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const sessionApprovalRules: ApprovalRule[] = [];
  const readState = new ReadStateTracker();
  const approvalHandler = makeApprovalHandler(rl);
  const onEvent = makeEventRenderer();
  let activeProvider = provider;

  console.log(`Session: ${session.id}`);
  console.log("Type your message, /exit to quit.\n");

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const input = await askLine(rl);
      if (input === null) break;
      if (input.trim() === "") continue;
      if (input === "/exit" || input === "/quit") break;
      if (
        await handleSessionCommand(
          () => activeProvider,
          (profile) => {
            activeProvider = createProviderForProfile(profile);
          },
          modelProfiles,
          session,
          store,
          input,
        )
      )
        continue;

      try {
        const {
          session: updated,
          newMessages,
          aborted,
        } = await runTurn(activeProvider, registry, session, input, {
          approval,
          approvalHandler,
          onEvent,
          sessionApprovalRules,
          store,
          readState,
          availableSkills,
        });
        Object.assign(session, updated);
        store.appendMessages(session.id, newMessages);

        if (aborted) {
          console.log("\nTurn aborted. Tell myagent what to do differently.\n");
        }
      } catch (err) {
        if (err instanceof ProviderRuntimeError) {
          console.error(`\n${formatProviderError(err)}`);
          continue;
        }
        throw err;
      }
    }

    const diffStat = await getGitDiffStat(session.cwd);
    if (diffStat) {
      console.log("\n--- Changes ---");
      console.log(diffStat);
    }
  } finally {
    rl.close();
  }
}

// --- Extracted handlers ---

function handleSessions(): void {
  const store = openStore();
  try {
    printSessionList(store.listSessions());
  } finally {
    store.close();
  }
}

async function handleRewind(sessionId: string, checkpointId: string): Promise<void> {
  const store = openStore();
  try {
    const session = store.getSession(sessionId);
    if (!session) {
      console.error(`Session not found: ${sessionId}`);
      process.exit(1);
    }
    const result = await rewindSession(session, checkpointId);
    const message = formatRewindMessage("rewind", result);
    store.appendMessages(session.id, [{ role: "assistant", content: message }]);
    printRewindResult("rewind", result);
  } finally {
    store.close();
  }
}

async function handleRevertLast(sessionId: string): Promise<void> {
  const store = openStore();
  try {
    const session = store.getSession(sessionId);
    if (!session) {
      console.error(`Session not found: ${sessionId}`);
      process.exit(1);
    }
    const result = await revertLast(session);
    const message = formatRewindMessage("revert-last", result);
    store.appendMessages(session.id, [{ role: "assistant", content: message }]);
    printRewindResult("revert-last", result);
  } finally {
    store.close();
  }
}

async function handleCompact(sessionId: string): Promise<void> {
  const store = openStore();
  try {
    const session = store.getSession(sessionId);
    if (!session) {
      console.error(`Session not found: ${sessionId}`);
      process.exit(1);
    }
    const config = loadConfig({ workspaceRoot: session.cwd });
    const provider = createProvider(config);
    const result = await compactSession(provider, session);
    store.replaceMessages(session.id, result.messages);
    printCompactResult(result);
  } finally {
    store.close();
  }
}

async function handleResume(sessionId: string, options: { cwd: string }): Promise<void> {
  let cwd = canonicalWorkspaceRoot(options.cwd);
  let config = loadConfig({ workspaceRoot: cwd });

  const explicitCwd = process.argv.includes("--cwd");

  const store = openStore();
  try {
    const session = store.getSession(sessionId);
    if (!session) {
      console.error(`Session not found: ${sessionId}`);
      process.exit(1);
    }
    if (explicitCwd && canonicalWorkspaceRoot(options.cwd) !== session.cwd) {
      console.error(
        `Session ${sessionId} belongs to ${session.cwd}, but --cwd is ${canonicalWorkspaceRoot(options.cwd)}. Use a future fork command to move history to another workspace.`,
      );
      process.exit(1);
    }
    cwd = session.cwd;
    config = loadConfig({ workspaceRoot: cwd });
    const modelProfiles = resolveModelProfiles(config);
    const activeProfile = resolveModelProfile(config, session.modelProfileId);
    const provider = createProviderForProfile(activeProfile);
    const skills = await discoverSkills({ cwd });
    const registry = buildDefaultRegistry(skills);
    await chatMode(
      provider,
      modelProfiles,
      registry,
      session,
      resolveApprovalMode(config),
      store,
      summarizeSkills(skills),
    );
  } finally {
    store.close();
  }
}

async function handleMainRun(options: { cwd: string }): Promise<void> {
  let cwd = canonicalWorkspaceRoot(options.cwd);
  const config = loadConfig({ workspaceRoot: cwd });
  const resolved = resolveSessionProvider(config);

  const store = openStore();
  try {
    const session = store.createSession({
      workspaceRoot: cwd,
      modelProfileId: resolved.modelProfileId,
      provider: resolved.provider,
      model: resolved.model,
    });
    const provider = createProvider(config);
    const modelProfiles = resolveModelProfiles(config);
    const skills = await discoverSkills({ cwd });
    const registry = buildDefaultRegistry(skills);
    await chatMode(
      provider,
      modelProfiles,
      registry,
      session,
      resolveApprovalMode(config),
      store,
      summarizeSkills(skills),
    );
  } finally {
    store.close();
  }
}

async function handleTui(options: { cwd: string }): Promise<void> {
  const cwd = canonicalWorkspaceRoot(options.cwd);
  const config = loadConfig({ workspaceRoot: cwd });
  const resolved = resolveSessionProvider(config);

  const store = openStore();
  try {
    const session = store.createSession({
      workspaceRoot: cwd,
      modelProfileId: resolved.modelProfileId,
      provider: resolved.provider,
      model: resolved.model,
    });
    const provider = createProvider(config);
    const skills = await discoverSkills({ cwd });
    const registry = buildDefaultRegistry(skills);

    const { launchTui } = await import("./tui/index.js");
    await launchTui({
      session,
      provider,
      providerName: resolved.provider,
      modelName: resolved.model,
      modelProfiles: resolveModelProfiles(config),
      createProvider: createProviderForProfile,
      registry,
      approval: resolveApprovalMode(config),
      store,
      availableSkills: summarizeSkills(skills),
    });
  } finally {
    store.close();
  }
}

async function handleInputDebug(): Promise<void> {
  const { launchInputDebug } = await import("./tui/input-debug.js");
  await launchInputDebug();
}

async function handleApp(options: { cwd: string }): Promise<void> {
  const fallbackProjectPath = canonicalWorkspaceRoot(options.cwd);
  const config = loadGlobalConfig();
  const resolved = resolveSessionProvider(config);
  const modelProfiles = resolveModelProfiles(config);
  const provider = createAppBootstrapProvider();
  const registry = buildDefaultRegistry();
  const store = openStore();
  store.upsertProject({ path: fallbackProjectPath });
  const { createAppServer, findAvailablePort } = await import("./app/server.js");
  const port = await findAvailablePort(43110);
  const server = createAppServer({
    provider,
    providerName: resolved.provider,
    modelName: resolved.model,
    modelProfileId: resolved.modelProfileId,
    modelProfiles,
    createProvider: createProviderForProfile,
    registry,
    approval: resolveApprovalMode(config),
    store,
    cwd: fallbackProjectPath,
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(`myAgent app listening on http://127.0.0.1:${port}`);
  });
}

// --- Commander setup ---

const program = new Command();

program
  .name("myagent")
  .description("A small coding-agent runtime")
  .option("--cwd <path>", "working directory", process.cwd());

program.action(async (options: { cwd: string }) => {
  await handleMainRun(options);
});

// Subcommand: sessions
const sessionsCmd = program
  .command("sessions")
  .description("List historical sessions and exit");

sessionsCmd.action(async () => {
  handleSessions();
});

// Subcommand: resume
const resumeCmd = program
  .command("resume <sessionId>")
  .description("Resume a previous session in interactive chat mode");

resumeCmd.action(async (sessionId: string) => {
  await handleResume(sessionId, program.opts<{ cwd: string }>());
});

const rewindCmd = program
  .command("rewind <sessionId> <checkpointId>")
  .description("Restore files from a checkpoint");

rewindCmd.action(async (sessionId: string, checkpointId: string) => {
  await handleRewind(sessionId, checkpointId);
});

const revertLastCmd = program
  .command("revert-last <sessionId>")
  .description("Restore the latest checkpoint in a session");

revertLastCmd.action(async (sessionId: string) => {
  await handleRevertLast(sessionId);
});

const compactCmd = program
  .command("compact <sessionId>")
  .description("Compact older transcript messages into a summary");

compactCmd.action(async (sessionId: string) => {
  await handleCompact(sessionId);
});

// Subcommand: tui
const tuiCmd = program.command("tui").description("Launch interactive TUI chat mode");

tuiCmd.action(async () => {
  await handleTui(program.opts<{ cwd: string }>());
});

// Subcommand: input-debug
const inputDebugCmd = program
  .command("input-debug", { hidden: true })
  .description("Launch standalone TUI input diagnostics");

inputDebugCmd.action(async () => {
  await handleInputDebug();
});

// Subcommand: app
const appCmd = program.command("app").description("Launch local web app server");

appCmd.action(async () => {
  await handleApp(program.opts<{ cwd: string }>());
});

// --- Entry point ---

const argv =
  process.argv[2] === "--"
    ? [...process.argv.slice(0, 2), ...process.argv.slice(3)]
    : process.argv;

program.parse(argv);
