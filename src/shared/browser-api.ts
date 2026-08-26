import type { RuntimeMessage, RuntimeResponse } from "./types";

export const hasChromeRuntime =
  typeof chrome !== "undefined" && Boolean(chrome.runtime?.id);

export async function sendRuntimeMessage<T>(message: RuntimeMessage): Promise<RuntimeResponse<T>> {
  if (!hasChromeRuntime) return { ok: false, error: "Extension runtime unavailable" };
  try {
    return (await chrome.runtime.sendMessage(message)) as RuntimeResponse<T>;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function hasOriginPermission(origin: string): Promise<boolean> {
  if (!hasChromeRuntime) return true;
  return chrome.permissions.contains({ origins: [`${origin}/*`] });
}

export async function requestOriginPermission(origin: string): Promise<boolean> {
  if (!hasChromeRuntime) return true;
  return chrome.permissions.request({ origins: [`${origin}/*`] });
}
