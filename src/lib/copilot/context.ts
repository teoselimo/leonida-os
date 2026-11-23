import { autopilotContext } from "../autopilot";
import type { RadarFeed } from "../feed";
import { frHeadline } from "../fr";
import { missionCatalog } from "../missions";
import type { PlaceRef } from "../ai/engine";
import { POI_CATS, POI_STATUS_FR, poiCategory, poiName, poiStatus } from "../poi";
import type { Landmark } from "../gtadb";
import type { PersistedState } from "../types";
import { CONSOLES, SPOILER_FR } from "../meta";
import { progressionContext } from "../progress";
import { storyContext } from "../story/engine";

/** Limites de contexte : jamais des dizaines de fiches sans rapport. */
export const CONTEXT_LIMITS = { maxEvidence: 8, maxQuote: 280, maxChars: 16_000 };

const EDITION: Record<string, string> = { standard: "Standard", ultimate: "Ultimate", unknown: "non renseignée" };
const PREORDER: Record<string, string> = { yes: "oui", no: "non", unknown: "inconnu" };

/** Contexte joueur en français, lu par le modèle avant chaque réponse (aucune donnée personnelle hors jeu). */
export function playerContext(s: Pick<PersistedState, "profile" | "vehicles" | "done"> & { story?: PersistedState["story"] }, feed: RadarFeed | null): string {
  const p = s.profile;
  const owned = Object.entries(s.vehicles)
    .filter(([, v]) => v.state !== "spotted")
    .map(([id, v]) => `${feed?.vehicles?.find((x) => x.id === id)?.name ?? id} (${v.state}${v.storage ? `, ${v.storage}` : ""})`);
  const done = Object.keys(s.done)
    .map((id) => {
      const r = feed?.items.find((x) => x.id === id);
      return r ? frHeadline(r) : null;
    })
    .filter(Boolean);
  return [
    `Console : ${CONSOLES[p.console] ?? p.console} · édition ${EDITION[p.edition]} · bonus de précommande : ${PREORDER[p.preorder]}`,
    `Chapitre atteint : ${p.chapter} · dernière mission terminée (déclarée) : ${p.lastMission ?? "non renseignée"}`,
    p.nextMission
      ? p.missionInProgress
        ? `Mission EN COURS (déclarée lancée, PAS terminée) : ${p.nextMission}`
        : `Prochaine mission (pas encore lancée) : ${p.nextMission}`
      : "Prochaine mission : non renseignée",
    objectivesLine(p),
    `Missions terminées : ${p.missionsDone.length ? p.missionsDone.slice(-12).join(", ") : "aucune renseignée"}`,
    `Activités déjà faites : ${done.length ? done.slice(-10).join(" ; ") : "aucune renseignée"}`,
    `Véhicules et garages possédés : ${owned.length ? owned.slice(-10).join(", ") : "aucun renseigné"}`,
    `Anti-spoiler : ${SPOILER_FR[p.spoilerMode] ?? SPOILER_FR.strict}`,
    progressionContext(s),
    autopilotContext(s),
    storyContext(s),
  ].join("\n");
}

function objectivesLine(p: PersistedState["profile"]): string {
  const list = (p.objectives ?? []).filter((o) => p.nextMission && o.mission.toLowerCase() === p.nextMission.toLowerCase());
  if (!list.length) return "Objectifs facultatifs notés pour cette mission : aucun";
  return `Objectifs facultatifs notés : ${list.map((o) => `${o.done ? "[fait] " : "[à faire] "}${o.text} (${o.basis})`).join(" ; ")}`;
}

/** Résultat web transmis au modèle comme preuve (jamais comme instruction). */
export interface WebEvidence {
  id: string;
  titre: string;
  url: string;
  site: string;
  date: string | null;
  extrait: string;
}

const asLm = (p: PlaceRef): Landmark => ({ id: p.id, name: p.name, district: p.district, tags: p.tags ?? [], x: p.x ?? 0, y: p.y ?? 0, real: p.real ?? "" });

/**
 * Preuves compactes pour le modèle : uniquement les entités retenues par la recherche (fiches, véhicules, lieux),
 * avec leur fiabilité et le nombre de sources par fait. Partagé par l'Artifact et le futur backend API.
 */
export function buildEvidence(feed: RadarFeed, ids: string[], places: PlaceRef[] = [], web: WebEvidence[] = []): string {
  const cat = missionCatalog(feed);
  const g = { missions: [...cat.values()].map((m) => m.name), proper: (feed.vehicles ?? []).map((v) => v.name) };
  const q = (s: string) => s.slice(0, CONTEXT_LIMITS.maxQuote);
  const out: unknown[] = [];
  for (const id of ids.slice(0, CONTEXT_LIMITS.maxEvidence)) {
    if (id.startsWith("poi:")) {
      const p = places.find((x) => x.id === id.slice(4));
      if (p) {
        const l = asLm(p);
        out.push({ id, lieu: poiName(l), type: POI_CATS[poiCategory(l)].label, quartier: l.district, statut: POI_STATUS_FR[poiStatus(l)], fiabilite: "repère communautaire gtadb" });
      }
      continue;
    }
    const r = feed.items.find((x) => x.id === id);
    if (r) {
      const d = r.details;
      out.push({
        id: r.id,
        titre: frHeadline(r, g),
        fiabilite: r.reliability,
        faits: {
          chapitre: d?.chapter?.value ?? null,
          gain: r.conditions.reward,
          lieu: d?.place ? `${d.place.value.name}${d.place.value.district ? `, ${d.place.value.district}` : ""}` : null,
          pendant_mission: d?.mission?.value ?? null,
          disparait_au_lancement_de: d?.contextMissable?.value.until ?? null,
          manquable: d?.missable?.value ?? null,
          sources_par_fait: { gain: d?.money?.support.length ?? 0, lieu: d?.place?.support.length ?? 0, disparition: d?.contextMissable?.support.length ?? 0 },
        },
        extraits: r.evidence.flatMap((e) => (e.quotes ?? []).slice(0, 2)).slice(0, 3).map(q),
        sources: r.evidence.slice(0, 3).map((e) => `${e.sourceName.replace(/\s*\([^)]*\)\s*$/, "")} (${(e.publishedAt ?? r.firstSeenAt).slice(0, 10)})`),
      });
      continue;
    }
    const v = (feed.vehicles ?? []).find((x) => x.id === id);
    if (v)
      out.push({
        id: v.id,
        vehicule: v.name,
        fiabilite: v.reliability,
        zone: v.location.district,
        precision: v.location.precision === "zone" ? "zone de recherche (pas un point exact)" : v.location.precision,
        edition: v.edition.exclusive ? `${v.edition.exclusive} (${v.edition.status})` : "toutes éditions",
        chapitre_min: v.access.chapterMin?.value ?? v.access.inferredChapter?.value ?? null,
        acces_tot: v.access.early,
        jusqu_au_chapitre: v.access.until?.value ?? null,
        conserver: v.keep.rule ? `immatriculation dès le chapitre ${v.keep.rule.chapter}${v.keep.rule.where ? `, ${v.keep.rule.where}` : ""}` : v.keep.mode,
        extraits: [v.location.text?.value ?? ""].filter(Boolean).map(q),
      });
  }
  for (const w of web.slice(0, 8)) out.push({ id: w.id, web: w.titre, site: w.site, date: w.date, fiabilite: "web non vérifié (une source)", extrait: w.extrait.slice(0, 1_500) });
  let s = JSON.stringify(out);
  if (s.length > CONTEXT_LIMITS.maxChars) s = s.slice(0, CONTEXT_LIMITS.maxChars);
  return s;
}

/**
 * V0.19 · Contexte joueur COMPACT pour une question sur un lieu, un véhicule ou une image : où il en est, sans les
 * alertes de mission ni l'argent (qu'il retrouve sur l'Accueil). Évite que Claude récite Tourist Trap à chaque capture.
 */
export function compactPlayerContext(s: Pick<PersistedState, "profile">): string {
  const p = s.profile;
  return [
    `Chapitre atteint : ${p.chapter} · édition ${EDITION[p.edition]}`,
    `Dernière mission terminée (déclarée) : ${p.lastMission ?? "non renseignée"}`,
    p.nextMission ? (p.missionInProgress ? `Mission EN COURS : ${p.nextMission}` : `Prochaine mission envisagée (pas lancée) : ${p.nextMission}`) : "Aucune mission choisie",
    `Anti-spoiler : ${SPOILER_FR[p.spoilerMode] ?? SPOILER_FR.strict}`,
    "(Alertes de mission et argent : non pertinents pour cette question, affichés sur l'Accueil — n'en parle pas sauf demande.)",
  ].join("\n");
}

const MISSION_TERMS = /\b(mission|lancer|lance|risque|manquer|rater|argent|family savings|point de non-retour|chapitre suivant|terminer|termin[ée]|apr[eè]s|avant de)\b/i;
const PLACE_TERMS = /\b(o[uù] est|c'est quoi (ce|cette)|c'est o[uù]|quel (lieu|endroit|bâtiment|batiment)|cette maison|ce bâtiment|ce batiment|ce lieu|cet endroit|ressemble|reconna[iî]s|quelle voiture|quel v[ée]hicule|à quoi ressemble)\b/i;

/** La question porte sur un lieu / un véhicule (et pas sur une mission, un risque ou l'argent). */
export function placeFocus(q: string, namesKnownPlace = false): boolean {
  return (PLACE_TERMS.test(q) || namesKnownPlace) && !MISSION_TERMS.test(q);
}
