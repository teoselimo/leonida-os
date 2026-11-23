import { KNOWLEDGE, KNOWLEDGE_BY_ID } from "@/data/knowledge";
import ZONES from "@/data/mapZones.json";
import { nk } from "../missions";
import type { Profile } from "../types";
import { CLUES, clueWeight } from "./model";
import type { Clue, KEntity } from "./model";

/**
 * LEONIDA KNOWLEDGE ENGINE (V0.19) — sélection contextuelle et reconnaissance « ancrée ».
 *
 * Le modèle multimodal DÉCRIT (indices normalisés, textes lus) ; ce moteur DÉCIDE quels lieux sont compatibles,
 * avec un score explicable. Règles :
 *   - un indice générique (palmiers, eau, plage) ne suffit jamais : poids quasi nul ;
 *   - la progression du joueur ne fait que départager des candidats déjà compatibles (jamais seule) ;
 *   - sous le seuil, aucun lieu n'est proposé (« inconnu ») ;
 *   - une carte n'est jamais convertie en coordonnées : seulement des zones GTADB à confirmer.
 */

export type GroundConfidence = "élevée" | "moyenne" | "faible" | "aucune";

/** Ce que Claude a extrait d'une image (première passe), normalisé. */
export interface Observation {
  kind: "scène" | "carte" | "menu" | "autre";
  /** Probablement GTA VI ? (« non » = autre jeu / photo sans rapport). */
  gta: "oui" | "non" | "incertain";
  clues: Clue[];
  /** Textes lus sur l'image (noms, enseignes, objectifs). */
  texts: string[];
  /** Description courte de ce qui est visible. */
  summary: string;
  /** Véhicules décrits (couleur, type). */
  vehicles: string[];
}

export interface Candidate {
  id: string;
  name: string;
  type: KEntity["type"] | "zone de carte";
  score: number;
  /** Indices compatibles, en clair (2 à 3 pour la réponse). */
  why: string[];
  /** Indices de l'entité qui n'ont PAS été vus (aide à confirmer en jeu). */
  toCheck: string[];
  landmarkId: string | null;
  district: string;
  note?: string;
}

export interface Grounding {
  kind: Observation["kind"];
  candidates: Candidate[];
  confidence: GroundConfidence;
  /** Véhicule reconnu séparément (ex. « et la voiture devant ? »). */
  vehicle: Candidate | null;
  /** Pourquoi aucun candidat n'est retenu, le cas échéant. */
  reason: string | null;
}

const CLUE_SET = new Set<string>(CLUES);
const COLORS = new Set<Clue>(["vehicule_jaune", "vehicule_turquoise", "4x4_gris"]);

/** Normalise la sortie JSON de l'extraction (tolère les fautes, ignore l'inconnu, jamais d'indice inventé). */
export function parseObservation(raw: unknown): Observation | null {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!o) return null;
  const arr = (x: unknown) => (Array.isArray(x) ? x.filter((y): y is string => typeof y === "string") : []);
  const kindRaw = String(o.type ?? o.kind ?? "").toLowerCase();
  const kind: Observation["kind"] = /carte|map/.test(kindRaw) ? "carte" : /menu|interface|hud/.test(kindRaw) ? "menu" : /sc[eè]ne|scene|jeu|gameplay/.test(kindRaw) ? "scène" : "autre";
  const g = String(o.gta6 ?? o.gta ?? "").toLowerCase();
  return {
    kind,
    gta: /^(oui|yes|true)/.test(g) ? "oui" : /^(non|no|false)/.test(g) ? "non" : "incertain",
    clues: [...new Set(arr(o.indices ?? o.clues).map((c) => nk(c).replace(/[ -]/g, "_")).filter((c) => CLUE_SET.has(c)))] as Clue[],
    texts: arr(o.textes ?? o.texts).map((t) => t.slice(0, 80)).slice(0, 12),
    summary: typeof o.resume === "string" ? o.resume.slice(0, 300) : typeof o.summary === "string" ? o.summary.slice(0, 300) : "",
    vehicles: arr(o.vehicules ?? o.vehicles).map((t) => t.slice(0, 80)).slice(0, 4),
  };
}

const named = (e: { name: string; aliases: string[] }, texts: string[]) => {
  const keys = [e.name, ...e.aliases].map((n) => nk(n)).filter((n) => n.length >= 5);
  return texts.some((t) => {
    const k = nk(t);
    return keys.some((n) => k.includes(n) || (k.length >= 6 && n.includes(k)));
  });
};

/** Score d'une entité : indices visuels compatibles (pondérés, comptés une fois), nom lu, puis contexte joueur. */
function scoreEntity(e: KEntity, obs: Observation, p: Pick<Profile, "chapter" | "edition">): Candidate | null {
  const seen = new Set(obs.clues);
  const counted = new Set<Clue>();
  let score = 0;
  const why: string[] = [];
  const toCheck: string[] = [];
  // les caractéristiques qui correspondent le mieux d'abord (ex. Ganado JAUNE vu → variante Retro Build, pas la turquoise)
  const feats = e.visual
    .filter((f) => !(f.condition === "édition Ultimate" && p.edition === "standard"))
    .map((f) => ({ f, n: f.clues.filter((c) => seen.has(c)).reduce((a, c) => a + clueWeight(c), 0) }))
    .sort((a, b) => b.n - a.n);
  for (const { f } of feats) {
    // couleur contradictoire (vu : jaune ; fiche : turquoise) → la caractéristique ne correspond pas
    const fc = f.clues.filter((c) => COLORS.has(c));
    if (fc.length && !fc.some((c) => seen.has(c)) && [...COLORS].some((c) => seen.has(c as Clue))) continue;
    const all = f.clues.filter((c) => seen.has(c));
    const fresh = all.filter((c) => !counted.has(c));
    // la caractéristique compte si un indice DISTINCTIF est vu ; seuls les indices pas encore comptés ajoutent au score
    if (all.some((c) => clueWeight(c) >= 1) && fresh.length) {
      fresh.forEach((c) => counted.add(c));
      score += fresh.reduce((a, c) => a + clueWeight(c), 0);
      why.push(f.text + (f.condition && !f.text.includes(f.condition) ? ` (${f.condition})` : ""));
    } else if (!all.length && f.clues.some((c) => clueWeight(c) >= 1.5)) toCheck.push(f.text);
  }
  const nameRead = named(e, obs.texts);
  if (nameRead) (score += 6), why.unshift("nom lu sur la capture");
  if (score <= 0) return null;
  let note: string | undefined;
  // la progression DÉPARTAGE des candidats déjà compatibles ; elle ne crée jamais un candidat
  if (score >= 2 && e.chapters.includes(p.chapter)) (score *= 1.2), (note = `cohérent avec ton chapitre ${p.chapter}`);
  if (e.lostAfterChapter !== undefined && p.chapter > e.lostAfterChapter) (score *= 0.3), (note = `plus accessible après le chapitre ${e.lostAfterChapter}`);
  return { id: e.id, name: e.name, type: e.type, score: Math.round(score * 10) / 10, why: why.slice(0, 3), toCheck: toCheck.slice(0, 2), landmarkId: e.location.landmarkId ?? null, district: e.location.district, note };
}

function confidenceOf(c: Candidate[], nameRead: boolean): GroundConfidence {
  const [a, b] = c;
  if (!a || a.score < 2.5) return "aucune";
  const margin = a.score - (b?.score ?? 0);
  if (nameRead || (a.score >= 7 && margin >= 2.5)) return "élevée";
  if (a.score >= 4 && margin >= 1.5) return "moyenne";
  return "faible";
}

/** Reconnaissance d'une SCÈNE (capture de jeu) : lieux et véhicule compatibles, classés. */
export function groundScene(obs: Observation, p: Pick<Profile, "chapter" | "edition">): Grounding {
  if (obs.gta === "non") return { kind: obs.kind, candidates: [], confidence: "aucune", vehicle: null, reason: "l'image ne semble pas venir de GTA VI" };
  const all = KNOWLEDGE.map((e) => scoreEntity(e, obs, p)).filter((x): x is Candidate => !!x);
  const places = all.filter((x) => x.type !== "véhicule" && x.type !== "personnage").sort((a, b) => b.score - a.score);
  const vehicles = all.filter((x) => x.type === "véhicule").sort((a, b) => b.score - a.score);
  const nameRead = places[0]?.why[0] === "nom lu sur la capture";
  const confidence = confidenceOf(places, nameRead);
  const vehicle = vehicles[0] && vehicles[0].score >= 1.8 ? vehicles[0] : null;
  return {
    kind: obs.kind,
    candidates: confidence === "aucune" ? [] : places.slice(0, 3),
    confidence,
    vehicle,
    reason: confidence === "aucune" ? (obs.clues.length ? "les indices visibles sont trop génériques pour un lieu de mon référentiel" : "aucun indice exploitable") : null,
  };
}

interface Zone { id: string; landmarkId: string; name: string; district: string; kind: string; x: number; y: number; features: string[]; water: number; waterWide: number; coastal: boolean; island: boolean }
export const MAP_ZONES: Zone[] = (ZONES as { zones: Zone[] }).zones;

/**
 * Reconnaissance d'une CAPTURE DE CARTE : zones GTADB compatibles avec les formes vues (aéroport, port, littoral,
 * île, base militaire…). Mesures issues des repères et des tuiles (scripts/map_zones.py). Jamais de coordonnées.
 */
export function groundMap(obs: Observation): Grounding {
  const has = (c: Clue) => obs.clues.includes(c);
  const wantsAir = has("aeroport") || has("piste_d_atterrissage") || has("pistes_multiples") || has("tour_de_controle");
  const out: Candidate[] = [];
  for (const z of MAP_ZONES) {
    if (wantsAir && z.kind !== "aerodrome") continue;
    if (!wantsAir && z.kind === "aerodrome" && !has("base_militaire")) continue;
    let score = 0;
    const why: string[] = [];
    const toCheck: string[] = [];
    const ent = KNOWLEDGE.find((e) => e.location.landmarkId === z.landmarkId);
    if (named({ name: z.name, aliases: [z.district, ...(ent ? [ent.name, ...ent.aliases] : [])] }, obs.texts)) (score += 6), why.push("nom lu sur la capture");
    if (wantsAir) (score += 2), why.push("aérodrome");
    const feat = (want: boolean, ok: boolean, w: number, txt: string, miss?: string) => {
      if (!want) return;
      if (ok) (score += w), why.push(txt);
      else if (miss) (score -= w / 2), toCheck.push(miss);
    };
    feat(has("marina"), z.features.includes("marina"), 2, "marina à proximité", "pas de marina connue autour");
    feat(has("port") || has("quai"), z.features.includes("quais"), 2, "quais / port voisins", "pas de quai connu autour");
    feat(has("littoral"), z.coastal, 1.5, `en bord de mer (${Math.round(z.water * 100)} % d'eau autour)`, "zone peu côtière");
    feat(has("interieur_des_terres"), !z.coastal, 2, "à l'intérieur des terres", "zone côtière");
    feat(has("ile"), z.island, 1, "zone insulaire");
    feat(has("base_militaire") || has("cloture_militaire"), z.features.includes("militaire"), 3, "base militaire", "pas de base militaire connue");
    feat(has("pistes_multiples"), /International/.test(z.name), 2, "plusieurs grandes pistes");
    if (has("heliport")) toCheck.push("héliport : non répertorié dans GTADB, à vérifier sur la carte");
    if (score <= 0) continue;
    out.push({ id: z.id, name: ent?.name ?? (z.district && z.district !== z.name ? `${z.name}, ${z.district}` : z.name), type: "zone de carte", score: Math.round(score * 10) / 10, why: why.slice(0, 3), toCheck: toCheck.slice(0, 2), landmarkId: z.landmarkId, district: z.district });
  }
  out.sort((a, b) => b.score - a.score);
  const nameRead = out[0]?.why[0] === "nom lu sur la capture";
  const confidence = confidenceOf(out, nameRead);
  return { kind: "carte", candidates: confidence === "aucune" ? [] : out.slice(0, 3), confidence, vehicle: null, reason: confidence === "aucune" ? "aucune zone de la carte LEONIDA ne combine les formes vues" : null };
}

export function ground(obs: Observation, p: Pick<Profile, "chapter" | "edition">): Grounding {
  return obs.kind === "carte" ? groundMap(obs) : groundScene(obs, p);
}

/** Entités citées dans une question (nom ou alias), plus leurs voisines directes (relations). */
export function entitiesForQuestion(q: string, limit = 4): KEntity[] {
  const k = ` ${nk(q)} `;
  const hit = KNOWLEDGE.filter((e) => [e.name, ...e.aliases].some((n) => {
    const m = nk(n);
    return m.length >= 4 && k.includes(` ${m} `.replace(/ +/g, " ")) || (m.length >= 6 && k.includes(m));
  }));
  const rel = hit.flatMap((e) => e.relations.map((r) => KNOWLEDGE_BY_ID.get(r.to)).filter((x): x is KEntity => !!x));
  return [...new Set([...hit, ...rel])].slice(0, limit);
}

/** Bloc de connaissances pour Claude : faits sourcés, caractéristiques visuelles, contradictions, inconnues. */
export function knowledgeBlock(ents: KEntity[]): string {
  if (!ents.length) return "";
  return ents
    .map((e) =>
      [
        `• ${e.name} [${e.type}, ${e.location.district}${e.location.landmarkId ? `, repère ${e.location.landmarkId}` : ""}] — ${e.description}`,
        e.visual.length ? `  Caractéristiques visuelles : ${e.visual.map((v) => v.text + (v.condition ? ` (${v.condition})` : "")).join(" ; ")}` : "",
        e.contradictions.length ? `  Désaccords : ${e.contradictions.join(" ")}` : "",
        e.unknowns.length ? `  Non documenté : ${e.unknowns.join(", ")}` : "",
        `  Sources : ${[...new Set(e.sources.map((x) => x.name))].join(", ")} · couverture ${e.coverage}`,
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n");
}

/** Bloc « candidats » pour la seconde passe de Claude (et pour la mémoire visuelle). */
export function groundingBlock(g: Grounding): string {
  const lines = [`RECONNAISSANCE LEONIDA (calculée par le moteur à partir des indices extraits ; confiance : ${g.confidence})`];
  if (!g.candidates.length) lines.push(`- Aucun candidat retenu : ${g.reason ?? "indices insuffisants"}. Ne nomme PAS de lieu précis.`);
  g.candidates.forEach((c, i) => lines.push(`- Candidat ${i + 1} (id ${c.id}, score ${c.score}) : ${c.name}, ${c.district}. Indices compatibles : ${c.why.join(" ; ") || "—"}${c.toCheck.length ? `. À vérifier : ${c.toCheck.join(" ; ")}` : ""}${c.note ? `. ${c.note}` : ""}`));
  if (g.vehicle) lines.push(`- Véhicule compatible : ${g.vehicle.name} (${g.vehicle.why.join(" ; ")})`);
  const ents = g.candidates.map((c) => KNOWLEDGE_BY_ID.get(c.id)).filter((x): x is KEntity => !!x);
  if (g.vehicle) ents.push(KNOWLEDGE_BY_ID.get(g.vehicle.id)!);
  const kb = knowledgeBlock(ents.filter(Boolean));
  if (kb) lines.push(`FICHES KNOWLEDGE DES CANDIDATS\n${kb}`);
  return lines.join("\n");
}
