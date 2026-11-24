import { assetUrl } from "@/lib/gtadb";
import { KNOWLEDGE } from "@/data/knowledge";
import type { Grounding } from "@/lib/knowledge/engine";
import type { Observation } from "@/lib/knowledge/engine";
import type { Profile } from "@/lib/types";

/**
 * V0.20.1 · Références visuelles GTADB pour Vision : photos EN JEU du dépôt GTADB (CC BY 4.0 selon le dépôt, images du
 * jeu © Rockstar ; usage validé par Théo), réduites à 640 px et ≤ 70 Ko. Index : public/data/hub/vision-refs.json
 * (produit par hub/vision_refs.py). Chargées À LA DEMANDE, seulement pour une capture de scène.
 */
export interface VisionRef {
  id: string;
  name: string | null;
  district: string | null;
  file: string;
  w: number;
  h: number;
  bytes: number;
  knowledge: string | null;
  tags: string[];
  why: string;
  source: string;
  gtadbUpdated: string | null;
}
export interface VisionRefIndex {
  revision: string;
  license: string;
  available: number;
  count: number;
  bytes: number;
  refs: VisionRef[];
}

/** Limites strictes d'un tour : 3 références au plus, 210 Ko au total (la capture du joueur passe avant). */
export const REF_MAX = 3;
export const REF_MAX_BYTES = 210_000;

let idx: Promise<VisionRefIndex | null> | null = null;
export function loadRefIndex(): Promise<VisionRefIndex | null> {
  if (typeof document === "undefined" || typeof fetch === "undefined") return Promise.resolve(null);
  if (!idx)
    idx = fetch(assetUrl("data/hub/vision-refs.json"))
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => {
        idx = null;
        return null;
      });
  return idx;
}

const blobs = new Map<string, Promise<Blob | null>>();
export function loadRefBlob(r: VisionRef): Promise<Blob | null> {
  if (!blobs.has(r.id))
    blobs.set(
      r.id,
      fetch(assetUrl(r.file))
        .then((x) => (x.ok ? x.blob() : null))
        .then((b) => (b && b.size <= 80_000 ? b : null)) // jamais une référence plus lourde que prévu
        .catch(() => {
          blobs.delete(r.id);
          return null;
        }),
    );
  return blobs.get(r.id)!;
}

/** Quartiers cités par les indices ou les textes lus (ex. « Key Lento » sur un panneau). */
function districtHints(obs: Observation | null): string[] {
  const t = [...(obs?.texts ?? []), obs?.summary ?? ""].join(" ").toLowerCase();
  return ["key lento", "vice city", "vice beach", "port gellhorn", "hamlet", "mariana county", "watson bay", "kelly county"].filter((d) => t.includes(d));
}

export interface RefPick {
  ref: VisionRef;
  /** Pourquoi cette référence est comparée : candidat du moteur, ou lieu probable d'après la progression. */
  reason: "candidat" | "progression";
}

/**
 * Sélection AVANT comparaison :
 *   1. références des candidats du moteur (dans leur ordre) ;
 *   2. complément : lieux Knowledge du chapitre du joueur (ou du quartier lu sur la capture), photo disponible.
 * Jamais plus de REF_MAX ni de REF_MAX_BYTES ; aucune référence pour une capture de carte, de menu ou hors GTA VI.
 */
export function selectRefs(index: VisionRefIndex, g: Grounding | null, obs: Observation | null, profile: Pick<Profile, "chapter">, max = REF_MAX): RefPick[] {
  if (!obs || obs.kind === "carte" || obs.kind === "menu" || obs.gta === "non") return [];
  const byLm = new Map(index.refs.map((r) => [r.id, r]));
  const out: RefPick[] = [];
  let bytes = 0;
  const add = (r: VisionRef | undefined, reason: RefPick["reason"]) => {
    if (!r || out.length >= max || out.some((x) => x.ref.id === r.id) || bytes + r.bytes > REF_MAX_BYTES) return;
    out.push({ ref: r, reason });
    bytes += r.bytes;
  };
  for (const c of g?.candidates ?? []) if (c.landmarkId) add(byLm.get(c.landmarkId), "candidat");
  const hints = districtHints(obs);
  const ch = profile.chapter;
  const fill = KNOWLEDGE.filter((e) => e.location.landmarkId && byLm.has(e.location.landmarkId) && e.type !== "zone" && (hints.length ? hints.some((h) => e.location.district.toLowerCase().includes(h)) : !e.chapters.length || e.chapters.includes(ch)) && !(e.lostAfterChapter && ch > e.lostAfterChapter));
  for (const e of fill) add(byLm.get(e.location.landmarkId!), "progression");
  return out;
}

/** Nom affichable d'une référence (« Lieu non nommé, Key Lento » si GTADB ne le nomme pas). */
export const refLabel = (r: VisionRef) => r.name ?? `Lieu non nommé${r.district ? `, ${r.district}` : ""}`;
