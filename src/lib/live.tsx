"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { RadarFeed, RadarRecord } from "../../collector/src/types";
import type { CategoryId, Discovery } from "./types";

export type { RadarFeed, RadarRecord };

/**
 * Flux Radar alimenté automatiquement par le moteur de veille (GitHub Actions → branche `data`).
 * L'URL est fixée au build (NEXT_PUBLIC_RADAR_URL) ; une surcharge locale sert aux diagnostics et aux tests.
 * Aucun redéploiement n'est nécessaire pour voir de nouvelles fiches : l'app relit le flux toutes les 10 min.
 */
const BUILD_URL = process.env.NEXT_PUBLIC_RADAR_URL || "";
const OVERRIDE_KEY = "leonida-os/radar-url";
const CACHE_KEY = "leonida-os/radar-cache/v1";
const REFRESH_MS = 10 * 60_000;

export type LiveState = "disabled" | "loading" | "live" | "cached" | "offline";

interface LiveCtx {
  feed: RadarFeed | null;
  state: LiveState;
  fetchedAt: string | null;
  error: string | null;
  refresh: () => Promise<void>;
  url: string;
}

const Ctx = createContext<LiveCtx | null>(null);

function radarUrl(): string {
  try {
    return localStorage.getItem(OVERRIDE_KEY) || BUILD_URL;
  } catch {
    return BUILD_URL;
  }
}

export function isFeed(x: unknown): x is RadarFeed {
  const f = x as RadarFeed;
  return !!f && f.version === 1 && Array.isArray(f.items) && Array.isArray(f.sources) && typeof f.generatedAt === "string";
}

export function LiveRadarProvider({ children }: { children: ReactNode }) {
  const [feed, setFeed] = useState<RadarFeed | null>(null);
  const [state, setState] = useState<LiveState>("loading");
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const inflight = useRef(false);

  const refresh = useCallback(async () => {
    const u = radarUrl();
    setUrl(u);
    if (!u) {
      setState("disabled");
      return;
    }
    if (inflight.current) return;
    inflight.current = true;
    try {
      const sep = u.includes("?") ? "&" : "?";
      const res = await fetch(`${u}${sep}t=${Math.floor(Date.now() / 60_000)}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!isFeed(json)) throw new Error("format de flux inattendu");
      setFeed(json);
      setState("live");
      setError(null);
      const now = new Date().toISOString();
      setFetchedAt(now);
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ at: now, feed: json }));
      } catch {
        /* quota : on garde seulement la version en mémoire */
      }
    } catch (e) {
      setError((e as Error).message);
      setState((s) => (s === "live" || s === "cached" ? "cached" : "offline"));
    } finally {
      inflight.current = false;
    }
  }, []);

  useEffect(() => {
    // Affichage immédiat du dernier flux connu, puis rafraîchissement réseau
    try {
      const c = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
      if (c && isFeed(c.feed)) {
        setFeed(c.feed);
        setFetchedAt(c.at);
        setState("cached");
      }
    } catch {
      /* cache illisible : ignoré */
    }
    refresh();
    const id = setInterval(() => document.visibilityState === "visible" && refresh(), REFRESH_MS);
    const onVis = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [refresh]);

  const value = useMemo(() => ({ feed, state, fetchedAt, error, refresh, url }), [feed, state, fetchedAt, error, refresh, url]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLiveRadar(): LiveCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useLiveRadar hors de LiveRadarProvider");
  return c;
}

// ── Classement des fiches en onglets ───────────────────────────────────────────
export type LiveTab = "new" | "confirmed" | "verify" | "news";

const NEWS_CATS = new Set(["news", "patch"]);

export function tabOf(r: RadarRecord, now = Date.now()): LiveTab[] {
  const tabs: LiveTab[] = [];
  if (now - Date.parse(r.firstSeenAt) < 48 * 3600_000) tabs.push("new");
  if (NEWS_CATS.has(r.category)) tabs.push("news");
  else if (r.reliability === "official" || r.reliability === "confirmed") tabs.push("confirmed");
  else tabs.push("verify");
  return tabs;
}

/**
 * Filtre anti-spoiler du flux : strict = retiré, modéré = flouté (géré à l'affichage).
 * Une fiche rattachée à un chapitre plus avancé que celui du joueur est traitée comme un spoiler.
 */
export function spoilerVisibility(r: RadarRecord, mode: "strict" | "relaxed", playerChapter?: number): "visible" | "blurred" | "hidden" {
  const ahead = playerChapter != null && (r.details?.chapter?.value ?? 0) > playerChapter;
  if (r.spoiler !== "high" && !ahead) return "visible";
  return mode === "strict" ? "hidden" : "blurred";
}

// ── Santé du collecteur ─────────────────────────────────────────────────────────
export type CollectorHealth = { level: "ok" | "late" | "stopped"; ageMin: number; cadence: number; lastCron: string | null; cronCount24h: number };

/**
 * Le collecteur tourne toutes les 15 min (cron GitHub, retards de 10–30 min fréquents).
 * En retard au-delà de 3 cycles sans nouveau flux, arrêté au-delà de 3 h.
 */
export function collectorHealth(feed: RadarFeed, now = Date.now()): CollectorHealth {
  const cadence = feed.health?.cadenceMinutes ?? 15;
  const ageMin = Math.max(0, Math.round((now - Date.parse(feed.generatedAt)) / 60_000));
  const cycles = feed.health?.cycles ?? [];
  const crons = cycles.filter((c) => c.trigger === "schedule");
  return {
    level: ageMin > 180 ? "stopped" : ageMin > cadence * 3 ? "late" : "ok",
    ageMin,
    cadence,
    lastCron: crons.at(-1)?.at ?? null,
    cronCount24h: crons.filter((c) => now - Date.parse(c.at) < 86400_000).length,
  };
}

export const TRIGGER_FR: Record<string, string> = { schedule: "planifié (cron)", workflow_dispatch: "manuel", push: "déploiement", local: "local" };

// ── Conseils personnalisés (« Que faire maintenant ? ») ────────────────────────
/** Conseils exploitables, fiables, compatibles avec le chapitre du joueur et l'anti-spoiler. */
export function liveAdvice(feed: RadarFeed | null, profile: { chapter: number; spoilerMode: "strict" | "relaxed" }, done: string[] = []) {
  if (!feed) return { now: [] as RadarRecord[], later: 0 };
  const usable = feed.items.filter(
    (r) => r.advice && r.actionable && r.status === "active" && (r.reliability === "official" || r.reliability === "confirmed") && !done.includes(r.id),
  );
  const fits = (r: RadarRecord) => (r.advice!.chapterMin ?? 0) <= profile.chapter && spoilerVisibility(r, profile.spoilerMode, profile.chapter) === "visible";
  const now = usable.filter(fits).sort((a, b) => Number(b.advice!.urgency === "now") - Number(a.advice!.urgency === "now") || b.score - a.score);
  return { now, later: usable.length - now.length };
}

const DONE_KEY = "leonida-os/advice-done/v1";
export function readDoneAdvice(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(DONE_KEY) || "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}
export function writeDoneAdvice(ids: string[]) {
  try {
    localStorage.setItem(DONE_KEY, JSON.stringify(ids.slice(-200)));
  } catch {
    /* stockage indisponible : l'état reste en mémoire */
  }
}

/** Lien de proposition de point : ouvre une demande de validation sur GitHub (aucune coordonnée publiée sans validation). */
export function proposePointUrl(r: RadarRecord): string {
  const s = r.location.suggestion;
  const body = [
    `Fiche : ${r.id}`,
    `Titre : ${r.title}`,
    `Lieu cité par les sources : ${r.location.place ?? "—"}`,
    s ? `Repère proposé (carte communautaire gtadb) : ${s.landmark} → x=${s.x}, y=${s.y}` : "Aucun repère exact sur la carte communautaire : indiquer x/y relevés en jeu.",
    "",
    "Preuves :",
    ...r.evidence.map((e) => `- ${e.sourceName} : ${e.url}`),
    "",
    "Pour valider : ajouter dans collector/overrides.json →",
    "```json",
    JSON.stringify({ [r.id]: { location: { x: s?.x ?? 0, y: s?.y ?? 0, place: r.location.place } } }, null, 1),
    "```",
  ].join("\n");
  return `https://github.com/teoselimo/leonida-os/issues/new?labels=validation-point&title=${encodeURIComponent(`Point à valider : ${r.location.place ?? r.title}`)}&body=${encodeURIComponent(body)}`;
}

export const LIVE_CATEGORY: Record<string, { label: string; icon: string; color: string }> = {
  weapon: { label: "Arme", icon: "target", color: "#FF5C7A" },
  vehicle: { label: "Véhicule", icon: "car", color: "#5AB8FF" },
  money: { label: "Argent", icon: "gem", color: "#FFB547" },
  easter_egg: { label: "Easter egg", icon: "sparkle", color: "#B98CFF" },
  side_mission: { label: "Mission secondaire", icon: "flag", color: "#FF3D8B" },
  unique_item: { label: "Objet unique", icon: "gem", color: "#FFB547" },
  mechanic: { label: "Mécanique", icon: "bolt", color: "#2EE6D6" },
  missable: { label: "Manquable", icon: "clock", color: "#FF7A45" },
  news: { label: "Actualité", icon: "signal", color: "#9b96ae" },
  patch: { label: "Mise à jour", icon: "reset", color: "#7CF29A" },
  guide: { label: "Guide", icon: "map", color: "#2EE6D6" },
  other: { label: "Autre", icon: "info", color: "#9b96ae" },
};

// ── Pont vers la carte et les recommandations ───────────────────────────────────
const TO_APP_CATEGORY: Record<string, CategoryId> = {
  weapon: "collectible", vehicle: "vehicle", money: "activity", easter_egg: "secret", side_mission: "mission",
  unique_item: "collectible", missable: "event", mechanic: "activity", guide: "activity", news: "event", patch: "event", other: "secret",
};

/**
 * Seules les fiches actionnables (officielles ou confirmées) dont le point a été VALIDÉ deviennent des découvertes
 * jouables (carte + « Que faire maintenant ? »). Tout le reste reste dans le Radar, sans pin approximatif.
 */
export function liveToDiscoveries(feed: RadarFeed | null): Discovery[] {
  if (!feed) return [];
  return feed.items
    .filter((r) => r.actionable && r.status === "active" && r.location.precision === "validated" && r.location.x != null && r.location.y != null)
    .map((r) => ({
      id: `live-${r.id}`,
      title: r.title,
      category: TO_APP_CATEGORY[r.category] ?? "secret",
      regionId: r.location.regionId ?? "vicecity",
      x: r.location.x!,
      y: r.location.y!,
      summary: r.evidence[0]?.excerpt ?? r.summary,
      prerequisites: [],
      reward: r.conditions.money != null ? `${r.conditions.money.toLocaleString("fr-FR")} $ (selon les sources)` : r.conditions.reward ?? "Non établi",
      durationMin: 10,
      difficulty: 1,
      spoilerChapter: r.spoiler === "high" ? 3 : 0,
      contentPotential: r.opportunity.score,
      source: { label: r.evidence.map((e) => e.sourceName).join(", "), reliability: r.reliability === "personal" ? "reported" : r.reliability },
      provenance: { kind: "live", recordId: r.id, url: r.evidence[0]?.url ?? "", firstSeenAt: r.firstSeenAt },
    }));
}
