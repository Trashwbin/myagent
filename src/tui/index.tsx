import React from "react";
import { render } from "ink";
import { TuiApp } from "./app.js";
import { CursorDeclarationContext } from "./cursor-declaration.js";
import { createCursorParkingStdout } from "./cursor-parking.js";
import { enterAlternateScreen } from "./terminal-screen.js";
import type { ApprovalMode } from "../permission/policy.js";
import type { Provider } from "../model/provider.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { TranscriptStore } from "../storage/store.js";
import type { SessionState } from "../session/loop.js";

export type LaunchTuiOptions = {
  session: SessionState;
  provider: Provider;
  providerName: string;
  modelName: string;
  registry: ToolRegistry;
  approval: ApprovalMode;
  store: TranscriptStore;
  maxTurns?: number;
};

export async function launchTui(options: LaunchTuiOptions): Promise<void> {
  return new Promise((resolve) => {
    const screen = enterAlternateScreen(process.stdout);
    const cursorParking = createCursorParkingStdout(process.stdout);

    const onExit = () => {
      cursorParking.clear();
      reactInstance.unmount();
      screen.exit();
      resolve();
    };

    const reactInstance = render(
      React.createElement(
        CursorDeclarationContext.Provider,
        { value: cursorParking.declareCursor },
        React.createElement(TuiApp, { ...options, onExit }),
      ),
      { stdout: cursorParking.stdout, exitOnCtrlC: false },
    );
  });
}
