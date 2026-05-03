import React, { useCallback, useEffect, useRef, useState } from "react";
import { Box, Text, useInput, render } from "ink";
import type { Key } from "ink";
import { CursorDeclarationContext } from "./cursor-declaration.js";
import { createCursorParkingStdout } from "./cursor-parking.js";
import { PromptInput, type PromptInputDebugEvent } from "./prompt-input/PromptInput.js";
import type { PastePart } from "./types.js";

type DebugEntry = {
  id: number;
  text: string;
};

type DebugBus = {
  emit: (entry: string) => void;
  subscribe: (listener: (entry: string) => void) => () => void;
};

const MAX_LOGS = 80;

export async function launchInputDebug(): Promise<void> {
  return new Promise((resolve) => {
    const bus = createDebugBus();
    const cursorParking = createCursorParkingStdout(process.stdout);
    const debugStdin = createDebugStdin(process.stdin, (chunk) => {
      bus.emit(`raw   ${describeChunk(chunk)}`);
    });

    const onExit = () => {
      cursorParking.clear();
      instance.unmount();
      resolve();
    };

    const instance = render(
      <CursorDeclarationContext.Provider value={cursorParking.declareCursor}>
        <InputDebugApp bus={bus} onExit={onExit} />
      </CursorDeclarationContext.Provider>,
      {
        stdin: debugStdin,
        stdout: cursorParking.stdout,
        exitOnCtrlC: false,
      },
    );
  });
}

function InputDebugApp(props: { bus: DebugBus; onExit: () => void }): React.ReactElement {
  const [inputState, setInputState] = useState({ value: "", cursor: 0 });
  const [pasteParts, setPasteParts] = useState<PastePart[]>([]);
  const [logs, setLogs] = useState<DebugEntry[]>([]);
  const nextId = useRef(1);

  const addLog = useCallback((text: string) => {
    setLogs((prev) => [
      ...prev.slice(Math.max(0, prev.length - MAX_LOGS + 1)),
      { id: nextId.current++, text },
    ]);
  }, []);

  useEffect(() => props.bus.subscribe(addLog), [props.bus, addLog]);

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      props.onExit();
      return;
    }
    if (input === "\u001b") {
      props.onExit();
    }
  });

  const handleDebug = useCallback(
    (event: PromptInputDebugEvent) => {
      addLog(formatPromptDebugEvent(event));
    },
    [addLog],
  );

  const visibleLogs = logs.slice(-18);

  return (
    <Box flexDirection="column" width="100%">
      <Text color="cyan">myagent input-debug</Text>
      <Text color="gray">
        Reproduce: type English, switch to Chinese IME, type Chinese, switch back to
        English. Ctrl+C or Esc exits.
      </Text>
      <Box marginTop={1}>
        <Text color="gray">value: </Text>
        <Text>{JSON.stringify(inputState.value)}</Text>
        <Text color="gray"> cursor:{inputState.cursor}</Text>
      </Box>
      <Box marginTop={1}>
        <PromptInput
          value={inputState.value}
          cursor={inputState.cursor}
          onChange={(value, cursor) => setInputState({ value, cursor })}
          onSubmit={(value) => addLog(`submit ${JSON.stringify(value)}`)}
          pasteParts={pasteParts}
          onPastePartsChange={setPasteParts}
          focus
          columns={80}
          placeholder="debug input..."
          onInputDebug={handleDebug}
        />
      </Box>
      <Box flexDirection="column" marginTop={1}>
        <Text color="yellow">logs</Text>
        {visibleLogs.map((entry) => (
          <Text key={entry.id}>{entry.text}</Text>
        ))}
      </Box>
    </Box>
  );
}

function createDebugBus(): DebugBus {
  const listeners = new Set<(entry: string) => void>();
  return {
    emit(entry) {
      for (const listener of listeners) listener(entry);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

function createDebugStdin(
  rawStdin: NodeJS.ReadStream,
  onRawChunk: (chunk: string | Buffer) => void,
): NodeJS.ReadStream {
  return new Proxy(rawStdin, {
    get(target, property, receiver) {
      if (property === "read") {
        return (...args: unknown[]) => {
          const chunk = Reflect.apply(target.read, target, args);
          if (chunk !== null) onRawChunk(chunk as string | Buffer);
          return chunk;
        };
      }
      const value = Reflect.get(target, property, receiver);
      if (typeof value === "function") return value.bind(target);
      return value;
    },
  }) as NodeJS.ReadStream;
}

function formatPromptDebugEvent(event: PromptInputDebugEvent): string {
  if (event.type === "ink_input") {
    return [
      "ink  ",
      `input=${describeString(event.input)}`,
      `key=${describeKey(event.key)}`,
      `before=${describeState(event.before)}`,
    ].join(" ");
  }

  if (event.type === "commit") {
    return [
      "edit ",
      `reason=${event.reason}`,
      `after=${describeState(event.after)}`,
    ].join(" ");
  }

  if (event.type === "ignored") {
    return `skip  reason=${event.reason}`;
  }

  return `submit ${JSON.stringify(event.value)}`;
}

function describeState(state: { value: string; cursor: number }): string {
  return `${JSON.stringify(state.value)}@${state.cursor}`;
}

function describeChunk(chunk: string | Buffer): string {
  const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
  return `${describeString(text)} hex=${Buffer.from(text).toString("hex")}`;
}

function describeString(input: string): string {
  return `${JSON.stringify(printableControls(input))} len=${input.length}`;
}

function describeKey(key: Key): string {
  const flags = Object.entries(key)
    .filter(([, value]) => value === true)
    .map(([name]) => name);
  return flags.length > 0 ? flags.join("|") : "-";
}

function printableControls(input: string): string {
  return input
    .replace(/\x1b/g, "<ESC>")
    .replace(/\x7f/g, "<DEL>")
    .replace(/\x08/g, "<BS>")
    .replace(/\r/g, "<CR>")
    .replace(/\n/g, "<LF>")
    .replace(/\t/g, "<TAB>");
}
