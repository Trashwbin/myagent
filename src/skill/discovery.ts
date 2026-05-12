import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import type { SkillInfo, SkillScope, SkillSummary } from "./types.js";

type SkillRoot = {
  root: string;
  scope: SkillScope;
  priority: number;
};

type ParsedSkill = {
  name: string;
  description: string;
  content: string;
};

export type DiscoverSkillsOptions = {
  cwd: string;
  myagentHome?: string;
  homeDir?: string;
};

const WORKSPACE_SKILL_DIRS = [
  [".agents", "skills"],
  [".claude", "skills"],
  [".opencode", "skill"],
  [".opencode", "skills"],
] as const;

const GLOBAL_SKILL_DIRS = [
  [".agents", "skills"],
  [".claude", "skills"],
] as const;

export async function discoverSkills(options: DiscoverSkillsOptions): Promise<SkillInfo[]> {
  const roots = skillRoots(options);
  const discovered: SkillInfo[] = [];

  for (const root of roots) {
    if (!existsSync(root.root)) continue;
    const files = await findSkillFiles(root.root);
    for (const file of files) {
      const parsed = await parseSkillFile(file);
      if (!parsed) continue;
      discovered.push({
        ...parsed,
        location: file,
        baseDir: dirname(file),
        scope: root.scope,
      });
    }
  }

  return dedupeSkills(discovered, roots);
}

export function summarizeSkills(skills: SkillInfo[]): SkillSummary[] {
  return skills
    .map((skill) => ({
      name: skill.name,
      description: skill.description,
      scope: skill.scope,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function sampleSkillFiles(skill: SkillInfo, limit = 10): Promise<string[]> {
  const files = await findFiles(skill.baseDir);
  return files
    .filter((file) => basename(file) !== "SKILL.md")
    .sort()
    .slice(0, limit)
    .map((file) => relative(skill.baseDir, file));
}

function skillRoots(options: DiscoverSkillsOptions): SkillRoot[] {
  const cwd = resolve(options.cwd);
  const myagentHome =
    options.myagentHome ?? process.env.MYAGENT_HOME ?? join(homedir(), ".myagent");
  const home = options.homeDir ?? homedir();

  const roots: SkillRoot[] = [];
  let priority = 0;

  for (const parts of WORKSPACE_SKILL_DIRS) {
    roots.push({ root: join(cwd, ...parts), scope: "workspace", priority: priority++ });
  }

  roots.push({ root: join(myagentHome, "skills"), scope: "myagent", priority: priority++ });

  for (const parts of GLOBAL_SKILL_DIRS) {
    roots.push({ root: join(home, ...parts), scope: "global", priority: priority++ });
  }

  return roots;
}

async function findSkillFiles(root: string): Promise<string[]> {
  const out: string[] = [];

  async function walk(dir: string): Promise<void> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name === "SKILL.md") {
        out.push(fullPath);
      }
    }
  }

  const rootStat = await stat(root).catch(() => undefined);
  if (!rootStat?.isDirectory()) return [];
  await walk(root);
  return out.sort();
}

async function findFiles(root: string): Promise<string[]> {
  const out: string[] = [];

  async function walk(dir: string): Promise<void> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        out.push(fullPath);
      }
    }
  }

  await walk(root);
  return out;
}

async function parseSkillFile(filePath: string): Promise<ParsedSkill | undefined> {
  const raw = await readFile(filePath, "utf-8").catch(() => undefined);
  if (!raw) return undefined;

  const parsed = parseFrontmatter(raw);
  if (!parsed) return undefined;

  const name = parsed.data.name;
  const description = parsed.data.description;
  if (typeof name !== "string" || typeof description !== "string") return undefined;
  if (!name.trim() || !description.trim()) return undefined;

  const expectedDirName = basename(dirname(filePath));
  return {
    name: name.trim() || expectedDirName,
    description: description.trim(),
    content: parsed.content.trim(),
  };
}

function parseFrontmatter(raw: string): { data: Record<string, string>; content: string } | undefined {
  if (!raw.startsWith("---\n") && !raw.startsWith("---\r\n")) return undefined;
  const newline = raw.startsWith("---\r\n") ? "\r\n" : "\n";
  const end = raw.indexOf(`${newline}---${newline}`, 3);
  if (end < 0) return undefined;

  const frontmatter = raw.slice(3 + newline.length, end);
  const content = raw.slice(end + newline.length + 3 + newline.length);
  const data: Record<string, string> = {};

  for (const line of frontmatter.split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key) data[key] = value;
  }

  return { data, content };
}

function dedupeSkills(skills: SkillInfo[], roots: SkillRoot[]): SkillInfo[] {
  const rootPriority = new Map(roots.map((root) => [root.root, root.priority]));
  const priorityFor = (skill: SkillInfo): number => {
    const matchingRoot = roots.find((root) => skill.location.startsWith(root.root));
    return matchingRoot ? rootPriority.get(matchingRoot.root) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
  };

  const byName = new Map<string, SkillInfo>();
  for (const skill of skills) {
    const existing = byName.get(skill.name);
    if (!existing || priorityFor(skill) < priorityFor(existing)) {
      byName.set(skill.name, skill);
    }
  }

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}
