import type { StreamPreference } from "../shared/types";

export function focusAudio(
  preferences: StreamPreference[],
  sourceId: string
): StreamPreference[] {
  return preferences.map((preference) => ({
    ...preference,
    muted: preference.sourceId !== sourceId
  }));
}

export function audibleSourceIds(preferences: StreamPreference[]): string[] {
  return preferences
    .filter((preference) => !preference.muted && preference.volume > 0)
    .map((preference) => preference.sourceId);
}

export function enforceSingleAudio(
  preferences: StreamPreference[],
  preferredSourceId?: string
): StreamPreference[] {
  const audible = audibleSourceIds(preferences);
  if (audible.length <= 1) return preferences;
  const keep = preferredSourceId && audible.includes(preferredSourceId) ? preferredSourceId : audible[0];
  return preferences.map((preference) => ({
    ...preference,
    muted: preference.sourceId === keep ? false : preference.muted || audible.includes(preference.sourceId)
  }));
}
