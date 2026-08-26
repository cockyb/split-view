import { DEFAULT_SETTINGS, type AppSettings, type DiagnosticEvent, type PendingPlayerPayload, type PlayerBounds, type WorkspaceSnapshot } from "./types";
import { redactRecord } from "./security";

const KEYS = {
  settings: "settings",
  snapshot: "workspaceSnapshot",
  playerWindow: "playerWindow",
  playerCount: "playerCount",
  pending: "pendingPlayerPayload",
  bounds: "playerBounds",
  logs: "diagnosticLogs"
} as const;

const DAY_MS = 24 * 60 * 60 * 1000;

function localGet<T>(key: string): T | undefined {
  try {
    const value = localStorage.getItem(`split-view:${key}`);
    return value ? (JSON.parse(value) as T) : undefined;
  } catch {
    return undefined;
  }
}

function localSet(key: string, value: unknown): void {
  localStorage.setItem(`split-view:${key}`, JSON.stringify(value));
}

async function getLocal<T>(key: string): Promise<T | undefined> {
  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    const result = await chrome.storage.local.get(key);
    return result[key] as T | undefined;
  }
  return localGet<T>(key);
}

async function setLocal(key: string, value: unknown): Promise<void> {
  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    await chrome.storage.local.set({ [key]: value });
    return;
  }
  localSet(key, value);
}

async function getSession<T>(key: string): Promise<T | undefined> {
  if (typeof chrome !== "undefined" && chrome.storage?.session) {
    const result = await chrome.storage.session.get(key);
    return result[key] as T | undefined;
  }
  return localGet<T>(`session:${key}`);
}

async function setSession(key: string, value: unknown): Promise<void> {
  if (typeof chrome !== "undefined" && chrome.storage?.session) {
    await chrome.storage.session.set({ [key]: value });
    return;
  }
  localSet(`session:${key}`, value);
}

async function removeSession(key: string): Promise<void> {
  if (typeof chrome !== "undefined" && chrome.storage?.session) {
    await chrome.storage.session.remove(key);
    return;
  }
  localStorage.removeItem(`split-view:session:${key}`);
}

export async function getSettings(): Promise<AppSettings> {
  return { ...DEFAULT_SETTINGS, ...(await getLocal<Partial<AppSettings>>(KEYS.settings)) };
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await setLocal(KEYS.settings, settings);
}

export function sanitizeSnapshot(snapshot: WorkspaceSnapshot): WorkspaceSnapshot {
  return {
    version: 1,
    sources: snapshot.sources.map(({ id, platform, originalUrl, canonicalUrl, channelKey, broadcastKey }) => ({
      id,
      platform,
      originalUrl,
      canonicalUrl,
      channelKey,
      ...(broadcastKey ? { broadcastKey } : {})
    })),
    order: [...snapshot.order],
    layout: snapshot.layout,
    preferences: snapshot.preferences.map(({ sourceId, volume, muted, maxQualityHeight }) => ({
      sourceId,
      volume: Math.min(1, Math.max(0, volume)),
      muted,
      ...(maxQualityHeight ? { maxQualityHeight } : {})
    })),
    savedAt: snapshot.savedAt
  };
}

export async function getWorkspaceSnapshot(): Promise<WorkspaceSnapshot | undefined> {
  const snapshot = await getLocal<WorkspaceSnapshot>(KEYS.snapshot);
  return snapshot?.version === 1 ? sanitizeSnapshot(snapshot) : undefined;
}

export async function saveWorkspaceSnapshot(snapshot: WorkspaceSnapshot): Promise<void> {
  await setLocal(KEYS.snapshot, sanitizeSnapshot(snapshot));
}

export async function setPendingPayload(payload: PendingPlayerPayload): Promise<void> {
  await setSession(KEYS.pending, payload);
}

export async function takePendingPayload(): Promise<PendingPlayerPayload | undefined> {
  const payload = await getSession<PendingPlayerPayload>(KEYS.pending);
  await removeSession(KEYS.pending);
  return payload;
}

export async function setPlayerSession(windowId: number | undefined, count = 0): Promise<void> {
  if (windowId === undefined) {
    await removeSession(KEYS.playerWindow);
    await removeSession(KEYS.playerCount);
    return;
  }
  await setSession(KEYS.playerWindow, windowId);
  await setSession(KEYS.playerCount, count);
}

export async function getPlayerSession(): Promise<{ windowId?: number; count: number }> {
  return {
    windowId: await getSession<number>(KEYS.playerWindow),
    count: (await getSession<number>(KEYS.playerCount)) ?? 0
  };
}

export async function getPlayerBounds(): Promise<PlayerBounds | undefined> {
  const bounds = await getLocal<PlayerBounds>(KEYS.bounds);
  if (!bounds || bounds.width < 720 || bounds.height < 480) return undefined;
  return bounds;
}

export async function savePlayerBounds(bounds: PlayerBounds): Promise<void> {
  if (bounds.width < 720 || bounds.height < 480) return;
  await setLocal(KEYS.bounds, bounds);
}

export async function appendDiagnostic(
  level: DiagnosticEvent["level"],
  scope: string,
  event: string,
  detail?: Record<string, unknown>
): Promise<void> {
  const now = Date.now();
  const previous = (await getLocal<DiagnosticEvent[]>(KEYS.logs)) ?? [];
  const next = previous
    .filter((item) => now - item.at <= DAY_MS)
    .concat({
      id: crypto.randomUUID().slice(0, 8).toUpperCase(),
      at: now,
      level,
      scope,
      event,
      ...(detail ? { detail: redactRecord(detail) } : {})
    })
    .slice(-200);
  await setLocal(KEYS.logs, next);
}

export async function exportDiagnostics(): Promise<string> {
  const logs = ((await getLocal<DiagnosticEvent[]>(KEYS.logs)) ?? []).map((item) => ({
    ...item,
    ...(item.detail ? { detail: redactRecord(item.detail) } : {})
  }));
  return JSON.stringify({ product: "Split View", version: 1, exportedAt: Date.now(), logs }, null, 2);
}
