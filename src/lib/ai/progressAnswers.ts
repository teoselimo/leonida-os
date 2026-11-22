import type { ProgNode } from "@/data/progression";
import { ESTABLISHMENTS, establishmentCategoryFromQuery, EST_CATS } from "@/data/establishments";
import type { EstCat, Establishment } from "@/data/establishments";
import { placementOf } from "../places";
import { computeProgress, nextPointOfNoReturn, pendingMissables, shownName } from "../progress";
import type { NodeState, ProgressView } from "../progress";
import { nk } from "../missions";
import type { Profile } from "../types";
import type { AiAnswer, AiContext, Source } from "./engine";

/**
 * Réponses de progression (V0.12) : « je fais quoi maintenant ? », « j'ai terminé », « je l'ai », « j'attaque la suivante »,
 * « qu'est-ce que j'ai débloqué ? », « il me reste quoi ici ? », « je risque de manquer quoi ? », « je peux acheter des armes ? »,
 * « quels vêtements à Key Lento ? ». Faits issus du graphe sourcé et du référentiel d'établissements ; Claude les reformule.
 * Toute modification de progression passe par une action à CONFIRMER.
 */
export type ProgIntent = "got_item" | "next_start" | "what_now" | "unlocked" | "side_list" | "zone_left" | "miss_risk" | "buy_weapons" | "shops";

const RX: Array<[ProgIntent, RegExp]> = [
  ["got_item", /^(c est bon[, ]*)?(je l ai|je les ai|j l ai|chope|recupere|recup|c est recupere|j ai (pris|recupere|chope|eu) (le|la|les|l ))\b|^c est bon,? je l/],
  ["next_start", /\b(j attaque|je lance|je commence|on attaque|on lance|je passe a|go) (la )?(suivante|mission suivante|prochaine( mission)?|suite)\b|^(la )?suivante ?!?$/],
  ["buy_weapons", /\b(acheter|achete|acheter de nouvelles|nouvelles|achat d)\b.{0,20}\barmes?\b|\barmurerie|ammu.?nation/],
  ["miss_risk", /\b(risque|vais|peux|pourrais)\b.{0,20}\b(manquer|rater|louper)\b(?!.{0,40}\b(dans|pendant|avant)\b\s+[a-z])|\bqu est ce qui (est )?manquable/],
  ["side_list", /\bmissions? (secondaires|facultatives|annexes)|\bactivites? (secondaires|facultatives|annexes)|\bquetes? (secondaires|annexes)/],
  ["unlocked", /\b(qu est ce que|qu est ce qu|quoi) .{0,15}(debloque|deverrouille)|\bj ai debloque quoi|\bnouveautes? debloquees?/],
  ["zone_left", /\b(il me reste quoi|qu est ce qu il me reste|reste[- ]?t[- ]?il|encore a faire)\b/],
  ["what_now", /\b(je fais quoi|on fait quoi|que faire|quoi faire|je peux faire quoi|qu est ce que je (peux|pourrais) faire)\b/],
];

export function progressIntent(q: string): ProgIntent | null {
  const n = nk(q).replace(/'/g, " ").replace(/\s+/g, " ").trim();
  if (establishmentCategoryFromQuery(n) && /\b(ou|quels?|quelles?|meilleurs?|magasins?|boutiques?|y a|dispo|disponibles?|trouver|acheter)\b/.test(n) && !/\barmes?\b.{0,10}\bgratuit/.test(n)) return "shops";
  for (const [k, rx] of RX) if (rx.test(n)) return k;
  return null;
}

const src = (n: ProgNode): Source[] => (n.prereq?.sources ?? []).slice(0, 3).map((s) => ({ name: s.name, url: s.url, when: null }));
const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} et ${xs[xs.length - 1]}`);

function curOf(v: ProgressView): NodeState | null {
  return v.current ?? v.planned ?? null;
}
function collected(p: Profile) {
  return (p.objectives ?? []).filter((o) => o.done).map((o) => o.text);
}
const describeLock = (st: NodeState, v: ProgressView, mode: Profile["spoilerMode"]) => `après ${list(st.missing!.map((m) => shownName(v.byId.get(m.id)!, mode)))}`;

/** Ce que change « mission terminée » dans le graphe (V0.14) : données structurées pour l'accueil et le copilote. */
export interface ProgressDelta {
  mains: NodeState[];
  potentials: NodeState[];
  sides: NodeState[];
  lost: NodeState[];
  /** Prochain point de non-retour pertinent, nommé sans spoiler (ou null). */
  pnr: { where: string; lose: string[]; node: string; prereq: string[] } | null;
}

export function progressDelta(profile: Profile, name: string, done: Record<string, string> = {}): ProgressDelta {
  const before = computeProgress({ profile, done });
  const nextProfile: Profile = {
    ...profile,
    missionsDone: profile.missionsDone.some((m) => nk(m) === nk(name)) ? profile.missionsDone : [...profile.missionsDone, name],
    lastMission: name,
    nextMission: profile.nextMission && nk(profile.nextMission) === nk(name) ? null : profile.nextMission,
    missionInProgress: profile.nextMission && nk(profile.nextMission) === nk(name) ? false : profile.missionInProgress,
  };
  const after = computeProgress({ profile: nextProfile, done });
  const opened = after.states.filter((x) => (x.status === "accessible" || x.status === "potentiellement accessible") && before.byId.get(x.node.id)?.status === "verrouillé");
  const pnrNode = nextPointOfNoReturn(after);
  const mode = profile.spoilerMode;
  const pnr = pnrNode?.node.pointOfNoReturn
    ? { where: shownName(pnrNode, mode) === pnrNode.node.name ? `au début de ${pnrNode.node.name}` : "au début d'une mission principale à venir", lose: pnrNode.node.pointOfNoReturn.lose, node: pnrNode.node.id, prereq: pnrNode.node.prereq?.all ?? [] }
    : null;
  return {
    mains: opened.filter((x) => x.node.kind === "main" && x.status === "accessible"),
    potentials: opened.filter((x) => x.node.kind === "main" && x.status !== "accessible"),
    sides: opened.filter((x) => x.node.kind !== "main"),
    lost: after.states.filter((x) => x.status === "plus disponible" && before.byId.get(x.node.id)?.status !== "plus disponible"),
    pnr,
  };
}

/** Après « terminée » : ce qui s'ouvre réellement (statuts recalculés), sans ordre linéaire inventé. */
export function afterDone(profile: Profile, name: string): { text: string; actions: AiAnswer["actions"] } {
  const d = progressDelta(profile, name);
  const opened = [...d.mains, ...d.potentials, ...d.sides];
  const mains = [...d.mains, ...d.potentials];
  const parts: string[] = [];
  if (opened.length) parts.push(`Débloqué d'après les sources : ${list(opened.map((x) => `${x.node.name}${x.node.kind !== "main" ? " (facultative)" : ""}${x.status === "potentiellement accessible" ? " — à confirmer en jeu" : ""}`))}.`);
  else parts.push("Je n'ai pas de nouvelle mission documentée comme débloquée par celle-ci : regarde ta carte en jeu, je ne devine pas la suite.");
  if (d.lost.length) parts.push(`Plus disponible désormais : ${list(d.lost.map((x) => x.node.name))}.`);
  if (d.pnr && mains.some((m) => m.node.id === d.pnr!.node || d.pnr!.prereq.includes(m.node.id))) parts.push(`Attention : le point de non-retour du chapitre approche (${d.pnr.lose.slice(0, 2).join(", ")} perdus). Finis tes activités avant.`);
  return {
    text: parts.join(" "),
    actions: mains.slice(0, 2).map((x) => ({ type: "start_mission" as const, name: x.node.name, label: `Lancer ${x.node.name}`, confirm: `Noter « ${x.node.name} » comme mission en cours ?` })),
  };
}

export function progressAnswer(kind: ProgIntent, q: string, ctx: AiContext): AiAnswer | null {
  const p = ctx.state.profile;
  const mode = p.spoilerMode;
  const v = computeProgress({ profile: p, done: ctx.state.done });
  const cur = curOf(v);
  const acc = v.states.filter((x) => x.status === "accessible" && x.node.id !== cur?.node.id);
  const pot = v.states.filter((x) => x.status === "potentiellement accessible");
  const pnr = nextPointOfNoReturn(v);
  const miss = pendingMissables(v, collected(p));
  const base = { reliability: "recoupé" as const, topic: cur ? { kind: "mission" as const, name: cur.node.name, known: true } : null };

  switch (kind) {
    case "got_item": {
      if (!cur) return null;
      if (!miss.length) return { intent: "got_item", text: `Bien joué ! Je n'ai plus d'objet manquable documenté à cocher pour ${cur.node.name}.`, reliability: null, sources: [], actions: [], topic: base.topic };
      const acts = miss.slice(0, 3).map((m) => ({ type: "objective_done" as const, mission: cur.node.name, text: m.text, label: `J'ai : ${short(m.text)}`, confirm: `Cocher « ${short(m.text)} » comme récupéré ?` }));
      return {
        intent: "got_item",
        text: miss.length === 1 ? `Parfait ! Je coche « ${short(miss[0].text)} » ?` : `Bien joué ! Tu as récupéré lequel ? (${list(miss.map((m) => short(m.text)))})`,
        reliability: null,
        sources: [],
        actions: acts,
        topic: base.topic,
      };
    }
    case "next_start": {
      if (v.current) return { intent: "next_start", text: `Tu as terminé ${v.current.node.name} ? Je le note d'abord, puis je te dis ce qui s'ouvre.`, reliability: null, sources: [], actions: [{ type: "set_mission", name: v.current.node.name, label: `Oui, « ${v.current.node.name} » est terminée`, confirm: `Indiquer que « ${v.current.node.name} » est terminée ?` }], topic: base.topic };
      const mains = v.states.filter((x) => x.node.kind === "main" && (x.status === "accessible" || x.status === "potentiellement accessible"));
      if (!mains.length) return { intent: "next_start", text: "Je n'ai pas de mission principale documentée comme accessible maintenant : regarde l'icône de mission sur ta carte en jeu et dis-moi son nom.", reliability: null, sources: [], actions: [] };
      return {
        intent: "next_start",
        text: mains.length === 1 ? `D'après les sources, la suite accessible est ${mains[0].node.name}. Je la note en cours ?` : `Plusieurs missions sont accessibles : ${list(mains.map((x) => x.node.name))}. Laquelle tu lances ?`,
        reliability: "recoupé",
        sources: src(mains[0].node),
        actions: mains.slice(0, 3).map((x) => ({ type: "start_mission" as const, name: x.node.name, label: `Lancer ${x.node.name}`, confirm: `Noter « ${x.node.name} » comme mission en cours ?` })),
      };
    }
    case "what_now":
    case "unlocked": {
      const parts: string[] = [];
      if (cur && kind === "what_now") parts.push(`${v.current ? "Tu es sur" : "Ta prochaine mission est"} ${cur.node.name}${miss.length ? ` — ne rate pas : ${list(miss.slice(0, 2).map((m) => short(m.text)))}` : ""}.`);
      if (acc.length) parts.push(`Accessible maintenant : ${list(acc.slice(0, 4).map((x) => x.node.name + (x.node.kind !== "main" ? " (facultative)" : "")))}.`);
      if (pot.length) parts.push(`Probablement accessible aussi (à confirmer en jeu) : ${list(pot.slice(0, 3).map((x) => x.node.name))}.`);
      if (!acc.length && !pot.length) parts.push("Je n'ai pas d'autre activité documentée comme accessible pour ta progression.");
      if (pnr?.node.pointOfNoReturn) parts.push(`Garde en tête le point de non-retour ${shownName(pnr, mode) === pnr.node.name ? `de ${pnr.node.name}` : "qui arrive plus loin dans le chapitre"} : finis tes activités de Key Lento avant.`);
      return { intent: kind, text: parts.join(" "), ...base, sources: acc.length ? src(acc[0].node) : [], actions: [], replies: ["Je risque de manquer quoi ?", "Quelles missions secondaires ?"] };
    }
    case "side_list": {
      const sides = v.states.filter((x) => x.node.kind === "side");
      const open = sides.filter((x) => x.status === "accessible" || x.status === "potentiellement accessible");
      const locked = sides.filter((x) => x.status === "verrouillé");
      const gone = sides.filter((x) => x.status === "plus disponible");
      const parts = [
        open.length ? `Missions secondaires ouvertes : ${list(open.map((x) => `${x.node.name}${x.status === "potentiellement accessible" ? " (probable)" : ""}${x.node.prereq?.condition ? ` — ${x.node.prereq.condition}` : ""}`))}.` : "Aucune mission secondaire documentée comme ouverte.",
        locked.length ? `Verrouillées : ${list(locked.map((x) => `${x.node.name} (${describeLock(x, v, mode)})`))}.` : "",
        gone.length ? `Plus disponibles : ${list(gone.map((x) => x.node.name))}.` : "",
      ].filter(Boolean);
      return { intent: kind, text: parts.join(" "), ...base, sources: open[0] ? src(open[0].node) : [], actions: [] };
    }
    case "miss_risk": {
      // « je vais faire UNE mission, je risque de rater… ? » sans mission connue : on demande laquelle (flux existant)
      if (!cur && /\bmission\b/.test(nk(q))) return null;
      const deadline = v.states.filter((x) => x.node.lostAt && (x.status === "accessible" || x.status === "potentiellement accessible"));
      const parts: string[] = [];
      if (miss.length) parts.push(`Dans ${miss[0].mission} : ${list(miss.map((m) => short(m.text) + (m.locationCertain ? "" : " (emplacement incertain)")))}.`);
      if (deadline.length) parts.push(`Avec une date limite : ${list(deadline.map((x) => `${x.node.name} (jusqu'au ${x.node.lostAt!.at === "start" ? "début" : "terme"} de ${shownName(v.byId.get(x.node.lostAt!.node)!, mode)})`))}.`);
      if (pnr?.node.pointOfNoReturn) parts.push(`Point de non-retour : on y perd ${list(pnr.node.pointOfNoReturn.lose)}.`);
      if (!parts.length) parts.push("Je n'ai rien de manquable documenté pour ta progression actuelle — ce n'est pas une garantie.");
      return { intent: kind, text: parts.join(" "), ...base, sources: [], actions: [] };
    }
    case "buy_weapons": {
      const gear = v.byId.get("gear-up");
      const open = gear?.status === "terminé" || gear?.likelyDone;
      const shops = ESTABLISHMENTS.filter((e) => e.cats.includes("armurerie"));
      return {
        intent: kind,
        text: open
          ? `Oui : l'achat d'armes s'ouvre avec Gear Up${gear?.status === "terminé" ? "" : " (que tu as très probablement faite)"}. Le stock s'élargit à mesure que tu achètes des armes. À Key Lento : ${list(shops.map((e) => e.name))}.`
          : "L'achat d'armes s'ouvre avec une mission principale du début du chapitre 1 que je ne vois pas encore dans ta progression.",
        reliability: "recoupé",
        sources: (gear?.node.unlocks?.[0]?.sources ?? []).map((s) => ({ name: s.name, url: s.url, when: null })),
        actions: shops.slice(0, 1).map((e) => ({ type: "show_place" as const, estId: e.id, label: `Voir ${e.name}` })),
        topic: base.topic,
      };
    }
    case "zone_left":
    case "shops":
      return shopsAnswer(kind, q, ctx, v);
  }
}

const short = (t: string) => t.split(/[:—(]/)[0].trim().slice(0, 70);

function shopsAnswer(kind: ProgIntent, q: string, ctx: AiContext, v: ProgressView): AiAnswer {
  const n = nk(q).replace(/'/g, " ");
  const cat: EstCat | null = establishmentCategoryFromQuery(n);
  const district = /key lento/.test(n) || !/vice city|hamlet|port gellhorn|ambrosia|stockyard|grassrivers/.test(n) ? "Key Lento" : null;
  const pool = ESTABLISHMENTS.filter((e) => (!district || e.district === district) && (!cat || e.cats.includes(cat)));
  const p = ctx.state.profile;
  const stateOf = (e: Establishment) => {
    if (!e.unlock) return "ouvert dès le chapitre 1";
    const st = v.byId.get(e.unlock.node);
    return st?.status === "terminé" || st?.likelyDone ? "ouvert" : `ouvre ${e.unlock.text}`;
  };
  if (kind === "zone_left") {
    const here = v.states.filter((x) => x.node.district === (district ?? "Key Lento") && (x.status === "accessible" || x.status === "potentiellement accessible"));
    const miss = pendingMissables(v, collected(p));
    const parts = [
      here.length ? `À faire à ${district ?? "Key Lento"} : ${list(here.map((x) => x.node.name + (x.status === "potentiellement accessible" ? " (probable)" : "")))}.` : `Pas d'activité documentée encore ouverte à ${district ?? "Key Lento"}.`,
      miss.length ? `Dans ta mission : ${list(miss.map((m) => short(m.text)))}.` : "",
      `Commerces confirmés sur place : ${list(pool.slice(0, 6).map((e) => e.name))}.`,
    ].filter(Boolean);
    return { intent: "zone_left", text: parts.join(" "), reliability: "recoupé", sources: [], actions: [{ type: "show_place", query: `Magasins ${district ?? "Key Lento"}`, label: `Voir les commerces de ${district ?? "Key Lento"}` }] };
  }
  if (!pool.length)
    return { intent: "shops", text: `Je n'ai pas d'établissement ${cat ? EST_CATS[cat].label.toLowerCase() : ""} confirmé${district ? ` à ${district}` : ""} dans mon référentiel.`, reliability: null, sources: [], actions: [] };
  // V0.13 : précision de position par établissement (point / zone probable / inconnue) — jamais de zone de quartier
  const lms = (ctx.places ?? []).map((p) => ({ id: p.id, name: p.name, district: p.district, tags: p.tags ?? [], x: p.x ?? 0, y: p.y ?? 0, real: p.real ?? "" }));
  const placed = pool.map((e) => ({ e, pl: placementOf(e, lms, ctx.state.pins ?? {}) }));
  const where = (x: (typeof placed)[number]) => (x.pl.precision === "joueur" ? "placé par toi sur la carte" : x.pl.precision === "repere" ? "repère communautaire sur la carte" : x.pl.precision === "zone" ? "zone estimée sur la carte" : x.e.position?.text ? x.e.position.text : "position non établie");
  // boutiques du comté sans île précisée : signalées à part, jamais présentées comme « à Key Lento »
  const county = district === "Key Lento" && cat ? ESTABLISHMENTS.filter((e) => e.district === "Mariana County" && e.cats.includes(cat)) : [];
  const firstPlaced = placed.find((x) => x.pl.precision === "joueur") ?? placed.find((x) => x.pl.precision === "repere") ?? placed.find((x) => x.pl.precision === "zone");
  return {
    intent: "shops",
    // une ligne par établissement : nom — ce qu'on y trouve · ouverture · position (lisible d'un coup d'œil)
    text: `${cat ? EST_CATS[cat].plural : "Établissements"} confirmés${district ? ` à ${district}` : ""} :\n${placed
      .map((x) => `• ${x.e.name}${x.e.what ? ` — ${x.e.what}` : ""} · ${stateOf(x.e)} · ${where(x)}`)
      .join("\n")}${county.length ? `\nDans le comté, île non précisée par la source : ${list(county.map((e) => `${e.name}${e.what ? ` (${e.what})` : ""}`))}.` : ""}`,
    reliability: pool.every((e) => e.verification === "confirmé") ? "recoupé" : "signalé",
    sources: [...new Map(pool.flatMap((e) => e.sources.slice(0, 2)).map((s) => [s.url, s])).values()].slice(0, 5).map((s) => ({ name: s.name, url: s.url, when: null })),
    actions: [
      { type: "show_place" as const, query: `${cat ? EST_CATS[cat].plural : "Magasins"} ${district ?? ""}`.trim(), poiCat: "commerce", label: `Voir les ${pool.length} sur la carte` },
      ...(firstPlaced ? [{ type: "show_place" as const, estId: firstPlaced.e.id, label: `Voir ${firstPlaced.e.name}` }] : []),
    ],
    evidence: placed.filter((x) => x.pl.landmarkId).map((x) => `poi:${x.pl.landmarkId}`),
  };
}
