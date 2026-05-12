export type SkillScope = "workspace" | "myagent" | "global";

export type SkillInfo = {
  name: string;
  description: string;
  location: string;
  content: string;
  scope: SkillScope;
  baseDir: string;
};

export type SkillSummary = {
  name: string;
  description: string;
  scope: SkillScope;
};
