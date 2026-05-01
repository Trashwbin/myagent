import { describe, expect, it } from "vitest";
import {
  buildExternalDirectoryPattern,
  matchesExternalDirectory,
  isExternalDirTool,
} from "../src/permission/external-directory.js";

describe("buildExternalDirectoryPattern", () => {
  it("uses parent directory for read_file", () => {
    expect(buildExternalDirectoryPattern("read_file", "/ext/project/pkg.json")).toBe(
      "/ext/project/*",
    );
  });

  it("uses the path itself for list_dir", () => {
    expect(buildExternalDirectoryPattern("list_dir", "/ext/project")).toBe(
      "/ext/project/*",
    );
  });

  it("uses the path itself for search", () => {
    expect(buildExternalDirectoryPattern("search", "/ext/project/src")).toBe(
      "/ext/project/src/*",
    );
  });
});

describe("matchesExternalDirectory", () => {
  it("matches a file inside the directory", () => {
    expect(matchesExternalDirectory("/ext/project/package.json", "/ext/project/*")).toBe(
      true,
    );
  });

  it("matches a nested file", () => {
    expect(matchesExternalDirectory("/ext/project/src/index.ts", "/ext/project/*")).toBe(
      true,
    );
  });

  it("matches the directory itself", () => {
    expect(matchesExternalDirectory("/ext/project", "/ext/project/*")).toBe(true);
  });

  it("does not match a sibling directory", () => {
    expect(matchesExternalDirectory("/ext/other-project/file.ts", "/ext/project/*")).toBe(
      false,
    );
  });

  it("does not match a parent directory", () => {
    expect(matchesExternalDirectory("/ext", "/ext/project/*")).toBe(false);
  });

  it("does not match a prefix match that is not a path boundary", () => {
    expect(matchesExternalDirectory("/ext/project-other/file.ts", "/ext/project/*")).toBe(
      false,
    );
  });
});

describe("isExternalDirTool", () => {
  it("returns true for read_file, list_dir, search", () => {
    expect(isExternalDirTool("read_file")).toBe(true);
    expect(isExternalDirTool("list_dir")).toBe(true);
    expect(isExternalDirTool("search")).toBe(true);
  });

  it("returns false for other tools", () => {
    expect(isExternalDirTool("edit_file")).toBe(false);
    expect(isExternalDirTool("bash")).toBe(false);
    expect(isExternalDirTool("unknown")).toBe(false);
  });
});
