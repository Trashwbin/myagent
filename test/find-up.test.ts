import { describe, expect, it } from "vitest";
import { findUpTool } from "../src/tools/find-up.js";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("find_up tool", () => {
  it("finds package.json in current directory", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-findup-"));
    await writeFile(join(tmp, "package.json"), "{}");

    const result = await findUpTool.execute(
      { name: "package.json", start_path: "." },
      { cwd: tmp },
    );

    expect(result.ok).toBe(true);
    expect(result.output).toContain("package.json");

    await rm(tmp, { recursive: true, force: true });
  });

  it("finds package.json in parent directory", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-findup-"));
    await writeFile(join(tmp, "package.json"), "{}");
    await mkdir(join(tmp, "src"));
    await mkdir(join(tmp, "src", "util"));

    const result = await findUpTool.execute(
      { name: "package.json", start_path: "src/util" },
      { cwd: tmp },
    );

    expect(result.ok).toBe(true);
    expect(result.output).toBe(join(tmp, "package.json"));

    await rm(tmp, { recursive: true, force: true });
  });

  it("finds from file path (uses directory of file)", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-findup-"));
    await mkdir(join(tmp, "src"));
    await writeFile(join(tmp, "src", "index.ts"), "");
    await writeFile(join(tmp, "tsconfig.json"), "{}");

    const result = await findUpTool.execute(
      { name: "tsconfig.json", start_path: "src/index.ts" },
      { cwd: tmp },
    );

    expect(result.ok).toBe(true);
    expect(result.output).toBe(join(tmp, "tsconfig.json"));

    await rm(tmp, { recursive: true, force: true });
  });

  it("returns not found when no match exists", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-findup-"));
    await writeFile(join(tmp, "readme.md"), "hello");

    const result = await findUpTool.execute(
      { name: "NONEXISTENT_MARKER_FILE", start_path: "." },
      { cwd: tmp },
    );

    expect(result.ok).toBe(true);
    expect(result.output).toBe("No matching ancestor found");

    await rm(tmp, { recursive: true, force: true });
  });

  it("respects stop parameter", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-findup-"));
    await mkdir(join(tmp, "project"));
    await mkdir(join(tmp, "project", "src"));
    // package.json in tmp (above project), not in project
    await writeFile(join(tmp, "package.json"), "{}");

    const result = await findUpTool.execute(
      { name: "package.json", start_path: "project/src", stop: "project" },
      { cwd: tmp },
    );

    expect(result.ok).toBe(true);
    expect(result.output).toBe("No matching ancestor found");

    await rm(tmp, { recursive: true, force: true });
  });

  it("finds file in stop directory itself", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-findup-"));
    await mkdir(join(tmp, "project"));
    await mkdir(join(tmp, "project", "src"));
    await writeFile(join(tmp, "project", "package.json"), "{}");

    const result = await findUpTool.execute(
      { name: "package.json", start_path: "project/src", stop: "project" },
      { cwd: tmp },
    );

    expect(result.ok).toBe(true);
    expect(result.output).toBe(join(tmp, "project", "package.json"));

    await rm(tmp, { recursive: true, force: true });
  });

  it("finds .gitignore (hidden file)", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-findup-"));
    await mkdir(join(tmp, "src"));
    await writeFile(join(tmp, ".gitignore"), "node_modules\n");

    const result = await findUpTool.execute(
      { name: ".gitignore", start_path: "src" },
      { cwd: tmp },
    );

    expect(result.ok).toBe(true);
    expect(result.output).toBe(join(tmp, ".gitignore"));

    await rm(tmp, { recursive: true, force: true });
  });

  it("rejects external start_path without permission-resolved input", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-findup-"));
    const sibling = `${tmp}-sibling`;
    await mkdir(sibling);

    const result = await findUpTool.execute(
      { name: "package.json", start_path: `../${sibling.split("/").at(-1)}` },
      { cwd: tmp },
    );

    expect(result.ok).toBe(false);
    expect(result.output).toContain("permission-resolved input");

    await rm(tmp, { recursive: true, force: true });
    await rm(sibling, { recursive: true, force: true });
  });
});

// --- Permission policy for stop path ---

import { checkToolPermission } from "../src/permission/policy.js";

describe("find_up permission — stop path", () => {
  const CWD = process.cwd();

  it("asks for find_up when stop path is outside workspace (unresolvable target)", () => {
    const result = checkToolPermission(
      "find_up",
      { name: "package.json", start_path: ".", stop: "/nonexistent_outside_workspace_stop" },
      "auto",
      CWD,
    );
    expect(result.behavior).toBe("ask");
    expect(result.reason).toContain("outside workspace");
  });

  it("asks for find_up when stop path is outside workspace", () => {
    const result = checkToolPermission(
      "find_up",
      { name: "package.json", start_path: ".", stop: "/tmp" },
      "auto",
      CWD,
    );
    expect(result.behavior).toBe("ask");
    expect(result.reason).toContain("outside workspace");
  });

  it("allows find_up when both start_path and stop are inside workspace", () => {
    const result = checkToolPermission(
      "find_up",
      { name: "package.json", start_path: ".", stop: "." },
      "auto",
      CWD,
    );
    expect(result.behavior).toBe("allow");
  });

  it("denies in never mode when stop is outside workspace", () => {
    const result = checkToolPermission(
      "find_up",
      { name: "package.json", start_path: ".", stop: "/tmp" },
      "never",
      CWD,
    );
    expect(result.behavior).toBe("deny");
  });

  it("workspace start_path with external stop is still denied in never mode", () => {
    const result = checkToolPermission(
      "find_up",
      { name: "package.json", start_path: ".", stop: "/etc" },
      "never",
      CWD,
    );
    // The finalize step in checkToolPermission should deny the ask from stop
    expect(result.behavior).toBe("deny");
    expect(result.reason).toContain("approval mode is never");
  });

  it("external stop decision metadata keys off the stop path, not start_path", () => {
    const result = checkToolPermission(
      "find_up",
      { name: "package.json", start_path: ".", stop: "/tmp" },
      "auto",
      CWD,
    );
    expect(result.behavior).toBe("ask");
    // realPath in metadata must be the stop path, so approval rules match correctly
    expect((result.metadata as any).realPath).toMatch(/\/tmp$/);
    expect((result.metadata as any).externalDirectoryPattern).toBeTruthy();
  });
});
