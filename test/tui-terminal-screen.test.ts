import { describe, expect, it } from "vitest";
import { enterAlternateScreen } from "../src/tui/terminal-screen.js";

describe("terminal screen", () => {
  it("enters and exits the alternate screen for TTY stdout", () => {
    const writes: string[] = [];
    const stdout = {
      isTTY: true,
      write(chunk: string) {
        writes.push(chunk);
        return true;
      },
    } as NodeJS.WriteStream;

    const screen = enterAlternateScreen(stdout);
    screen.exit();

    expect(writes).toEqual([
      "\x1b[?1049h\x1b[2J\x1b[H",
      "\x1b[?25h\x1b[2J\x1b[H\x1b[?1049l",
    ]);
  });

  it("exits at most once", () => {
    const writes: string[] = [];
    const stdout = {
      isTTY: true,
      write(chunk: string) {
        writes.push(chunk);
        return true;
      },
    } as NodeJS.WriteStream;

    const screen = enterAlternateScreen(stdout);
    screen.exit();
    screen.exit();

    expect(writes).toHaveLength(2);
  });

  it("is a no-op for non-TTY stdout", () => {
    const writes: string[] = [];
    const stdout = {
      isTTY: false,
      write(chunk: string) {
        writes.push(chunk);
        return true;
      },
    } as NodeJS.WriteStream;

    const screen = enterAlternateScreen(stdout);
    screen.exit();

    expect(writes).toEqual([]);
  });
});
