import type {
  CategoryId,
  Discovery,
  DiscoveryStatus,
  PersistedState,
  Prerequisite,
  RadarSignal,
  Recommendation,
} from "./types";
import { CATEGORY_ORDER, isReliable } from "./meta";

/**
 * Moteur de progression et de recommandation — pur, sans effet de bord,
 * donc testable et déplaçable côté serveur (V1) sans réécriture.
 */

export function isPrereqMet(p: Prerequisite, s: PersistedState): boolean {
  return p.type === "discovery" ? Boolean(s.completed[p.id]) : s.profile.chapter >= p.min;
}

export function statusOf(d: Discovery, s: PersistedState): DiscoveryStatus {
  if (s.completed[d.id]) return "done";
  if (d.spoilerChapter > s.profile.chapter) return "hidden";
  const chapterOk = d.prerequisites.every((p) => p.type !== "chapter" || isPrereqMet(p, s));
  if (!chapterOk) return "chapter";
  const discOk = d.prerequisites.every((p) => p.type !== "discovery" || isPrereqMet(p, s));
  return discOk ? "available" : "locked";
}

/** Ce que la complétion de `id` débloquerait immédiatement. */
export function wouldUnlock(id: string, all: Discovery[], s: PersistedState): Discovery[] {
  const next: PersistedState = { ...s, completed: { ...s.completed, [id]: "x" } };
  return all.filter((d) => d.id !== id && statusOf(d, s) === "locked" && statusOf(d, next) === "available");
}

export function availableIds(all: Discovery[], s: PersistedState): Set<string> {
  return new Set(all.filter((d) => statusOf(d, s) === "available").map((d) => d.id));
}

export function lastCompleted(all: Discovery[], s: PersistedState): Discovery | undefined {
  const entries = Object.entries(s.completed).sort((a, b) => b[1].localeCompare(a[1]));
  return entries.length ? all.find((d) => d.id === entries[0][0]) : undefined;
}

const CATEGORY_WEIGHT: Record<CategoryId, number> = {
  event: 30,
  vehicle: 14,
  secret: 12,
  activity: 10,
  mission: 10,
  collectible: 6,
};

export function recommend(all: Discovery[], s: PersistedState, now = new Date(), limit = 5): Recommendation[] {
  const last = lastCompleted(all, s);
  return all
    .filter((d) => statusOf(d, s) === "available")
    .filter((d) => !d.endsAt || new Date(d.endsAt) > now)
    .map((d) => {
      const reasons: string[] = [];
      let score = CATEGORY_WEIGHT[d.category];

      const unlocked = wouldUnlock(d.id, all, s);
      const unlocks = unlocked.length;
      if (unlocks) {
        score += unlocks * 18;
        reasons.push(unlocks > 1 ? `Débloque ${unlocks} découvertes` : `Débloque : ${unlocked[0].title}`);
      }
      if (d.endsAt) {
        const h = Math.max(0, Math.round((new Date(d.endsAt).getTime() - now.getTime()) / 36e5));
        reasons.push(h < 48 ? `Se termine dans ${h} h` : "Événement limité");
      }
      if (last && last.regionId === d.regionId) {
        score += 12;
        reasons.push("Dans ta zone actuelle");
      } else if (last) {
        const dist = Math.hypot(last.x - d.x, last.y - d.y);
        score += Math.max(0, 10 - dist / 700);
      }
      if (d.durationMin <= 10) {
        score += 8;
        reasons.push(`Rapide · ~${d.durationMin} min`);
      }
      if (s.freshUnlocks.includes(d.id)) {
        score += 10;
        reasons.unshift("Vient d'être débloqué");
      }
      score += d.contentPotential * 0.12;
      if (!reasons.length) reasons.push(`~${d.durationMin} min`);
      return { discovery: d, score, reasons: reasons.slice(0, 2), isFresh: s.freshUnlocks.includes(d.id) };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export interface Progress {
  done: number;
  total: number;
  pct: number;
  byCategory: { id: CategoryId; done: number; total: number }[];
  byRegion: Record<string, { done: number; total: number }>;
  regionsVisited: number;
}

export function progress(all: Discovery[], s: PersistedState): Progress {
  const done = all.filter((d) => s.completed[d.id]).length;
  const byRegion: Progress["byRegion"] = {};
  for (const d of all) {
    byRegion[d.regionId] ??= { done: 0, total: 0 };
    byRegion[d.regionId].total++;
    if (s.completed[d.id]) byRegion[d.regionId].done++;
  }
  return {
    done,
    total: all.length,
    pct: all.length ? done / all.length : 0,
    byCategory: CATEGORY_ORDER.map((id) => {
      const items = all.filter((d) => d.category === id);
      return { id, done: items.filter((d) => s.completed[d.id]).length, total: items.length };
    }),
    byRegion,
    regionsVisited: Object.values(byRegion).filter((r) => r.done > 0).length,
  };
}

export type AlertLevel = "high" | "medium" | "info";
export interface Alert {
  id: string;
  level: AlertLevel;
  title: string;
  body: string;
  discoveryId?: string;
  action?: "radar";
}

export function alerts(all: Discovery[], signals: RadarSignal[], s: PersistedState, now = new Date()): Alert[] {
  const out: Alert[] = [];
  for (const d of all) {
    if (d.endsAt && !s.completed[d.id] && new Date(d.endsAt) > now && statusOf(d, s) === "available") {
      const h = Math.round((new Date(d.endsAt).getTime() - now.getTime()) / 36e5);
      out.push({ id: `ev-${d.id}`, level: "high", title: `${d.title} · ${h < 48 ? `${h} h restantes` : "en cours"}`, body: d.reward, discoveryId: d.id });
    }
  }
  if (s.freshUnlocks.length) {
    const names = s.freshUnlocks.map((id) => all.find((d) => d.id === id)?.title).filter(Boolean);
    out.push({ id: "fresh", level: "medium", title: names.length > 1 ? `${names.length} nouvelles découvertes accessibles` : "Nouvelle découverte accessible", body: names.join(" · "), discoveryId: s.freshUnlocks[0] });
  }
  const unseen = signals.filter((g) => !s.seenSignals.includes(g.id) && g.spoilerChapter <= s.profile.chapter && isReliable(g.reliability));
  if (unseen.length) {
    out.push({ id: "radar", level: "info", title: unseen.length > 1 ? `${unseen.length} signaux fiables sur le radar` : "1 signal fiable sur le radar", body: unseen[0].title, action: "radar" });
  }
  return out;
}

export function visibleSignal(g: RadarSignal, s: PersistedState): "visible" | "blurred" | "hidden" {
  if (g.spoilerChapter <= s.profile.chapter || s.profile.spoilerMode === "off") return "visible";
  return s.profile.spoilerMode === "strict" ? "hidden" : "blurred";
}
