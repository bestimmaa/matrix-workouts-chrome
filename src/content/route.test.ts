import { describe, expect, it } from "vitest";
import { workoutIdFromPath } from "./route.js";

describe("workoutIdFromPath", () => {
  it("matches a workout detail route", () => {
    expect(workoutIdFromPath("/workouts/6a8f2cd78d2b6d09c6943bd0")).toBe("6a8f2cd78d2b6d09c6943bd0");
    expect(workoutIdFromPath("/workouts/6a8f2cd78d2b6d09c6943bd0/")).toBe("6a8f2cd78d2b6d09c6943bd0");
  });

  it("ignores every other route", () => {
    expect(workoutIdFromPath("/workouts")).toBeNull();
    expect(workoutIdFromPath("/workouts/")).toBeNull();
    expect(workoutIdFromPath("/")).toBeNull();
    expect(workoutIdFromPath("/dashboard")).toBeNull();
    expect(workoutIdFromPath("/workouts/abc/edit")).toBeNull();
  });

  it("does not match ids with unexpected characters", () => {
    expect(workoutIdFromPath("/workouts/../etc")).toBeNull();
    expect(workoutIdFromPath("/workouts/a b")).toBeNull();
  });
});
