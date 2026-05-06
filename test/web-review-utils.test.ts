import { describe, expect, it } from "vitest";
import { reviewStatus, splitReviewPath, summarizeReview } from "../src/app/web/components/review/review-utils.js";

describe("web review utils", () => {
  it("splits path into directory and filename", () => {
    expect(splitReviewPath("src/app.ts")).toEqual({
      directory: "src/",
      filename: "app.ts",
    });
    expect(splitReviewPath("app.ts")).toEqual({
      directory: "",
      filename: "app.ts",
    });
  });

  it("classifies review status from additions and deletions", () => {
    expect(reviewStatus({ path: "a.ts", additions: 1, deletions: 0 })).toBe("added");
    expect(reviewStatus({ path: "a.ts", additions: 0, deletions: 2 })).toBe("deleted");
    expect(reviewStatus({ path: "a.ts", additions: 2, deletions: 2 })).toBe("modified");
  });

  it("summarizes aggregate additions and deletions", () => {
    expect(
      summarizeReview([
        { path: "a.ts", additions: 2, deletions: 1 },
        { path: "b.ts", additions: 3, deletions: 4 },
      ]),
    ).toEqual({
      files: 2,
      additions: 5,
      deletions: 5,
    });
  });
});
