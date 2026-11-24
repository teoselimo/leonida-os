import type { RadarFeed, RadarRecord } from "./feed";
import { liveAdvice, LIVE_CATEGORY, spoilerVisibility } from "./feed";
import { viewOf } from "./garage";
import type { VehicleView } from "./garage";
import { CAT_FR, frHeadline } from "./fr";
import type { MissionBrief, MissionInfo } from "./missions";
import { missionBrief, missionCatalog, missionVisible, nextMissionGuess, nk } from "./missions";
import type { MediaRef } from "../../collector/src/types";
import type { PersistedState } from "./types";
import { hiddenMissionNames, redactorFor } from "./spoiler";

/**
 * Briefing de session : répond en un coup d'œil à
 * 1. Quelle est ma prochaine mission ? (choisie/confirmée par le joueur, jamais déduite du seul chapitre)
 * 2. Que dois-je faire avant de la lancer ? (≤ 3, classé par perte potentielle puis valeur)
 * 3. Que puis-je récupérer pendant ? (preuve requise ; sinon « aucune récompense particulière confirmée »)
 * 4. Envie de t'amuser ? (≤ 2 véhicules ou secrets réellement accessibles)
 * Aucun doublon entre les sections ; les découvertes faites disparaissent.
 */

export interface SessionItem {
  id: string;
  kind: "record" | "vehicle";
  recordId?: string;
  vehicleId?: string;
  title: string;
  sub: string;
  urgent: boolean;
  reliability: string;
  media: MediaRef | null;
  icon: string;
  color: string;
  where: string | null;
  ultimate: boolean;
  /** « Me guider » (véhicule/zone) ou « Voir » (fiche). */
  go: "guide" | "see";
  score: number;
}

export interface SessionPlan {
  mission: {
    name: string | null;
    info: MissionInfo | null;
    brief: MissionBrief | null;
    /** Proposition à faire confirmer (numérotation cohérente d'une série de guides). */
    guess: { name: string; basis: string } | null;
    /** Missions connues et visibles (sans spoiler), pour choisir. */
    choices: string[];
    during: string | null;
    risk: string | null;
  };
  before: SessionItem[];
  fun: SessionItem[];
  stats: { missions: number; vehicles: number; done: number };
}

const solid = (r: string) => r === "official" || r === "confirmed";

function g(feed: RadarFeed | null) {
  const cat = missionCatalog(feed);
  return { cat, gl: { missions: [...cat.values()].map((m) => m.name), proper: (feed?.vehicles ?? []).map((v) => v.name.replace(/^'\d+\s*/, "")) } };
}

function recItem(r: RadarRecord, gl: { missions: string[]; proper: string[] }, score: number, sub: string, urgent = false): SessionItem {
  const cat = LIVE_CATEGORY[r.category] ?? LIVE_CATEGORY.other;
  return {
    id: `r:${r.id}`,
    kind: "record",
    recordId: r.id,
    title: frHeadline(r, gl),
    sub,
    urgent,
    reliability: r.reliability,
    media: r.media ?? null,
    icon: cat.icon,
    color: cat.color,
    where: r.details?.place?.value.name ?? null,
    ultimate: false,
    go: "see",
    score,
  };
}

function vehItem(x: VehicleView, score: number, sub: string): SessionItem {
  return {
    id: `v:${x.v.id}`,
    kind: "vehicle",
    vehicleId: x.v.id,
    title: x.v.name,
    sub,
    urgent: x.urgent,
    reliability: x.v.reliability,
    media: x.v.media ?? null,
    icon: "car",
    color: x.v.edition.exclusive === "ultimate" ? "#FFB547" : "#2EE6D6",
    where: x.v.location.district,
    ultimate: x.v.edition.exclusive === "ultimate",
    go: x.v.location.precision === "zone" || x.v.location.precision === "exact" ? "guide" : "see",
    score,
  };
}

export function sessionPlan(feed: RadarFeed | null, s: Pick<PersistedState, "profile" | "vehicles" | "done">): SessionPlan {
  const p = s.profile;
  const { cat, gl } = g(feed);
  const doneM = new Set(p.missionsDone.map(nk));
  const next = p.nextMission && !doneM.has(nk(p.nextMission)) ? p.nextMission : null;
  const info = next ? cat.get(nk(next).replace(/'/g, "")) ?? null : null;
  const brief = next ? missionBrief(feed, next, { chapter: p.chapter, spoilerMode: p.spoilerMode, done: s.done }) : null;
  const guess = p.chapter !== 2 && !next && p.lastMission ? nextMissionGuess(cat, p.lastMission) : null;
  const choices = [...cat.values()].filter((m) => missionVisible(m, p.chapter, p.spoilerMode) && !doneM.has(nk(m.name))).map((m) => m.name).sort();

  const during = brief?.during.length
    ? brief.during
        .slice(0, 2)
        .map((r) => `${r.conditions.reward ?? CAT_FR[r.category] ?? "un bonus"}${r.details?.place ? ` (${r.details.place.value.name})` : ""}`)
        .join(", ")
    : null;
  const risk = brief?.during.find((r) => r.details?.missable?.value === true) ? "Une récompense de cette mission peut être manquée : prépare-la avec Leonida." : null;

  // ── Avant de la lancer ──
  const before: SessionItem[] = [];
  const used = new Set<string>(brief?.during.map((r) => r.id) ?? []);
  for (const r of brief?.before ?? []) {
    used.add(r.id);
    before.push(recItem(r, gl, 100, `À faire avant « ${next} » : ${r.details?.contextMissable?.value.subject ? `la mission « ${r.details.contextMissable.value.subject} » disparaît ensuite` : "plus possible ensuite"}.`, true));
  }
  for (const a of liveAdvice(feed, { chapter: p.chapter, spoilerMode: p.spoilerMode, missionsDone: p.missionsDone }, s.done).now) {
    if (used.has(a.r.id)) continue;
    used.add(a.r.id);
    const cm = a.r.details?.contextMissable?.value;
    const urgent = a.urgency === "now" && !a.missionGone;
    before.push(
      recItem(
        a.r,
        gl,
        urgent ? 80 : 45,
        a.missionGone ? "La mission n'est plus disponible, mais le lieu reste accessible selon la source." : cm?.until ? `Pendant « ${cm.subject ?? "une mission"} », avant « ${cm.until} ».` : "Accessible maintenant.",
        urgent,
      ),
    );
  }
  const views = (feed?.vehicles ?? []).map((v) => viewOf(v, s)).filter((x) => !x.hidden && x.now && (!x.owned || x.owned === "spotted"));
  for (const x of views.filter((x) => x.urgent)) before.push(vehItem(x, 70, `Seulement jusqu'au chapitre ${x.v.access.until?.value}${x.v.location.district ? ` · ${x.v.location.district}` : ""}`));
  const visibleRec = (feed?.items ?? []).filter(
    (r) => r.status === "active" && !s.done[r.id] && !used.has(r.id) && r.actionable && solid(r.reliability) && (r.details?.chapter?.value ?? 99) <= p.chapter && spoilerVisibility(r, p.spoilerMode, p.chapter) === "visible",
  );
  for (const r of visibleRec) {
    const sc = r.category === "money" ? 40 + Math.min(20, (r.conditions.money ?? 0) / 1000) : r.category === "weapon" ? 38 : r.category === "unique_item" ? 30 : 0;
    if (sc) before.push(recItem(r, gl, sc, r.details?.place ? `${r.details.place.value.name}${r.details.place.value.district ? ` · ${r.details.place.value.district}` : ""}` : "Lieu dans la fiche"));
  }
  before.sort((a, b) => b.score - a.score);
  const beforeTop = before.slice(0, 3);

  // ── Envie de t'amuser ? ── (véhicules accessibles non urgents, puis secrets illustrés)
  const taken = new Set(beforeTop.map((x) => x.id));
  const fun: SessionItem[] = [];
  for (const x of views.filter((x) => !x.urgent).sort((a, b) => Number(!!b.v.media) - Number(!!a.v.media) || Number(solid(b.v.reliability)) - Number(solid(a.v.reliability)))) {
    const it = vehItem(x, 60, `${x.v.location.precision === "zone" ? `Zone de ${x.v.location.district}` : x.v.location.district ?? "Lieu dans la fiche"} · accessible maintenant`);
    if (!taken.has(it.id)) fun.push(it);
  }
  const eggs = (feed?.items ?? []).filter((r) => r.category === "easter_egg" && r.status === "active" && !s.done[r.id] && !taken.has(`r:${r.id}`) && r.reliability !== "rumor" && (r.details?.chapter?.value ?? 0) <= p.chapter && spoilerVisibility(r, p.spoilerMode, p.chapter) === "visible" && r.media);
  for (const r of eggs) fun.push(recItem(r, gl, 50, `${r.reliability === "reported" ? "Signalé par une source" : "Recoupé"} · secret à découvrir`));
  // un véhicule puis, si possible, une autre envie (secret) pour varier
  const funTop = [fun.find((x) => x.kind === "vehicle"), fun.find((x) => x.kind === "record") ?? fun.filter((x) => x.kind === "vehicle")[1]].filter((x): x is SessionItem => !!x).slice(0, 2);

  // anti-spoiler à la source : aucun nom de mission future dans les textes de l'accueil
  const red = redactorFor(s, feed);
  const clean = (it: SessionItem): SessionItem => ({ ...it, title: red(it.title), sub: red(it.sub), where: it.where ? red(it.where) : it.where });
  const hidden = new Set(hiddenMissionNames(s, feed).map((n) => n.toLowerCase()));
  return {
    mission: { name: next, info, brief, guess: guess && missionVisible(guess.mission, p.chapter, p.spoilerMode) && !hidden.has(guess.mission.name.toLowerCase()) ? { name: guess.mission.name, basis: guess.basis } : null, choices: choices.filter((c) => !hidden.has(c.toLowerCase())), during: during ? red(during) : during, risk },
    before: beforeTop.map(clean),
    fun: funTop.map(clean),
    stats: { missions: p.missionsDone.length, vehicles: Object.values(s.vehicles).filter((v) => v.state !== "spotted").length, done: Object.keys(s.done).length },
  };
}
