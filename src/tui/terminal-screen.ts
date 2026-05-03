const ENTER_ALT_SCREEN = "\x1b[?1049h";
const EXIT_ALT_SCREEN = "\x1b[?1049l";
const CLEAR_SCREEN = "\x1b[2J";
const CURSOR_HOME = "\x1b[H";
const SHOW_CURSOR = "\x1b[?25h";

export type TerminalScreenSession = {
  exit: () => void;
};

export function enterAlternateScreen(
  stdout: NodeJS.WriteStream = process.stdout,
): TerminalScreenSession {
  if (!stdout.isTTY) {
    return { exit: () => {} };
  }

  let active = true;
  stdout.write(ENTER_ALT_SCREEN + CLEAR_SCREEN + CURSOR_HOME);

  return {
    exit() {
      if (!active) return;
      active = false;
      stdout.write(SHOW_CURSOR + CLEAR_SCREEN + CURSOR_HOME + EXIT_ALT_SCREEN);
    },
  };
}
