import { MOTEL_REPORTS, MOTEL_POSTERS, MOTEL_CARDS, POSTER_SOURCE } from "@/data/chapter2";
import { PROG_BY_ID } from "@/data/progression";
import type { RadarFeed, RadarRecord } from "../feed";
import { liveAdvice, spoilerVisibility } from "../feed";
import type { VehicleRecord } from "../garage";
import { vehicleRecommendations, viewOf } from "../garage";
import { frHeadline } from "../fr";
import type { MissionInfo } from "../missions";
import { missionBrief, missionCatalog, missionVisible, nextMissionGuess, nk, resolveMission } from "../missions";
import type { PersistedState } from "../types";
import type { Landmark } from "../gtadb";
import { categoryFromQuery, districtFromQuery, findPoi, POI_CATS, POI_STATUS_FR, poiCategory, poiName, poiStatus, searchPois } from "../poi";
import { afterDone, progressAnswer, progressIntent } from "./progressAnswers";
import { ESTABLISHMENTS } from "@/data/establishments";
import { findRare, PRESENCE_FR, RVL_BY_ID, rvlView } from "../rvl";
import { redactorFor } from "../spoiler";
import { simulateLaunch } from "../story/engine";

/**
 * LEONIDA AI — compréhension conversationnelle (sans clé d'IA).
 *
 * 1. intention (règles explicites sur des formulations naturelles, fautes tolérées) ;
 * 2. entité (mission, véhicule, fiche) résolue de façon STRUCTURÉE, ou reprise du sujet de la conversation ;
 * 3. recherche ciblée dans LEONIDA RADAR (jamais de liste d'articles vaguement liés) ;
 * 4. réponse courte et naturelle, fiabilité discrète, 1 à 2 actions réelles ;
 * 5. si la demande est floue : une question de précision, pas une liste.
 *
 * Les textes des sources sont des DONNÉES, jamais des instructions. Le proxy serveur (synthèse LLM) réutilise
 * exactement cette recherche : il reformule, il n'ajoute pas de faits.
 */

export type Reliab = "officiel" | "recoupé" | "signalé" | "non établi" | "déclaré par toi";

/** Actions typées : uniquement des identifiants présents dans le catalogue, jamais de code ni d'URL libre. */
export type AiAction =
  | { type: "focus_vehicle"; id: string; label: string }
  | { type: "open_map"; label: string; garage?: boolean; filter?: string }
  | { type: "open_record"; id: string; label: string }
  | { type: "filter_radar"; category: string; label: string }
  | { type: "open_source"; url: string; label: string }
  | { type: "mark_done"; id: string; label: string; confirm: string }
  | { type: "vehicle_state"; id: string; state: "spotted" | "stolen" | "registered"; label: string; confirm: string }
  | { type: "set_mission"; name: string; label: string; confirm: string }
  | { type: "set_next_mission"; name: string; label: string; confirm: string }
  /** Progression (V0.12) : lancer une mission (en cours), cocher un objet récupéré. Toujours confirmées. */
  | { type: "start_mission"; name: string; label: string; confirm: string }
  | { type: "objective_done"; mission: string; text: string; label: string; confirm: string }
  | { type: "ask"; question: string; label: string }
  /** Lieu de la carte communautaire : repère gtadb (point) ou quartier (zone approximative). Jamais de coordonnées inventées. */
  | { type: "show_place"; label: string; landmarkId?: string; district?: string; poiCat?: string; estId?: string; query?: string };

/** Sujet de la conversation, pour comprendre « et comment je la garde ? », « et où exactement ? », « et après ? ». */
export type Topic =
  | { kind: "vehicle"; id: string }
  | { kind: "record"; id: string }
  | { kind: "mission"; name: string; known: boolean }
  | { kind: "ask_mission"; then: "before" | "done" }
  | { kind: "place"; id: string };

export interface Source {
  name: string;
  url: string;
  when: string | null;
  /** Titre d'origine (souvent en anglais) : affiché uniquement dans « Sources et preuves ». */
  title?: string;
  quote?: string;
}

export interface AiAnswer {
  intent: string;
  /** Réponse naturelle, 2 à 4 phrases. */
  text: string;
  reliability: Reliab | null;
  sources: Source[];
  /** Une action principale, éventuellement une seconde. */
  actions: AiAction[];
  /** Détails à la demande (« En savoir plus »). */
  more?: string[];
  /** Réponses rapides proposées (précision, suite logique). */
  replies?: string[];
  topic?: Topic | null;
  /** Fiches et véhicules utilisés : seules preuves transmises à la synthèse serveur. */
  evidence?: string[];
}

export interface PlaceRef {
  id: string;
  name: string;
  district: string;
  /** Champs gtadb complets quand disponibles (catégories de lieux). */
  tags?: string[];
  x?: number;
  y?: number;
  real?: string;
}
const asLm = (p: PlaceRef): Landmark => ({ id: p.id, name: p.name, district: p.district, tags: p.tags ?? [], x: p.x ?? 0, y: p.y ?? 0, real: p.real ?? "" });

export interface AiContext {
  feed: RadarFeed | null;
  state: Pick<PersistedState, "profile" | "vehicles" | "done" | "pins"> & { story?: PersistedState["story"] };
  /** Centre de carte courant (coordonnées de jeu), pour « près de moi ». */
  position?: { x: number; y: number } | null;
  /** Repères gtadb chargés par la carte : permettent « voir sur la carte » sans inventer de position. */
  places?: PlaceRef[];
}

export const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[’']/g, " ");
const R: Record<string, Reliab> = { official: "officiel", confirmed: "recoupé", reported: "signalé", rumor: "non établi", personal: "déclaré par toi" };
const cleanSrc = (s: string) => s.replace(/\s*\([^)]*\)\s*$/, "");
const ago = (iso: string | null | undefined) => {
  if (!iso) return null;
  const h = (Date.now() - Date.parse(iso)) / 3600_000;
  return h < 1 ? "il y a moins d'une heure" : h < 48 ? `il y a ${Math.round(h)} h` : `il y a ${Math.round(h / 24)} j`;
};
const fmt$ = (n: number) => `${n.toLocaleString("fr-FR").replace(/[  ]/g, " ")} $`;
const solid = (rel: string) => rel === "official" || rel === "confirmed";

function recSources(r: RadarRecord): Source[] {
  return r.evidence.slice(0, 3).map((e) => ({ name: cleanSrc(e.sourceName), url: e.url, when: ago(e.publishedAt ?? r.firstSeenAt), title: e.title, quote: e.quotes?.[0] }));
}
function vehSources(v: VehicleRecord): Source[] {
  return v.evidence.slice(0, 3).map((e) => ({ name: cleanSrc(e.sourceName), url: e.url, when: ago(e.readAt ?? v.firstSeenAt), title: e.title }));
}

function glossary(feed: RadarFeed | null) {
  const cat = missionCatalog(feed);
  return { cat, g: { missions: [...cat.values()].map((m) => m.name), proper: (feed?.vehicles ?? []).map((v) => v.name.replace(/^'\d+\s*/, "")) } };
}

export function placeAction(r: RadarRecord, ctx: AiContext): AiAction | null {
  const places = ctx.places ?? [];
  if (!places.length) return null;
  const p = r.details?.place?.value;
  const cited = [p?.name, p?.district, ...(r.location?.place ?? "").split(",")].filter((x): x is string => !!x && !!x.trim()).map((x) => x.trim());
  for (const c of cited) {
    const lm = places.find((l) => norm(l.name) === norm(c));
    if (lm) return { type: "show_place", landmarkId: lm.id, label: `Voir ${lm.name} sur la carte` };
  }
  for (const c of cited) {
    const d = places.find((l) => norm(l.district.split(",")[0] ?? "") === norm(c));
    // V0.13 : plus de zone couvrant tout un quartier — la carte ouvre la liste des lieux du quartier
    if (d) return { type: "show_place", query: d.district.split(",")[0].trim(), label: `Voir les lieux de ${d.district.split(",")[0].trim()}` };
  }
  return null;
}

/** Fiches visibles pour ce joueur (anti-spoiler, statut, déjà faites exclues). */
function visible(ctx: AiContext, pred: (r: RadarRecord) => boolean): RadarRecord[] {
  const p = ctx.state.profile;
  return (ctx.feed?.items ?? []).filter((r) => r.status === "active" && !ctx.state.done[r.id] && pred(r) && spoilerVisibility(r, p.spoilerMode, p.chapter) === "visible");
}

/** Véhicule cité (nom, modèle, alias appris, « Fast & Furious »…). */
export function findVehicle(q: string, list: VehicleRecord[]): VehicleRecord | null {
  const n = norm(q);
  let best: { v: VehicleRecord; s: number } | null = null;
  for (const v of list) {
    let s = 0;
    const model = norm(v.model);
    if (model && n.includes(model)) s += 4;
    for (const tok of model.split(" ")) if (tok.length >= 4 && new RegExp(`\\b${tok}\\b`).test(n)) s += 2;
    if (v.make && n.includes(norm(v.make))) s += 1;
    for (const a of v.aliases?.value ?? []) for (const tok of a.split("-")) if (tok.length >= 4 && n.includes(tok)) s += 3;
    const blob = norm([...v.evidence.map((e) => e.title), v.location.text?.value ?? "", ...(v.aliases?.support ?? []).map((x) => x.quote)].join(" "));
    if (/fast|furious|paul walker/.test(n) && /fast|furious|paul walker/.test(blob)) s += 4;
    if (s > (best?.s ?? 2)) best = { v, s };
  }
  if (best) return best.v;
  // référentiel vérifié (Rare Vehicle Locator) : surnoms courants (« la voiture de Paul Walker », « le buggy »…)
  const rare = findRare(q);
  return rare ? list.find((v) => v.id === rare.id) ?? null : null;
}

// ── Intentions ────────────────────────────────────────────────────────────────
const RX = {
  done: /\b(viens de|vient de|j ai|jai|c est|c etait)\b.{0,12}\b(termin|fini|finir|boucl|reussi)|\bje l ai (fini|termine)|\bmission (terminee|finie)\b/,
  before: /(sur le point de|je vais|vais|m appret|j appret|je m appret|avant de|je compte|je commence|je lance|commencer|lancer|attaquer|demarrer|je suis devant|devant)\b.{0,40}|\brisque(s)? de (rater|manquer|louper)|\b(louper|rater|manquer) quelque chose|\bsans rien (rater|manquer|louper)|\bmanquable|\bprochaine mission/,
  keep: /(garder|conserver|immatricul|enregistr|la garde|le garde|la conserve|le conserve|garde-la|garder la)/,
  buy: /(achet|acquerir|payer).{0,30}(voiture|vehicule|caisse|bagnole|garage)/,
  ultimate: /ultimate|exclusi|edition/,
  weapon: /\barmes?\b|fusil|pistolet|sniper|flingue|\bgun\b/,
  money: /(gagner|argent|\$|dollars?|thune|fric|cash|planque|\d+\s?k\b|\d[\d\s.]*\s?(\$|dollars|balles))/,
  nearby: /(proche|autour|pres d|a cote|ou je suis|ma position)/,
  fun: /(sympa|m amuser|amuser|fun|cool|delire|rigoler|kiffer|stylee?|belle (voiture|caisse))/,
  vehicle: /(voiture|vehicule|caisse|bagnole|moto|bateau|fast|furious|paul walker|eclipse|penumbra)/,
  secret: /secret|easter|cache|mystere|objets? caches?/,
  where: /\b(ou exactement|c est ou|elle est ou|il est ou|ou (est|se trouve)|ou la trouver|ou le trouver|ou trouver|localis)/,
  next: /^\s*(et )?(apres|ensuite|la suite|et maintenant)\s*\??\s*$/,
  hello: /^\s*(salut|bonjour|hello|coucou|yo|hey)\b/,
  thanks: /^\s*(merci|top|super|parfait|ok|d accord|dac)\b.{0,20}$/,
  followPron: /^\s*(et\b|ca\b|cette|celle|elle\b|il\b|la\b|le\b|des objets|du loot|des recompenses|quoi d autre)/,
};

export function intentOf(q: string, topic: Topic | null = null): string {
  const n = norm(q);
  if (RX.hello.test(n) && n.length < 30) return "hello";
  if (RX.thanks.test(n)) return "thanks";
  if (RX.next.test(n)) return "next";
  if (RX.done.test(n)) return "mission_done";
  // reprises : « et comment je la garde ? », « et où exactement ? », « des objets cachés ? »
  if (topic && (RX.followPron.test(n) || n.split(" ").length <= 6)) {
    if (RX.keep.test(n) && topic.kind === "vehicle") return "keep";
    if (RX.where.test(n)) return "where";
    if (topic.kind === "mission" && /(objet|cache|recompense|loot|argent|arme|rater|manquer|louper|recuperer)/.test(n)) return "before";
  }
  if (RX.keep.test(n) && /(voiture|vehicule|caisse|bagnole|volee|vole|la |le )/.test(n)) return "keep";
  if (/(lancer|commencer|faire|attaquer|demarrer|jouer)\b.{0,30}\bmission|\bmission\b.{0,30}(lancer|commencer)|sur le point de|je suis devant|m appret|prochaine mission/.test(n)) return "before";
  if (/(risque|vais|peux).{0,25}(rater|manquer|louper)|sans rien (rater|manquer|louper)|manquable/.test(n)) return "before";
  if (RX.buy.test(n)) return "buy";
  if (RX.fun.test(n) && RX.vehicle.test(n)) return "fun";
  if (RX.ultimate.test(n)) return "ultimate";
  if (RX.weapon.test(n)) return "weapon";
  if (RX.money.test(n)) return "money";
  if (RX.nearby.test(n)) return "nearby";
  if (RX.where.test(n) && topic) return "where";
  if (RX.vehicle.test(n)) return "vehicle";
  if (RX.fun.test(n)) return "fun";
  if (RX.secret.test(n)) return "secret";
  if (/(lancer|commencer|terminer|finir|faire) /.test(n) && /[A-Z]/.test(q)) return "before";
  return "unknown";
}

const amountOf = (q: string) => {
  const m = norm(q).match(/(\d[\d\s.,]*)\s?(k|000|\$|dollars?|balles)?/);
  if (!m) return null;
  let n = Number(m[1].replace(/[\s.,]/g, ""));
  if (m[2] === "k") n *= 1000;
  return n > 0 ? n : null;
};

/** Ce qu'il est urgent de faire maintenant, toutes missions confondues (pour compléter une réponse). */
function urgentNow(ctx: AiContext) {
  const p = ctx.state.profile;
  const adv = liveAdvice(ctx.feed, { chapter: p.chapter, spoilerMode: p.spoilerMode, missionsDone: p.missionsDone }, ctx.state.done).now.filter((a) => a.urgency === "now");
  const veh = vehicleRecommendations(ctx.feed?.vehicles ?? [], ctx.state, 10).filter((x) => x.urgent);
  return { adv, veh };
}

// ── Réponses ──────────────────────────────────────────────────────────────────
const lc = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);

function vehicleAnswer(v: VehicleRecord, ctx: AiContext, focus: "where" | "keep" | "all" = "all"): AiAnswer {
  const x = viewOf(v, ctx.state);
  const topic: Topic = { kind: "vehicle", id: v.id };
  if (x.hidden)
    return { intent: "vehicle", text: "Ce véhicule est lié à un chapitre plus avancé que le tien : je préfère ne rien te dévoiler pour l'instant.", reliability: null, sources: [], actions: [], topic };
  const rv = RVL_BY_ID.get(v.id);
  const red = redactorFor(ctx.state, ctx.feed ?? null);
  const rl = rv?.locations[0];
  const rvArea = rl ? rl.area.split(", ").filter((part) => !rl.label.toLowerCase().includes(part.split(/[ (]/)[0].toLowerCase())).join(", ") : "";
  const rvx0 = rv ? rvlView(rv, ctx.state) : null;
  const rvWhere = rv && rl && rvx0
    ? `${rl.label}${rvArea ? ` (${rvArea})` : ""} : ${rl.precision === "inconnue" ? "endroit non repéré sur notre carte, donc pas d'épingle" : rvx0.location.label.charAt(0).toLowerCase() + rvx0.location.label.slice(1)}, ${PRESENCE_FR[rl.presence].toLowerCase()}.`
    : null;
  const where = rvWhere ??
    (v.location.precision === "exact"
      ? `Son emplacement est vérifié sur la carte${v.location.district ? ` (${v.location.district})` : ""}.`
      : v.location.precision === "zone"
        ? `Elle se trouve dans la zone de ${v.location.district}${v.location.zone?.widened ? " (zone élargie)" : ""} : c'est une zone de recherche, pas un point exact.`
        : v.location.text
          ? `Les guides citent un lieu que je n'ai pas encore pu placer sur la carte.`
          : "Son emplacement n'est pas encore établi par les sources.");
  const rvx = rvx0;
  const access = rvx && !x.hidden
    ? rvx.access === "now" ? `accessible maintenant pour toi, ${lc(red(rvx.condition))}.` : rvx.access === "order-pending" ? `lieu accessible, mais la commande de Moses n'est pas encore confirmée : ${lc(red(rvx.condition))}.` : `pas encore pour toi : ${lc(red(rvx.condition))}.`
    : x.now
    ? "Tu peux la récupérer dès maintenant."
    : x.access === "confirm"
      ? "Les conditions pour y accéder ne sont pas encore établies : à vérifier en jeu."
      : x.access === "later"
        ? `Elle sera accessible plus tard (chapitre ${x.need}).`
        : x.access === "expired"
          ? "La fenêtre pour la récupérer est dépassée pour ta progression."
          : x.compat === "ultimate-only"
            ? "Elle est réservée à l'édition Ultimate : pas récupérable avec ton édition."
            : x.compat === "preorder" || x.compat === "preorder-no"
              ? "C'est un bonus de précommande : indique dans Profil si tu y as droit."
              : "Sa compatibilité avec ton édition reste à vérifier.";
  const keep = rv
    ? rv.keep.possible === "oui" ? `Pour la garder : ${lc(rv.keep.how.split(". ")[0].replace(/\.$/, ""))}${rv.keep.chapterMin ? `, dès le chapitre ${rv.keep.chapterMin}${ctx.state.profile.chapter < rv.keep.chapterMin ? " (avant, tu peux la perdre)" : ""}` : ""}.` : `Les sources ne disent pas si on peut la garder.`
    : v.keep.mode === "yes"
      ? "Elle t'est remise d'office : rien à faire pour la garder."
      : v.keep.rule
        ? `Pour la garder, il faudra l'immatriculer${v.keep.rule.where ? ` (${v.keep.rule.where})` : ""}, possible dès le chapitre ${v.keep.rule.chapter}${ctx.state.profile.chapter < v.keep.rule.chapter ? " : avant cela, une voiture volée peut être perdue" : ""}.`
        : "Les sources ne disent pas encore comment la conserver.";
  const extras = [v.access.alarm?.value ? "Une alarme se déclenche : prévois de t'éloigner vite." : "", v.access.keyCloner?.value ? "Il faut un cloneur de clé." : ""].filter(Boolean);
  const text =
    focus === "keep"
      ? `${keep}${v.keep.rule && ctx.state.profile.chapter >= v.keep.rule.chapter ? " Tu y as déjà accès." : ""}`
      : focus === "where"
        ? `${where}${v.location.text ? " Les guides la décrivent précisément : le détail est dans « Sources et preuves »." : ""}`
        : `${v.name} : ${access.charAt(0).toLowerCase()}${access.slice(1)} ${where} ${keep}`;
  const actions: AiAction[] = [];
  if (rl?.precision === "inconnue") actions.push({ type: "focus_vehicle", id: v.id, label: `Ouvrir la fiche ${v.model || v.name}` });
  else if (v.location.precision === "zone" || v.location.precision === "exact") actions.push({ type: "focus_vehicle", id: v.id, label: v.location.precision === "zone" ? "Voir la zone sur la carte" : "Voir sur la carte" });
  else actions.push({ type: "focus_vehicle", id: v.id, label: `Ouvrir la fiche ${v.model || v.name}` });
  const owned = ctx.state.vehicles[v.id]?.state;
  if (!owned && x.access !== "excluded" && focus !== "keep") actions.push({ type: "vehicle_state", id: v.id, state: "spotted", label: "Je l'ai trouvée", confirm: `Marquer « ${v.name} » comme repérée ?` });
  if (focus === "keep" && owned && owned !== "registered") actions.unshift({ type: "vehicle_state", id: v.id, state: "registered", label: "Je l'ai immatriculée", confirm: `Indiquer que « ${v.name} » est immatriculée ?` });
  return {
    intent: focus === "keep" ? "keep" : focus === "where" ? "where" : "vehicle",
    text: text.replace(/\s+/g, " ").trim(),
    reliability: rvx ? (rvx.trust === "Vérifié" ? R.confirmed : rvx.trust === "Probable" ? R.reported : R.rumor) : R[v.reliability],
    sources: rv ? rv.evidence.filter((e, i, a) => e.url && a.findIndex((o) => o.url === e.url) === i).slice(0, 4).map((e) => ({ name: e.creator, url: e.url!, when: e.publishedAt })) : vehSources(v),
    actions: actions.slice(0, 2),
    more: [...extras, focus !== "all" ? access.charAt(0).toUpperCase() + access.slice(1) : "", ...(rl ? rl.steps.slice(0, 2).map(red) : []), v.location.text ? `Description du lieu (en anglais) : « ${v.location.text.value} »` : ""].filter(Boolean),
    replies: focus === "all" ? ["Et comment je la garde ?", "Et où exactement ?"] : focus === "where" ? ["Et comment je la garde ?"] : ["Et où exactement ?"],
    topic,
    evidence: [v.id],
  };
}

function missionTopicAnswer(ctx: AiContext, mission: MissionInfo | null, rawName: string, opts: { items?: boolean } = {}): AiAnswer {
  const p = ctx.state.profile;
  const name = mission?.name ?? rawName;
  const topic: Topic = { kind: "mission", name, known: !!mission };
  const { g } = glossary(ctx.feed);
  // une mission du chapitre suivant reste traitable (c'est souvent elle qu'on s'apprête à lancer) ; au-delà, on se tait
  const aboveChapter = mission?.chapter != null && mission.chapter > p.chapter + 1;
  const brief = missionBrief(ctx.feed, name, { chapter: p.chapter, spoilerMode: p.spoilerMode, done: ctx.state.done });
  const urgent = urgentNow(ctx);
  const isNext = p.nextMission && nk(p.nextMission) === nk(name);
  const setNext: AiAction[] = isNext ? [] : [{ type: "set_next_mission", name, label: "C'est ma prochaine mission", confirm: `Enregistrer « ${name} » comme prochaine mission ?` }];
  const sources = [...brief.before, ...brief.during].slice(0, 3).flatMap(recSources).slice(0, 3);
  const evidence = [...brief.before, ...brief.during].map((r) => r.id);

  // V0.17 : le référentiel Story Intelligence répond d'abord (mêmes règles que l'Accueil)
  const story = storyBefore(ctx, rawName, { short: !!brief.before[0] });
  if (story) {
    // les fiches de la veille sur cette mission restent citées (preuves transmises à la synthèse)
    const feedFirst = brief.before[0] ?? brief.during[0];
    const feedAct = feedFirst ? placeAction(feedFirst, ctx) ?? { type: "open_record" as const, id: feedFirst.id, label: `Voir : ${frHeadline(feedFirst, g)}`.slice(0, 48) } : null;
    return {
      ...story,
      text: [story.text, brief.before[0] ? beforeSentence(brief.before[0], name) : ""].filter(Boolean).join(" "),
      sources: [...sources, ...story.sources].filter((x, i, a) => a.findIndex((y) => y.url === x.url) === i).slice(0, 5),
      actions: [...(feedAct ? [feedAct] : []), ...setNext].slice(0, 2),
      topic,
      evidence: [...evidence, ...(brief.guide ? [brief.guide.id] : [])],
    };
  }
  if (!mission) {
    const other = urgent.adv[0];
    return {
      intent: "before",
      text: `Tu vas lancer « ${name} » ? 🎯 Je n'ai encore aucun guide fiable sur cette mission : je ne peux donc confirmer ni récompense ni objet manquable. Tu peux poursuivre, sans garantie que tout ait été recensé.${other ? ` À part ça, ${lowerFirst(reminder(other.r, g))}` : ""}`,
      reliability: null,
      sources: other ? recSources(other.r).slice(0, 2) : [],
      actions: [...setNext, ...(other ? [{ type: "open_record" as const, id: other.r.id, label: "Voir ce qu'il faut faire avant" }] : [])].slice(0, 2),
      topic,
      evidence: other ? [other.r.id] : [],
    };
  }
  if (aboveChapter && p.spoilerMode === "strict") {
    return {
      intent: "before",
      text: `Les sources rattachent « ${name} » au chapitre ${mission.chapter}, plus loin que ta progression indiquée (chapitre ${p.chapter}). Mets ton chapitre à jour dans Profil et je te dirai ce qu'il faut savoir, sans rien te dévoiler d'autre.`,
      reliability: null,
      sources: [],
      actions: [],
      topic,
    };
  }
  const parts: string[] = [];
  if (brief.before.length) parts.push(beforeSentence(brief.before[0], name));
  if (brief.during.length) {
    const d = brief.during[0];
    parts.push(`Pendant la mission, tu peux récupérer ${d.conditions.reward ?? "un bonus"}${d.details?.place ? ` à ${d.details.place.value.name}` : ""}${brief.during.length > 1 ? `, et ${brief.during.length - 1} autre${brief.during.length > 2 ? "s" : ""} élément${brief.during.length > 2 ? "s" : ""}` : ""}.`);
  }
  if (!parts.length) {
    parts.push(
      brief.guide
        ? `Un guide décrit « ${name} », mais aucune récompense particulière ni oubli possible n'y est confirmé pour l'instant. Tu peux la lancer ; je ne peux simplement pas garantir que tout ait été recensé.`
        : `Je n'ai pas encore de guide fiable pour « ${name} » : aucune récompense ni aucun oubli possible n'est confirmé pour le moment. Tu peux la lancer, sans garantie que tout ait été recensé.`,
    );
    const u = urgent.adv.find((a) => !brief.before.includes(a.r));
    if (u && !opts.items) parts.push(`À part ça, ${lowerFirst(reminder(u.r, g))}`);
  }
  const actions: AiAction[] = [];
  const first = brief.before[0] ?? brief.during[0];
  if (first) actions.push(placeAction(first, ctx) ?? { type: "open_record", id: first.id, label: `Voir : ${frHeadline(first, g)}`.slice(0, 48) });
  else if (brief.guide) actions.push({ type: "open_record", id: brief.guide.id, label: "Voir le guide de la mission" });
  actions.push(...setNext);
  return {
    intent: "before",
    text: parts.join(" "),
    reliability: first ? R[first.reliability] : null,
    sources: sources.length ? sources : brief.guide ? recSources(brief.guide).slice(0, 1) : [],
    actions: actions.slice(0, 2),
    more: [...brief.before.slice(1), ...brief.during.slice(1)].map((r) => frHeadline(r, g)),
    replies: ["Et si je veux une voiture sympa avant ?", "Et après ?"],
    topic,
    evidence: [...evidence, ...(brief.guide ? [brief.guide.id] : [])],
  };
}

/** « Je vais lancer X » à partir de la simulation Story Intelligence (anti-spoiler et couverture inclus). */
function storyBefore(ctx: AiContext, name: string, opts: { short?: boolean } = {}): AiAnswer | null {
  const sim = simulateLaunch(ctx.state, name);
  if (!sim) return null;
  const crit = [...sim.money, ...sim.disappears].filter((l) => l.tier === "Critique" || l.tier === "Fortement recommandé" || !l.tier);
  const during = sim.during[0];
  if (!crit.length && !during && !sim.choices.length) return null;
  const parts: string[] = [];
  const first = crit[0];
  const lead = first ? `${first.text}${first.confidence === "Contesté" ? " (sources divergentes)" : ""}` : "";
  if (sim.pointOfNoReturn) parts.push(lead ? `« ${sim.name} » est un point de non-retour : ${lead.charAt(0).toLowerCase()}${lead.slice(1)}` : `« ${sim.name} » est un point de non-retour.`);
  else if (lead) parts.push(lead);
  // montant : dans le texte seulement s'il est calculé à partir de ce que le joueur a indiqué
  if (first?.money && !/inconnu/.test(first.money)) parts.push(first.money);
  const gone = sim.disappears.filter((l) => / ne sera plus disponible$/.test(l.text)).map((l) => l.text.replace(/ \(facultative\) ne sera plus disponible$| ne sera plus disponible$/, ""));
  if (gone.length && !opts.short) parts.push(`Disparaît au lancement : ${gone.join(", ")}.`);
  if (during) parts.push(`Pendant la mission : ${during.text.charAt(0).toLowerCase()}${during.text.slice(1)}.`);
  if (sim.choices[0]) parts.push(sim.choices[0].text);
  if (sim.coverage !== "auditée") parts.push("Audit partiel : je ne garantis pas que tout soit recensé.");
  const srcs = [...crit, during, ...sim.choices].filter(Boolean).flatMap((l) => l!.sources).filter((x, i, a) => a.findIndex((y) => y.url === x.url) === i).slice(0, 4);
  const conf = first?.confidence ?? during?.confidence;
  return {
    intent: "before",
    text: parts.join(" "),
    reliability: conf === "Vérifié" ? "recoupé" : conf === "Probable" ? "signalé" : "non établi",
    sources: srcs.map((x) => ({ name: x.name, url: x.url, when: null })),
    actions: [],
    more: [...(first?.money && /inconnu/.test(first.money) ? [first.money] : []), ...(opts.short && gone.length ? [`Disparaît au lancement : ${gone.join(", ")}.`] : []), ...crit.slice(1).map((l) => l.text), ...sim.during.slice(1).map((l) => l.text)].slice(0, 8),
    replies: ["Et après ?", "Qu'est-ce qui n'est pas vérifié ?"],
  };
}

const lowerFirst = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);
const nSrc = (n: number) => (n > 1 ? `${n} sources` : "une source");

/** « Avant de lancer X, pense à… » — fondé sur les preuves du champ « disparaît au lancement de ». */
function beforeSentence(r: RadarRecord, mission: string): string {
  const cm = r.details?.contextMissable;
  const subject = cm?.value.subject;
  const where = r.details?.place?.value.name;
  return `Avant de lancer « ${mission} », pense à ${subject ? `la mission « ${subject} »` : "ceci"} : d'après ${nSrc(cm?.support.length ?? 1)}, elle disparaît au lancement de « ${mission} ».${r.conditions.reward ? ` Elle permet de récupérer ${r.conditions.reward}${where ? ` (${where})` : ""}.` : ""}${r.details?.missable?.value === false ? " La source précise toutefois qu'on ne rate rien d'essentiel en la sautant." : ""}`;
}

/** Rappel court d'une chose à faire avant de continuer (hors mission demandée). */
function reminder(r: RadarRecord, g: { missions: string[]; proper: string[] }): string {
  const cm = r.details?.contextMissable?.value;
  if (cm?.subject && cm.until) return `Pense à « ${cm.subject} » avant « ${cm.until} »${r.conditions.reward ? ` : elle rapporte ${r.conditions.reward}${r.details?.place ? ` (${r.details.place.value.name})` : ""}` : ""}.`;
  return `Une chose reste à faire avant de continuer : ${frHeadline(r, g)}.`;
}

function askMission(ctx: AiContext, then: "before" | "done", candidates: MissionInfo[] = []): AiAnswer {
  const { cat } = glossary(ctx.feed);
  const p = ctx.state.profile;
  const guess = p.chapter !== 2 && p.lastMission ? nextMissionGuess(cat, p.lastMission) : null;
  const options = candidates.length ? candidates.map((c) => c.name) : [p.nextMission, guess?.mission.name].filter((x): x is string => !!x);
  return {
    intent: then === "before" ? "ask_mission" : "ask_mission_done",
    text: candidates.length
      ? `Tu parles de quelle mission ? Je connais ${candidates.length === 1 ? `« ${candidates[0].name} »` : candidates.map((c) => `« ${c.name} »`).join(" ou ")} pour l'instant.`
      : then === "before"
        ? "De quelle mission s'agit-il ? Donne-moi son nom (en anglais, comme dans le jeu) et je vérifie ce qu'il ne faut pas rater."
        : "Quelle mission viens-tu de terminer ? Donne-moi son nom et je mets ta progression à jour.",
    reliability: null,
    sources: [],
    actions: [],
    replies: options.slice(0, 3).map((o) => (then === "before" ? `Je vais lancer ${o}` : `J'ai terminé ${o}`)),
    topic: { kind: "ask_mission", then },
  };
}

export function answer(question: string, ctx: AiContext, topic: Topic | null = null): AiAnswer {
  const q = question.trim().slice(0, 2000);
  const p = ctx.state.profile;
  if (p.chapter === 2) {
    const reports = MOTEL_REPORTS.filter((r) => r.pattern.test(nk(q)));
    if (reports.length) {
      const actions: AiAction[] = [];
      const lines = reports.map((r) => {
        const name = PROG_BY_ID.get(r.id)!.name;
        if (![...p.missionsDone, p.lastMission].includes(name)) {
          if (r.id === "ambulance-chaser") actions.push({ type: "set_mission", name, label: `Confirmer « ${name} » terminée`, confirm: `Enregistrer « ${name} » comme terminée ?` });
          else actions.push({ type: "start_mission", name, label: `Mon objectif actuel est « ${name} »`, confirm: `Confirmer que « ${name} » est en cours ?` });
        }
        if (r.id === "just-moved-in") return `Cela correspond à « ${name} ». As-tu rapporté les provisions dans la chambre ? Confirme la fin seulement si ton jeu l’indique.`;
        if (r.id === "overnight-charges") return `La conversation pourrait correspondre à « ${name} ». Quel objectif vois-tu à l’écran ?`;
        return `La tâche de l’ambulance correspond à « ${name} ».`;
      });
      return { intent: "motel_report", text: lines.join(" "), actions, sources: [], reliability: "signalé" };
    }
    if (/manqu|avant de continuer|debut.{0,12}chapitre 2|commenc.{0,20}chapitre 2|dois faire|aller maintenant/.test(nk(q)) && !p.nextMission) {
      return { intent: "motel_advice", text: `Si tu es au Starlet Motel, regarde les objectifs actifs sur la carte. ${MOTEL_CARDS} ${MOTEL_POSTERS}`, reliability: "signalé", actions: [], sources: [{ name: "The Games Wiki", url: "https://thegameswiki.com/gta6/wiki/missable-content-and-points-of-no-return", when: null }, { name: "Windows Central", url: POSTER_SOURCE, when: null }] };
    }
  }
  const vehicles = ctx.feed?.vehicles ?? [];
  if (!ctx.feed)
    return { intent: "offline", text: "Je n'ai pas encore les données de la veille. Reconnecte-toi : je ne réponds qu'à partir des fiches vérifiées, jamais de mémoire.", reliability: null, sources: [], actions: [] };
  const { cat, g } = glossary(ctx.feed);
  const opts = { chapter: p.chapter, spoilerMode: p.spoilerMode };

  // réponse à une question de précision (« Quelle mission ? » → « Down to Earth »)
  if (topic?.kind === "ask_mission") {
    const m = resolveMission(q, cat, opts);
    const raw = m.raw ?? (q.split(" ").length <= 6 && /[A-Za-z]/.test(q) ? q.replace(/[?.!]+$/, "").trim() : null);
    if (m.mission || raw) return topic.then === "before" ? missionTopicAnswer(ctx, m.mission, m.mission?.name ?? raw!) : doneAnswer(ctx, m.mission?.name ?? raw!);
  }

  const intent = intentOf(q, topic);
  // Progression (V0.12) : « je fais quoi maintenant ? », « je l'ai », « la suivante », boutiques… (avant les intentions génériques)
  const pi = progressIntent(q);
  if (pi && intent !== "mission_done" && !(pi === "shops" && findPoi(q, (ctx.places ?? []).map(asLm), null))) {
    const pa = progressAnswer(pi, q, ctx);
    if (pa) return pa;
  }
  const vMentioned = findVehicle(q, vehicles);
  // Lieux de la carte (repères gtadb) : nom cité, ou catégorie + quartier (« les commerces de Key Lento »)
  if (ctx.places?.length && !["weapon", "money", "mission_done", "keep", "ultimate"].includes(intent) && !vMentioned) {
    const lms = ctx.places.map(asLm);
    const district = districtFromQuery(q, lms);
    const cat = categoryFromQuery(q);
    const named = findPoi(q, lms, district);
    if (named && (intent === "unknown" || intent === "where" || /\b(ou|où|trouver|montre|aller|c est ou)\b/i.test(q))) return poiAnswer(named, district);
    if (cat && (district || /\b(ou|où|montre|trouver|voir|y a)\b/i.test(q)) && intent !== "before") {
      const list = searchPois(`${POI_CATS[cat].plural} ${district ?? ""}`, lms, 6).filter((l) => poiCategory(l) === cat && l.name !== "Lieu non identifié");
      if (list.length)
        return {
          intent: "poi",
          text: `${list.length > 1 ? `Sur la carte communautaire, je vois ${list.length} ${POI_CATS[cat].plural.toLowerCase()}` : `Sur la carte communautaire, je vois un lieu de ce type`}${district ? ` à ${district}` : ""} : ${list.slice(0, 3).map((l) => poiName(l)).join(", ")}${list.length > 3 ? "…" : ""}. Ce sont des repères communautaires : rien ne garantit encore qu'ils soient ouverts ou utilisables en jeu.`,
          reliability: "non établi",
          sources: [{ name: "gtadb.org (carte communautaire)", url: "https://map.gtadb.org", when: null }],
          actions: [district ? { type: "show_place", query: `${POI_CATS[cat].plural} ${district}`, poiCat: cat, label: `Voir les ${POI_CATS[cat].plural.toLowerCase()} sur la carte` } : { type: "show_place", landmarkId: list[0].id, label: `Voir ${poiName(list[0])} sur la carte` }],
          topic: { kind: "place", id: list[0].id },
          evidence: list.slice(0, 5).map((l) => `poi:${l.id}`),
        };
    }
  }
  const topicVehicle = topic?.kind === "vehicle" ? vehicles.find((v) => v.id === topic.id) ?? null : null;

  switch (intent) {
    case "hello": {
      const who = p.pseudo && p.pseudo !== "Joueur" ? ` ${p.pseudo}` : "";
      const next = p.nextMission ? (p.missionInProgress ? ` Toujours dans « ${p.nextMission} » ?` : ` Prochaine étape : « ${p.nextMission} ».`) : "";
      return { intent, text: `Salut${who} !${next} Dis-moi ce que tu cherches : une voiture, une arme, de l'argent, un magasin…`, reliability: null, sources: [], actions: [], replies: starters(ctx).slice(0, 2) };
    }
    case "thanks":
      return { intent, text: "Avec plaisir ! Bonne session à Leonida 🌴", reliability: null, sources: [], actions: [] };
    case "mission_done": {
      const m = resolveMission(q, cat, opts);
      if (m.mission || m.raw) return doneAnswer(ctx, m.mission?.name ?? m.raw!);
      if (topic?.kind === "mission") return doneAnswer(ctx, topic.name);
      // « J'ai terminé » sans nom : la mission en cours (ou prévue) du joueur, toujours à confirmer
      if (p.nextMission && !m.candidates?.length) return doneAnswer(ctx, p.nextMission);
      return askMission(ctx, "done", m.candidates);
    }
    case "before": {
      const m = resolveMission(q, cat, opts);
      if (m.mission) return missionTopicAnswer(ctx, m.mission, m.mission.name, { items: /objet|cache/.test(norm(q)) });
      if (m.candidates.length) return askMission(ctx, "before", m.candidates);
      if (m.raw) return missionTopicAnswer(ctx, null, m.raw);
      if (topic?.kind === "mission") return missionTopicAnswer(ctx, cat.get(nk(topic.name).replace(/'/g, "")) ?? null, topic.name, { items: true });
      if (p.nextMission) {
        const mm = resolveMission(p.nextMission, cat, opts);
        return missionTopicAnswer(ctx, mm.mission, mm.mission?.name ?? p.nextMission);
      }
      return askMission(ctx, "before");
    }
    case "keep": {
      const v = vMentioned ?? topicVehicle;
      if (v) return vehicleAnswer(v, ctx, "keep");
      const regs = ctx.feed.mechanics?.register?.length
        ? ctx.feed.mechanics.register
        : vehicles.flatMap((x) => (x.keep.rule ? [{ chapter: x.keep.rule.chapter, where: x.keep.rule.where, tracker: x.keep.rule.tracker, source: x.keep.rule.source }] : []));
      const none = regs.find((r) => (r.tracker ?? "none") === "none" && r.where === "garage de Moses") ?? regs.find((r) => r.tracker == null);
      if (!none) return { intent, text: "Les sources collectées n'expliquent pas encore comment conserver un véhicule volé. Je préfère ne pas improviser.", reliability: "non établi", sources: [], actions: [] };
      const src = regs.filter((r) => r.source).slice(0, 2).map((r) => ({ name: cleanSrc(r.source.sourceName), url: r.source.url, when: null, quote: r.source.quote }));
      return {
        intent,
        text: `Voler une voiture ne la rend pas tienne : il faut l'immatriculer, ${none.where ? `au ${none.where}` : "chez un spécialiste"}, possible dès le chapitre ${none.chapter}. ${p.chapter < none.chapter ? `Tu es au chapitre ${p.chapter} : d'ici là, une voiture volée peut être perdue.` : "Tu y as déjà accès."}`,
        reliability: src.length >= 2 ? "recoupé" : "signalé",
        sources: src,
        actions: [{ type: "open_map", garage: true, filter: "now", label: "Voitures accessibles maintenant" }],
        more: ["Traqueur avancé : méthode pas encore documentée par les sources."],
      };
    }
    case "where": {
      if (topicVehicle) return vehicleAnswer(topicVehicle, ctx, "where");
      if (topic?.kind === "record") {
        const r = ctx.feed.items.find((x) => x.id === topic.id);
        if (r) {
          const pa = placeAction(r, ctx);
          return { intent, text: r.details?.place ? `Le lieu cité est ${r.details.place.value.name}${r.details.place.value.district ? `, dans le quartier ${r.details.place.value.district}` : ""}. ${pa ? "Je peux te le montrer sur la carte communautaire (repère approximatif)." : "Je n'ai pas de point vérifié sur la carte pour ce lieu."}` : "Les sources ne précisent pas d'emplacement exact pour celle-ci.", reliability: R[r.reliability], sources: recSources(r), actions: pa ? [pa] : [], topic, evidence: [r.id] };
        }
      }
      if (topic?.kind === "place" && ctx.places?.length) {
        const l = ctx.places.find((x) => x.id === topic.id);
        if (l) return poiAnswer(asLm(l), null);
      }
      if (topic?.kind === "mission") return { intent, text: `Je n'ai pas d'emplacement documenté pour le départ de « ${topic.name} ». Dans le jeu, la carte de l'histoire indique son point de départ.`, reliability: null, sources: [], actions: [], topic };
      break;
    }
    case "next": {
      if (topic?.kind === "mission") {
        if (p.chapter === 2) return progressAnswer("next_start", q, ctx)!;
        const guess = nextMissionGuess(cat, topic.name);
        return guess && missionVisible(guess.mission, p.chapter, p.spoilerMode)
          ? { intent, text: `Ensuite, ce serait probablement « ${guess.mission.name} », ${guess.basis} : à confirmer dans le jeu.`, reliability: "signalé", sources: [], actions: [{ type: "set_next_mission", name: guess.mission.name, label: `Enregistrer ${guess.mission.name}`, confirm: `Enregistrer « ${guess.mission.name} » comme prochaine mission ?` }], replies: [`Je vais lancer ${guess.mission.name}`], topic }
          : { intent, text: "Je ne connais pas l'ordre des missions de façon fiable après celle-ci. Quand tu sauras laquelle arrive, dis-le-moi et je vérifie ce qu'il ne faut pas rater.", reliability: null, sources: [], actions: [], topic };
      }
      if (topicVehicle) return vehicleAnswer(topicVehicle, ctx, "keep");
      return answer("Je vais lancer ma prochaine mission", ctx, null);
    }
    case "fun":
    case "vehicle":
    case "ultimate": {
      if (vMentioned && intent !== "ultimate") return vehicleAnswer(vMentioned, ctx);
      const all = vehicles.map((v) => viewOf(v, ctx.state)).filter((x) => !x.hidden);
      if (intent === "ultimate" && p.edition !== "ultimate") {
        const n = all.filter((x) => x.v.edition.exclusive === "ultimate" && x.v.edition.status === "confirmed").length;
        return { intent, text: p.edition === "standard" ? `Avec l'édition Standard, les exclusivités Ultimate ne te sont pas accessibles${n ? ` (${n} sont recoupées par plusieurs sources)` : ""}. Je ne te recommande donc que ce que ton édition permet.` : "Indique ton édition dans Profil : je ne compte une exclusivité que si elle est établie par les sources.", reliability: null, sources: [], actions: [{ type: "open_map", garage: true, filter: "ultimate", label: "Voir les exclusivités" }] };
      }
      const pool = all
        .filter((x) => x.now && (!x.owned || x.owned === "spotted") && (intent !== "ultimate" || (x.v.edition.exclusive === "ultimate" && x.v.edition.status === "confirmed")))
        .sort((a, b) => Number(!!b.v.media) - Number(!!a.v.media) || Number(b.urgent) - Number(a.urgent) || Number(solid(b.v.reliability)) - Number(solid(a.v.reliability)));
      if (!pool.length)
        return { intent, text: intent === "ultimate" ? "Aucune exclusivité Ultimate établie n'est récupérable à ton chapitre pour l'instant." : "Je n'ai pas de véhicule accessible maintenant pour ta progression dont les conditions sont établies. D'autres existent, mais leur accès reste à confirmer.", reliability: null, sources: [], actions: [{ type: "open_map", garage: true, label: "Voir les voitures cachées" }] };
      const pick = pool.slice(0, 2);
      const desc = (x: (typeof pick)[number]) => `la ${x.v.name}${x.v.location.district ? ` (zone de ${x.v.location.district})` : ""}${x.urgent ? `, à récupérer avant la fin du chapitre ${x.v.access.until?.value}` : ""}`;
      return {
        intent,
        text: `${intent === "fun" ? "Bonne idée avant de continuer ! " : ""}${pick.length === 2 ? `Je te propose ${desc(pick[0])} ou ${desc(pick[1])}.` : `Je te propose ${desc(pick[0])}.`} ${pick.length === 2 ? "Les deux sont accessibles" : "Elle est accessible"} maintenant avec ton édition.`,
        reliability: pick.every((x) => solid(x.v.reliability)) ? "recoupé" : "signalé",
        sources: pick.flatMap((x) => vehSources(x.v)).slice(0, 3),
        actions: pick.map((x) => ({ type: "focus_vehicle" as const, id: x.v.id, label: x.v.model ? `${x.v.make} ${x.v.model}`.trim() : x.v.name })),
        replies: ["Et comment je la garde ?"],
        topic: { kind: "vehicle", id: pick[0].v.id },
        evidence: pick.map((x) => x.v.id),
      };
    }
    case "weapon": {
      const askFree = /gratuit|free|sans payer/.test(norm(q));
      const list = visible(ctx, (r) => r.category === "weapon" || /\b(weapon|rifle|sniper|gun|pistol|shotgun)\b/i.test(r.title)).filter((r) => {
        const ch = r.details?.chapter?.value;
        return ch == null || ch <= p.chapter;
      });
      const isFree = (r: RadarRecord) => /\bfree\b/i.test(r.title) || r.evidence.some((e) => (e.quotes ?? []).some((qq) => /\bfree\b/i.test(qq)));
      const ranked = list.sort((a, b) => Number(isFree(b)) - Number(isFree(a)) || Number(!!b.details?.place) - Number(!!a.details?.place) || Number(solid(b.reliability)) - Number(solid(a.reliability)));
      const top = ranked[0];
      if (!top) return { intent, text: `Je n'ai aucune arme documentée pour ton chapitre dans les sources fiables${askFree ? ", gratuite ou non" : ""}.`, reliability: "non établi", sources: [], actions: [] };
      const free = isFree(top);
      const place = top.details?.place ? `${top.details.place.value.name}${top.details.place.value.district ? ` (${top.details.place.value.district})` : ""}` : null;
      const head = frHeadline(top, g);
      const text = askFree && !free
        ? `Je n'ai aucune source qui confirme une arme gratuite à ton chapitre. La piste la mieux documentée : ${head}${place ? `, à ${place}` : ""} — sa gratuité n'est pas établie.`
        : `${free ? "D'après " + (solid(top.reliability) ? "plusieurs sources" : "une source") + ", tu peux récupérer gratuitement" : "La piste la mieux documentée :"} ${head.replace(/^Le /, "le ").replace(/ gratuit tôt dans le jeu.*$/, "")}${place ? `, à ${place}` : ""}.${top.details?.chapter ? ` Accessible au chapitre ${top.details.chapter.value}.` : ""}${top.reliability === "reported" ? " Une seule source le signale : vérifie en jeu." : ""}`;
      const pa = placeAction(top, ctx);
      return {
        intent,
        text,
        reliability: R[top.reliability],
        sources: recSources(top),
        actions: [pa ?? { type: "open_record", id: top.id, label: "Voir la fiche de l'arme" }, { type: "mark_done", id: top.id, label: "C'est fait", confirm: `Marquer « ${head} » comme fait ?` }],
        more: ranked.slice(1, 3).map((r) => `${frHeadline(r, g)} (${R[r.reliability]})`),
        topic: { kind: "record", id: top.id },
        evidence: [top.id],
      };
    }
    case "money": {
      const target = amountOf(q);
      const list = visible(ctx, (r) => !!r.details?.money && r.category !== "news" && !/\b(subscription|gta\+|price|preorder)\b/i.test(r.title)).filter((r) => (r.details?.chapter?.value ?? 0) <= p.chapter);
      const ranked = list.sort((a, b) => Number(solid(b.reliability)) - Number(solid(a.reliability)) || (b.conditions.money ?? 0) - (a.conditions.money ?? 0));
      if (!ranked.length) return { intent, text: "Je n'ai pas de source d'argent documentée pour ton chapitre.", reliability: "non établi", sources: [], actions: [] };
      const pick: RadarRecord[] = [];
      let sum = 0;
      for (const r of ranked) {
        if ((target && sum >= target) || pick.length >= 3) break;
        pick.push(r);
        sum += r.conditions.money ?? 0;
      }
      const top = pick[0];
      const label = (r: RadarRecord) => `${r.conditions.reward ?? fmt$(r.conditions.money ?? 0)}${r.details?.place ? ` à ${r.details.place.value.name}` : ""}`;
      return {
        intent,
        text: `${target ? (sum >= target ? `Pour tes ${fmt$(target)}, le plus sûr : ` : `Je trouve environ ${fmt$(sum)}, un peu moins que tes ${fmt$(target)}. Le plus sûr : `) : "Le plus sûr : "}${label(top)}${pick.length > 1 ? `, puis ${pick.slice(1).map(label).join(" et ")}` : ""}.${pick.some((r) => r.reliability === "reported") ? " Certaines sommes ne sont signalées que par une source." : ""}`,
        reliability: pick.every((r) => solid(r.reliability)) ? "recoupé" : "signalé",
        sources: pick.flatMap(recSources).slice(0, 3),
        actions: [placeAction(top, ctx) ?? { type: "open_record", id: top.id, label: `Voir ${top.details?.place?.value.name ?? "la planque"}` }, { type: "mark_done", id: top.id, label: "C'est fait", confirm: `Marquer « ${frHeadline(top, g)} » comme fait ?` }],
        topic: { kind: "record", id: top.id },
        evidence: pick.map((r) => r.id),
      };
    }
    case "nearby": {
      const pos = ctx.position;
      if (!pos) return { intent, text: "Je ne lis pas ta position dans le jeu. Ouvre la carte, centre-la là où tu es, puis repose-moi la question.", reliability: null, sources: [], actions: [{ type: "open_map", label: "Ouvrir la carte" }] };
      const dist = (x: number, y: number) => Math.hypot(x - pos.x, y - pos.y);
      const cands: Array<{ d: number; label: string; action: AiAction }> = [];
      for (const r of visible(ctx, (r) => !!r.location.zone && r.category !== "news")) cands.push({ d: dist(r.location.zone!.x, r.location.zone!.y), label: frHeadline(r, g), action: { type: "open_record", id: r.id, label: `Voir ${r.details?.place?.value.name ?? "la fiche"}` } });
      for (const v of vehicles) {
        const x = viewOf(v, ctx.state);
        const c = v.location.point ?? v.location.zone;
        if (c && !x.hidden && x.access !== "excluded") cands.push({ d: dist(c.x, c.y), label: v.name, action: { type: "focus_vehicle", id: v.id, label: `Voir ${v.model || v.name}` } });
      }
      const near = cands.sort((a, b) => a.d - b.d).slice(0, 2);
      if (!near.length) return { intent, text: "Je n'ai rien de localisé près du centre de ta carte.", reliability: null, sources: [], actions: [] };
      return { intent, text: `Près du centre de ta carte : ${near.map((c) => `${c.label} (~${Math.round(c.d / 10) * 10} m)`).join(" et ")}. Les distances sont approximatives.`, reliability: null, sources: [], actions: near.map((c) => c.action) };
    }
    case "buy":
      return { intent, text: "Les sources collectées n'expliquent pas encore comment acheter une voiture : je préfère ne pas l'inventer. En attendant, tu peux en voler une puis l'immatriculer pour la garder.", reliability: "non établi", sources: [], actions: [], replies: ["Comment conserver ma voiture volée ?"] };
    case "secret": {
      const list = visible(ctx, (r) => r.category === "easter_egg" && r.reliability !== "rumor" && (r.details?.chapter?.value ?? 0) <= p.chapter);
      const top = list.sort((a, b) => Number(!!b.media) - Number(!!a.media) || Number(solid(b.reliability)) - Number(solid(a.reliability)))[0];
      if (!top) return { intent, text: "Je n'ai pas de secret documenté pour ton chapitre pour l'instant.", reliability: null, sources: [], actions: [] };
      return { intent, text: `Un secret à découvrir : ${frHeadline(top, g)}.${top.reliability === "reported" ? " Signalé par une seule source." : ""}`, reliability: R[top.reliability], sources: recSources(top), actions: [placeAction(top, ctx) ?? (top.media ? { type: "open_source", url: top.media.url, label: "Voir la vidéo" } : { type: "open_record", id: top.id, label: "Voir la fiche" })], topic: { kind: "record", id: top.id }, evidence: [top.id] };
    }
  }

  // Véhicule cité sans intention claire (« Penumbra FF ? »)
  if (vMentioned) return vehicleAnswer(vMentioned, ctx);
  // Mission citée sans verbe (« Tourist Trap ? »)
  const m = resolveMission(q, cat, opts);
  if (m.mission) return missionTopicAnswer(ctx, m.mission, m.mission.name);
  // Demande floue : une question de précision, jamais une liste d'articles
  return {
    intent: "clarify",
    text: "Je ne suis pas sûr de bien comprendre. Tu prépares une mission, tu cherches un véhicule, une arme, de l'argent ou un secret ?",
    reliability: null,
    sources: [],
    actions: [],
    replies: ["Je vais lancer ma prochaine mission", "Une voiture sympa accessible ?", "Une arme gratuite ?"],
  };
}

function poiAnswer(l: Landmark, district: string | null): AiAnswer {
  const cat = POI_CATS[poiCategory(l)];
  const status = poiStatus(l);
  return {
    intent: "poi",
    text: `${poiName(l)} est un ${cat.label.toLowerCase()} repéré${l.district ? ` à ${l.district}` : district ? ` à ${district}` : ""} sur la carte communautaire. ${status === "uncertain" ? "Sa position ou son identité n'est pas confirmée par gtadb." : "C'est un repère communautaire : rien ne confirme encore qu'il soit ouvert ou utilisable en jeu."}`,
    reliability: "non établi",
    sources: [{ name: "gtadb.org (carte communautaire)", url: "https://map.gtadb.org", when: null, quote: l.real ? `Équivalent réel : ${l.real}` : undefined }],
    actions: [{ type: "show_place", landmarkId: l.id, label: `Voir ${poiName(l)} sur la carte` }],
    more: [POI_STATUS_FR[status]],
    topic: { kind: "place", id: l.id },
    evidence: [`poi:${l.id}`],
  };
}

function doneAnswer(ctx: AiContext, name: string): AiAnswer {
  const p = ctx.state.profile;
  const already = p.missionsDone.some((m) => nk(m) === nk(name));
  if (already) return { intent: "mission_done", text: `« ${name} » est déjà notée comme terminée. Tu veux préparer la suivante ?`, reliability: "déclaré par toi", sources: [], actions: [], replies: ["Et après ?"], topic: { kind: "mission", name, known: true } };
  const next = afterDone(p, name);
  return {
    intent: "mission_done",
    text: `Bravo ! Je note « ${name} » comme terminée ? ${next.text}`,
    reliability: "déclaré par toi",
    sources: [],
    actions: [{ type: "set_mission", name, label: `Oui, « ${name} » est terminée`, confirm: `Indiquer que « ${name} » est terminée ?` }],
    replies: ["Et après ?"],
    topic: { kind: "mission", name, known: true },
  };
}

/** Amorces de questions adaptées à la progression. */
export function starters(ctx: AiContext): string[] {
  const p = ctx.state.profile;
  const out = [p.nextMission ? `Je vais lancer ${p.nextMission}` : "Je vais lancer ma prochaine mission"];
  out.push("Une voiture sympa accessible maintenant ?");
  out.push(p.chapter <= 1 ? "Quelle arme gratuite puis-je récupérer ?" : "Comment conserver ma voiture volée ?");
  return out;
}

/** Validation d'une action avant exécution : l'identifiant doit exister dans le catalogue courant. */
export function isValidAction(a: AiAction, feed: RadarFeed | null): boolean {
  if (!feed) return a.type === "open_map" || a.type === "ask";
  switch (a.type) {
    case "focus_vehicle":
    case "vehicle_state":
      return !!feed.vehicles?.some((v) => v.id === a.id);
    case "open_record":
    case "mark_done":
      return feed.items.some((r) => r.id === a.id);
    case "open_source":
      return /^https:\/\//.test(a.url) && (feed.items.some((r) => r.evidence.some((e) => e.url === a.url) || r.media?.url === a.url) || !!feed.vehicles?.some((v) => v.media?.url === a.url || v.evidence.some((e) => e.url === a.url)));
    case "set_mission":
    case "set_next_mission":
    case "start_mission":
      return a.name.length > 1 && a.name.length < 80 && !/[<>{}]/.test(a.name);
    case "objective_done":
      return a.mission.length > 1 && a.mission.length < 80 && a.text.length > 2 && a.text.length <= 220;
    case "ask":
      return a.question.length > 1 && a.question.length < 200;
    case "show_place":
      return (
        ((!!a.landmarkId && /^[A-Za-z0-9_-]{1,24}$/.test(a.landmarkId)) ||
          (!!a.estId && ESTABLISHMENTS.some((e) => e.id === a.estId)) ||
          (!!a.query && a.query.length > 1 && a.query.length < 80 && !/[<>{}]/.test(a.query)) ||
          (!!a.district && a.district.length > 1 && a.district.length < 60) ||
          (!!a.poiCat && a.poiCat in POI_CATS)) &&
        (!a.poiCat || a.poiCat in POI_CATS)
      );
    default:
      return true;
  }
}
