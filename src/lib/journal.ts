import type { RadarFeed } from "./feed";
import { frHeadline } from "./fr";
import { glossaryOf } from "./missions";
import { PROG_BY_ID } from "@/data/progression";
import { ESTABLISHMENTS } from "@/data/establishments";
import type { PersistedState } from "./types";

/**
 * Journal « Récupéré / Fait » (V0.14) : une VUE UNIFIÉE en lecture des progrès enregistrés, sans fusionner leur stockage.
 * Chaque type garde son champ de sauvegarde et sa date :
 * - `done[recordId]`            fiches de la veille (armes, objets, argent, secrets) — date de la coche ;
 * - `done["prog:<id>"]`         activités facultatives du graphe de progression ;
 * - `done["veh:<id>"]`          véhicule noté trouvé depuis l'accueil ;
 * - `vehicles[id]`              garage (repéré → volé → rangé), avec sa date ;
 * - `profile.objectives[done]`  objectifs de mission cochés ;
 * - `pins[id]`                  positions placées par le joueur ;
 * - `profile.missionsDone`      missions principales (sans date enregistrée avant V0.14).
 * Annuler = l'action inverse propre à chaque type (jamais une réécriture globale).
 */
export type JournalKind = "arme" | "objet" | "argent" | "secret" | "activite" | "vehicule" | "objectif" | "position" | "mission";

export interface JournalEntry {
  id: string;
  kind: JournalKind;
  name: string;
  at: string | null;
  /** Comment annuler (action dédiée au type de stockage). */
  undo: { type: "done"; key: string } | { type: "vehicle"; id: string } | { type: "objective"; id: string } | { type: "pin"; id: string } | { type: "mission"; name: string };
}

export const JOURNAL_FR: Record<JournalKind, { label: string; done: string; group: string }> = {
  arme: { label: "Arme", done: "Arme récupérée", group: "Armes" },
  objet: { label: "Objet", done: "Objet récupéré", group: "Objets" },
  argent: { label: "Argent", done: "Butin récupéré", group: "Argent" },
  secret: { label: "Découverte", done: "Découverte faite", group: "Découvertes" },
  activite: { label: "Activité", done: "Activité terminée", group: "Missions annexes et activités" },
  vehicule: { label: "Véhicule", done: "Véhicule trouvé", group: "Véhicules" },
  objectif: { label: "Objectif", done: "Objectif coché", group: "Objectifs de mission" },
  position: { label: "Position", done: "Position enregistrée", group: "Positions placées" },
  mission: { label: "Mission", done: "Mission terminée", group: "Missions principales" },
};

/** Type d'une fiche de la veille, pour le bon message (« Arme récupérée », « Objet récupéré »…). */
export function recordKind(category: string | undefined): JournalKind {
  if (category === "weapon") return "arme";
  if (category === "unique_item") return "objet";
  if (category === "money") return "argent";
  if (category === "vehicle") return "vehicule";
  if (category === "mission" || category === "side_mission") return "activite";
  return "secret";
}

export function buildJournal(s: Pick<PersistedState, "profile" | "done" | "vehicles" | "pins">, feed: RadarFeed | null): JournalEntry[] {
  const out: JournalEntry[] = [];
  const gl = glossaryOf(feed);
  for (const [key, at] of Object.entries(s.done ?? {})) {
    if (key.startsWith("prog:")) {
      const n = PROG_BY_ID.get(key.slice(5));
      out.push({ id: key, kind: n?.id === "family-savings" ? "argent" : "activite", name: n?.name ?? key.slice(5), at, undo: { type: "done", key } });
    } else if (key.startsWith("order:")) {
      const v = feed?.vehicles?.find((x) => x.id === key.slice(6));
      out.push({ id: key, kind: "activite", name: `Commande reçue : ${v?.name ?? key.slice(6)}`, at, undo: { type: "done", key } });
    } else if (key.startsWith("veh:")) {
      const v = feed?.vehicles?.find((x) => x.id === key.slice(4));
      out.push({ id: key, kind: "vehicule", name: v?.name ?? key.slice(4), at, undo: { type: "done", key } });
    } else {
      const r = feed?.items.find((x) => x.id === key);
      out.push({ id: key, kind: recordKind(r?.category), name: r ? frHeadline(r, gl) : "Fiche de la veille", at, undo: { type: "done", key } });
    }
  }
  for (const [id, v] of Object.entries(s.vehicles ?? {})) {
    if (v.state === "spotted") continue;
    const veh = feed?.vehicles?.find((x) => x.id === id);
    out.push({ id: `garage:${id}`, kind: "vehicule", name: veh?.name ?? id, at: v.at, undo: { type: "vehicle", id } });
  }
  for (const o of s.profile.objectives ?? []) if (o.done) out.push({ id: `obj:${o.id}`, kind: "objectif", name: `${o.text} (${o.mission})`, at: o.at ?? null, undo: { type: "objective", id: o.id } });
  for (const [id, p] of Object.entries(s.pins ?? {})) out.push({ id: `pin:${id}`, kind: "position", name: ESTABLISHMENTS.find((e) => e.id === id)?.name ?? id, at: p.at, undo: { type: "pin", id } });
  for (const m of s.profile.missionsDone) out.push({ id: `mission:${m}`, kind: "mission", name: m, at: null, undo: { type: "mission", name: m } });
  // le plus récent d'abord ; les missions (sans date) en fin de liste
  return out.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
}
