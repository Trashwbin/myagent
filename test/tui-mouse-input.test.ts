import { describe, expect, it } from "vitest";
import {
  containsMouseSequence,
  enableMouseTracking,
  parseMouseEvents,
  stripMouseSequences,
} from "../src/tui/mouse-input.js";

describe("mouse input", () => {
  it("parses SGR wheel up events", () => {
    expect(parseMouseEvents("\x1b[<64;10;5M")).toEqual([
      { type: "wheel", direction: "up", x: 10, y: 5 },
    ]);
  });

  it("parses SGR wheel down events", () => {
    expect(parseMouseEvents("\x1b[<65;11;6M")).toEqual([
      { type: "wheel", direction: "down", x: 11, y: 6 },
    ]);
  });

  it("parses multiple events in one chunk", () => {
    expect(parseMouseEvents("\x1b[<64;1;2M\x1b[<65;3;4M")).toEqual([
      { type: "wheel", direction: "up", x: 1, y: 2 },
      { type: "wheel", direction: "down", x: 3, y: 4 },
    ]);
  });

  it("ignores non-wheel SGR mouse events", () => {
    expect(parseMouseEvents("\x1b[<0;10;5M")).toEqual([]);
    expect(parseMouseEvents("\x1b[<64;10;5m")).toEqual([]);
  });

  it("detects and strips mouse sequences including ESC-less fragments", () => {
    expect(containsMouseSequence("\x1b[<64;10;5M")).toBe(true);
    expect(containsMouseSequence("[<64;10;5M")).toBe(true);
    expect(stripMouseSequences("a\x1b[<64;10;5Mb[<65;1;2Mc")).toBe("abc");
  });

  it("enables and disables mouse tracking for TTY output", () => {
    const writes: string[] = [];
    const stdout = {
      isTTY: true,
      write(chunk: string) {
        writes.push(chunk);
      },
    } as unknown as NodeJS.WriteStream;

    const disable = enableMouseTracking(stdout);
    disable();
    disable();

    expect(writes).toEqual([
      "\x1b[?1000h\x1b[?1002h\x1b[?1006h",
      "\x1b[?1006l\x1b[?1002l\x1b[?1000l",
    ]);
  });

  it("does nothing for non-TTY output", () => {
    const writes: string[] = [];
    const stdout = {
      isTTY: false,
      write(chunk: string) {
        writes.push(chunk);
      },
    } as unknown as NodeJS.WriteStream;

    const disable = enableMouseTracking(stdout);
    disable();

    expect(writes).toEqual([]);
  });
});
