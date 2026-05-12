import { z } from "zod";
import { formatSkillContent } from "../skill/format.js";
import { sampleSkillFiles } from "../skill/discovery.js";
import type { SkillInfo } from "../skill/types.js";
import type { ToolContext, ToolDefinition, ToolResult } from "./tool.js";

const inputSchema = z.object({
  name: z.string().describe("The name of the skill from available skills"),
});

export function createSkillTool(skills: SkillInfo[]): ToolDefinition {
  const byName = new Map(skills.map((skill) => [skill.name, skill]));

  return {
    name: "skill",
    description: [
      "Load a specialized skill when the task matches one of the skills listed in the system prompt.",
      "",
      "Use this tool to inject the skill's detailed instructions and resource references into the current conversation.",
      "The skill name must exactly match one of the available skill names.",
    ].join("\n"),
    inputSchema,

    preparePermissionInput(input: unknown): unknown {
      const parsed = inputSchema.parse(input);
      const skill = byName.get(parsed.name);
      return {
        ...parsed,
        scope: skill?.scope,
        location: skill?.location,
      };
    },

    async execute(input: unknown, _context: ToolContext): Promise<ToolResult> {
      const { name } = inputSchema.parse(input);
      const skill = byName.get(name);

      if (!skill) {
        const available = [...byName.keys()].sort().join(", ");
        return {
          ok: false,
          output: `Skill "${name}" not found. Available skills: ${available || "none"}`,
        };
      }

      const files = await sampleSkillFiles(skill);
      return {
        ok: true,
        output: formatSkillContent(skill, files),
        metadata: {
          skillName: skill.name,
          baseDir: skill.baseDir,
          location: skill.location,
          scope: skill.scope,
        },
      };
    },
  };
}
