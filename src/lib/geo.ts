import type { Region } from "./types";

/** Région la plus probable pour un point (étiquette de région la plus proche). */
export function regionAt(x: number, y: number, regions: Region[]): Region {
  return regions.reduce((best, r) =>
    Math.hypot(r.label[0] - x, r.label[1] - y) < Math.hypot(best.label[0] - x, best.label[1] - y) ? r : best,
  );
}

export const fmtCoord = (x: number, y: number) => `${Math.round(x)} · ${Math.round(y)}`;
