import { PlaybackError } from "../shared/errors";
import type { Platform, StreamSource } from "../shared/types";
import { chzzkAdapter } from "./chzzk";
import type { PlatformAdapter } from "./platform-adapter";
import { soopAdapter } from "./soop";

const ADAPTERS: PlatformAdapter[] = [chzzkAdapter, soopAdapter];

export function adapterForUrl(inputUrl: string): PlatformAdapter | undefined {
  return ADAPTERS.find((adapter) => adapter.match(inputUrl));
}

export function adapterForPlatform(platform: Platform): PlatformAdapter {
  const adapter = ADAPTERS.find((candidate) => candidate.platform === platform);
  if (!adapter) throw new PlaybackError("adapter_contract_changed");
  return adapter;
}

export async function normalizeStreamUrl(inputUrl: string): Promise<StreamSource> {
  const adapter = adapterForUrl(inputUrl);
  if (!adapter) throw new PlaybackError("invalid_url");
  return adapter.normalize(inputUrl);
}
