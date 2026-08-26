import { PlaybackError } from "./errors";

const PLATFORM_HOSTS = new Set([
  "chzzk.naver.com",
  "m.chzzk.naver.com",
  "sooplive.co.kr",
  "www.sooplive.co.kr",
  "play.sooplive.co.kr",
  "m.sooplive.co.kr",
  "sooplive.com",
  "www.sooplive.com",
  "play.sooplive.com",
  "m.sooplive.com",
  "play.afreecatv.com"
]);

const PRIVATE_IPV4 = /^(?:10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/;

export function parseHttpsUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new PlaybackError("invalid_url");
  }

  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hostname === "localhost" ||
    url.hostname === "[::1]" ||
    PRIVATE_IPV4.test(url.hostname)
  ) {
    throw new PlaybackError("invalid_url");
  }

  return url;
}

export function isPlatformPageUrl(input: string): boolean {
  try {
    return PLATFORM_HOSTS.has(parseHttpsUrl(input).hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function assertAllowedMediaUrl(input: string, allowedHosts: ReadonlySet<string>): URL {
  const url = parseHttpsUrl(input);
  const host = url.hostname.toLowerCase();
  const allowed = [...allowedHosts].some((candidate) => host === candidate || host.endsWith(`.${candidate}`));
  if (!allowed) throw new PlaybackError("adapter_contract_changed");
  return url;
}

export function originPattern(input: string): string {
  const url = parseHttpsUrl(input);
  return `${url.origin}/*`;
}

export function redactUrl(input: unknown): unknown {
  if (typeof input !== "string") return input;
  if (!/^https?:\/\//i.test(input)) return input;
  try {
    const url = new URL(input);
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "[invalid-url]";
  }
}

export function redactRecord(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => {
      if (/token|cookie|aid|signature|manifest|hdnts|bgda/i.test(key)) return [key, "[redacted]"];
      if (Array.isArray(value)) return [key, value.map(redactUrl)];
      if (value && typeof value === "object") return [key, redactRecord(value as Record<string, unknown>)];
      return [key, redactUrl(value)];
    })
  );
}
