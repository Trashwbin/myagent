import React from "react";

export type RawInputSnapshot = {
  lastChunk: () => string;
};

const EMPTY_RAW_INPUT: RawInputSnapshot = {
  lastChunk: () => "",
};

export const RawInputContext = React.createContext<RawInputSnapshot>(EMPTY_RAW_INPUT);

export function createRawInputTrackingStdin(
  rawStdin: NodeJS.ReadStream,
  onRawChunk?: (chunk: string | Buffer) => void,
  shouldConsumeRawChunk?: (chunk: string | Buffer) => boolean,
): { stdin: NodeJS.ReadStream; rawInput: RawInputSnapshot } {
  let lastChunk = "";

  const stdin = new Proxy(rawStdin, {
    get(target, property, receiver) {
      if (property === "read") {
        return (...args: unknown[]) => {
          const chunk = Reflect.apply(target.read, target, args);
          if (chunk !== null) {
            lastChunk = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
            onRawChunk?.(chunk as string | Buffer);
            if (shouldConsumeRawChunk?.(chunk as string | Buffer)) {
              return "";
            }
          }
          return chunk;
        };
      }

      const value = Reflect.get(target, property, receiver);
      if (typeof value === "function") return value.bind(target);
      return value;
    },
  }) as NodeJS.ReadStream;

  return {
    stdin,
    rawInput: {
      lastChunk: () => lastChunk,
    },
  };
}
