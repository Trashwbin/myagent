import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ProjectSkillIndex } from "../src/skill/index.js";

describe("ProjectSkillIndex", () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tmpDirs) await rm(dir, { recursive: true, force: true });
    tmpDirs.length = 0;
  });

  async function tempDir(prefix: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), prefix));
    tmpDirs.push(dir);
    return dir;
  }

  async function writeSkill(cwd: string, name: string, description: string): Promise<void> {
    const skillDir = join(cwd, ".agents", "skills", name);
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\n`,
    );
  }

  it("refreshes the snapshot when workspace skills are added, modified, or deleted", async () => {
    const cwd = await tempDir("myagent-skill-index-");
    const home = await tempDir("myagent-skill-home-");
    const myagentHome = await tempDir("myagent-skill-myagent-home-");
    const index = new ProjectSkillIndex({ cwd, homeDir: home, myagentHome });

    try {
      expect((await index.snapshot()).availableSkills).toEqual([]);

      await writeSkill(cwd, "hello", "Say hello.");
      expect((await index.snapshot()).availableSkills).toEqual([
        { name: "hello", description: "Say hello.", scope: "workspace" },
      ]);

      await writeSkill(cwd, "hello", "Say hello loudly.");
      expect((await index.snapshot()).availableSkills).toEqual([
        { name: "hello", description: "Say hello loudly.", scope: "workspace" },
      ]);

      await unlink(join(cwd, ".agents", "skills", "hello", "SKILL.md"));
      expect((await index.snapshot()).availableSkills).toEqual([]);
    } finally {
      index.dispose();
    }
  });
});
