import React from "react";
import type { PromptCursorDeclaration } from "./cursor-parking.js";

export const CursorDeclarationContext = React.createContext<
  (declaration: PromptCursorDeclaration | null) => void
>(() => {});

export function usePromptCursorDeclaration(
  declaration: PromptCursorDeclaration | null,
): void {
  const declareCursor = React.useContext(CursorDeclarationContext);

  React.useLayoutEffect(() => {
    declareCursor(declaration);
  });

  React.useLayoutEffect(() => {
    return () => {
      declareCursor(null);
    };
  }, [declareCursor]);
}
