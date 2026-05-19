import { existsSync, watch, type FSWatcher } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { discoverSkills, getSkillRoots, summarizeSkills, type DiscoverSkillsOptions } from "./discovery.js";
import type { SkillInfo, SkillSummary } from "./types.js";

export type SkillSnapshot = {
  skills: SkillInfo[];
  availableSkills: SkillSummary[];
  version: number;
};

export class ProjectSkillIndex {
  private dirty = true;
  private disposed = false;
  private version = 0;
  private lastFingerprint = "";
  private current: SkillSnapshot | undefined;
  private pending: Promise<SkillSnapshot> | undefined;
  private watchers = new Map<string, FSWatcher>();

  constructor(private readonly options: DiscoverSkillsOptions) {}

  async snapshot(): Promise<SkillSnapshot> {
    if (this.pending) return this.pending;
    if (!this.dirty && this.current) {
      const fingerprint = await skillFingerprint(this.options);
      if (fingerprint === this.lastFingerprint) return this.current;
    }

    this.pending = this.refresh().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }

  invalidate(): void {
    this.dirty = true;
  }

  dispose(): void {
    this.disposed = true;
    for (const watcher of this.watchers.values()) watcher.close();
    this.watchers.clear();
  }

  private async refresh(): Promise<SkillSnapshot> {
    const skills = await discoverSkills(this.options);
    const fingerprint = await skillFingerprint(this.options);
    this.syncWatchers(skills);
    this.lastFingerprint = fingerprint;
    this.dirty = false;
    this.current = {
      skills,
      availableSkills: summarizeSkills(skills),
      version: ++this.version,
    };
    return this.current;
  }

  private syncWatchers(skills: SkillInfo[]): void {
    if (this.disposed) return;
    const paths = new Set<string>();
    for (const root of getSkillRoots(this.options)) {
      paths.add(root.root);
      paths.add(dirname(root.root));
    }
    for (const skill of skills) paths.add(skill.baseDir);

    for (const path of paths) {
      if (!this.watchers.has(path)) this.watchPath(path);
    }

    for (const [path, watcher] of this.watchers) {
      if (!paths.has(path)) {
        watcher.close();
        this.watchers.delete(path);
      }
    }
  }

  private watchPath(path: string): void {
    if (!existsSync(path)) return;
    try {
      const watcher = watch(path, {}, () => this.invalidate());
      watcher.on("error", () => {
        watcher.close();
        this.watchers.delete(path);
        this.invalidate();
      });
      this.watchers.set(path, watcher);
    } catch {
      try {
        const watcher = watch(path, () => this.invalidate());
        watcher.on("error", () => {
          watcher.close();
          this.watchers.delete(path);
          this.invalidate();
        });
        this.watchers.set(path, watcher);
      } catch {
        this.invalidate();
      }
    }
  }
}

export class ProjectSkillIndexRegistry {
  private indexes = new Map<string, ProjectSkillIndex>();

  constructor(private readonly defaults: Omit<DiscoverSkillsOptions, "cwd"> = {}) {}

  get(cwd: string): ProjectSkillIndex {
    const key = resolve(cwd);
    const existing = this.indexes.get(key);
    if (existing) return existing;
    const index = new ProjectSkillIndex({ ...this.defaults, cwd: key });
    this.indexes.set(key, index);
    return index;
  }

  dispose(): void {
    for (const index of this.indexes.values()) index.dispose();
    this.indexes.clear();
  }
}

async function skillFingerprint(options: DiscoverSkillsOptions): Promise<string> {
  const signatures: string[] = [];
  for (const root of getSkillRoots(options)) {
    await addPathSignature(signatures, root.root);
    await addPathSignature(signatures, dirname(root.root));
    const skillFiles = await findSkillFiles(root.root);
    for (const file of skillFiles) {
      await addPathSignature(signatures, dirname(file));
      await addPathSignature(signatures, file);
    }
  }
  return signatures.sort().join("\n");
}

async function addPathSignature(signatures: string[], path: string): Promise<void> {
  const abs = resolve(path);
  const info = await stat(abs).catch(() => undefined);
  if (!info) {
    signatures.push(`${abs}:missing`);
    return;
  }
  signatures.push(`${abs}:${info.isDirectory() ? "dir" : "file"}:${info.mtimeMs}:${info.size}`);
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
      } else if (entry.isFile() && entry.name === "SKILL.md") {
        out.push(fullPath);
      }
    }
  }

  const rootStat = await stat(root).catch(() => undefined);
  if (!rootStat?.isDirectory()) return [];
  await walk(root);
  return out.sort();
}
