import type { SkillInfo } from "../skill/types.js";
import { applyPatchTool } from "./apply-patch.js";
import { bashTool } from "./bash.js";
import { editFileTool } from "./edit.js";
import { findUpTool } from "./find-up.js";
import { globTool } from "./glob.js";
import { listDirTool } from "./list-dir.js";
import { readFileTool } from "./read.js";
import { ToolRegistry } from "./registry.js";
import { searchTool } from "./search.js";
import { createSkillTool } from "./skill.js";
import { writeFileTool } from "./write.js";

export function buildDefaultRegistry(skills: SkillInfo[] = []): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(readFileTool);
  registry.register(searchTool);
  registry.register(editFileTool);
  registry.register(writeFileTool);
  registry.register(bashTool);
  registry.register(listDirTool);
  registry.register(applyPatchTool);
  registry.register(globTool);
  registry.register(findUpTool);
  if (skills.length > 0) registry.register(createSkillTool(skills));
  return registry;
}
