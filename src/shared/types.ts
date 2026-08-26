export type Platform = "chzzk" | "soop";

export type Layout =
  | "auto"
  | "single"
  | "two-horizontal"
  | "two-vertical"
  | "grid";

export interface StreamSource {
  id: string;
  platform: Platform;
  originalUrl: string;
  canonicalUrl: string;
  channelKey: string;
  broadcastKey?: string;
}

export interface StreamPreference {
  sourceId: string;
  volume: number;
  muted: boolean;
  maxQualityHeight?: number;
}

export interface WorkspaceSnapshot {
  version: 1;
  sources: StreamSource[];
  order: string[];
  layout: Layout;
  preferences: StreamPreference[];
  savedAt: number;
}

export interface PlaybackSession {
  sourceId: string;
  manifestUrl: string;
  expiresAt?: number;
  requestContext?: Record<string, string>;
  urlRewriteMode?: "none" | "chzzk-bgda" | "soop-aid";
  qualityHint?: "source" | "high" | "standard" | "low";
  fallbackSources?: string[];
}

export interface StreamMetadata {
  title: string;
  channelName: string;
  thumbnailUrl?: string;
  isLive: boolean;
  isRestricted: boolean;
}

export type PlaybackErrorCode =
  | "invalid_url"
  | "network_lost"
  | "session_expired"
  | "quality_unavailable"
  | "permission_required"
  | "permission_denied"
  | "offline"
  | "live_ended"
  | "login_required"
  | "restricted"
  | "password_required"
  | "adapter_contract_changed"
  | "playback_fatal";

export interface PlaybackIssue {
  code: PlaybackErrorCode;
  message: string;
  diagnosticId: string;
  retryable: boolean;
  platformUrl?: string;
  permissionOrigin?: string;
}

export interface AppSettings {
  defaultLayout: "auto" | "two-horizontal" | "two-vertical";
  maxQualityHeight?: number;
  controlsTimeoutMs: 1200 | 1800 | 3000;
  saveWorkspace: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  defaultLayout: "auto",
  controlsTimeoutMs: 1800,
  saveWorkspace: true
};

export interface PendingPlayerPayload {
  sources: StreamSource[];
  restore?: boolean;
  openSettings?: boolean;
  queuedAt: number;
}

export interface PlayerBounds {
  left?: number;
  top?: number;
  width: number;
  height: number;
}

export interface LauncherContext {
  currentUrl?: string;
  currentSource?: StreamSource;
  playerOpen: boolean;
  streamCount: number;
  snapshot?: WorkspaceSnapshot;
}

export type RuntimeMessage =
  | { type: "GET_LAUNCHER_CONTEXT" }
  | { type: "OPEN_PLAYER"; source?: StreamSource; restore?: boolean; openSettings?: boolean }
  | { type: "PLAYER_READY" }
  | { type: "PLAYER_STATE"; count: number }
  | { type: "PLAYER_CLOSING" }
  | { type: "PLAYER_ADD_SOURCE"; source: StreamSource }
  | { type: "PLAYER_OPEN_SETTINGS" }
  | { type: "CONFIGURE_CDN_CONTEXT"; sourceId: string; origin: string; platform: Platform }
  | { type: "REMOVE_CDN_CONTEXT"; sourceId: string };

export type RuntimeResponse<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export interface DiagnosticEvent {
  id: string;
  at: number;
  level: "info" | "warn" | "error";
  scope: string;
  event: string;
  detail?: Record<string, unknown>;
}

export interface QualityOption {
  index: number;
  height: number;
  bitrate: number;
  label: string;
}
