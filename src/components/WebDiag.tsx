"use client";

import { useEffect, useState } from "react";
import { exaSearch, WEB_SERVER, WEB_TOOL, webStatus } from "@/lib/runtime/web";
import { reportWeb } from "@/lib/useCopilot";
import type { WebHit, WebStatus } from "@/lib/copilot";
import { tick } from "@/lib/motion";
import { useStore } from "@/lib/store";
import { median, ROUTER_KEY } from "@/lib/copilot/route";
import type { TurnMetrics } from "@/lib/copilot/route";

const KEY = "leonida-os/web-diag/v1";
type Diag = { at: string; status: WebStatus; count: number; rawChars: number; ms: number; hits: Array<Pick<WebHit, "title" | "url">> };

const STATUS_FR: Record<WebStatus, string> = {
  ok: "Fonctionne",
  empty: "Réponse reçue, aucun résultat lu",
  unavailable: "Indisponible ici (hors Artifact Claude, ou capacité non chargée)",
  not_connected: "Connecteur Exa non branché sur ce compte",
  needs_reauth: "Connecteur Exa à reconnecter",
  denied: "Accès refusé à cette app (accepte la demande d'autorisation)",
  error: "Erreur du connecteur",
};

/**
 * Diagnostic RÉEL de la recherche web depuis l'Artifact publié : un vrai appel Exa, résultat brut affiché.
 * Rien n'est simulé ; le dernier résultat est daté et conservé sur cet appareil.
 */
export function WebDiag() {
  const [st, setSt] = useState<WebStatus | null>(null);
  const [last, setLast] = useState<Diag | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void webStatus().then(setSt);
    try {
      setLast(JSON.parse(localStorage.getItem(KEY) || "null"));
    } catch {
      /* rien */
    }
  }, []);
  const test = async () => {
    tick();
    setBusy(true);
    const t0 = performance.now();
    const r = await exaSearch("GTA 6 Don Gone mission guide", undefined, "Guides of the GTA VI (GTA 6) mission Don Gone. Exclude GTA V.");
    const d: Diag = { at: new Date().toISOString(), status: r.status, count: r.hits.length, rawChars: r.rawChars ?? 0, ms: Math.round(performance.now() - t0), hits: r.hits.slice(0, 3).map((h) => ({ title: h.title, url: h.url })) };
    setLast(d);
    reportWeb(d.status === "empty" ? "ok" : d.status);
    try {
      localStorage.setItem(KEY, JSON.stringify(d));
    } catch {
      /* stockage indisponible */
    }
    setBusy(false);
  };
  return (
    <section className="card form" data-testid="web-diag">
      <h4>Recherche web (Exa)</h4>
      <p className="muted small">
        Connecteur « {WEB_SERVER} », outil <code>{WEB_TOOL}</code>. État détecté : <b data-testid="web-diag-state">{st ? STATUS_FR[st] : "…"}</b>. Le premier appel peut demander ton accord.
      </p>
      <button className="btn btn--sm btn--on press" onClick={test} disabled={busy} data-testid="web-diag-run">
        {busy ? "Test en cours…" : "Tester une vraie recherche"}
      </button>
      <RouterMetrics />
      {last && (
        <div className="webdiag" data-testid="web-diag-result" data-status={last.status}>
          <p>
            <b>{STATUS_FR[last.status]}</b> · {last.count} résultat{last.count > 1 ? "s" : ""} lu{last.count > 1 ? "s" : ""} · réponse brute {last.rawChars.toLocaleString("fr-FR")} caractères · {last.ms} ms · {new Date(last.at).toLocaleString("fr-FR")}
          </p>
          {last.status === "empty" && last.rawChars > 200 && <p className="small">Exa a répondu mais l&apos;app n&apos;a lu aucun résultat : format inattendu, à signaler.</p>}
          {last.hits.length > 0 && (
            <ul>
              {last.hits.map((h, i) => (
                <li key={i}><a href={h.url} target="_blank" rel="noreferrer">{h.title || h.url}</a></li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

/** Mesures RÉELLES des dernières réponses (sauvegardées) : routage local V0.13 vs ancien planificateur. */
function RouterMetrics() {
  const { state } = useStore();
  const [mode, setMode] = useState<"local" | "planner">("local");
  useEffect(() => {
    try {
      setMode(localStorage.getItem(ROUTER_KEY) === "planner" ? "planner" : "local");
    } catch {
      /* préférence absente */
    }
  }, []);
  const toggle = () => {
    const next = mode === "local" ? "planner" : "local";
    try {
      if (next === "planner") localStorage.setItem(ROUTER_KEY, "planner");
      else localStorage.removeItem(ROUTER_KEY);
    } catch {
      /* stockage indisponible */
    }
    setMode(next);
  };
  const ms = state.metrics ?? [];
  const row = (r: "local" | "planner") => {
    const xs: TurnMetrics[] = ms.filter((m) => m.router === r);
    if (!xs.length) return null;
    const web = xs.filter((m) => m.searches + m.cachedSearches > 0);
    return (
      <li key={r} data-testid={`metrics-${r}`}>
        <b>{r === "local" ? "Routage local (V0.13)" : "Ancien planificateur"}</b> · {xs.length} réponse{xs.length > 1 ? "s" : ""} · premier texte {median(xs.map((m) => m.firstTextMs ?? NaN)) ?? "—"} ms · total {median(xs.map((m) => m.totalMs))} ms · {(xs.reduce((a, m) => a + m.claudeCalls, 0) / xs.length).toFixed(1)} appel(s) Claude / réponse
        {web.length > 0 && <> · recherche web dans {web.length}/{xs.length} (médiane {median(web.map((m) => m.searchMs))} ms)</>}
      </li>
    );
  };
  return (
    <div className="webdiag" data-testid="router-metrics">
      <p className="small">
        Mesures réelles de tes dernières questions (médianes). Pour comparer, active l&apos;ancien planificateur le temps de quelques questions, puis reviens au routage local.
      </p>
      {ms.length ? <ul>{row("local")}{row("planner")}</ul> : <p className="small muted">Aucune mesure pour l&apos;instant : pose une question au copilote.</p>}
      <button className="btn btn--xs btn--ghost press" onClick={toggle} data-testid="router-toggle">
        {mode === "local" ? "Comparer : utiliser l'ancien planificateur" : "Revenir au routage local (recommandé)"}
      </button>
    </div>
  );
}
