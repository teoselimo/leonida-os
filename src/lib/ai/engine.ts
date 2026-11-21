import type { RadarFeed, RadarRecord } from "../live";
import { spoilerVisibility } from "../live";
import type { VehicleRecord } from "../garage";
import { vehicleRecommendations, viewOf } from "../garage";
import type { PersistedState } from "../types";

/**
 * LEONIDA AI — moteur « recherche d'abord » (fonctionne sans aucune clé d'IA).
 * Il ne répond qu'à partir du flux réel (fiches de la veille, Garage des légendes, règles sourcées),
 * en respectant le chapitre, l'édition, l'éligibilité précommande, l'anti-spoiler et ce que le joueur a déjà fait.
 * Les textes des sources sont des DONNÉES : ils sont cités, jamais interprétés comme des instructions.
 */

export type Reliab = "officiel" | "recoupé" | "signalé" | "non établi";

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
  /** Lieu de la carte communautaire : repère gtadb (point) ou quartier (zone approximative). Jamais de coordonnées inventées. */
  | { type: "show_place"; label: string; landmarkId?: string; district?: string };

/** Repère de la carte communautaire (gtadb), passé par l'interface. */
export interface PlaceRef {
  id: string;
  name: string;
  district: string;
}

export interface AiAnswer {
  /** Conclusion courte, en tête. */
  title: string;
  lines: string[];
  reliability: Reliab | null;
  sources: Array<{ name: string; url: string; when: string | null }>;
  actions: AiAction[];
  /** Remarque d'honnêteté (non confirmé, masqué par l'anti-spoiler, donnée manquante). */
  note?: string;
  /** Intention détectée (tests, journal). */
  intent: string;
}

export interface AiContext {
  feed: RadarFeed | null;
  state: Pick<PersistedState, "profile" | "vehicles" | "done">;
  /** Centre de carte courant (coordonnées de jeu), pour « près de moi ». */
  position?: { x: number; y: number } | null;
  /** Repères gtadb chargés par la carte : permettent une action « voir sur la carte » sans inventer de position. */
  places?: PlaceRef[];
}

/** Rapproche un lieu cité par une source d'un repère ou d'un quartier gtadb (correspondance exacte de nom). */
export function placeAction(r: RadarRecord, ctx: AiContext): AiAction | null {
  const places = ctx.places ?? [];
  if (!places.length) return null;
  const p = r.details?.place?.value;
  const cited = [p?.name, p?.district, ...(r.location?.place ?? "").split(",")].filter((x): x is string => !!x && !!x.trim()).map((x) => x.trim());
  for (const c of cited) {
    const lm = places.find((l) => norm(l.name) === norm(c));
    if (lm) return { type: "show_place", landmarkId: lm.id, label: `Voir « ${lm.name} » sur la carte` };
  }
  for (const c of cited) {
    const d = places.find((l) => norm(l.district.split(",")[0] ?? "") === norm(c));
    if (d) return { type: "show_place", district: d.district.split(",")[0].trim(), label: `Voir la zone ${d.district.split(",")[0].trim()}` };
  }
  return null;
}

export const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[’']/g, " ");
const R: Record<string, Reliab> = { official: "officiel", confirmed: "recoupé", reported: "signalé", rumor: "non établi", personal: "non établi" };
const cleanSrc = (s: string) => s.replace(/\s*\([^)]*\)\s*$/, "");
const ago = (iso: string | null | undefined) => {
  if (!iso) return null;
  const h = (Date.now() - Date.parse(iso)) / 3600_000;
  return h < 1 ? "il y a moins d'une heure" : h < 48 ? `il y a ${Math.round(h)} h` : `il y a ${Math.round(h / 24)} j`;
};
const fmt$ = (n: number) => `${n.toLocaleString("fr-FR").replace(/ | /g, " ")} $`;

function recSources(r: RadarRecord) {
  return r.evidence.slice(0, 3).map((e) => ({ name: cleanSrc(e.sourceName), url: e.url, when: ago(e.publishedAt ?? r.firstSeenAt) }));
}
function vehSources(v: VehicleRecord) {
  return v.evidence.slice(0, 3).map((e) => ({ name: cleanSrc(e.sourceName), url: e.url, when: ago(e.readAt ?? v.firstSeenAt) }));
}
const recChapter = (r: RadarRecord) => r.details?.chapter?.value ?? r.advice?.chapterMin ?? null;

/** Fiches visibles pour ce joueur (anti-spoiler par chapitre) et nombre de fiches masquées. */
function visibleRecords(ctx: AiContext, pred: (r: RadarRecord) => boolean) {
  const all = (ctx.feed?.items ?? []).filter((r) => r.status === "active" && pred(r));
  const ok = all.filter((r) => spoilerVisibility(r, ctx.state.profile.spoilerMode, ctx.state.profile.chapter) === "visible");
  return { list: ok, hidden: all.length - ok.length };
}

function hiddenNote(n: number) {
  return n ? `${n} résultat${n > 1 ? "s" : ""} masqué${n > 1 ? "s" : ""} par l'anti-spoiler (chapitre plus avancé que le tien).` : undefined;
}

/** Recherche d'un véhicule cité dans la question (nom, modèle, alias appris, « Fast & Furious »…). */
export function findVehicle(q: string, list: VehicleRecord[]): VehicleRecord | null {
  const n = norm(q);
  let best: { v: VehicleRecord; s: number } | null = null;
  for (const v of list) {
    let s = 0;
    const model = norm(v.model);
    if (n.includes(model)) s += 4;
    for (const tok of model.split(" ")) if (tok.length >= 4 && new RegExp(`\\b${tok}\\b`).test(n)) s += 2;
    if (n.includes(norm(v.make)) && v.make) s += 1;
    for (const a of v.aliases?.value ?? []) for (const tok of a.split("-")) if (tok.length >= 4 && n.includes(tok)) s += 3;
    // indices thématiques présents dans les preuves de la fiche (« Fast & Furious », « Paul Walker »…)
    const blob = norm([...v.evidence.map((e) => e.title), v.location.text?.value ?? "", ...(v.aliases?.support ?? []).map((x) => x.quote)].join(" "));
    if (/fast|furious|paul walker/.test(n) && /fast|furious|paul walker/.test(blob)) s += 4;
    if (s > (best?.s ?? 2)) best = { v, s };
  }
  return best?.v ?? null;
}

function vehicleAnswer(v: VehicleRecord, ctx: AiContext): AiAnswer {
  const x = viewOf(v, ctx.state);
  if (x.hidden) {
    return { intent: "vehicle", title: "Ce véhicule est lié à un chapitre plus avancé que le tien.", lines: ["Je ne détaille pas son emplacement pour ne rien te divulgâcher."], reliability: null, sources: [], actions: [], note: "Passe l'anti-spoiler en mode modéré dans Profil si tu veux le voir." };
  }
  const lines: string[] = [];
  if (v.location.precision === "zone") lines.push(`Zone de recherche : ${v.location.district}${v.location.zone?.widened ? " (élargie)" : ""} — pas un point exact.`);
  else if (v.location.precision === "exact") lines.push("Point vérifié sur la carte.");
  else if (v.location.text) lines.push(`Lieu cité : « ${v.location.text.value} »`);
  else lines.push("Emplacement non établi par les sources.");
  if (v.location.text && v.location.precision !== "text") lines.push(`Selon ${cleanSrc(v.location.text.support[0].sourceName)} : « ${v.location.text.value} »`);
  if (x.compat === "ultimate-only") lines.push("Réservé à l'édition Ultimate : non récupérable avec ton édition.");
  else if (x.compat === "check") lines.push("Exclusivité d'édition non confirmée : compatibilité à vérifier.");
  else if (x.compat === "preorder") lines.push("Bonus de précommande : indique dans Profil si tu y as droit.");
  if (v.access.early) lines.push("Accessible tôt, dès l'exploration libre (selon la source).");
  else if (v.access.chapterMin) lines.push(`À partir du chapitre ${v.access.chapterMin.value}.`);
  else if (v.access.inferredChapter) lines.push(`Chapitre ${v.access.inferredChapter.value} estimé (${v.access.inferredChapter.why}).`);
  else lines.push("Chapitre d'accès non établi : accès à confirmer.");
  if (v.access.alarm?.value) lines.push("Alarme à neutraliser sur place.");
  if (v.access.keyCloner?.value) lines.push("Cloneur de clé nécessaire.");
  if (v.keep.mode === "register" && v.keep.rule) lines.push(`Pour la garder : immatriculation dès le chapitre ${v.keep.rule.chapter}${v.keep.rule.where ? `, ${v.keep.rule.where}` : ""}.`);
  if (v.keep.mode === "yes") lines.push("Conservée automatiquement (bonus remis au joueur).");
  const risk = v.risks.find((r) => /lose|lost|disappear/i.test(r.quote));
  if (risk) lines.push(`Attention : « ${risk.quote} » (${cleanSrc(risk.sourceName)})`);
  const actions: AiAction[] = [{ type: "focus_vehicle", id: v.id, label: v.location.precision === "zone" || v.location.precision === "exact" ? "Voir sur la carte" : "Ouvrir la fiche" }];
  const owned = ctx.state.vehicles[v.id]?.state;
  if (!owned && x.access !== "excluded") actions.push({ type: "vehicle_state", id: v.id, state: "spotted", label: "Je l'ai trouvé", confirm: `Marquer « ${v.name} » comme repéré ?` });
  if (v.media) actions.push({ type: "open_source", url: v.media.url, label: "Voir la vidéo" });
  return {
    intent: "vehicle",
    title: `${v.name} : ${x.now ? "récupérable maintenant" : x.access === "confirm" ? "accès à confirmer" : x.access === "later" ? "plus tard dans l'histoire" : x.access === "excluded" ? "pas disponible pour toi" : x.access === "expired" ? "fenêtre dépassée" : "à vérifier"}.`,
    lines,
    reliability: R[v.reliability],
    sources: vehSources(v),
    actions,
    note: v.reliability === "reported" ? "Information signalée par une seule origine : à vérifier en jeu." : undefined,
  };
}

/** Intention principale d'une question (règles explicites, prévisibles). */
export function intentOf(q: string): string {
  const n = norm(q);
  if (/(garder|conserver|immatricul|enregistr|personal|perso).{0,40}(voiture|vehicule|caisse|bagnole)|voiture volee|vehicule vole/.test(n)) return "keep";
  if (/(achet|acheter|acquerir|payer).{0,30}(voiture|vehicule|caisse|bagnole|garage)/.test(n)) return "buy";
  if (/(lancer|commencer|prochaine).{0,30}mission|rien (rater|manquer|louper)|sans rien|manquable/.test(n)) return "missable";
  if (/ultimate|exclusi|edition/.test(n)) return "ultimate";
  if (/\barmes?\b|fusil|pistolet|sniper|flingue|gun/.test(n)) return "weapon";
  if (/(gagner|argent|\$|dollars?|thune|fric|cash|\d+\s?k\b|\d[\d\s.]*\s?(\$|dollars|balles))/.test(n)) return "money";
  if (/(proche|autour|pres d|a cote|ou je suis|ma position)/.test(n)) return "nearby";
  if (/(voiture|vehicule|caisse|bagnole|moto|bateau|fast|furious|paul walker|eclipse)/.test(n)) return "vehicle";
  if (/garage/.test(n)) return "garage";
  if (/secret|easter|cache|mystere/.test(n)) return "secret";
  return "search";
}

const amountOf = (q: string) => {
  const m = norm(q).match(/(\d[\d\s.,]*)\s?(k|000|\$|dollars?|balles)?/);
  if (!m) return null;
  let n = Number(m[1].replace(/[\s.,]/g, ""));
  if (m[2] === "k") n *= 1000;
  return n > 0 ? n : null;
};

export function answer(question: string, ctx: AiContext): AiAnswer {
  const q = question.trim().slice(0, 300);
  const p = ctx.state.profile;
  const vehicles = ctx.feed?.vehicles ?? [];
  if (!ctx.feed) {
    return { intent: "offline", title: "Je n'ai pas encore les données de la veille.", lines: ["Reconnecte-toi : je réponds uniquement à partir des fiches collectées, jamais de mémoire."], reliability: null, sources: [], actions: [] };
  }
  const intent = intentOf(q);
  const done = (id: string) => !!ctx.state.done[id];

  // Véhicule précis cité : priorité à la fiche (sauf questions générales d'achat/conservation)
  if (intent !== "keep" && intent !== "buy" && intent !== "ultimate" && intent !== "missable") {
    const v = findVehicle(q, vehicles);
    if (v) return vehicleAnswer(v, ctx);
  }

  switch (intent) {
    case "keep": {
      // règles générales du flux ; à défaut, celles déjà appliquées aux fiches du garage (même sources)
      const regs = ctx.feed.mechanics?.register?.length
        ? ctx.feed.mechanics.register
        : vehicles.flatMap((v) => (v.keep.rule ? [{ chapter: v.keep.rule.chapter, where: v.keep.rule.where, tracker: v.keep.rule.tracker, source: v.keep.rule.source }] : []));
      const none = regs.find((r) => (r.tracker ?? "none") === "none" && r.where === "garage de Moses") ?? regs.find((r) => r.tracker == null);
      const std = regs.find((r) => r.tracker === "standard");
      if (!none && !std) return { intent, title: "Les sources collectées ne décrivent pas encore comment conserver un véhicule.", lines: [], reliability: "non établi", sources: [], actions: [{ type: "open_map", garage: true, label: "Voir les voitures cachées" }] };
      const lines = [
        "Voler une voiture ne la rend pas tienne : il faut l'immatriculer.",
        none ? `Sans traqueur : dès le chapitre ${none.chapter}${none.where ? `, ${none.where}` : ""}.` : "",
        std ? `Traqueur standard : dès le chapitre ${std.chapter}${std.where ? `, ${std.where}` : ""}.` : "",
        "Traqueur avancé : méthode non documentée par les sources.",
        p.chapter < (none?.chapter ?? 99) ? `Tu es au chapitre ${p.chapter} : une voiture volée avant cela peut être perdue.` : "",
      ].filter(Boolean);
      const src = [none?.source, std?.source].filter(Boolean) as Array<{ sourceName: string; url: string }>;
      return { intent, title: none ? `Immatricule-la chez Moses dès le chapitre ${none.chapter}.` : "Immatricule-la dans un Pay 'n' Spray.", lines, reliability: src.length >= 2 ? "recoupé" : "signalé", sources: src.map((s) => ({ name: cleanSrc(s.sourceName), url: s.url, when: null })), actions: [{ type: "open_map", garage: true, filter: "now", label: "Voitures accessibles maintenant" }] };
    }
    case "buy": {
      const { list } = visibleRecords(ctx, (r) => /\b(buy|purchase|dealership|concession|acheter)\b/i.test(`${r.title} ${r.evidence.map((e) => e.excerpt).join(" ")}`) && /\b(car|vehicle|garage|voiture)\b/i.test(r.title));
      const garages = ctx.feed.items.find((r) => r.evidence.some((e) => (e.deep?.mechanics?.garages ?? null) !== null));
      if (!list.length && !garages)
        return { intent, title: "Aucune source collectée n'explique encore l'achat de voitures.", lines: ["Je ne l'invente pas. En attendant, on peut voler puis immatriculer une voiture (demande « comment conserver ma voiture volée ? »)."], reliability: "non établi", sources: [], actions: [{ type: "open_map", garage: true, label: "Voir les voitures cachées" }] };
      const g = garages?.evidence.find((e) => e.deep?.mechanics?.garages)?.deep?.mechanics?.garages;
      return {
        intent,
        title: list.length ? "Voici ce que disent les guides sur l'achat." : "Les sources parlent surtout de garages à acheter.",
        lines: [...list.slice(0, 2).map((r) => `« ${r.title} » (${cleanSrc(r.evidence[0].sourceName)})`), g ? `Garages : ${g.value.how}${g.value.chapter ? ` (chapitre ${g.value.chapter})` : ""}.` : ""].filter(Boolean),
        reliability: "signalé",
        sources: [...list.slice(0, 2).flatMap(recSources), ...(g ? [{ name: cleanSrc(garages!.evidence[0].sourceName), url: g.url, when: null }] : [])].slice(0, 3),
        actions: list.slice(0, 1).map((r) => ({ type: "open_record" as const, id: r.id, label: "Ouvrir la fiche" })),
      };
    }
    case "ultimate": {
      const ult = vehicles.filter((v) => v.edition.exclusive === "ultimate").map((v) => viewOf(v, ctx.state)).filter((x) => !x.hidden);
      if (p.edition !== "ultimate")
        return {
          intent,
          title: p.edition === "standard" ? "Avec l'édition Standard, aucun véhicule Ultimate n'est récupérable." : "Indique ton édition dans Profil pour que je réponde.",
          lines: ult.slice(0, 4).map((x) => `${x.v.name} — ${x.v.edition.status === "confirmed" ? "exclusivité recoupée" : "exclusivité signalée"}`),
          reliability: null,
          sources: [],
          actions: [{ type: "open_map", garage: true, filter: "ultimate", label: "Voir les exclusivités" }],
        };
      // d'abord ce qui est récupérable et dont l'exclusivité est recoupée
      const now = ult.filter((x) => x.now || x.access === "confirm").sort((a, b) => Number(b.now) - Number(a.now) || Number(b.v.edition.status === "confirmed") - Number(a.v.edition.status === "confirmed"));
      return {
        intent,
        title: now.length ? `${now.length} contenu${now.length > 1 ? "s" : ""} Ultimate pour ton chapitre.` : "Aucun contenu Ultimate accessible à ton chapitre pour l'instant.",
        lines: now.slice(0, 5).map((x) => `${x.v.name} — ${x.now ? "maintenant" : "accès à confirmer"}${x.v.edition.status === "confirmed" ? "" : " (exclusivité à vérifier)"}${x.v.access.until ? `, seulement jusqu'au chapitre ${x.v.access.until.value}` : ""}`),
        reliability: now.every((x) => x.v.edition.status === "confirmed") && now.length ? "recoupé" : "signalé",
        sources: now.slice(0, 2).flatMap((x) => vehSources(x.v)).slice(0, 3),
        actions: [{ type: "open_map", garage: true, filter: "ultimate", label: "Afficher sur la carte" }, ...now.slice(0, 1).map((x) => ({ type: "focus_vehicle" as const, id: x.v.id, label: x.v.name }))],
        note: hiddenNote(ult.length - ult.filter((x) => !x.hidden).length),
      };
    }
    case "weapon": {
      const free = /gratuit|free/.test(norm(q));
      const { list, hidden } = visibleRecords(ctx, (r) => r.category === "weapon" || /\b(weapon|rifle|sniper|gun|pistol|shotgun)\b/i.test(r.title));
      const ranked = list.filter((r) => !done(r.id)).sort((a, b) => Number(!!b.details?.place) - Number(!!a.details?.place) || (["official", "confirmed"].includes(b.reliability) ? 1 : 0) - (["official", "confirmed"].includes(a.reliability) ? 1 : 0) || Number(/free|early/i.test(b.title)) - Number(/free|early/i.test(a.title)));
      if (!ranked.length) return { intent, title: "Aucune arme documentée pour ton chapitre dans les sources collectées.", lines: [], reliability: "non établi", sources: [], actions: [], note: hiddenNote(hidden) };
      const top = ranked[0];
      return {
        intent,
        title: `${free ? "Arme gratuite" : "Arme"} à récupérer : ${top.title.replace(/\s*in GTA (6|VI)\b.*$/i, "")}.`,
        lines: [
          top.details?.place ? `Lieu cité : ${top.details.place.value.name}${top.details.place.value.district ? ` (${top.details.place.value.district})` : ""}.` : "Lieu non précisé dans l'extrait collecté.",
          top.details?.chapter ? `Chapitre ${top.details.chapter.value}.` : "",
          ...ranked.slice(1, 3).map((r) => `Aussi : ${r.title.replace(/\s*in GTA (6|VI)\b.*$/i, "")} (${R[r.reliability]})`),
        ].filter(Boolean),
        reliability: R[top.reliability],
        sources: recSources(top),
        actions: [...[placeAction(top, ctx)].filter((x): x is AiAction => !!x), { type: "open_record", id: top.id, label: "Ouvrir la fiche" }, { type: "filter_radar", category: "weapon", label: "Toutes les armes" }, { type: "mark_done", id: top.id, label: "C'est fait", confirm: `Marquer « ${top.title} » comme fait ?` }],
        note: top.reliability === "reported" ? "Signalé par une seule origine : à vérifier en jeu." : hiddenNote(hidden),
      };
    }
    case "money": {
      const target = amountOf(q);
      // seulement des montants extraits d'un guide lu en entier (citation à l'appui), jamais un prix ou un abonnement
      const { list, hidden } = visibleRecords(ctx, (r) => !!r.details?.money && r.category !== "news" && !/\b(subscription|gta\+|price|preorder)\b/i.test(r.title));
      const ranked = list.filter((r) => !done(r.id)).sort((a, b) => (["official", "confirmed"].includes(b.reliability) ? 1 : 0) - (["official", "confirmed"].includes(a.reliability) ? 1 : 0) || (b.conditions.money ?? 0) - (a.conditions.money ?? 0));
      if (!ranked.length) return { intent, title: "Aucune source d'argent documentée pour ton chapitre.", lines: [], reliability: "non établi", sources: [], actions: [], note: hiddenNote(hidden) };
      const pick: RadarRecord[] = [];
      let sum = 0;
      for (const r of ranked) {
        if (target && sum >= target) break;
        pick.push(r);
        sum += r.conditions.money ?? 0;
        if (!target && pick.length >= 3) break;
      }
      return {
        intent,
        title: target ? (sum >= target ? `Environ ${fmt$(sum)} avec ${pick.length} source${pick.length > 1 ? "s" : ""} d'argent.` : `Je trouve environ ${fmt$(sum)}, moins que tes ${fmt$(target)}.`) : "Les meilleures sources d'argent pour ton chapitre.",
        lines: pick.slice(0, 4).map((r) => `${r.conditions.reward ?? fmt$(r.conditions.money ?? 0)} — ${r.details?.place ? r.details.place.value.name : r.title.replace(/\s*in GTA (6|VI)\b.*$/i, "")} (${R[r.reliability]})`),
        reliability: pick.every((r) => ["official", "confirmed"].includes(r.reliability)) ? "recoupé" : "signalé",
        sources: pick.slice(0, 3).flatMap(recSources).slice(0, 3),
        actions: pick.slice(0, 2).map((r) => ({ type: "open_record" as const, id: r.id, label: r.details?.place?.value.name ?? "Ouvrir la fiche" })),
        note: pick.some((r) => r.reliability === "reported") ? "Certaines sommes ne sont signalées que par une source : à vérifier." : hiddenNote(hidden),
      };
    }
    case "missable": {
      const urgentV = vehicleRecommendations(vehicles, ctx.state, 10).filter((x) => x.urgent);
      const { list, hidden } = visibleRecords(ctx, (r) => !!r.details?.contextMissable || r.category === "missable" || r.conditions.missable === true);
      const finished = new Set(p.missionsDone.map((m) => m.toLowerCase()));
      const open = list.filter((r) => {
        if (done(r.id)) return false;
        const ch = recChapter(r);
        const until = r.details?.contextMissable?.value.until;
        if (until && (finished.has(until.toLowerCase()) || (ch != null && p.chapter > ch))) return false;
        return ch == null || ch <= p.chapter;
      });
      if (!open.length && !urgentV.length)
        return { intent, title: "Rien de manquable n'est documenté pour ta progression : tu peux continuer.", lines: [p.lastMission ? `Dernière mission terminée : « ${p.lastMission} ».` : "Indique ta dernière mission terminée dans Profil pour un avis plus précis."], reliability: null, sources: [], actions: [], note: hiddenNote(hidden) };
      return {
        intent,
        title: "Avant de continuer, termine ceci :",
        lines: [
          ...open.slice(0, 3).map((r) => (r.details?.contextMissable?.value.until ? `${r.details.contextMissable.value.subject ?? r.title} — disparaît au lancement de « ${r.details.contextMissable.value.until} »` : r.title)),
          ...urgentV.slice(0, 2).map((x) => `${x.v.name} — seulement jusqu'au chapitre ${x.v.access.until!.value}`),
        ],
        reliability: open.every((r) => ["official", "confirmed"].includes(r.reliability)) ? "recoupé" : "signalé",
        sources: [...open.slice(0, 2).flatMap(recSources), ...urgentV.slice(0, 1).flatMap((x) => vehSources(x.v))].slice(0, 3),
        actions: [
          ...open.slice(0, 1).map((r) => ({ type: "open_record" as const, id: r.id, label: "Ouvrir la fiche" })),
          ...urgentV.slice(0, 1).map((x) => ({ type: "focus_vehicle" as const, id: x.v.id, label: x.v.name })),
          ...open.slice(0, 1).filter((r) => r.details?.contextMissable?.value.until).map((r) => ({ type: "set_mission" as const, name: r.details!.contextMissable!.value.until!, label: `J'ai terminé « ${r.details!.contextMissable!.value.until} »`, confirm: `Indiquer que « ${r.details!.contextMissable!.value.until} » est terminée ?` })),
        ],
        note: hiddenNote(hidden),
      };
    }
    case "nearby": {
      const pos = ctx.position;
      if (!pos) return { intent, title: "Ouvre la carte et centre-la là où tu es, puis repose la question.", lines: ["Je ne lis pas ta position dans le jeu : j'utilise le centre de la carte de l'app."], reliability: null, sources: [], actions: [{ type: "open_map", label: "Ouvrir la carte" }] };
      const dist = (x: number, y: number) => Math.hypot(x - pos.x, y - pos.y);
      const cands: Array<{ d: number; label: string; action: AiAction; rel: string }> = [];
      for (const r of visibleRecords(ctx, (r) => !!r.location.zone && r.category !== "news").list)
        if (!done(r.id)) cands.push({ d: dist(r.location.zone!.x, r.location.zone!.y), label: r.details?.place?.value.name ?? r.title, action: { type: "open_record", id: r.id, label: r.details?.place?.value.name ?? "Fiche" }, rel: R[r.reliability] });
      for (const v of vehicles) {
        const x = viewOf(v, ctx.state);
        const c = v.location.point ?? v.location.zone;
        if (c && !x.hidden && x.access !== "excluded") cands.push({ d: dist(c.x, c.y), label: v.name, action: { type: "focus_vehicle", id: v.id, label: v.name }, rel: R[v.reliability] });
      }
      const near = cands.sort((a, b) => a.d - b.d).slice(0, 4);
      if (!near.length) return { intent, title: "Rien de localisé près du centre de ta carte.", lines: [], reliability: null, sources: [], actions: [] };
      return { intent, title: `${near.length} découverte${near.length > 1 ? "s" : ""} près du centre de ta carte.`, lines: near.map((c) => `${c.label} — ~${Math.round(c.d / 10) * 10} m (${c.rel})`), reliability: null, sources: [], actions: near.slice(0, 3).map((c) => c.action), note: "Distances jusqu'au centre des zones de recherche, approximatives." };
    }
    case "garage":
    case "vehicle": {
      const recs = vehicleRecommendations(vehicles, ctx.state, 3);
      if (!recs.length) return { intent, title: "Aucun véhicule récupérable maintenant n'est documenté pour ta partie.", lines: ["Les autres sont « à confirmer », réservés à une autre édition ou plus loin dans l'histoire."], reliability: null, sources: [], actions: [{ type: "open_map", garage: true, label: "Voir les voitures cachées" }] };
      return { intent, title: `${recs.length} véhicule${recs.length > 1 ? "s" : ""} à récupérer maintenant.`, lines: recs.map((x) => `${x.v.name} — ${x.v.location.district ?? "lieu cité"} (${R[x.v.reliability]})`), reliability: null, sources: recs.slice(0, 2).flatMap((x) => vehSources(x.v)).slice(0, 3), actions: [{ type: "open_map", garage: true, filter: "now", label: "Voir sur la carte" }, ...recs.slice(0, 2).map((x) => ({ type: "focus_vehicle" as const, id: x.v.id, label: x.v.name }))] };
    }
    default: {
      // recherche plein texte prudente dans les titres et faits extraits
      const words = norm(q).split(/\W+/).filter((w) => w.length >= 4 && !["comment", "quelle", "quelles", "quels", "est-ce", "peux", "faire", "trouver", "dans", "avec", "pour"].includes(w));
      if (!words.length) return { intent: "unknown", title: "Pose-moi une question sur une voiture, une arme, de l'argent, une mission ou un lieu.", lines: [], reliability: null, sources: [], actions: [] };
      const { list, hidden } = visibleRecords(ctx, (r) => r.category !== "news");
      const scored = list
        .map((r) => {
          const blob = norm(`${r.title} ${r.details?.place?.value.name ?? ""} ${r.details?.mission?.value ?? ""}`);
          return { r, s: words.filter((w) => blob.includes(w)).length };
        })
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s || b.r.score - a.r.score)
        .slice(0, 3);
      if (!scored.length) return { intent: "unknown", title: "Je ne trouve rien à ce sujet dans les sources collectées.", lines: ["Je préfère ne pas inventer : la veille ajoutera la réponse dès qu'un guide fiable la publie."], reliability: "non établi", sources: [], actions: [], note: hiddenNote(hidden) };
      return { intent: "search", title: `${scored.length} fiche${scored.length > 1 ? "s" : ""} en rapport.`, lines: scored.map((x) => `${x.r.title} (${R[x.r.reliability]})`), reliability: null, sources: scored.slice(0, 3).flatMap((x) => recSources(x.r)).slice(0, 3), actions: scored.slice(0, 2).map((x) => ({ type: "open_record" as const, id: x.r.id, label: "Ouvrir la fiche" })), note: hiddenNote(hidden) };
    }
  }
}

/** Trois amorces de questions adaptées à la progression. */
export function starters(ctx: AiContext): string[] {
  const p = ctx.state.profile;
  const out = ["Je peux lancer ma prochaine mission sans rien rater ?"];
  out.push(p.edition === "ultimate" ? "Quels véhicules Ultimate sont accessibles à mon niveau ?" : "Où trouver la voiture de Fast & Furious ?");
  out.push(p.chapter <= 1 ? "Quelle arme gratuite puis-je récupérer maintenant ?" : "Comment conserver ma voiture volée ?");
  return out;
}

/** Validation d'une action avant exécution : l'identifiant doit exister dans le catalogue courant. */
export function isValidAction(a: AiAction, feed: RadarFeed | null): boolean {
  if (!feed) return a.type === "open_map";
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
      return a.name.length > 1 && a.name.length < 80;
    case "show_place":
      return (!!a.landmarkId && /^[A-Za-z0-9_-]{1,24}$/.test(a.landmarkId)) || (!!a.district && a.district.length > 1 && a.district.length < 60);
    default:
      return true;
  }
}
