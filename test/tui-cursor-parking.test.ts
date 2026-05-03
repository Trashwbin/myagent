import { describe, expect, it } from "vitest";
import { createCursorParkingStdout } from "../src/tui/cursor-parking.js";

describe("createCursorParkingStdout", () => {
  it("parks the terminal cursor after Ink writes and resets before the next write", () => {
    const writes: string[] = [];
    const rawStdout = {
      write(chunk: string) {
        writes.push(chunk);
        return true;
      },
    } as NodeJS.WriteStream;

    const parking = createCursorParkingStdout(rawStdout);
    parking.declareCursor({ linesBelowCursor: 2, cursorColumn: 4 });

    expect(writes).toEqual(["\x1b[?25h\x1b[2A\x1b[5G"]);

    parking.stdout.write("frame");

    expect(writes).toEqual([
      "\x1b[?25h\x1b[2A\x1b[5G",
      "\x1b[2B\r",
      "frame",
      "\x1b[?25h\x1b[2A\x1b[5G",
    ]);
  });

  it("returns to the frame cursor when cleared", () => {
    const writes: string[] = [];
    const rawStdout = {
      write(chunk: string) {
        writes.push(chunk);
        return true;
      },
    } as NodeJS.WriteStream;

    const parking = createCursorParkingStdout(rawStdout);
    parking.declareCursor({ linesBelowCursor: 1, cursorColumn: 0 });
    parking.clear();

    expect(writes).toEqual(["\x1b[?25h\x1b[1A\x1b[1G", "\x1b[1B\r"]);
  });
});
