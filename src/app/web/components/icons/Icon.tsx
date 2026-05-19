import React from "react";

export type IconName =
  | "arrow-right"
  | "arrow-up"
  | "chevron-down"
  | "chevron-right"
  | "chevron-up"
  | "folder"
  | "folder-open"
  | "folder-plus"
  | "pencil"
  | "plus-square"
  | "search"
  | "skill"
  | "terminal";

const symbols: Record<IconName, string> = {
  "arrow-right": "icon-arrow-right",
  "arrow-up": "icon-arrow-up-bold",
  "chevron-down": "icon-direction-down",
  "chevron-right": "icon-direction-right",
  "chevron-up": "icon-direction-up",
  folder: "icon-folder-close",
  "folder-open": "icon-folder-filling",
  "folder-plus": "icon-file-add",
  pencil: "icon-edit",
  "plus-square": "icon-add",
  search: "icon-search",
  skill: "icon-prompt",
  terminal: "icon-code",
};

export function Icon({
  name,
  className,
}: {
  name: IconName;
  className?: string;
}) {
  const symbol = `#${symbols[name]}`;
  return (
    <svg
      className={["iconfont-icon", className].filter(Boolean).join(" ")}
      aria-hidden="true"
      focusable="false"
    >
      <use href={symbol} xlinkHref={symbol} />
    </svg>
  );
}
