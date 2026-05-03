import React from "react";

const ENABLE_MOUSE_TRACKING = "\x1b[?1000h\x1b[?1002h\x1b[?1006h";
const DISABLE_MOUSE_TRACKING = "\x1b[?1006l\x1b[?1002l\x1b[?1000l";
const SGR_MOUSE_RE = /\x1b\[<(\d+);(\d+);(\d+)([mM])/g;

export type TuiMouseEvent =
  | { type: "wheel"; direction: "up" | "down"; x: number; y: number };

export type MouseInputBus = {
  emit: (event: TuiMouseEvent) => void;
  subscribe: (listener: (event: TuiMouseEvent) => void) => () => void;
};

const EMPTY_MOUSE_BUS: MouseInputBus = {
  emit: () => {},
  subscribe: () => () => {},
};

export const MouseInputContext = React.createContext<MouseInputBus>(EMPTY_MOUSE_BUS);

export function createMouseInputBus(): MouseInputBus {
  const listeners = new Set<(event: TuiMouseEvent) => void>();
  return {
    emit(event) {
      for (const listener of listeners) listener(event);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function enableMouseTracking(
  stdout: NodeJS.WriteStream = process.stdout,
): () => void {
  if (!stdout.isTTY || process.env.MYAGENT_DISABLE_MOUSE === "1") {
    return () => {};
  }

  let active = true;
  stdout.write(ENABLE_MOUSE_TRACKING);

  return () => {
    if (!active) return;
    active = false;
    stdout.write(DISABLE_MOUSE_TRACKING);
  };
}

export function parseMouseEvents(chunk: string): TuiMouseEvent[] {
  const events: TuiMouseEvent[] = [];
  for (const match of chunk.matchAll(SGR_MOUSE_RE)) {
    const code = Number(match[1]);
    const x = Number(match[2]);
    const y = Number(match[3]);
    if (match[4] !== "M") continue;
    if (code === 64) events.push({ type: "wheel", direction: "up", x, y });
    if (code === 65) events.push({ type: "wheel", direction: "down", x, y });
  }
  return events;
}

export function containsMouseSequence(input: string): boolean {
  return /\x1b?\[<\d+;\d+;\d+[mM]/.test(input);
}

export function stripMouseSequences(input: string): string {
  return input.replace(/\x1b?\[<\d+;\d+;\d+[mM]/g, "");
}
