import { describe, expect, it } from "vitest";
import { normalizeCliArgv, parseCliValues } from "../scripts/live-scenario.js";

describe("live-scenario CLI args", () => {
  it("strips pnpm's leading -- separator", () => {
    expect(normalizeCliArgv(["--", "--scenario", "patch-recover"])).toEqual([
      "--scenario",
      "patch-recover",
    ]);
  });

  it("keeps direct invocation args unchanged", () => {
    expect(normalizeCliArgv(["--scenario", "patch-recover"])).toEqual([
      "--scenario",
      "patch-recover",
    ]);
  });

  it("parses scenario after pnpm separator", () => {
    const values = parseCliValues(["--", "--scenario", "patch-recover"]);
    expect(values.scenario).toBe("patch-recover");
  });
});
