import type { ModelProfile } from "../config/config.js";
import { findModelProfile } from "../config/config.js";

export function formatModelProfile(profile: ModelProfile): string {
  const label = profile.name ? `${profile.name} ` : "";
  const mode = profile.mode ? `:${profile.mode}` : "";
  return `${profile.id} ${label}(${profile.adapter}${mode}/${profile.model})`;
}

export function formatModelList(
  profiles: ModelProfile[],
  activeId: string | undefined,
): string {
  if (profiles.length === 0) return "No model profiles configured.";
  return [
    "Available models:",
    ...profiles.map((profile) => {
      const marker = profile.id === activeId ? "*" : "-";
      return `${marker} ${formatModelProfile(profile)}`;
    }),
    "",
    "Use /model <id> to switch.",
  ].join("\n");
}

export function resolveRequestedModelProfile(
  profiles: ModelProfile[],
  requestedId: string,
): ModelProfile | undefined {
  return findModelProfile(profiles, requestedId);
}

export function formatModelSwitch(profile: ModelProfile): string {
  return `Switched model to ${formatModelProfile(profile)}.`;
}

export function formatUnknownModel(
  requestedId: string,
  profiles: ModelProfile[],
): string {
  return [
    `Unknown model profile: ${requestedId}`,
    "",
    formatModelList(profiles, undefined),
  ].join("\n");
}
