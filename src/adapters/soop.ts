import { errorForHttpStatus, PlaybackError } from "../shared/errors";
import { assertAllowedMediaUrl, parseHttpsUrl } from "../shared/security";
import type { PlaybackSession, StreamMetadata, StreamSource } from "../shared/types";
import { asNumber, asRecord, asString, sourceId, type JsonRecord, type PlatformAdapter } from "./platform-adapter";

const ROOT_DOMAINS = new Set(["sooplive.com", "sooplive.co.kr", "afreecatv.com"]);
const MEDIA_HOSTS = new Set(["sooplive.com", "sooplive.co.kr", "afreecatv.com", "gscdn.com"]);
const LIVE_API = "https://live.sooplive.com/afreeca/player_live_api.php";
const QUALITY_CHAIN = ["auto", "original", "hd8k", "hd4k", "hd2k", "hd", "sd"] as const;

interface SoopChannelInfo {
  result: number;
  broadcastNo?: string;
  resourceManager?: string;
  cdn?: string;
  title?: string;
  channelName?: string;
  password: boolean;
  subscriptionOnly: boolean;
  viewPreset: Array<{ name: string; height: number; bitrate: number }>;
  message?: string;
  aid?: string;
}

function rootDomain(hostname: string): string | undefined {
  return [...ROOT_DOMAINS].find((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}

function parseSoopUrl(input: string): { channelKey: string; broadcastKey?: string } | undefined {
  const url = parseHttpsUrl(input);
  if (!rootDomain(url.hostname.toLowerCase())) return undefined;
  const segments = url.pathname.split("/").filter(Boolean);
  let channelKey: string | undefined;
  let broadcastKey: string | undefined;

  if (segments[0] === "station") channelKey = segments[1];
  else if (["player", "live", "mobile"].includes(segments[0])) {
    channelKey = segments[1];
    broadcastKey = segments[2];
  } else {
    channelKey = segments[0];
    broadcastKey = segments[1];
  }

  if (!channelKey || !/^[a-z0-9_-]{2,32}$/i.test(channelKey)) return undefined;
  if (broadcastKey && !/^\d+$/.test(broadcastKey)) broadcastKey = undefined;
  return { channelKey: channelKey.toLowerCase(), ...(broadcastKey ? { broadcastKey } : {}) };
}

function qualityForApi(quality: string): string {
  const map: Record<string, string> = {
    auto: "AUTO",
    original: "ORIGINAL",
    hd8k: "HIGH_8000",
    hd4k: "HIGH_4000",
    hd2k: "HIGH",
    hd: "HD",
    sd: "LOW"
  };
  return map[quality] ?? "HD";
}

function parseChannel(payload: unknown): SoopChannelInfo {
  const channel = asRecord(asRecord(payload).CHANNEL);
  const rawPreset = Array.isArray(channel.VIEWPRESET) ? channel.VIEWPRESET : [];
  return {
    result: asNumber(channel.RESULT) ?? -1,
    broadcastNo: asString(channel.BNO),
    resourceManager: asString(channel.RMD),
    cdn: asString(channel.CDN),
    title: asString(channel.TITLE),
    channelName: asString(channel.BJNICK) ?? asString(channel.BJID),
    password: channel.BPWD === "Y" || channel.PWD === "Y",
    subscriptionOnly:
      (asNumber(channel.SUBSCRIPTION_TIER) ?? asNumber(channel.SUBSCRIPTION_ONLY) ?? 0) > 0,
    viewPreset: rawPreset.map(asRecord).flatMap((item) => {
      const name = asString(item.name);
      if (!name || name === "auto") return [];
      return [{
        name,
        height: asNumber(item.label_resolution) ?? 0,
        bitrate: (asNumber(item.bps) ?? 0) * 1000
      }];
    }),
    message: asString(channel.MSG),
    aid: asString(channel.AID)
  };
}

function mapSoopFailure(info: SoopChannelInfo): never {
  const message = info.message?.toLowerCase() ?? "";
  if (info.password || message.includes("password") || message.includes("비밀번호")) {
    throw new PlaybackError("password_required");
  }
  if (info.subscriptionOnly || message.includes("subscribe") || message.includes("구독")) {
    throw new PlaybackError("login_required");
  }
  if ([-6, -8].includes(info.result) || message.includes("adult") || message.includes("연령")) {
    throw new PlaybackError("restricted");
  }
  if (info.result === 0 || message.includes("offline") || message.includes("종료")) {
    throw new PlaybackError("offline");
  }
  throw new PlaybackError("adapter_contract_changed");
}

async function fetchChannel(
  source: StreamSource,
  type: "live" | "aid",
  quality = "hd"
): Promise<SoopChannelInfo> {
  const body = new URLSearchParams({
    bid: source.channelKey,
    bno: source.broadcastKey ?? "",
    type,
    pwd: "",
    player_type: "html5",
    stream_type: "common",
    quality: qualityForApi(quality),
    mode: "live",
    from_api: "0",
    is_revive: "false"
  });

  let response: Response;
  try {
    response = await fetch(`${LIVE_API}?bjid=${encodeURIComponent(source.channelKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      credentials: "omit"
    });
  } catch (error) {
    throw new PlaybackError("network_lost", { cause: error, retryable: true });
  }
  if (!response.ok) throw errorForHttpStatus(response.status);
  return parseChannel(await response.json());
}

export function soopCdnType(cdn = "lg_cdn"): string {
  if (cdn.includes("lg_cdn")) return "lg_cdn_pc_web";
  if (cdn.includes("gs_cdn")) return "gs_cdn_pc_web";
  return cdn;
}

async function assignStream(info: SoopChannelInfo, quality: string): Promise<string | undefined> {
  if (!info.resourceManager || !info.broadcastNo) return undefined;
  const manager = assertAllowedMediaUrl(info.resourceManager, MEDIA_HOSTS);
  const params = new URLSearchParams({
    return_type: soopCdnType(info.cdn),
    use_cors: "true",
    cors_origin_url: "play.sooplive.com",
    broad_key: `${info.broadcastNo}-common-${quality}-hls`,
    player_mode: "live",
    time: String(Math.round(Math.random() * 10_000))
  });
  let response: Response;
  try {
    response = await fetch(`${manager.origin}/broad_stream_assign.html?${params}`, {
      credentials: "omit"
    });
  } catch {
    return undefined;
  }
  if (!response.ok) return undefined;
  const payload = asRecord(await response.json());
  if (String(payload.result) !== "1") return undefined;
  const viewUrl = asString(payload.view_url);
  if (!viewUrl) return undefined;
  return assertAllowedMediaUrl(viewUrl, MEDIA_HOSTS).toString();
}

export function rewriteSoopMediaUrl(input: string, manifestUrl: string, aid?: string): string {
  const target = new URL(input, manifestUrl);
  assertAllowedMediaUrl(target.toString(), MEDIA_HOSTS);
  if (aid && !target.searchParams.has("aid")) target.searchParams.set("aid", aid);
  return target.toString();
}

export const soopAdapter: PlatformAdapter = {
  platform: "soop",
  match(inputUrl) {
    try {
      return Boolean(parseSoopUrl(inputUrl));
    } catch {
      return false;
    }
  },
  async normalize(inputUrl) {
    const parsed = parseSoopUrl(inputUrl);
    if (!parsed) throw new PlaybackError("invalid_url");
    const canonicalUrl = `https://play.sooplive.com/${parsed.channelKey}${
      parsed.broadcastKey ? `/${parsed.broadcastKey}` : ""
    }`;
    return {
      id: sourceId("soop", parsed.channelKey, parsed.broadcastKey),
      platform: "soop",
      originalUrl: canonicalUrl,
      canonicalUrl,
      ...parsed
    };
  },
  async resolveMetadata(source): Promise<StreamMetadata> {
    const info = await fetchChannel(source, "live");
    if (info.result !== 1) mapSoopFailure(info);
    return {
      title: info.title ?? "제목 없는 방송",
      channelName: info.channelName ?? source.channelKey,
      thumbnailUrl: info.broadcastNo
        ? `https://liveimg.sooplive.com/m/${info.broadcastNo}`
        : undefined,
      isLive: true,
      isRestricted: info.password || info.subscriptionOnly
    };
  },
  async createSession(source): Promise<PlaybackSession> {
    const live = await fetchChannel(source, "live", "auto");
    if (live.result !== 1) mapSoopFailure(live);
    if (live.password) throw new PlaybackError("password_required");
    if (live.subscriptionOnly) throw new PlaybackError("login_required");

    const supported = new Set(live.viewPreset.map((quality) => quality.name));
    const candidates = QUALITY_CHAIN.filter((quality) => quality === "auto" || supported.has(quality));
    const fallbackSources: string[] = [];
    let selectedQuality = "standard" as PlaybackSession["qualityHint"];
    let aid: string | undefined;

    for (const quality of candidates.length > 0 ? candidates : ["hd"]) {
      const aidInfo = await fetchChannel(source, "aid", quality);
      if (aidInfo.result !== 1 || !aidInfo.aid) continue;
      const manifest = await assignStream(live, quality);
      if (!manifest) continue;
      const manifestWithAid = rewriteSoopMediaUrl(manifest, manifest, aidInfo.aid);
      if (!aid) {
        aid = aidInfo.aid;
        fallbackSources.push(manifestWithAid);
        selectedQuality = quality === "original" || quality.startsWith("hd") ? "high" : "standard";
      } else {
        fallbackSources.push(manifestWithAid);
      }
    }

    const manifestUrl = fallbackSources.shift();
    if (!manifestUrl || !aid) throw new PlaybackError("quality_unavailable");
    return {
      sourceId: source.id,
      manifestUrl,
      requestContext: { aid },
      urlRewriteMode: "soop-aid",
      qualityHint: selectedQuality,
      fallbackSources
    };
  },
  async refreshSession(source) {
    return this.createSession(source);
  }
};
