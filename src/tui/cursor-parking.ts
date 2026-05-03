export type PromptCursorDeclaration = {
  linesBelowCursor: number;
  cursorColumn: number;
};

export type PromptCursorParking = {
  stdout: NodeJS.WriteStream;
  declareCursor: (declaration: PromptCursorDeclaration | null) => void;
  clear: () => void;
};

const SHOW_CURSOR = "\x1b[?25h";

export function createCursorParkingStdout(
  rawStdout: NodeJS.WriteStream,
): PromptCursorParking {
  let declaration: PromptCursorDeclaration | null = null;
  let parked: PromptCursorDeclaration | null = null;

  const normalize = (value: PromptCursorDeclaration): PromptCursorDeclaration => ({
    linesBelowCursor: Math.max(0, Math.floor(value.linesBelowCursor)),
    cursorColumn: Math.max(0, Math.floor(value.cursorColumn)),
  });

  const resetToFrameCursor = () => {
    if (!parked) return;
    rawStdout.write(moveDown(parked.linesBelowCursor) + "\r");
    parked = null;
  };

  const parkAtDeclaration = () => {
    if (!declaration) return;
    const target = normalize(declaration);
    resetToFrameCursor();
    rawStdout.write(
      SHOW_CURSOR + moveUp(target.linesBelowCursor) + cursorColumn(target.cursorColumn),
    );
    parked = target;
  };

  const declareCursor = (next: PromptCursorDeclaration | null) => {
    declaration = next ? normalize(next) : null;
    if (!declaration) {
      resetToFrameCursor();
      return;
    }
    parkAtDeclaration();
  };

  const clear = () => {
    declaration = null;
    resetToFrameCursor();
  };

  const stdout = new Proxy(rawStdout, {
    get(target, property, receiver) {
      if (property === "write") {
        return (...args: unknown[]) => {
          resetToFrameCursor();
          const result = Reflect.apply(target.write, target, args);
          parkAtDeclaration();
          return result as boolean;
        };
      }

      const value = Reflect.get(target, property, receiver);
      if (typeof value === "function") {
        return value.bind(target);
      }
      return value;
    },
  }) as NodeJS.WriteStream;

  return { stdout, declareCursor, clear };
}

function moveUp(lines: number): string {
  return lines > 0 ? `\x1b[${lines}A` : "";
}

function moveDown(lines: number): string {
  return lines > 0 ? `\x1b[${lines}B` : "";
}

function cursorColumn(column: number): string {
  return `\x1b[${column + 1}G`;
}
