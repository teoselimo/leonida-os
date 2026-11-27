"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { RadarFeed, RadarRecord } from "../../collector/src/types";
import type { CategoryId, Discovery } from "./types";

export type { RadarFeed, RadarRecord };
export * from "./feed";
import { isFeed } from "./feed";
import { withRvl } from "./rvl";

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

  const merged = useMemo(() => withRvl(feed), [feed]);
  const value = useMemo(() => ({ feed: merged, state, fetchedAt, error, refresh, url }), [merged, state, fetchedAt, error, refresh, url]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLiveRadar(): LiveCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useLiveRadar hors de LiveRadarProvider");
  return c;
}

