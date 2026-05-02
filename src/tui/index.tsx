import React from "react";
import { render } from "ink";
import { TuiApp } from "./app.js";
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
    const onExit = () => {
      reactInstance.unmount();
      resolve();
    };

    const reactInstance = render(
      React.createElement(TuiApp, { ...options, onExit }),
    );
  });
}
