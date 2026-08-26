import { normalizeStreamUrl } from "../adapters";
import { isPlatformPageUrl, parseHttpsUrl } from "../shared/security";
import {
  getPlayerSession,
  getPlayerBounds,
  getWorkspaceSnapshot,
  savePlayerBounds,
  setPendingPayload,
  setPlayerSession
} from "../shared/storage";
import type {
  LauncherContext,
  RuntimeMessage,
  RuntimeResponse,
  StreamSource
} from "../shared/types";

const PLAYER_WIDTH = 1280;
const PLAYER_HEIGHT = 760;
const RULE_BASE = 10_000;
const sourceRules = new Map<string, number>();

function ok<T>(data: T): RuntimeResponse<T> {
  return { ok: true, data };
}

function fail(error: unknown): RuntimeResponse<never> {
  return { ok: false, error: error instanceof Error ? error.message : String(error) };
}

function isRuntimeMessage(value: unknown): value is RuntimeMessage {
  if (!value || typeof value !== "object") return false;
  return typeof (value as { type?: unknown }).type === "string";
}

async function playerWindowExists(windowId?: number): Promise<boolean> {
  if (windowId === undefined) return false;
  try {
    const window = await chrome.windows.get(windowId);
    return window.type === "popup";
  } catch {
    await setPlayerSession(undefined);
    return false;
  }
}

async function launcherContext(): Promise<LauncherContext> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const currentUrl = tabs[0]?.url;
  let currentSource: StreamSource | undefined;
  if (currentUrl && isPlatformPageUrl(currentUrl)) {
    try {
      currentSource = await normalizeStreamUrl(currentUrl);
    } catch {
      currentSource = undefined;
    }
  }
  const player = await getPlayerSession();
  const playerOpen = await playerWindowExists(player.windowId);
  return {
    currentUrl,
    currentSource,
    playerOpen,
    streamCount: playerOpen ? player.count : 0,
    snapshot: await getWorkspaceSnapshot()
  };
}

async function openPlayer(options: {
  source?: StreamSource;
  restore?: boolean;
  openSettings?: boolean;
}): Promise<{ reused: boolean }> {
  const player = await getPlayerSession();
  if (await playerWindowExists(player.windowId)) {
    await chrome.windows.update(player.windowId!, { focused: true });
    if (options.source) {
      await chrome.runtime.sendMessage({ type: "PLAYER_ADD_SOURCE", source: options.source } satisfies RuntimeMessage);
    }
    if (options.openSettings) {
      await chrome.runtime.sendMessage({ type: "PLAYER_OPEN_SETTINGS" } satisfies RuntimeMessage);
    }
    return { reused: true };
  }

  await setPendingPayload({
    sources: options.source ? [options.source] : [],
    restore: options.restore,
    openSettings: options.openSettings,
    queuedAt: Date.now()
  });
  const bounds = await getPlayerBounds();
  const created = await chrome.windows.create({
    url: chrome.runtime.getURL("player.html"),
    type: "popup",
    width: bounds?.width ?? PLAYER_WIDTH,
    height: bounds?.height ?? PLAYER_HEIGHT,
    ...(bounds?.left !== undefined ? { left: bounds.left } : {}),
    ...(bounds?.top !== undefined ? { top: bounds.top } : {}),
    focused: true
  });
  if (!created || created.id === undefined) throw new Error("플레이어 창을 열지 못했습니다.");
  await setPlayerSession(created.id, options.source ? 1 : 0);
  return { reused: false };
}

function stableRuleId(sourceId: string): number {
  let hash = 0;
  for (const character of sourceId) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return RULE_BASE + (hash % 900_000);
}

async function configureCdnContext(
  sourceId: string,
  origin: string,
  platform: "chzzk" | "soop"
): Promise<void> {
  if (platform !== "soop") return;
  const url = parseHttpsUrl(origin);
  if (!(url.hostname.endsWith(".sooplive.com") || url.hostname.endsWith(".sooplive.co.kr"))) {
    throw new Error("허용되지 않은 CDN 도메인입니다.");
  }
  const ruleId = stableRuleId(sourceId);
  sourceRules.set(sourceId, ruleId);
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [ruleId],
    addRules: [
      {
        id: ruleId,
        priority: 1,
        action: {
          type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
          requestHeaders: [
            { header: "Origin", operation: chrome.declarativeNetRequest.HeaderOperation.SET, value: "https://play.sooplive.com" },
            { header: "Referer", operation: chrome.declarativeNetRequest.HeaderOperation.SET, value: "https://play.sooplive.com/" }
          ]
        },
        condition: {
          initiatorDomains: [chrome.runtime.id],
          requestDomains: [url.hostname],
          resourceTypes: [
            chrome.declarativeNetRequest.ResourceType.XMLHTTPREQUEST,
            chrome.declarativeNetRequest.ResourceType.MEDIA
          ]
        }
      }
    ]
  });
}

async function removeCdnContext(sourceId: string): Promise<void> {
  const ruleId = sourceRules.get(sourceId) ?? stableRuleId(sourceId);
  sourceRules.delete(sourceId);
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [ruleId] });
}

async function clearSplitViewRules(): Promise<void> {
  const rules = await chrome.declarativeNetRequest.getDynamicRules();
  const ids = rules.filter((rule) => rule.id >= RULE_BASE && rule.id < RULE_BASE + 900_000).map((rule) => rule.id);
  if (ids.length > 0) await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: ids });
  sourceRules.clear();
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (!isRuntimeMessage(message) || (sender.id && sender.id !== chrome.runtime.id)) {
    sendResponse(fail("잘못된 메시지입니다."));
    return false;
  }

  void (async () => {
    try {
      switch (message.type) {
        case "GET_LAUNCHER_CONTEXT":
          return ok(await launcherContext());
        case "OPEN_PLAYER":
          return ok(await openPlayer(message));
        case "PLAYER_READY":
          return ok(true);
        case "PLAYER_STATE": {
          const session = await getPlayerSession();
          if (session.windowId !== undefined) await setPlayerSession(session.windowId, message.count);
          return ok(true);
        }
        case "PLAYER_CLOSING":
          await clearSplitViewRules();
          await setPlayerSession(undefined);
          return ok(true);
        case "CONFIGURE_CDN_CONTEXT":
          await configureCdnContext(message.sourceId, message.origin, message.platform);
          return ok(true);
        case "REMOVE_CDN_CONTEXT":
          await removeCdnContext(message.sourceId);
          return ok(true);
        default:
          return ok(false);
      }
    } catch (error) {
      return fail(error);
    }
  })().then(sendResponse);
  return true;
});

chrome.windows.onRemoved.addListener((windowId) => {
  void (async () => {
    const player = await getPlayerSession();
    if (player.windowId === windowId) {
      await clearSplitViewRules();
      await setPlayerSession(undefined);
    }
  })();
});

chrome.windows.onBoundsChanged.addListener((window) => {
  void (async () => {
    const player = await getPlayerSession();
    if (
      player.windowId !== window.id ||
      window.width === undefined ||
      window.height === undefined
    ) return;
    await savePlayerBounds({
      width: window.width,
      height: window.height,
      ...(window.left !== undefined ? { left: window.left } : {}),
      ...(window.top !== undefined ? { top: window.top } : {})
    });
  })();
});

chrome.runtime.onInstalled.addListener(() => {
  void clearSplitViewRules();
});
