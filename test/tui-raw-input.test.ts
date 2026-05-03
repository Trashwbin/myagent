import { describe, expect, it } from "vitest";
import { EventEmitter } from "node:events";
import { createRawInputTrackingStdin } from "../src/tui/prompt-input/raw-input.js";

class FakeStdin extends EventEmitter {
  chunks: Array<string | Buffer> = [];
  read(): string | Buffer | null {
    return this.chunks.shift() ?? null;
  }
}

describe("createRawInputTrackingStdin", () => {
  it("can consume a raw chunk after observing it", () => {
    const raw = new FakeStdin() as unknown as FakeStdin & NodeJS.ReadStream;
    raw.chunks.push("\x1b[<64;10;5M");
    const observed: Array<string | Buffer> = [];
    const proxy = createRawInputTrackingStdin(
      raw,
      (chunk) => observed.push(chunk),
      () => true,
    );

    expect(proxy.stdin.read()).toBe("");
    expect(proxy.rawInput.lastChunk()).toBe("\x1b[<64;10;5M");
    expect(observed).toEqual(["\x1b[<64;10;5M"]);
  });

  it("passes through chunks when not consumed", () => {
    const raw = new FakeStdin() as unknown as FakeStdin & NodeJS.ReadStream;
    raw.chunks.push("a");
    const proxy = createRawInputTrackingStdin(raw, undefined, () => false);

    expect(proxy.stdin.read()).toBe("a");
    expect(proxy.rawInput.lastChunk()).toBe("a");
  });
});
