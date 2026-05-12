import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSkillTool } from "../src/tools/skill.js";
import { discoverSkills } from "../src/skill/discovery.js";
import { checkToolPermission } from "../src/permission/policy.js";

describe("skill tool", () => {
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

  it("loads skill content and sampled file list", async () => {
    const cwd = await tempDir("myagent-skill-tool-");
    const home = await tempDir("myagent-skill-home-");
    const myagentHome = await tempDir("myagent-skill-myagent-home-");
    const skillDir = join(cwd, ".agents", "skills", "reviewer");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      "---\nname: reviewer\ndescription: Review code changes.\n---\n# Review\nUse sharp review notes.\n",
    );
    await writeFile(join(skillDir, "template.md"), "template");

    const skills = await discoverSkills({ cwd, homeDir: home, myagentHome });
    const tool = createSkillTool(skills);
    const result = await tool.execute({ name: "reviewer" }, { cwd });

    expect(result.ok).toBe(true);
    expect(result.output).toContain('<skill_content name="reviewer">');
    expect(result.output).toContain("# Review");
    expect(result.output).toContain("<file>template.md</file>");
    expect(result.metadata).toMatchObject({
      skillName: "reviewer",
      scope: "workspace",
      baseDir: skillDir,
    });
  });

  it("returns available skill names when the requested skill is missing", async () => {
    const cwd = await tempDir("myagent-skill-tool-missing-");
    const tool = createSkillTool([
      {
        name: "reviewer",
        description: "Review code changes.",
        content: "# Review",
        location: join(cwd, "SKILL.md"),
        baseDir: cwd,
        scope: "workspace",
      },
    ]);

    const result = await tool.execute({ name: "missing" }, { cwd });

    expect(result.ok).toBe(false);
    expect(result.output).toContain('Skill "missing" not found');
    expect(result.output).toContain("reviewer");
  });

  it("adds non-model permission metadata before policy evaluation", async () => {
    const cwd = await tempDir("myagent-skill-tool-meta-");
    const skill = {
      name: "global-docs",
      description: "Global docs workflow.",
      content: "# Docs",
      location: join(cwd, "SKILL.md"),
      baseDir: cwd,
      scope: "global" as const,
    };
    const tool = createSkillTool([skill]);

    expect(tool.preparePermissionInput?.({ name: "global-docs" }, { cwd })).toEqual({
      name: "global-docs",
      scope: "global",
      location: skill.location,
    });
  });

  it("distinguishes workspace, global, and never-mode skill permissions", async () => {
    const cwd = await tempDir("myagent-skill-tool-perm-");

    expect(
      checkToolPermission("skill", { name: "reviewer", scope: "workspace" }, "auto", cwd)
        .behavior,
    ).toBe("allow");
    expect(
      checkToolPermission("skill", { name: "global-docs", scope: "global" }, "auto", cwd)
        .behavior,
    ).toBe("ask");
    expect(
      checkToolPermission("skill", { name: "reviewer", scope: "workspace" }, "never", cwd)
        .behavior,
    ).toBe("deny");
  });
});
