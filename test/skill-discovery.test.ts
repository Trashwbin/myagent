import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { discoverSkills, summarizeSkills } from "../src/skill/discovery.js";
import { formatSkillContent, formatSkillSummary } from "../src/skill/format.js";

describe("skill discovery", () => {
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

  async function writeSkill(root: string, relDir: string, body: string): Promise<void> {
    const dir = join(root, relDir);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "SKILL.md"), body);
  }

  it("discovers workspace and global skills from supported roots", async () => {
    const cwd = await tempDir("myagent-skills-ws-");
    const home = await tempDir("myagent-skills-home-");
    const myagentHome = await tempDir("myagent-skills-home-myagent-");

    await writeSkill(
      cwd,
      ".agents/skills/reviewer",
      "---\nname: reviewer\ndescription: Review code changes.\n---\n# Review\n",
    );
    await writeSkill(
      cwd,
      ".opencode/skill/planner",
      "---\nname: planner\ndescription: Plan implementation work.\n---\n# Plan\n",
    );
    await writeSkill(
      home,
      ".claude/skills/global-docs",
      "---\nname: global-docs\ndescription: Global docs workflow.\n---\n# Docs\n",
    );
    await writeSkill(
      myagentHome,
      "skills/local-agent",
      "---\nname: local-agent\ndescription: MyAgent local skill.\n---\n# Local\n",
    );

    const skills = await discoverSkills({ cwd, homeDir: home, myagentHome });

    expect(skills.map((skill) => [skill.name, skill.scope])).toEqual([
      ["global-docs", "global"],
      ["local-agent", "myagent"],
      ["planner", "workspace"],
      ["reviewer", "workspace"],
    ]);
  });

  it("skips invalid skill files without failing discovery", async () => {
    const cwd = await tempDir("myagent-skills-invalid-");
    const home = await tempDir("myagent-skills-home-");
    const myagentHome = await tempDir("myagent-skills-home-myagent-");

    await writeSkill(cwd, ".agents/skills/no-frontmatter", "# Missing frontmatter\n");
    await writeSkill(
      cwd,
      ".agents/skills/missing-description",
      "---\nname: bad\n---\n# Bad\n",
    );
    await writeSkill(
      cwd,
      ".agents/skills/good",
      "---\nname: good\ndescription: Valid skill.\n---\n# Good\n",
    );

    const skills = await discoverSkills({ cwd, homeDir: home, myagentHome });

    expect(skills.map((skill) => skill.name)).toEqual(["good"]);
  });

  it("deduplicates by preferring workspace over myagent home and global skills", async () => {
    const cwd = await tempDir("myagent-skills-dupe-");
    const home = await tempDir("myagent-skills-home-");
    const myagentHome = await tempDir("myagent-skills-home-myagent-");

    await writeSkill(
      home,
      ".agents/skills/shared",
      "---\nname: shared\ndescription: Global copy.\n---\n# Global\n",
    );
    await writeSkill(
      myagentHome,
      "skills/shared",
      "---\nname: shared\ndescription: MyAgent copy.\n---\n# MyAgent\n",
    );
    await writeSkill(
      cwd,
      ".agents/skills/shared",
      "---\nname: shared\ndescription: Workspace copy.\n---\n# Workspace\n",
    );

    const skills = await discoverSkills({ cwd, homeDir: home, myagentHome });

    expect(skills).toHaveLength(1);
    expect(skills[0]?.scope).toBe("workspace");
    expect(skills[0]?.description).toBe("Workspace copy.");
  });

  it("formats summaries without leaking full skill content", async () => {
    const cwd = await tempDir("myagent-skills-format-");
    const home = await tempDir("myagent-skills-home-");
    const myagentHome = await tempDir("myagent-skills-home-myagent-");

    await writeSkill(
      cwd,
      ".agents/skills/reviewer",
      "---\nname: reviewer\ndescription: Review code changes.\n---\n# Secret Workflow\nDo not leak this in summary.\n",
    );

    const skills = await discoverSkills({ cwd, homeDir: home, myagentHome });
    const summary = formatSkillSummary(summarizeSkills(skills));

    expect(summary).toContain("reviewer");
    expect(summary).toContain("Review code changes.");
    expect(summary).not.toContain("Secret Workflow");
  });

  it("formats full skill content with base directory and sampled files", async () => {
    const skill = {
      name: "docs",
      description: "Write docs.",
      location: "/workspace/.agents/skills/docs/SKILL.md",
      baseDir: "/workspace/.agents/skills/docs",
      scope: "workspace" as const,
      content: "# Docs\nUse concise docs.",
    };

    const content = formatSkillContent(skill, [
      "/workspace/.agents/skills/docs/template.md",
    ]);

    expect(content).toContain('<skill_content name="docs">');
    expect(content).toContain("# Skill: docs");
    expect(content).toContain("# Docs");
    expect(content).toContain("file:///workspace/.agents/skills/docs");
    expect(content).toContain("<file>/workspace/.agents/skills/docs/template.md</file>");
  });
});
