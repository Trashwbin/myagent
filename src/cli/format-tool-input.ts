const INTERNAL_FIELDS = new Set([
  "resolvedPath",
  "realPath",
  "excludeSensitive",
  "resolvedPaths",
]);

const CONTENT_FIELDS = new Set([
  "content",
  "patch",
  "old_string",
  "new_string",
]);

const CONTENT_TRUNCATE = 120;
const GENERAL_TRUNCATE = 200;

function formatValue(key: string, value: unknown, sensitive: boolean): string {
  if (CONTENT_FIELDS.has(key)) {
    if (sensitive) return "[...]";
    if (typeof value !== "string") return JSON.stringify(value);
    if (value.length > CONTENT_TRUNCATE) return `"${value.slice(0, CONTENT_TRUNCATE)}"…`;
    return `"${value}"`;
  }
  if (typeof value === "string" && value.length > GENERAL_TRUNCATE) {
    return `"${value.slice(0, GENERAL_TRUNCATE)}"…`;
  }
  return JSON.stringify(value);
}

export function formatToolInputSummary(
  input: unknown,
  options?: { sensitive?: boolean },
): string {
  if (!input || typeof input !== "object") return "";

  const obj = input as Record<string, unknown>;
  const sensitive = options?.sensitive ?? false;

  const parts: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    if (INTERNAL_FIELDS.has(key)) continue;
    parts.push(`${key}: ${formatValue(key, value, sensitive)}`);
  }

  return parts.join(", ");
}
