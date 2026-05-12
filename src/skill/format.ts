import { pathToFileURL } from "node:url";
import type { SkillInfo, SkillSummary } from "./types.js";

export function formatSkillSummary(skills: SkillSummary[]): string | undefined {
  if (skills.length === 0) return undefined;
  return skills
    .map((skill) => `- ${skill.name} (${skill.scope}): ${skill.description}`)
    .join("\n");
}

export function formatSkillContent(skill: SkillInfo, files: string[] = []): string {
  return [
    `<skill_content name="${escapeAttribute(skill.name)}">`,
    `# Skill: ${skill.name}`,
    "",
    skill.content.trim(),
    "",
    `Base directory for this skill: ${pathToFileURL(skill.baseDir).href}`,
    "Relative paths in this skill (e.g. scripts/, reference/) are relative to this base directory.",
    "Note: file list is sampled.",
    "",
    "<skill_files>",
    files.map((file) => `<file>${escapeText(file)}</file>`).join("\n"),
    "</skill_files>",
    "</skill_content>",
  ].join("\n");
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
