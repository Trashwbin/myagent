import { describe, expect, it } from "vitest";
import { resolvePrimaryAnswer, resolveSecondaryAnswer } from "../src/cli/approval.js";

describe("resolvePrimaryAnswer", () => {
  it("allows empty input by default", () => {
    expect(resolvePrimaryAnswer("")).toBe("allow_once");
    expect(resolvePrimaryAnswer("   ")).toBe("allow_once");
  });

  it("allows y and yes", () => {
    expect(resolvePrimaryAnswer("y")).toBe("allow_once");
    expect(resolvePrimaryAnswer("Y")).toBe("allow_once");
    expect(resolvePrimaryAnswer("yes")).toBe("allow_once");
    expect(resolvePrimaryAnswer("YES")).toBe("allow_once");
  });

  it("triggers always with a", () => {
    expect(resolvePrimaryAnswer("a")).toBe("always");
    expect(resolvePrimaryAnswer("A")).toBe("always");
    expect(resolvePrimaryAnswer("always")).toBe("always");
  });

  it("aborts always input when always approvals are disabled", () => {
    expect(resolvePrimaryAnswer("a", { allowAlways: false })).toBe("abort");
    expect(resolvePrimaryAnswer("A", { allowAlways: false })).toBe("abort");
    expect(resolvePrimaryAnswer("always", { allowAlways: false })).toBe("abort");
  });

  it("aborts n and no", () => {
    expect(resolvePrimaryAnswer("n")).toBe("abort");
    expect(resolvePrimaryAnswer("N")).toBe("abort");
    expect(resolvePrimaryAnswer("no")).toBe("abort");
    expect(resolvePrimaryAnswer("NO")).toBe("abort");
  });

  it("aborts unknown input", () => {
    expect(resolvePrimaryAnswer("maybe")).toBe("abort");
  });
});

describe("resolveSecondaryAnswer", () => {
  it("selects session with s", () => {
    expect(resolveSecondaryAnswer("s")).toBe("allow_for_session");
    expect(resolveSecondaryAnswer("S")).toBe("allow_for_session");
    expect(resolveSecondaryAnswer("session")).toBe("allow_for_session");
  });

  it("selects workspace with w", () => {
    expect(resolveSecondaryAnswer("w")).toBe("allow_for_workspace");
    expect(resolveSecondaryAnswer("W")).toBe("allow_for_workspace");
    expect(resolveSecondaryAnswer("workspace")).toBe("allow_for_workspace");
  });

  it("cancels with n or unknown", () => {
    expect(resolveSecondaryAnswer("n")).toBe("cancel");
    expect(resolveSecondaryAnswer("")).toBe("cancel");
    expect(resolveSecondaryAnswer("x")).toBe("cancel");
  });
});
