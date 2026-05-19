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
  | "plus-square"
  | "search"
  | "terminal";

const paths: Record<IconName, React.ReactNode> = {
  "arrow-right": <path d="M4 8h8M8.5 4.5 12 8l-3.5 3.5" />,
  "arrow-up": <path d="M8 13.5v-11M4.5 6.5 8 2.5l3.5 4" />,
  "chevron-down": <path d="M4.5 6.5 8 10l3.5-3.5" />,
  "chevron-right": <path d="M6.5 4.5 10 8l-3.5 3.5" />,
  "chevron-up": <path d="M4.5 9.5 8 6l3.5 3.5" />,
  folder: (
    <>
      <path d="M2.5 4.5h4l1.1 1.2h5.9v5.8h-11z" />
      <path d="M2.5 6.2h11" />
    </>
  ),
  "folder-open": (
    <>
      <path d="M2.4 5.5h4l1.2 1.2h6" />
      <path d="M2.6 6.8h10.9l-1 5H3.2z" />
    </>
  ),
  "folder-plus": (
    <>
      <path d="M2.5 4.5h4l1.1 1.2h5.9v5.8h-11z" />
      <path d="M2.5 6.2h11" />
      <path d="M8 8.4v4M6 10.4h4" />
    </>
  ),
  "plus-square": (
    <>
      <rect x="3" y="3" width="10" height="10" rx="2.2" />
      <path d="M8 5.8v4.4M5.8 8h4.4" />
    </>
  ),
  search: (
    <>
      <circle cx="7" cy="7" r="3.5" />
      <path d="m9.7 9.7 2.8 2.8" />
    </>
  ),
  terminal: (
    <>
      <path d="M3.5 5.2 6.3 8l-2.8 2.8" />
      <path d="M7.2 11h5.3" />
    </>
  ),
};

export function Icon({
  name,
  className,
}: {
  name: IconName;
  className?: string;
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      {paths[name]}
    </svg>
  );
}
