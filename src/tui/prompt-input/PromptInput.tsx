import React from "react";
import { Box, Text, useInput } from "ink";
import type { PastePart } from "../types.js";
import { usePromptInput, type PromptInputDebugEvent } from "./usePromptInput.js";

export type { PromptInputDebugEvent } from "./usePromptInput.js";

type PromptInputProps = {
  value: string;
  cursor: number;
  onChange: (value: string, cursor: number) => void;
  onSubmit: (value: string) => void;
  pasteParts: PastePart[];
  onPastePartsChange: (parts: PastePart[]) => void;
  focus: boolean;
  columns: number;
  maxLines?: number;
  placeholder?: string;
  disabled?: boolean;
  onInputDebug?: (event: PromptInputDebugEvent) => void;
};

export const DEFAULT_MAX_VISIBLE_LINES = 6;

export function PromptInput({
  value,
  cursor,
  onChange,
  onSubmit,
  pasteParts,
  onPastePartsChange,
  focus,
  columns,
  maxLines = DEFAULT_MAX_VISIBLE_LINES,
  placeholder,
  disabled,
  onInputDebug,
}: PromptInputProps): React.ReactElement {
  const inputState = usePromptInput({
    value,
    cursor,
    onChange,
    onSubmit,
    pasteParts,
    onPastePartsChange,
    columns,
    maxLines,
    onInputDebug,
  });

  useInput(inputState.onInput, { isActive: focus && !disabled });

  const { editor, visibleLines, adjustedCursorLine } = inputState;

  if (!focus || disabled) {
    return (
      <Box flexDirection="column">
        <Box>
          <Text color="gray">{placeholder ?? "> "}</Text>
          <Text>{value}</Text>
        </Box>
      </Box>
    );
  }

  const elements: React.ReactElement[] = [];
  for (let i = 0; i < visibleLines.length; i++) {
    const line = visibleLines[i]!;
    if (i === adjustedCursorLine) {
      const { before, at, after } = editor.splitLineAtCursor(line);
      elements.push(
        <Text key={`l${i}`}>
          {before}
          <Text inverse>{at}</Text>
          {after}
        </Text>,
      );
    } else {
      elements.push(<Text key={`l${i}`}>{line.text || " "}</Text>);
    }
  }

  return (
    <Box flexDirection="column">
      {value.length === 0 && placeholder ? (
        <Box>
          <Text inverse> </Text>
          <Text color="gray">{placeholder}</Text>
        </Box>
      ) : (
        elements
      )}
    </Box>
  );
}
