import { describe, it, expect } from "vitest";
import { ToolRegistry } from "../src/tools/registry.js";
import { readFileTool } from "../src/tools/read.js";
import { searchTool } from "../src/tools/search.js";
import { editFileTool } from "../src/tools/edit.js";
import { bashTool } from "../src/tools/bash.js";
import { globTool } from "../src/tools/glob.js";
import { zodToJsonSchema } from "zod-to-json-schema";

describe("ToolRegistry", () => {
  it("registers and finds all built-in tools", () => {
    const registry = new ToolRegistry();
    registry.register(readFileTool);
    registry.register(searchTool);
    registry.register(editFileTool);
    registry.register(bashTool);
    registry.register(globTool);

    expect(registry.get("Read")).toBe(readFileTool);
    expect(registry.get("grep")).toBe(searchTool);
    expect(registry.get("edit_file")).toBe(editFileTool);
    expect(registry.get("bash")).toBe(bashTool);
    expect(registry.get("glob")).toBe(globTool);
  });

  it("returns undefined for unknown tools", () => {
    const registry = new ToolRegistry();
    expect(registry.get("nonexistent")).toBeUndefined();
  });

  it("lists all registered tools", () => {
    const registry = new ToolRegistry();
    registry.register(readFileTool);
    registry.register(bashTool);

    const list = registry.list();
    expect(list).toHaveLength(2);
    expect(list.map((t) => t.name)).toEqual(["Read", "bash"]);
  });

  it("all tools have name, description, inputSchema, and execute", () => {
    const tools = [readFileTool, searchTool, editFileTool, bashTool, globTool];
    for (const tool of tools) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema).toBeDefined();
      expect(typeof tool.execute).toBe("function");
    }
  });

  it("does not expose permission-resolved internal fields to the model", () => {
    const properties = (tool: { inputSchema: unknown }) =>
      Object.keys(
        ((zodToJsonSchema(tool.inputSchema as any) as any).properties ?? {}) as Record<
          string,
          unknown
        >,
      );

    expect(properties(readFileTool)).not.toContain("resolvedPath");
    expect(properties(readFileTool)).not.toContain("realPath");

    expect(properties(searchTool)).not.toContain("resolvedPath");
    expect(properties(searchTool)).not.toContain("realPath");
    expect(properties(searchTool)).not.toContain("excludeSensitive");

    expect(properties(globTool)).not.toContain("resolvedPath");
    expect(properties(globTool)).not.toContain("realPath");

    expect(properties(editFileTool)).not.toContain("resolvedPath");
  });
});
