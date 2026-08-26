import { errorForHttpStatus, PlaybackError } from "../shared/errors";
import { assertAllowedMediaUrl, parseHttpsUrl } from "../shared/security";
import type { PlaybackSession, StreamMetadata, StreamSource } from "../shared/types";
import { asRecord, asString, sourceId, type JsonRecord, type PlatformAdapter } from "./platform-adapter";

const API_BASE = "https://api.chzzk.naver.com/service/v3.3";
const CHANNEL_ID = /^[a-f0-9]{32}$/i;
const MEDIA_HOSTS = new Set(["pstatic.net", "naver.com", "naver.net"]);
const API_HEADERS = {
  "Front-Client-Product-Type": "web",
  "Front-Client-Platform-Type": "pc"
};

interface ChzzkLiveDetail {
  channelId: string;
  channelName: string;
  liveTitle: string;
  status: string;
  adult: boolean;
  liveImageUrl?: string;
  livePlaybackJson?: string;
}

function channelIdFromUrl(input: string): string | undefined {
  const url = parseHttpsUrl(input);
  if (!new Set(["chzzk.naver.com", "m.chzzk.naver.com"]).has(url.hostname.toLowerCase())) return undefined;
  const segments = url.pathname.split("/").filter(Boolean);
  const candidate = segments[0] === "live" ? segments[1] : segments[0];
  return candidate && CHANNEL_ID.test(candidate) ? candidate.toLowerCase() : undefined;
}

async function fetchLiveDetail(channelId: string): Promise<ChzzkLiveDetail> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/channels/${channelId}/live-detail?tm=false`, {
      headers: API_HEADERS,
      credentials: "omit"
    });
  } catch (error) {
    throw new PlaybackError("network_lost", { cause: error, retryable: true });
  }
  if (!response.ok) throw errorForHttpStatus(response.status);

  const payload = asRecord(await response.json());
  const content = asRecord(payload.content);
  const channel = asRecord(content.channel);
  const resolvedChannelId = asString(channel.channelId) ?? channelId;
  const channelName = asString(channel.channelName);
  if (!channelName) throw new PlaybackError("adapter_contract_changed");

  return {
    channelId: resolvedChannelId,
    channelName,
    liveTitle: asString(content.liveTitle) ?? "제목 없는 방송",
    status: asString(content.status) ?? "CLOSE",
    adult: content.adult === true,
    liveImageUrl: asString(content.liveImageUrl)?.replace("{type}", "720"),
    livePlaybackJson: asString(content.livePlaybackJson)
  };
}

export function parseChzzkPlaybackJson(raw: string, sourceIdValue: string): PlaybackSession {
  let parsed: JsonRecord;
  try {
    parsed = asRecord(JSON.parse(raw));
  } catch (error) {
    throw new PlaybackError("adapter_contract_changed", { cause: error });
  }
  const media = Array.isArray(parsed.media) ? parsed.media.map(asRecord) : [];
  const selected =
    media.find((item) => asString(item.mediaId)?.toUpperCase() === "HLS") ??
    media.find((item) => asString(item.protocol)?.toUpperCase() === "HLS");
  const manifestUrl = asString(selected?.path);
  if (!manifestUrl) throw new PlaybackError("adapter_contract_changed");
  const url = assertAllowedMediaUrl(manifestUrl, MEDIA_HOSTS);
  const hdntsExpiry = url.searchParams.get("hdnts")
    ?.split("~")
    .find((part) => part.startsWith("exp="))
    ?.slice(4);
  const expiresAtRaw = url.searchParams.get("expires") ?? url.searchParams.get("exp") ?? hdntsExpiry;
  const expiresAt = expiresAtRaw ? Number(expiresAtRaw) * 1000 : undefined;

  return {
    sourceId: sourceIdValue,
    manifestUrl: url.toString(),
    ...(expiresAt && Number.isFinite(expiresAt) ? { expiresAt } : {}),
    urlRewriteMode: url.searchParams.has("hdnts") ? "chzzk-bgda" : "none",
    qualityHint: "source"
  };
}

export function rewriteChzzkMediaUrl(input: string, manifestUrl: string): string {
  const target = new URL(input, manifestUrl);
  assertAllowedMediaUrl(target.toString(), MEDIA_HOSTS);
  const manifest = new URL(manifestUrl);
  const hdnts = manifest.searchParams.get("hdnts");
  if (hdnts && !target.searchParams.has("__bgda__") && !target.searchParams.has("hdnts")) {
    target.searchParams.set("__bgda__", hdnts);
  }
  const vp = manifest.searchParams.get("vp");
  if (vp && !target.searchParams.has("vp")) target.searchParams.set("vp", vp);
  return target.toString();
}

export const chzzkAdapter: PlatformAdapter = {
  platform: "chzzk",
  match(inputUrl) {
    try {
      return Boolean(channelIdFromUrl(inputUrl));
    } catch {
      return false;
    }
  },
  async normalize(inputUrl) {
    const channelKey = channelIdFromUrl(inputUrl);
    if (!channelKey) throw new PlaybackError("invalid_url");
    return {
      id: sourceId("chzzk", channelKey),
      platform: "chzzk",
      originalUrl: `https://chzzk.naver.com/live/${channelKey}`,
      canonicalUrl: `https://chzzk.naver.com/live/${channelKey}`,
      channelKey
    };
  },
  async resolveMetadata(source): Promise<StreamMetadata> {
    const detail = await fetchLiveDetail(source.channelKey);
    return {
      title: detail.liveTitle,
      channelName: detail.channelName,
      thumbnailUrl: detail.liveImageUrl,
      isLive: detail.status === "OPEN",
      isRestricted: detail.adult
    };
  },
  async createSession(source) {
    const detail = await fetchLiveDetail(source.channelKey);
    if (detail.adult) throw new PlaybackError("restricted");
    if (detail.status !== "OPEN") throw new PlaybackError("offline");
    if (!detail.livePlaybackJson) throw new PlaybackError("restricted");
    return parseChzzkPlaybackJson(detail.livePlaybackJson, source.id);
  },
  async refreshSession(source) {
    return this.createSession(source);
  }
};
