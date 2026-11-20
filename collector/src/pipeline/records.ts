import type { Category, Evidence, Override, RadarRecord, RawItem, Reliability, ReviewStatus, SourceConfig } from "../types.ts";
import { hostOf, sha1 } from "../util.ts";
import { ACTIONABLE, CATEGORY_FR, categorize, extractMoney, jaccard, MISSABLE, RUMOR, SPOILER, tokens } from "./rules.ts";
import { findPlace } from "./places.ts";

/** Origines d'une preuve : chaîne/domaine éditeur + vidéos citées. */
export function originsOf(raw: RawItem, source: SourceConfig): string[] {
  const o = new Set<string>();
  if (source.kind === "youtube-feed" || source.kind === "youtube-api") o.add(`yt-channel:${(raw.author ?? source.id).toLowerCase()}`);
  else o.add(`site:${hostOf(raw.url)}`);
  for (const v of raw.videoIds) o.add(`yt:${v}`);
  return [...o];
}

export function toEvidence(raw: RawItem, source: SourceConfig): Evidence {
  return {
    rawKey: raw.key,
    sourceId: source.id,
    sourceName: source.name,
    url: raw.url,
    title: raw.title,
    excerpt: raw.excerpt,
    publishedAt: raw.publishedAt,
    official: source.official,
    origins: originsOf(raw, source),
    quotes: [],
  };
}

/** Nombre de preuves réellement indépendantes (aucune origine commune). Deux sites relayant la même vidéo comptent pour une. */
export function independentCount(evidence: Evidence[]): number {
  const groups: Set<string>[] = [];
  for (const e of evidence) {
    const hit = groups.find((g) => e.origins.some((o) => g.has(o)));
    if (hit) e.origins.forEach((o) => hit.add(o));
    else groups.push(new Set(e.origins));
  }
  // fusion transitive
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < groups.length && !merged; i++)
      for (let j = i + 1; j < groups.length && !merged; j++)
        if ([...groups[i]].some((o) => groups[j].has(o))) {
          groups[j].forEach((o) => groups[i].add(o));
          groups.splice(j, 1);
          merged = true;
        }
  }
  return groups.length;
}

/** Une nouvelle preuve concerne-t-elle déjà une fiche existante ? Prudent : on préfère deux fiches à une fusion abusive. */
export function matches(rec: RadarRecord, ev: Evidence, category: Category): boolean {
  if (rec.evidence.some((e) => e.rawKey === ev.rawKey)) return true;
  const vids = ev.origins.filter((o) => o.startsWith("yt:"));
  if (vids.length && rec.evidence.some((e) => e.origins.some((o) => vids.includes(o)))) return true;
  if (rec.category !== category) return false;
  const a = tokens(rec.evidence.map((e) => e.title).join(" "));
  const b = tokens(ev.title);
  const { score, shared } = jaccard(a, b);
  return score >= 0.5 && shared >= 3;
}

function textOf(evs: Evidence[]) {
  return evs.map((e) => `${e.title}. ${e.excerpt}`).join(" \n ");
}

/**
 * Recalcule tous les champs dérivés d'une fiche à partir de ses preuves.
 * Règles de fiabilité :
 *  - official  : au moins une preuve issue d'une source Rockstar
 *  - confirmed : ≥ 2 preuves indépendantes, contenu actionnable et précis (lieu ou conditions établis), sans marqueur de rumeur
 *  - rumor     : marqueur de rumeur/fuite/théorie, ou titre interrogatif, ou seule source à faible confiance
 *  - reported  : sinon (une source identifiée, plausible, non corroborée)
 */
export function derive(rec: RadarRecord, sources: Map<string, SourceConfig>, now: Date, override?: Override): RadarRecord {
  const evs = rec.evidence;
  const text = textOf(evs);
  const official = evs.some((e) => e.official);
  const lead = [...evs].sort((a, b) => Number(b.official) - Number(a.official))[0];
  const category: Category = categorize(lead.title, evs.map((e) => e.excerpt).join(" "), "news");

  // Champs établis uniquement s'ils sont cités textuellement
  const quotes: string[] = [];
  const money = extractMoney(text);
  if (money) quotes.push(money.quote);
  const miss = text.match(MISSABLE);
  if (miss) quotes.push(miss[0]);
  const place = ACTIONABLE.includes(category) ? findPlace(text) : null;
  if (place) quotes.push(place.quote);

  const independent = independentCount(evs.filter((e) => !e.official));
  const rumorHit = text.match(RUMOR);
  const question = evs.every((e) => /\?\s*$/.test(e.title));
  const lowTrustOnly = evs.every((e) => sources.get(e.sourceId)?.trust === "low");
  const precise = !!place || !!money || !!miss;
  const reasons: string[] = [];
  let reliability: Reliability;
  if (official) {
    reliability = "official";
    reasons.push("Publié par Rockstar Games (source officielle).");
  } else if (rumorHit || question || lowTrustOnly) {
    reliability = "rumor";
    reasons.push(rumorHit ? `Formulation de rumeur détectée (« ${rumorHit[0]} »).` : question ? "Titre interrogatif : affirmation non établie." : "Source à faible confiance uniquement.");
  } else if (independent >= 2 && ACTIONABLE.includes(category) && precise) {
    reliability = "confirmed";
    reasons.push(`${independent} sources indépendantes concordantes avec des éléments précis.`);
  } else {
    reliability = "reported";
    reasons.push(independent >= 2 ? `${independent} sources indépendantes, mais sans élément assez précis pour confirmer.` : "Une seule source identifiée, non corroborée.");
  }
  if (evs.length > independent && !official) reasons.push(`${evs.length - independent} relais de la même origine non comptés comme indépendants.`);

  let status: ReviewStatus = "active";
  if (override?.reliability && override.reliability !== "personal") {
    reliability = override.reliability;
    reasons.unshift("Classement ajusté par un administrateur.");
  }
  if (override?.status) status = override.status;
  if (override?.note) reasons.push(`Note admin : ${override.note}`);

  const location = override?.location
    ? { regionId: override.location.regionId ?? place?.regionId ?? null, place: override.location.place ?? place?.place ?? null, precision: "validated" as const, x: override.location.x, y: override.location.y }
    : { regionId: place?.regionId ?? null, place: place?.place ?? null, precision: place?.precision ?? ("none" as const), x: null, y: null };

  const spoilerHit = text.match(SPOILER);
  const spoiler = spoilerHit ? "high" : "low";
  if (spoilerHit) reasons.push(`Spoiler possible (« ${spoilerHit[0]} ») : masqué en mode strict.`);

  const conditions = {
    reward: null,
    money: money?.value ?? null,
    requirement: null,
    missable: miss ? true : null,
    platform: null,
  };
  const actionable = (reliability === "official" || reliability === "confirmed") && status === "active" && ACTIONABLE.includes(category) && (location.precision !== "none" || money != null || miss != null);

  const media = rec.media;
  const publishedAt = evs.map((e) => e.publishedAt).filter(Boolean).sort()[0] ?? null;

  const hours = (now.getTime() - Date.parse(rec.firstSeenAt)) / 3600_000;
  const recency = Math.max(0, 1 - hours / 72);
  const RW: Record<Reliability, number> = { official: 40, confirmed: 35, reported: 20, rumor: 8, personal: 0 };
  const CW: Partial<Record<Category, number>> = { missable: 25, money: 15, weapon: 12, vehicle: 12, easter_egg: 12, side_mission: 10, unique_item: 10, patch: 8, mechanic: 6, guide: 5, news: 5 };
  const score = Math.round(RW[reliability] + (CW[category] ?? 4) + recency * 20 + Math.min(evs.length, 5) * 3 - (status === "active" ? 0 : 50));

  const INTEREST: Partial<Record<Category, number>> = { missable: 1, easter_egg: 0.9, money: 0.85, vehicle: 0.8, weapon: 0.8, unique_item: 0.7, side_mission: 0.6, news: 0.5, patch: 0.5, mechanic: 0.5, guide: 0.4 };
  const CERT: Record<Reliability, number> = { official: 1, confirmed: 0.9, reported: 0.6, rumor: 0.4, personal: 0.3 };
  const opp = Math.round(
    100 * (0.25 * recency + 0.25 * (INTEREST[category] ?? 0.3) + 0.15 * (media ? 1 : 0.4) + 0.15 * (precise ? 1 : 0.4) + 0.1 * (1 / (1 + (evs.length - 1) * 0.5)) + 0.1 * CERT[reliability]),
  );
  const short = lead.title.length > 70 ? lead.title.slice(0, 67) + "…" : lead.title;
  const angle = reliability === "official" || reliability === "confirmed" ? (ACTIONABLE.includes(category) ? "testé" : "actu") : "vrai ou faux ?";
  const ideas =
    angle === "vrai ou faux ?"
      ? [`Vrai ou faux ? Je vérifie en jeu : « ${short} »`, `Rumeur ou réalité : ce que montrent vraiment les sources`]
      : angle === "testé"
        ? [`Testé en jeu : « ${short} »`, `Où et comment, en moins de 30 secondes`]
        : [`L'essentiel en 30 secondes : « ${short} »`];

  return {
    ...rec,
    title: lead.title,
    summary: `${CATEGORY_FR[category]} · ${lead.sourceName}${evs.length > 1 ? ` + ${evs.length - 1} autre${evs.length > 2 ? "s" : ""} source${evs.length > 2 ? "s" : ""}` : ""} — ${lead.excerpt}`.slice(0, 400),
    category,
    reliability,
    status,
    reviewed: !!override,
    reasons,
    spoiler,
    actionable,
    location,
    conditions,
    media: media ?? null,
    publishedAt,
    lastVerifiedAt: now.toISOString(),
    score,
    opportunity: { score: opp, angle, ideas },
    evidence: evs.map((e) => ({ ...e, quotes: quotes.filter((q) => `${e.title} ${e.excerpt}`.includes(q)) })),
  };
}

export function newRecord(ev: Evidence, raw: RawItem, now: Date, category: Category = "news"): RadarRecord {
  const t = now.toISOString();
  return {
    id: `r-${sha1(ev.rawKey).slice(0, 10)}`,
    title: ev.title,
    summary: "",
    category,
    reliability: "reported",
    status: "active",
    reviewed: false,
    reasons: [],
    spoiler: "low",
    actionable: false,
    location: { regionId: null, place: null, precision: "none", x: null, y: null },
    conditions: { reward: null, money: null, requirement: null, missable: null, platform: null },
    evidence: [ev],
    media: raw.media,
    firstSeenAt: t,
    updatedAt: t,
    publishedAt: raw.publishedAt,
    lastVerifiedAt: t,
    revisions: [{ at: t, reason: "Création automatique", changes: [`source : ${ev.sourceName}`] }],
    score: 0,
    opportunity: { score: 0, angle: "actu", ideas: [] },
  };
}

/** Différences visibles entre deux états d'une fiche (pour l'historique). */
export function diff(a: RadarRecord, b: RadarRecord): string[] {
  const out: string[] = [];
  if (a.title !== b.title) out.push(`titre : « ${a.title} » → « ${b.title} »`);
  if (a.reliability !== b.reliability) out.push(`fiabilité : ${a.reliability} → ${b.reliability}`);
  if (a.status !== b.status) out.push(`statut : ${a.status} → ${b.status}`);
  if (a.category !== b.category) out.push(`catégorie : ${a.category} → ${b.category}`);
  if (a.evidence.length !== b.evidence.length) out.push(`preuves : ${a.evidence.length} → ${b.evidence.length}`);
  if (a.location.precision !== b.location.precision) out.push(`localisation : ${a.location.precision} → ${b.location.precision}`);
  return out;
}
