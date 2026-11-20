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

/** Filtre anti-spoiler du flux : strict = retiré, modéré = flouté (géré à l'affichage). */
export function spoilerVisibility(r: RadarRecord, mode: "strict" | "relaxed"): "visible" | "blurred" | "hidden" {
  if (r.spoiler !== "high") return "visible";
  return mode === "strict" ? "hidden" : "blurred";
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
