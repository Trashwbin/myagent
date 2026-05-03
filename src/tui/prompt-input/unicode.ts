const GRAPHEME_BREAK_REGEX =
  /\p{Regional_Indicator}{2}|\p{Extended_Pictographic}(?:‍\p{Extended_Pictographic})*|\P{M}\p{M}*|\p{M}+/gu;
const ANSI_ESCAPE_REGEX = /\x1b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

type GraphemeSegment = {
  segment: string;
  index: number;
};

type WordSegment = {
  segment: string;
  index: number;
  isWordLike?: boolean;
};

let graphemeSegmenter: { segment(input: string): Iterable<GraphemeSegment> } | null =
  null;
let wordSegmenter: { segment(input: string): Iterable<WordSegment> } | null = null;

function getGraphemeSegmenter(): {
  segment(input: string): Iterable<GraphemeSegment>;
} | null {
  const Segmenter = (
    Intl as typeof Intl & {
      Segmenter?: new (
        locale: string | undefined,
        options: { granularity: "grapheme" },
      ) => { segment(input: string): Iterable<GraphemeSegment> };
    }
  ).Segmenter;
  if (!Segmenter) return null;
  graphemeSegmenter ??= new Segmenter(undefined, { granularity: "grapheme" });
  return graphemeSegmenter;
}

function getWordSegmenter(): {
  segment(input: string): Iterable<WordSegment>;
} | null {
  const Segmenter = (
    Intl as typeof Intl & {
      Segmenter?: new (
        locale: string | undefined,
        options: { granularity: "word" },
      ) => { segment(input: string): Iterable<WordSegment> };
    }
  ).Segmenter;
  if (!Segmenter) return null;
  wordSegmenter ??= new Segmenter(undefined, { granularity: "word" });
  return wordSegmenter;
}

export function stripTerminalSequences(input: string): string {
  return input.replace(ANSI_ESCAPE_REGEX, "");
}

export function normalizeTerminalInput(input: string): string {
  return stripTerminalSequences(input)
    .replace(/(?<=[^\\\r\n])\r$/u, "")
    .replace(/\r/g, "\n");
}

export function graphemeSegments(text: string): string[] {
  if (!text) return [];
  const segmenter = getGraphemeSegmenter();
  if (segmenter) {
    return Array.from(segmenter.segment(text), ({ segment }) => segment);
  }
  return text.match(GRAPHEME_BREAK_REGEX) ?? [...text];
}

export function graphemeBoundaries(text: string): number[] {
  const boundaries: number[] = [];
  let offset = 0;
  for (const segment of graphemeSegments(text)) {
    boundaries.push(offset);
    offset += segment.length;
  }
  boundaries.push(text.length);
  return boundaries;
}

export function previousGraphemeOffset(text: string, offset: number): number {
  if (offset <= 0) return 0;
  let previous = 0;
  for (const boundary of graphemeBoundaries(text)) {
    if (boundary >= offset) return previous;
    previous = boundary;
  }
  return previous;
}

export function nextGraphemeOffset(text: string, offset: number): number {
  if (offset >= text.length) return text.length;
  for (const boundary of graphemeBoundaries(text)) {
    if (boundary > offset) return boundary;
  }
  return text.length;
}

export function snapToGraphemeBoundary(text: string, offset: number): number {
  if (offset <= 0) return 0;
  if (offset >= text.length) return text.length;
  let previous = 0;
  for (const boundary of graphemeBoundaries(text)) {
    if (boundary === offset) return offset;
    if (boundary > offset) return previous;
    previous = boundary;
  }
  return previous;
}

export function stringWidth(str: string): number {
  let width = 0;
  for (const segment of graphemeSegments(stripTerminalSequences(str))) {
    width += graphemeWidth(segment);
  }
  return width;
}

function graphemeWidth(segment: string): number {
  if (!segment) return 0;
  if (isEmojiLike(segment)) return regionalIndicatorCount(segment) === 1 ? 1 : 2;

  for (const char of segment) {
    const code = char.codePointAt(0)!;
    if (isZeroWidth(code)) continue;
    return isWideCodePoint(code) ? 2 : 1;
  }
  return 0;
}

function isEmojiLike(segment: string): boolean {
  for (const char of segment) {
    const code = char.codePointAt(0)!;
    if ((code >= 0x1f000 && code <= 0x1faff) || (code >= 0x2600 && code <= 0x27bf)) {
      return true;
    }
  }
  return false;
}

function regionalIndicatorCount(segment: string): number {
  let count = 0;
  for (const char of segment) {
    const code = char.codePointAt(0)!;
    if (code >= 0x1f1e6 && code <= 0x1f1ff) count++;
  }
  return count;
}

function isZeroWidth(code: number): boolean {
  return (
    code <= 0x1f ||
    (code >= 0x7f && code <= 0x9f) ||
    (code >= 0x300 && code <= 0x36f) ||
    (code >= 0x1ab0 && code <= 0x1aff) ||
    (code >= 0x1dc0 && code <= 0x1dff) ||
    (code >= 0x20d0 && code <= 0x20ff) ||
    (code >= 0xfe00 && code <= 0xfe0f) ||
    code === 0x200b ||
    code === 0x200c ||
    code === 0x200d ||
    code === 0xfeff
  );
}

function isWideCodePoint(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2329 && code <= 0x232a) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe10 && code <= 0xfe19) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x20000 && code <= 0x3fffd)
  );
}

export function offsetAtDisplayColumn(text: string, column: number): number {
  if (column <= 0) return 0;
  let width = 0;
  let offset = 0;
  for (const segment of graphemeSegments(text)) {
    const nextWidth = width + stringWidth(segment);
    if (nextWidth > column) return offset;
    width = nextWidth;
    offset += segment.length;
  }
  return text.length;
}

export function displayWidthOfPrefix(text: string, offset: number): number {
  if (offset <= 0) return 0;
  if (offset >= text.length) return stringWidth(text);
  return stringWidth(text.slice(0, snapToGraphemeBoundary(text, offset)));
}

export function wordBoundaries(text: string): Array<{
  start: number;
  end: number;
  isWordLike: boolean;
}> {
  const segmenter = getWordSegmenter();
  if (segmenter) {
    return Array.from(segmenter.segment(text), (segment) => ({
      start: segment.index,
      end: segment.index + segment.segment.length,
      isWordLike: segment.isWordLike ?? false,
    }));
  }

  const result: Array<{ start: number; end: number; isWordLike: boolean }> = [];
  const re = /[\p{L}\p{N}_]+|[^\p{L}\p{N}_\s]+|\s+/gu;
  for (const match of text.matchAll(re)) {
    const segment = match[0];
    const start = match.index;
    result.push({
      start,
      end: start + segment.length,
      isWordLike: /[\p{L}\p{N}_]/u.test(segment),
    });
  }
  return result;
}
