import Hls, {
  ErrorTypes,
  Events,
  type ErrorData,
  type Level,
  type LoaderCallbacks,
  type LoaderConfiguration,
  type LoaderContext
} from "hls.js";
import { adapterForPlatform } from "../adapters";
import { rewriteChzzkMediaUrl } from "../adapters/chzzk";
import { rewriteSoopMediaUrl } from "../adapters/soop";
import { hasOriginPermission, sendRuntimeMessage } from "../shared/browser-api";
import { PlaybackError, toPlaybackIssue } from "../shared/errors";
import { originPattern } from "../shared/security";
import { appendDiagnostic } from "../shared/storage";
import type {
  PlaybackIssue,
  PlaybackSession,
  QualityOption,
  StreamMetadata,
  StreamSource
} from "../shared/types";

export type PlaybackState =
  | "resolving"
  | "permission"
  | "connecting"
  | "playing"
  | "paused"
  | "retrying"
  | "error"
  | "ended";

export interface PlaybackCallbacks {
  onMetadata(metadata: StreamMetadata): void;
  onState(state: PlaybackState): void;
  onIssue(issue?: PlaybackIssue): void;
  onQualities(options: QualityOption[], currentHeight?: number, automatic?: boolean): void;
  onToast(message: string): void;
}

function rewriteRequestUrl(input: string, session: PlaybackSession): string {
  if (session.urlRewriteMode === "chzzk-bgda") {
    return rewriteChzzkMediaUrl(input, session.manifestUrl);
  }
  if (session.urlRewriteMode === "soop-aid") {
    return rewriteSoopMediaUrl(input, session.manifestUrl, session.requestContext?.aid);
  }
  return new URL(input, session.manifestUrl).toString();
}

function createSessionLoader(session: PlaybackSession): typeof Hls.DefaultConfig.loader {
  const BaseLoader = Hls.DefaultConfig.loader;
  return class SessionLoader extends BaseLoader {
    load(
      context: LoaderContext,
      config: LoaderConfiguration,
      callbacks: LoaderCallbacks<LoaderContext>
    ): void {
      context.url = rewriteRequestUrl(context.url, session);
      super.load(context, config, callbacks);
    }
  } as typeof Hls.DefaultConfig.loader;
}

function qualityOptions(levels: Level[]): QualityOption[] {
  return levels
    .map((level, index) => ({
      index,
      height: level.height,
      bitrate: level.bitrate,
      label: level.height ? `${level.height}p` : `${Math.round(level.bitrate / 1000)} kbps`
    }))
    .sort((a, b) => b.height - a.height || b.bitrate - a.bitrate);
}

export class PlaybackController {
  private readonly source: StreamSource;
  private readonly video: HTMLVideoElement;
  private readonly callbacks: PlaybackCallbacks;
  private hls?: Hls;
  private session?: PlaybackSession;
  private destroyed = false;
  private retryIndex = 0;
  private refreshedForFatal = false;
  private refreshTimer?: number;
  private qualityTimer?: number;
  private previousFrames?: { total: number; dropped: number };
  private maxQualityHeight?: number;

  constructor(source: StreamSource, video: HTMLVideoElement, callbacks: PlaybackCallbacks) {
    this.source = source;
    this.video = video;
    this.callbacks = callbacks;
  }

  async start(): Promise<void> {
    this.callbacks.onIssue(undefined);
    this.callbacks.onState("resolving");
    const adapter = adapterForPlatform(this.source.platform);
    try {
      const metadata = await adapter.resolveMetadata(this.source);
      if (this.destroyed) return;
      this.callbacks.onMetadata(metadata);
      if (metadata.isRestricted) throw new PlaybackError("restricted");
      if (!metadata.isLive) throw new PlaybackError("offline");
      const session = await adapter.createSession(this.source);
      if (this.destroyed) return;
      await this.loadSession(session);
    } catch (error) {
      if (!this.destroyed) this.reportIssue(error);
    }
  }

  private async loadSession(session: PlaybackSession): Promise<void> {
    const origin = new URL(session.manifestUrl).origin;
    if (!(await hasOriginPermission(origin))) {
      throw new PlaybackError("permission_required", {
        permissionOrigin: origin,
        retryable: true
      });
    }

    this.session = session;
    if (this.source.platform === "soop") {
      const configured = await sendRuntimeMessage({
        type: "CONFIGURE_CDN_CONTEXT",
        sourceId: this.source.id,
        origin,
        platform: this.source.platform
      });
      if (!configured.ok) throw new PlaybackError("playback_fatal");
    }
    this.callbacks.onState("connecting");
    this.attachHls(session);
    this.scheduleRefresh(session);
  }

  private attachHls(session: PlaybackSession): void {
    this.hls?.destroy();
    this.hls = undefined;
    this.video.removeAttribute("src");
    this.video.load();

    if (!Hls.isSupported()) {
      if (this.video.canPlayType("application/vnd.apple.mpegurl")) {
        this.video.src = session.manifestUrl;
        void this.video.play().catch(() => undefined);
        return;
      }
      this.reportIssue(new PlaybackError("playback_fatal"));
      return;
    }

    const hls = new Hls({
      loader: createSessionLoader(session),
      enableWorker: true,
      lowLatencyMode: true,
      liveSyncDurationCount: 3,
      liveMaxLatencyDurationCount: 10,
      backBufferLength: 30,
      maxBufferLength: 18,
      manifestLoadPolicy: {
        default: {
          maxTimeToFirstByteMs: 10_000,
          maxLoadTimeMs: 20_000,
          timeoutRetry: { maxNumRetry: 2, retryDelayMs: 1_000, maxRetryDelayMs: 2_000 },
          errorRetry: { maxNumRetry: 2, retryDelayMs: 1_000, maxRetryDelayMs: 2_000 }
        }
      }
    });
    this.hls = hls;
    hls.attachMedia(this.video);
    hls.on(Events.MEDIA_ATTACHED, () => hls.loadSource(session.manifestUrl));
    hls.on(Events.MANIFEST_PARSED, () => {
      this.retryIndex = 0;
      this.applyAutoQualityCap();
      this.callbacks.onQualities(qualityOptions(hls.levels), hls.levels[hls.currentLevel]?.height, true);
      this.startQualityMonitor();
      void this.video.play().catch(() => undefined);
    });
    hls.on(Events.LEVEL_SWITCHED, (_event, data) => {
      this.callbacks.onQualities(qualityOptions(hls.levels), hls.levels[data.level]?.height, hls.autoLevelEnabled);
    });
    hls.on(Events.ERROR, (_event, data) => void this.handleHlsError(data));
  }

  private async handleHlsError(data: ErrorData): Promise<void> {
    if (!data.fatal || this.destroyed) return;
    await appendDiagnostic("warn", "playback", "hls_fatal", {
      sourceId: this.source.id,
      type: data.type,
      details: data.details,
      status: data.response?.code
    });

    if (data.type === ErrorTypes.MEDIA_ERROR && this.hls && !this.refreshedForFatal) {
      this.refreshedForFatal = true;
      this.hls.recoverMediaError();
      return;
    }

    const status = data.response?.code;
    if ((status === 401 || status === 403) && !this.refreshedForFatal) {
      this.refreshedForFatal = true;
      await this.refreshSession();
      return;
    }

    const fallback = this.session?.fallbackSources?.shift();
    if (fallback && this.session) {
      this.callbacks.onToast("일반 화질로 전환했어요");
      const fallbackUrl = new URL(fallback);
      await this.loadSession({
        ...this.session,
        manifestUrl: fallback,
        requestContext: {
          ...this.session.requestContext,
          ...(fallbackUrl.searchParams.get("aid") ? { aid: fallbackUrl.searchParams.get("aid")! } : {})
        },
        qualityHint: "standard"
      });
      return;
    }

    const retryDelays = [0, 1_000, 2_000, 5_000];
    if (this.retryIndex < retryDelays.length) {
      const delay = retryDelays[this.retryIndex++];
      this.callbacks.onState("retrying");
      window.setTimeout(() => {
        if (!this.destroyed && this.session) this.attachHls(this.session);
      }, delay);
      return;
    }
    this.reportIssue(new PlaybackError("playback_fatal"));
  }

  private scheduleRefresh(session: PlaybackSession): void {
    if (this.refreshTimer) window.clearTimeout(this.refreshTimer);
    if (!session.expiresAt) return;
    const delay = Math.max(5_000, session.expiresAt - Date.now() - 30_000);
    this.refreshTimer = window.setTimeout(() => void this.refreshSession(), delay);
  }

  private async refreshSession(): Promise<void> {
    try {
      const next = await adapterForPlatform(this.source.platform).refreshSession(
        this.source,
        this.session!
      );
      if (!this.destroyed) await this.loadSession(next);
    } catch (error) {
      if (!this.destroyed) this.reportIssue(error);
    }
  }

  private startQualityMonitor(): void {
    if (this.qualityTimer) window.clearInterval(this.qualityTimer);
    this.previousFrames = undefined;
    this.qualityTimer = window.setInterval(() => {
      if (!this.hls || typeof this.video.getVideoPlaybackQuality !== "function") return;
      const quality = this.video.getVideoPlaybackQuality();
      const next = { total: quality.totalVideoFrames, dropped: quality.droppedVideoFrames };
      if (this.previousFrames) {
        const totalDelta = next.total - this.previousFrames.total;
        const droppedDelta = next.dropped - this.previousFrames.dropped;
        if (totalDelta > 0 && droppedDelta / totalDelta > 0.1) {
          const level = this.hls.nextAutoLevel;
          if (level > 0) this.hls.nextAutoLevel = level - 1;
        }
      }
      this.previousFrames = next;
    }, 15_000);
  }

  private reportIssue(error: unknown): void {
    const issue = toPlaybackIssue(error, this.source.canonicalUrl);
    this.callbacks.onState(issue.code === "permission_required" ? "permission" : "error");
    this.callbacks.onIssue(issue);
    void appendDiagnostic("error", "playback", issue.code, {
      sourceId: this.source.id,
      diagnosticId: issue.diagnosticId,
      platformUrl: this.source.canonicalUrl
    });
  }

  setQuality(index: number): void {
    if (!this.hls) return;
    this.hls.currentLevel = index;
  }

  setAutoQuality(maxHeight?: number): void {
    this.maxQualityHeight = maxHeight;
    if (!this.hls) return;
    this.applyAutoQualityCap();
    this.hls.currentLevel = -1;
  }

  private applyAutoQualityCap(): void {
    if (!this.hls) return;
    this.hls.autoLevelCapping = this.maxQualityHeight
      ? this.hls.levels.reduce((best, level, index) => (level.height <= this.maxQualityHeight! ? index : best), -1)
      : -1;
  }

  seekLive(): void {
    if (this.hls && Number.isFinite(this.hls.liveSyncPosition)) {
      this.video.currentTime = this.hls.liveSyncPosition!;
    }
  }

  async retry(): Promise<void> {
    this.retryIndex = 0;
    this.refreshedForFatal = false;
    await this.start();
  }

  destroy(): void {
    this.destroyed = true;
    if (this.refreshTimer) window.clearTimeout(this.refreshTimer);
    if (this.qualityTimer) window.clearInterval(this.qualityTimer);
    this.hls?.destroy();
    this.hls = undefined;
    this.video.pause();
    this.video.removeAttribute("src");
    this.video.load();
    void sendRuntimeMessage({ type: "REMOVE_CDN_CONTEXT", sourceId: this.source.id });
  }
}

export { originPattern };
