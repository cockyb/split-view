import type { Layout } from "../shared/types";

export type ResolvedLayout = "single" | "two-horizontal" | "two-vertical" | "grid";

export function resolveLayout(layout: Layout, streamCount: number, aspectRatio: number): ResolvedLayout {
  if (streamCount <= 1) return "single";
  if (layout !== "auto") {
    if (layout === "single") return "grid";
    if ((layout === "two-horizontal" || layout === "two-vertical") && streamCount > 2) return "grid";
    return layout;
  }
  if (streamCount <= 1) return "single";
  if (streamCount === 2) return aspectRatio >= 1.2 ? "two-horizontal" : "two-vertical";
  return "grid";
}

export const LAYOUT_SEQUENCE: Layout[] = ["auto", "two-horizontal", "two-vertical", "grid"];

export function nextLayout(current: Layout, streamCount: number): Layout {
  const allowed = streamCount > 2 ? (["auto", "grid"] as Layout[]) : LAYOUT_SEQUENCE;
  return allowed[(allowed.indexOf(current) + 1) % allowed.length] ?? "auto";
}
