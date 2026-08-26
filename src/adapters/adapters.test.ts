import { describe, expect, it } from "vitest";
import { normalizeStreamUrl } from ".";
import { parseChzzkPlaybackJson, rewriteChzzkMediaUrl } from "./chzzk";
import { rewriteSoopMediaUrl, soopCdnType } from "./soop";

describe("platform URL adapters", () => {
  it("normalizes CHZZK channel and live URLs without preserving query data", async () => {
    const id = "2086f44c7b09a17cef6786f21389db3b";
    const source = await normalizeStreamUrl(`https://chzzk.naver.com/${id}?accessToken=secret`);
    expect(source).toMatchObject({
      id: `chzzk:${id}:live`,
      channelKey: id,
      canonicalUrl: `https://chzzk.naver.com/live/${id}`,
      originalUrl: `https://chzzk.naver.com/live/${id}`
    });
  });

  it("normalizes current and legacy SOOP URLs", async () => {
    await expect(normalizeStreamUrl("https://play.sooplive.com/streamer/12345?aid=secret")).resolves.toMatchObject({
      id: "soop:streamer:12345",
      channelKey: "streamer",
      broadcastKey: "12345",
      canonicalUrl: "https://play.sooplive.com/streamer/12345"
    });
    await expect(normalizeStreamUrl("https://play.afreecatv.com/streamer/12345")).resolves.toMatchObject({
      platform: "soop",
      channelKey: "streamer"
    });
  });

  it("rejects non-HTTPS and private targets", async () => {
    await expect(normalizeStreamUrl("http://chzzk.naver.com/2086f44c7b09a17cef6786f21389db3b")).rejects.toThrow();
    await expect(normalizeStreamUrl("https://127.0.0.1/live/test")).rejects.toThrow();
  });
});

describe("playback session rewriting", () => {
  it("extracts the CHZZK HLS path and carries signed context to child resources", () => {
    const session = parseChzzkPlaybackJson(JSON.stringify({
      media: [{ mediaId: "HLS", protocol: "HLS", path: "https://nvelop-livecloud.pstatic.net/live/master.m3u8?hdnts=signed&vp=abc" }]
    }), "chzzk:test:live");
    expect(session.urlRewriteMode).toBe("chzzk-bgda");
    const rewritten = new URL(rewriteChzzkMediaUrl("720/playlist.m3u8", session.manifestUrl));
    expect(rewritten.searchParams.get("__bgda__")).toBe("signed");
    expect(rewritten.searchParams.get("vp")).toBe("abc");
  });

  it("appends SOOP AID without duplicating it", () => {
    const manifest = "https://live-pcweb-kr-cdn-z02.sooplive.com/live/master.m3u8?aid=existing";
    expect(new URL(rewriteSoopMediaUrl("variant.m3u8", manifest, "secret")).searchParams.get("aid")).toBe("secret");
    expect(new URL(rewriteSoopMediaUrl(manifest, manifest, "secret")).searchParams.get("aid")).toBe("existing");
    expect(soopCdnType("lg_cdn")).toBe("lg_cdn_pc_web");
  });
});
