import { describe, expect, it } from "vitest";
import { audibleSourceIds, enforceSingleAudio, focusAudio } from "./audio";
import { nextLayout, resolveLayout } from "./layout";
import type { StreamPreference } from "../shared/types";

const preferences: StreamPreference[] = [
  { sourceId: "one", volume: 0.8, muted: false },
  { sourceId: "two", volume: 0.5, muted: false },
  { sourceId: "three", volume: 0.7, muted: true }
];

describe("audio focus", () => {
  it("never leaves more than one audible tile", () => {
    const focused = focusAudio(preferences, "two");
    expect(audibleSourceIds(focused)).toEqual(["two"]);
    expect(audibleSourceIds(enforceSingleAudio(preferences, "one"))).toEqual(["one"]);
  });
});

describe("layout rules", () => {
  it("uses aspect ratio only for two-stream automatic layout", () => {
    expect(resolveLayout("auto", 1, 2)).toBe("single");
    expect(resolveLayout("auto", 2, 1.2)).toBe("two-horizontal");
    expect(resolveLayout("auto", 2, 1.19)).toBe("two-vertical");
    expect(resolveLayout("auto", 3, 2)).toBe("grid");
    expect(resolveLayout("auto", 4, 0.7)).toBe("grid");
  });

  it("does not force a one-stream tile into a quarter grid", () => {
    expect(resolveLayout("grid", 1, 1.6)).toBe("single");
    expect(nextLayout("two-vertical", 2)).toBe("grid");
    expect(nextLayout("grid", 4)).toBe("auto");
  });
});
