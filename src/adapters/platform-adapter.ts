import type { PlaybackSession, Platform, StreamMetadata, StreamSource } from "../shared/types";

export interface PlatformAdapter {
  platform: Platform;
  match(inputUrl: string): boolean;
  normalize(inputUrl: string): Promise<StreamSource>;
  resolveMetadata(source: StreamSource): Promise<StreamMetadata>;
  createSession(source: StreamSource): Promise<PlaybackSession>;
  refreshSession(source: StreamSource, previous: PlaybackSession): Promise<PlaybackSession>;
}

export interface JsonRecord {
  [key: string]: unknown;
}

export function asRecord(value: unknown): JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function asNumber(value: unknown): number | undefined {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

export function sourceId(platform: Platform, channelKey: string, broadcastKey?: string): string {
  return `${platform}:${channelKey.toLowerCase()}:${broadcastKey ?? "live"}`;
}
