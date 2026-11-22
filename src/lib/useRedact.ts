"use client";

import { useMemo } from "react";
import { useStore } from "./store";
import { useLiveRadar } from "./live";
import { redactorFor } from "./spoiler";

/** Rédacteur anti-spoiler du joueur courant (mémorisé) : à appliquer aux textes avant leur rendu. */
export function useRedact(): (t: string) => string {
  const { state } = useStore();
  const { feed } = useLiveRadar();
  return useMemo(() => redactorFor(state, feed), [state, feed]);
}
