import type { Category, DetailField, Evidence, RadarRecord, RecordDetails, SourceConfig } from "../types.ts";
import { sha1 } from "../util.ts";
import { readArticle } from "./article.ts";
import { extractFacts } from "./facts.ts";
import { extractWithLLM } from "./llm.ts";
import { extractVehicles } from "./vehicles.ts";
import { exactLandmark } from "./places.ts";

/** Catégories pour lesquelles on lit l'article complet (contenu exploitable en jeu). */
export const RULES_VERSION = 3; // 3 : extraction automobile (V0.6)

export const DEEP_CATEGORIES: Category[] = ["money", "easter_egg", "side_mission", "missable", "guide", "mechanic", "weapon", "vehicle", "unique_item"];

export interface DeepOptions {
  env: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  now: Date;
  log: (m: string) => void;
}

/**
 * Lecture approfondie, plafonnée par exécution (DEEP_READ_MAX, 15 par défaut).
 * Seuls les articles web (RSS) sont lus ; les vidéos YouTube sont traitées par leurs métadonnées.
 * Priorité : fiches touchées à ce cycle, puis rattrapage des plus récentes jamais lues.
 */
export async function deepReadPhase(records: RadarRecord[], sources: Map<string, SourceConfig>, touched: Set<string>, opts: DeepOptions): Promise<{ read: number; ok: number; ai: number }> {
  const max = Number(opts.env.DEEP_READ_MAX || 40);
  const horizon = opts.now.getTime() - 21 * 86400_000;
  const candidates: Array<{ rec: RadarRecord; ev: Evidence }> = [];
  for (const rec of records) {
    if (rec.status === "retracted" || Date.parse(rec.firstSeenAt) < horizon) continue;
    if (!DEEP_CATEGORIES.includes(rec.category) && !/\b(guide|how to|where to|location|stash|secret|hidden|missable|early money|cars?|vehicles?|garages?|edition|bonus|register)\b/i.test(rec.title)) continue;
    for (const ev of rec.evidence) {
      const src = sources.get(ev.sourceId);
      if (!src || (src.kind !== "rss" && src.kind !== "sitemap")) continue;
      // Déjà lu avec les règles actuelles ; un échec réseau est retenté après 24 h, un refus robots.txt jamais
      const d = ev.deep;
      if (d && d.v === RULES_VERSION && (d.ok || d.reason === "refusé par robots.txt" || opts.now.getTime() - Date.parse(d.at) < 86400_000)) continue;
      candidates.push({ rec, ev });
    }
  }
  // Priorité : nouveautés du cycle, contenu exploitable (argent, manquable, secret…), indices concrets dans le titre, puis récence
  const HOT: Category[] = ["money", "missable", "easter_egg", "side_mission", "unique_item", "weapon", "vehicle"];
  const prio = (c: { rec: RadarRecord; ev: Evidence }) =>
    (touched.has(c.rec.id) ? 2 : 0) + (HOT.includes(c.rec.category) ? 2 : 0) + (/\b(stash|money|cash|secret|hidden|missable|location|where to|unlock|free|how to (?:complete|find|get)|operation|side mission|cars?|vehicles?|garages?|ultimate|register)\b/i.test(c.ev.title) ? 1 : 0);
  candidates.sort((a, b) => prio(b) - prio(a) || b.rec.firstSeenAt.localeCompare(a.rec.firstSeenAt));
  let read = 0;
  let ok = 0;
  let ai = 0;
  const aiMax = Number(opts.env.LLM_MAX_CALLS_PER_RUN || 10);
  for (const { rec, ev } of candidates.slice(0, max)) {
    read++;
    const art = await readArticle(ev.url, opts.fetchImpl);
    if (!art.ok) {
      ev.deep = { v: RULES_VERSION, at: opts.now.toISOString(), ok: false, reason: art.reason ?? "lecture impossible", aiOptOut: art.aiOptOut, method: "rules", facts: null, videoIds: [] };
      opts.log(`– lecture : ${ev.sourceName} · ${art.reason}`);
      continue;
    }
    ok++;
    let facts = extractFacts(art.text, ev.url, ev.title);
    let method: "rules" | "rules+ai" = "rules";
    // IA ciblée : uniquement si les règles ont trouvé le sujet (lieu ou argent) mais pas le contexte, et si le site l'accepte
    const found = [facts.place, facts.money, facts.mission, facts.chapter].filter(Boolean).length;
    const src = sources.get(ev.sourceId);
    if (found >= 1 && found < 3 && !art.aiOptOut && !src?.noAI && ai < aiMax && opts.env.ANTHROPIC_API_KEY && opts.env.ANTHROPIC_MODEL) {
      ai++;
      const extra = await extractWithLLM(art.text, ev.url, opts).catch(() => null);
      if (extra) {
        facts = { ...facts, chapter: facts.chapter ?? extra.chapter, mission: facts.mission ?? extra.mission, giver: facts.giver ?? extra.giver, unlockAfter: facts.unlockAfter ?? extra.unlockAfter };
        method = "rules+ai";
      }
    }
    const vf = extractVehicles(art.text, art.sections, ev.title, ev.url);
    const hasMech = vf.mechanics.register.length || vf.mechanics.keyCloner || vf.mechanics.garages;
    ev.deep = {
      v: RULES_VERSION, at: opts.now.toISOString(), ok: true, reason: null, aiOptOut: art.aiOptOut, method, facts, videoIds: art.videoIds,
      ...(vf.vehicles.length ? { vehicles: vf.vehicles } : {}),
      ...(hasMech ? { mechanics: vf.mechanics } : {}),
      ...(art.cites.length ? { cites: art.cites } : {}),
    };
    for (const v of art.videoIds) if (!ev.origins.includes(`yt:${v}`)) ev.origins.push(`yt:${v}`);
    touched.add(rec.id);
    const n = Object.entries(facts).filter(([k, v]) => k !== "keywords" && v).length;
    if (vf.vehicles.length) opts.log(`  ↳ ${vf.vehicles.length} véhicule(s)/garage(s) : ${vf.vehicles.map((v) => v.name).slice(0, 6).join(", ")}`);
    opts.log(`✓ lecture : ${ev.sourceName} · ${n} champ(s) extrait(s)${method === "rules+ai" ? " (dont IA ciblée)" : ""} · « ${ev.title.slice(0, 60)} »`);
  }
  return { read, ok, ai };
}

const norm = (s: string) => s.toLowerCase().replace(/[’']/g, "'").replace(/\s+store$/, "").replace(/\s+/g, " ").trim();

function factsOf(rec: RadarRecord) {
  return rec.evidence.map((e) => e.deep?.facts).filter((f): f is NonNullable<typeof f> => !!f);
}

/**
 * Fusion prudente de deux fiches décrivant la même découverte : même lieu nommé (texte identique)
 * ET un indice concordant (même objet clé comme « parrot »/« stash », ou montants compatibles).
 */
export function sameDiscovery(a: RadarRecord, b: RadarRecord): boolean {
  const fa = factsOf(a);
  const fb = factsOf(b);
  if (!fa.length || !fb.length) return false;
  const placesA = new Set(fa.map((f) => f.place && norm(f.place.value.name)).filter(Boolean));
  const placeHit = fb.some((f) => f.place && placesA.has(norm(f.place.value.name)));
  if (!placeHit) return false;
  // Le lieu seul ne suffit pas (un guide « toutes les cartes à collectionner » cite les mêmes lieux) :
  // il faut une récompense compatible des deux côtés, ou au moins deux indices précis communs.
  const GENERIC = new Set(["cash", "liquor", "rum", "drugs", "safe", "stash", "gold"]);
  const kwA = new Set(fa.flatMap((f) => f.keywords));
  const sharedKw = [...new Set(fb.flatMap((f) => f.keywords))].filter((k) => kwA.has(k) && !GENERIC.has(k));
  const moneyA = fa.map((f) => f.money?.value).filter(Boolean) as Array<{ amount: number; max: number | null }>;
  const moneyB = fb.map((f) => f.money?.value).filter(Boolean) as Array<{ amount: number; max: number | null }>;
  const compatible = moneyA.some((x) => moneyB.some((y) => moneyCompatible(x, y)));
  return compatible && sharedKw.length >= 1;
}

export function moneyCompatible(x: { amount: number; max: number | null }, y: { amount: number; max: number | null }) {
  const lo1 = x.amount * 0.85, hi1 = (x.max ?? x.amount) * 1.15;
  const lo2 = y.amount * 0.85, hi2 = (y.max ?? y.amount) * 1.15;
  return lo1 <= hi2 && lo2 <= hi1;
}

/**
 * Annule une fusion devenue injustifiée (règles resserrées) : chaque preuve non reliée retrouve sa fiche d'origine
 * (même identifiant, dérivé de la clé de la preuve), avec une révision explicite.
 */
export function splitInvalidMerges(records: RadarRecord[], now: Date): RadarRecord[] {
  const out: RadarRecord[] = [];
  for (const r of records) {
    if (!r.mergedFrom?.length || r.evidence.length < 2) {
      out.push(r);
      continue;
    }
    const solo = (e: Evidence): RadarRecord => ({ ...r, evidence: [e] });
    const keep = [r.evidence[0]];
    const rest: Evidence[] = [];
    for (const e of r.evidence.slice(1)) (keep.some((k) => sameDiscovery(solo(k), solo(e))) ? keep : rest).push(e);
    if (!rest.length) {
      out.push(r);
      continue;
    }
    const t = now.toISOString();
    out.push({ ...r, evidence: keep, mergedFrom: r.mergedFrom.filter((id) => !rest.some((e) => id === `r-${sha1(e.rawKey).slice(0, 10)}`)), revisions: [...r.revisions, { at: t, reason: "Fusion annulée (sources distinctes)", changes: rest.map((e) => `séparée : « ${e.title} »`) }], updatedAt: t });
    for (const e of rest) {
      out.push({ ...r, id: `r-${sha1(e.rawKey).slice(0, 10)}`, title: e.title, evidence: [e], mergedFrom: [], media: null, firstSeenAt: e.publishedAt ?? r.firstSeenAt, revisions: [{ at: t, reason: "Fusion annulée (sources distinctes)", changes: [`détachée de « ${r.title} »`] }], updatedAt: t });
    }
  }
  return out;
}

export function mergeByFacts(records: RadarRecord[], now: Date): { records: RadarRecord[]; merged: number } {
  records = splitInvalidMerges(records, now);
  const out: RadarRecord[] = [];
  let merged = 0;
  const sorted = [...records].sort((a, b) => a.firstSeenAt.localeCompare(b.firstSeenAt));
  for (const r of sorted) {
    const target = r.status !== "retracted" ? out.find((o) => o.status !== "retracted" && sameDiscovery(o, r)) : undefined;
    if (!target) {
      out.push(r);
      continue;
    }
    merged++;
    const keys = new Set(target.evidence.map((e) => e.rawKey));
    target.evidence.push(...r.evidence.filter((e) => !keys.has(e.rawKey)));
    target.mergedFrom = [...new Set([...(target.mergedFrom ?? []), r.id, ...(r.mergedFrom ?? [])])];
    if (!target.media && r.media) target.media = r.media;
    target.revisions.push({ at: now.toISOString(), reason: "Même découverte décrite par une autre source", changes: [`fusion : « ${r.title} » (${r.evidence.map((e) => e.sourceName).join(", ")})`] });
    target.updatedAt = now.toISOString();
  }
  const order = new Map(records.map((r, i) => [r.id, i]));
  return { records: out.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)), merged };
}

/** Consolidation champ par champ : valeur majoritaire, toutes les citations, contradictions signalées. */
export function consolidate(evs: Evidence[]): RecordDetails | null {
  const withFacts = evs.filter((e) => e.deep?.facts);
  if (!withFacts.length) return null;
  const pick = <T>(get: (e: Evidence) => { value: T; quote: string; url: string } | null, key: (v: T) => string): DetailField<T> | null => {
    const refs = withFacts.map((e) => ({ e, f: get(e) })).filter((x): x is { e: Evidence; f: { value: T; quote: string; url: string } } => !!x.f);
    if (!refs.length) return null;
    const counts = new Map<string, number>();
    for (const r of refs) counts.set(key(r.f.value), (counts.get(key(r.f.value)) ?? 0) + 1);
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const chosen = refs.find((r) => key(r.f.value) === best)!;
    const ref = (r: (typeof refs)[number]) => ({ sourceName: r.e.sourceName, url: r.f.url, quote: r.f.quote });
    return { value: chosen.f.value, support: refs.filter((r) => key(r.f.value) === best).map(ref), conflicts: refs.filter((r) => key(r.f.value) !== best).map(ref) };
  };
  const F = (e: Evidence) => e.deep!.facts!;

  // Argent : intervalle couvrant les montants compatibles ; un montant incompatible est une contradiction
  let money: RecordDetails["money"] = null;
  const ms = withFacts.filter((e) => F(e).money).map((e) => ({ e, m: F(e).money! }));
  if (ms.length) {
    const support = ms.filter((x) => ms.filter((y) => moneyCompatible(x.m.value, y.m.value)).length * 2 > ms.length);
    const base = support.length ? support : [ms[0]];
    const min = Math.min(...base.map((x) => x.m.value.amount));
    const max = Math.max(...base.map((x) => x.m.value.max ?? x.m.value.amount));
    money = {
      value: { min, max: max > min ? max : null, approx: base.some((x) => x.m.value.approx) || max > min },
      support: base.map((x) => ({ sourceName: x.e.sourceName, url: x.m.url, quote: x.m.quote })),
      conflicts: ms.filter((x) => !base.includes(x)).map((x) => ({ sourceName: x.e.sourceName, url: x.m.url, quote: x.m.quote })),
    };
  }

  const details: RecordDetails = {
    chapter: pick((e) => F(e).chapter, String),
    money,
    mission: pick((e) => F(e).mission, norm),
    giver: pick((e) => F(e).giver, norm),
    unlockAfter: pick((e) => F(e).unlockAfter, norm),
    place: pick((e) => F(e).place && { ...F(e).place!, value: { name: F(e).place!.value.name, district: F(e).place!.value.district } }, (v) => norm(v.name)),
    missable: pick((e) => F(e).missable, String),
    contextMissable: pick((e) => F(e).contextMissable, (v) => norm(`${v.subject}|${v.until}`)),
    handsOn: withFacts.some((e) => F(e).handsOn),
    missing: [],
  };
  const LABELS: Array<[keyof RecordDetails, string]> = [["chapter", "chapitre"], ["money", "récompense"], ["mission", "mission associée"], ["unlockAfter", "condition d'accès"], ["place", "lieu"], ["missable", "risque de manquer"]];
  details.missing = LABELS.filter(([k]) => details[k] == null).map(([, l]) => l);
  return details;
}

const fmt = (n: number) => n.toLocaleString("fr-FR").replace(/ | /g, " ");

/** Conseil prêt pour « Que faire maintenant ? » — uniquement à partir des champs établis. */
export function adviceFor(rec: RadarRecord): RadarRecord["advice"] {
  const d = rec.details;
  if (!d || !rec.actionable) return null;
  const parts: string[] = [];
  if (d.money) parts.push(`${d.money.value.approx ? "≈ " : ""}${fmt(d.money.value.min)}${d.money.value.max ? `–${fmt(d.money.value.max)}` : ""} $`);
  if (d.place) parts.push(`${d.place.value.name}${d.place.value.district ? ` (${d.place.value.district})` : ""}`);
  if (!parts.length) return null;
  const via = d.mission ? ` pendant « ${d.mission.value} »${d.giver ? ` (${d.giver.value})` : ""}` : d.giver ? ` via ${d.giver.value}` : "";
  const unlock = d.unlockAfter ? ` Accessible après « ${d.unlockAfter.value} ».` : "";
  const until = d.contextMissable?.value.until ? ` La mission disparaît au lancement de « ${d.contextMissable.value.until} ».` : "";
  return {
    text: `${parts.join(" · ")}${via}.${unlock}${until}`.replace(/\.\./g, "."),
    chapterMin: d.chapter?.value ?? null,
    urgency: d.contextMissable?.value.until || d.missable?.value === true ? "now" : "anytime",
  };
}

/** Point proposé uniquement si le lieu cité correspond EXACTEMENT à un repère de la carte communautaire. */
export function suggestionFor(details: RecordDetails | null) {
  if (!details?.place) return null;
  return exactLandmark(details.place.value.name, details.place.value.district);
}
