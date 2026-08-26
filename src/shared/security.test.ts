import { describe, expect, it } from "vitest";
import { redactRecord, redactUrl } from "./security";
import { sanitizeSnapshot } from "./storage";
import type { WorkspaceSnapshot } from "./types";

describe("sensitive data handling", () => {
  it("removes query strings and token-like diagnostic fields", () => {
    expect(redactUrl("https://cdn.example.com/live.m3u8?aid=secret#x")).toBe("https://cdn.example.com/live.m3u8");
    expect(redactRecord({ manifestUrl: "https://cdn.example.com/a?x=y", AID: "secret" })).toEqual({
      manifestUrl: "[redacted]",
      AID: "[redacted]"
    });
  });

  it("serializes only the persistent workspace contract", () => {
    const snapshot = {
      version: 1,
      sources: [{
        id: "chzzk:channel:live",
        platform: "chzzk",
        originalUrl: "https://chzzk.naver.com/live/channel",
        canonicalUrl: "https://chzzk.naver.com/live/channel",
        channelKey: "channel",
        manifestUrl: "https://cdn.example.com/master.m3u8?token=secret"
      }],
      order: ["chzzk:channel:live"],
      layout: "auto",
      preferences: [{ sourceId: "chzzk:channel:live", volume: 3, muted: true }],
      savedAt: 1,
      accessToken: "secret"
    } as unknown as WorkspaceSnapshot;
    const serialized = JSON.stringify(sanitizeSnapshot(snapshot));
    expect(serialized).not.toContain("manifestUrl");
    expect(serialized).not.toContain("accessToken");
    expect(JSON.parse(serialized).preferences[0].volume).toBe(1);
  });
});
