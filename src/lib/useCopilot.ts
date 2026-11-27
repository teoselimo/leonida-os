"use client";

import { useEffect, useState } from "react";
import { pickTransport } from "./copilot";
import type { LlmTransport, WebStatus } from "./copilot";
import { webStatus } from "./runtime/web";

/** Moteur IA et état du web, détectés une seule fois et partagés entre l'accueil et LEONIDA AI. */
let transportP: Promise<LlmTransport | null> | null = null;
let webP: Promise<WebStatus> | null = null;
const listeners = new Set<(s: WebStatus) => void>();

/** Mise à jour de l'état du web après un vrai appel (succès ou erreur réels, jamais supposés). */
export function reportWeb(s: WebStatus) {
  webP = Promise.resolve(s);
  for (const l of listeners) l(s);
}

export function useCopilotRuntime() {
  const [transport, setTransport] = useState<LlmTransport | null>(null);
  const [web, setWeb] = useState<WebStatus>("unavailable");
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    listeners.add(setWeb);
    void Promise.all([(transportP ??= pickTransport()), (webP ??= webStatus())]).then(([t, w]) => {
      if (!live) return;
      setTransport(t);
      setWeb(w);
      setReady(true);
    });
    return () => {
      live = false;
      listeners.delete(setWeb);
    };
  }, []);
  return { transport, web, ready };
}
