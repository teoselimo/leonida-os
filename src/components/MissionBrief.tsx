"use client";

import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { useLiveRadar } from "@/lib/live";
import { loadLandmarks } from "@/lib/gtadb";
import type { Landmark } from "@/lib/gtadb";
import { BRIEF_TTL_MS, briefKey, runMissionBrief } from "@/lib/copilot/brief";
import { exaSearch } from "@/lib/runtime/web";
import { reportWeb, useCopilotRuntime } from "@/lib/useCopilot";
import { tick } from "@/lib/motion";
import type { BriefItem, MissionAlertBrief } from "@/lib/types";
import type { WebStatus } from "@/lib/copilot";
import { Icon } from "./ui/Icon";

const KIND_FR: Record<BriefItem["kind"], string> = {
  manquable: "Manquable",
  objet_unique: "Objet unique",
  facultatif: "Facultatif",
  decision: "Décision",
  non_retour: "Point de non-retour",
  preparation: "Préparation",
};
const WHEN_FR: Record<BriefItem["when"], string> = { avant: "avant de lancer", pendant: "pendant", apres: "juste après" };
const STATUS_CLS: Record<BriefItem["status"], string> = { confirmé: "ok", contradictoire: "bad", "une source": "warn" };
const WEB_FR: Partial<Record<WebStatus, string>> = {
  not_connected: "web indisponible (connecteur Exa non branché)",
  needs_reauth: "web indisponible (reconnecter Exa)",
  denied: "web non autorisé pour cette app",
  error: "web en erreur",
  empty: "aucun résultat web",
  unavailable: "sans web",
};

/** Analyses en cours (une par mission), partagées entre montages de l'écran. */
const running = new Set<string>();
const attempted = new Set<string>();

function ago(iso: string) {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  return m < 1 ? "à l'instant" : m < 60 ? `il y a ${m} min` : `il y a ${Math.round(m / 60)} h`;
}

/**
 * « Rien à manquer » préventif, sur l'écran de mission : alertes prioritaires de LA mission affichée (jamais d'une autre),
 * statut de recoupement calculé par l'app, sources accessibles, ajout en objectif. Lancé automatiquement une fois par mission.
 */
export function MissionBriefPanel({ mission, during, risk }: { mission: string; during: string | null; risk: string | null }) {
  const { state, setBrief, addObjective } = useStore();
  const { feed } = useLiveRadar();
  const { transport, web, ready } = useCopilotRuntime();
  const key = briefKey(mission);
  const brief: MissionAlertBrief | undefined = state.briefs?.[key];
  const [stage, setStage] = useState<"search" | "write" | null>(running.has(key) ? "write" : null);
  const [failed, setFailed] = useState(false);
  const [all, setAll] = useState(false);
  const [places, setPlaces] = useState<Landmark[]>([]);
  useEffect(() => void loadLandmarks().then(setPlaces), []);

  const run = async () => {
    if (running.has(key) || !feed) return;
    running.add(key);
    setFailed(false);
    setStage(web === "unavailable" ? "write" : "search");
    try {
      const b = await runMissionBrief({ mission, ctx: { feed, state, places }, transport, search: web === "unavailable" ? null : exaSearch, onStage: setStage });
      setBrief(key, b);
      if (b.web) reportWeb(b.web.status === "ok" || b.web.status === "empty" ? "ok" : (b.web.status as WebStatus));
    } catch {
      setFailed(true);
    } finally {
      running.delete(key);
      setStage(null);
    }
  };

  // Lancement automatique : une fois par mission, dès que Claude et la veille sont prêts (le joueur n'a rien à faire)
  useEffect(() => {
    if (!ready || !transport || !feed || brief || attempted.has(key)) return;
    attempted.add(key);
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, transport, feed, key, !!brief]);

  const has = (t: string) => (state.profile.objectives ?? []).some((o) => o.mission.toLowerCase() === mission.toLowerCase() && o.text.toLowerCase() === t.toLowerCase());
  // aucun doublon : un point déjà passé en objectif n'est plus répété ici (il vit dans « Objectifs »)
  const items = (brief?.items ?? []).filter((b) => !has(b.text));
  const main = items[0] ?? null;
  const rest = items.slice(1);
  const stale = brief && Date.now() - Date.parse(brief.at) > BRIEF_TTL_MS;
  const radarLine = during && !/^aucune/i.test(during) ? during : null;
  const extra = rest.length + (radarLine ? 1 : 0) + (risk && main ? 1 : 0);

  const row = (b: BriefItem, i: number, tid: string) => (
    <li key={`${tid}${i}`} className={`bitem bitem--${STATUS_CLS[b.status]}${b.priority === "haute" ? " is-high" : ""}`} data-testid={tid} data-status={b.status}>
      <div className="bitem__top">
        <b className={`bstat bstat--${STATUS_CLS[b.status]}`}>{b.status}</b>
        <span className="bitem__kind">{KIND_FR[b.kind]} · {WHEN_FR[b.when]}</span>
      </div>
      <p className="bitem__text">{b.text}</p>
      {b.note && <p className="bitem__note"><Icon name="alert" size={12} /> {b.note}</p>}
      <div className="bitem__foot">
        <span className="srcline">
          {b.sources.slice(0, 3).map((s, j) => (
            <a key={j} href={s.url} target="_blank" rel="noreferrer" data-testid="brief-source">{s.name.replace(/\s*·\s*web$/, "")}</a>
          ))}
        </span>
        <button className="btn btn--xs btn--ghost press" onClick={() => { tick(); addObjective({ mission, text: b.text, basis: b.status === "confirmé" ? "vérifié" : "incertain", source: b.sources[0] }); }} data-testid="brief-add" aria-label={`Ajouter aux objectifs : ${b.text}`}>
          <Icon name="plus" size={12} /> Objectif
        </button>
      </div>
    </li>
  );

  return (
    <section className="brief" data-testid="brief" aria-label={`Rien à manquer — ${mission}`}>
      <header className="brief__head">
        <div>
          <strong>Rien à manquer</strong>
          <span data-testid="brief-meta">
            {stage
              ? stage === "search"
                ? "Recherche sur le web…"
                : "Claude analyse les sources…"
              : brief
                ? `${ago(brief.at)} · ${brief.web?.status === "ok" ? `${brief.web.count} source${brief.web.count > 1 ? "s" : ""} web + LEONIDA RADAR` : `LEONIDA RADAR${brief.web ? ` · ${WEB_FR[brief.web.status as WebStatus] ?? brief.web.status}` : " seul"}`}${stale ? " · à rafraîchir" : ""}`
                : transport
                  ? "Analyse préventive de cette mission"
                  : "Analyse IA disponible dans l'Artifact Claude"}
          </span>
        </div>
        <button className={`iconbtn brief__refresh press${!brief ? " is-primary" : ""}`} disabled={!!stage || !feed} onClick={() => { tick(); void run(); }} data-testid="nothing-to-miss" aria-label={brief ? "Mettre à jour l'analyse" : "Analyser la mission"}>
          {stage ? <span className="spin" aria-hidden /> : <Icon name={brief ? "reset" : "check"} size={18} />}
        </button>
      </header>

      {failed && <p className="bitem__note" data-testid="brief-error">L&apos;analyse n&apos;a pas abouti. Réessaie dans un instant.</p>}

      {main && <ul className="bitems">{row(main, 0, "brief-alert")}</ul>}
      {!main && risk && <p className="missioncard__risk"><Icon name="alert" size={13} /> {risk}</p>}
      {brief && !items.length && !stage && (
        <p className="brief__empty" data-testid="brief-empty">
          {(brief.items ?? []).length
            ? "Tous les points sont dans tes objectifs."
            : brief.engine === "claude"
              ? "Rien de manquable trouvé dans les sources consultées — ce n'est pas une garantie."
              : "Analyse IA indisponible ici : seules les fiches LEONIDA RADAR sont utilisées."}
        </p>
      )}

      {extra > 0 && (
        <button className="brief__more press" onClick={() => setAll((v) => !v)} aria-expanded={all} data-testid="brief-more">
          {all ? "Voir moins" : `Voir plus (${extra})`} <Icon name="chevronRight" size={14} />
        </button>
      )}
      {all && (
        <>
          {rest.length > 0 && <ul className="bitems">{rest.map((b, i) => row(b, i, "brief-item"))}</ul>}
          {risk && main && <p className="missioncard__risk"><Icon name="alert" size={13} /> {risk}</p>}
          {radarLine && <p className="missioncard__during" data-testid="mission-during"><b>LEONIDA RADAR :</b> {radarLine}</p>}
        </>
      )}
    </section>
  );
}
