import { describe, expect, it } from "vitest";
import {
  distanceFromScrollBottom,
  isNearScrollBottom,
} from "../src/app/web/timeline-scroll.js";

describe("timeline scroll follow mode", () => {
  it("computes distance from the bottom", () => {
    expect(
      distanceFromScrollBottom({
        scrollHeight: 1_000,
        scrollTop: 600,
        clientHeight: 300,
      }),
    ).toBe(100);
  });

  it("follows only when the viewport is within the bottom threshold", () => {
    expect(
      isNearScrollBottom({
        scrollHeight: 1_000,
        scrollTop: 780,
        clientHeight: 120,
      }),
    ).toBe(true);
    expect(
      isNearScrollBottom({
        scrollHeight: 1_000,
        scrollTop: 700,
        clientHeight: 120,
      }),
    ).toBe(false);
  });
});
