import React from "react";
import { render } from "ink";
import { TuiApp } from "./app.js";
import { CursorDeclarationContext } from "./cursor-declaration.js";
import { createCursorParkingStdout } from "./cursor-parking.js";
import { enterAlternateScreen } from "./terminal-screen.js";
import {
  createRawInputTrackingStdin,
  RawInputContext,
} from "./prompt-input/raw-input.js";
import {
  createMouseInputBus,
  enableMouseTracking,
  MouseInputContext,
  parseMouseEvents,
} from "./mouse-input.js";
import type { ApprovalMode } from "../permission/policy.js";
import type { Provider } from "../model/provider.js";
import type { ModelProfile } from "../config/config.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { TranscriptStore } from "../storage/store.js";
import type { SessionState } from "../session/loop.js";
import type { SkillSummary } from "../skill/types.js";

export type LaunchTuiOptions = {
  session: SessionState;
  provider: Provider;
  providerName: string;
  modelName: string;
  modelProfiles?: ModelProfile[];
  createProvider?: (profile: ModelProfile) => Provider;
  registry: ToolRegistry;
  approval: ApprovalMode;
  store: TranscriptStore;
  availableSkills?: SkillSummary[];
  maxTurns?: number;
};

export async function launchTui(options: LaunchTuiOptions): Promise<void> {
  return new Promise((resolve) => {
    const screen = enterAlternateScreen(process.stdout);
    const cursorParking = createCursorParkingStdout(process.stdout);
    const mouseBus = createMouseInputBus();
    const disableMouse = enableMouseTracking(process.stdout);
    const rawInput = createRawInputTrackingStdin(
      process.stdin,
      (chunk) => {
        const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
        for (const event of parseMouseEvents(text)) mouseBus.emit(event);
      },
      (chunk) => {
        const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
        return parseMouseEvents(text).length > 0;
      },
    );

    const onExit = () => {
      disableMouse();
      cursorParking.clear();
      reactInstance.unmount();
      screen.exit();
      resolve();
    };

    const reactInstance = render(
      React.createElement(
        CursorDeclarationContext.Provider,
        { value: cursorParking.declareCursor },
        React.createElement(
          RawInputContext.Provider,
          { value: rawInput.rawInput },
          React.createElement(
            MouseInputContext.Provider,
            { value: mouseBus },
            React.createElement(TuiApp, { ...options, onExit }),
          ),
        ),
      ),
      { stdin: rawInput.stdin, stdout: cursorParking.stdout, exitOnCtrlC: false },
    );
  });
}
