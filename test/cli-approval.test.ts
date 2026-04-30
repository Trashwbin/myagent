import { describe, expect, it } from "vitest";
import { resolveApprovalAnswer } from "../src/cli/approval.js";

describe("resolveApprovalAnswer", () => {
  it("allows empty input by default", () => {
    expect(resolveApprovalAnswer("")).toBe("allow");
    expect(resolveApprovalAnswer("   ")).toBe("allow");
  });

  it("allows y and yes", () => {
    expect(resolveApprovalAnswer("y")).toBe("allow");
    expect(resolveApprovalAnswer("Y")).toBe("allow");
    expect(resolveApprovalAnswer("yes")).toBe("allow");
    expect(resolveApprovalAnswer("YES")).toBe("allow");
  });

  it("denies n and no", () => {
    expect(resolveApprovalAnswer("n")).toBe("deny");
    expect(resolveApprovalAnswer("N")).toBe("deny");
    expect(resolveApprovalAnswer("no")).toBe("deny");
    expect(resolveApprovalAnswer("NO")).toBe("deny");
  });

  it("denies unknown input", () => {
    expect(resolveApprovalAnswer("maybe")).toBe("deny");
  });
});
