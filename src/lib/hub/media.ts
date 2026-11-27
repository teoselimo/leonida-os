import { assetUrl } from "@/lib/gtadb";
import type { PersistedState } from "@/lib/types";

/**
 * V0.20.1 · Couche média des fiches véhicule (réutilisable : Garage, fiches, carte).
 * Ordre : capture du JOUEUR (sauvegarde locale) → image de référence EXACTE du manifeste (même fiche, jamais un modèle
 * voisin) → aucune image (le visuel de remplacement est dessiné par l'interface). Chargement différé, cache mémoire.
 */
export interface VehicleMediaManifest {
  policy: string;
  sources: Record<string, { allowed: boolean; license: string; exactAvailable: number; ambiguous: number; noImage: number }>;
  /** Image exacte d'une fiche : case `i` d'une planche (un Artifact est limité à 512 fichiers). */
  refs: Record<string, { atlas: string; i: number; source: string; credit: string }>;
  atlas?: { cols: number; rows: number; cellW: number; cellH: number };
}
/** Découpe CSS d'une case de planche (fond positionné : seule la planche des cartes affichées est téléchargée). */
export interface Sprite {
  src: string;
  /** background-position et background-size en %. */
  pos: string;
  size: string;
}
export type VehicleMedia = { kind: "capture"; src: string; at: string } | { kind: "reference"; sprite: Sprite; credit: string; source: string } | { kind: "none" };

let manifest: Promise<VehicleMediaManifest | null> | null = null;
export function loadVehicleMedia(): Promise<VehicleMediaManifest | null> {
  if (typeof document === "undefined" || typeof fetch === "undefined") return Promise.resolve(null);
  if (!manifest)
    manifest = fetch(assetUrl("data/hub/vehicle-media.json"))
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => {
        manifest = null;
        return null;
      });
  return manifest;
}

/** Visuel d'une fiche : `key` = id de l'état du joueur (Locator / veille / Hub), `hubId` = fiche GTABase exacte. */
export function mediaOf(key: string, hubId: string | undefined, s: Pick<PersistedState, "proofs">, m: VehicleMediaManifest | null): VehicleMedia {
  const caps = (s.proofs?.[key] ?? []).filter((p) => p.kind === "capture" && p.value.startsWith("data:image/"));
  const mine = caps.find((p) => p.note === "visuel") ?? caps.at(-1);
  if (mine) return { kind: "capture", src: mine.value, at: mine.at };
  const ref = hubId ? m?.refs[hubId] : undefined;
  if (ref && m?.atlas) {
    const { cols, rows } = m.atlas;
    const c = ref.i % cols;
    const r = Math.floor(ref.i / cols);
    const sprite = { src: assetUrl(ref.atlas), pos: `${cols > 1 ? (c * 100) / (cols - 1) : 0}% ${rows > 1 ? (r * 100) / (rows - 1) : 0}%`, size: `${cols * 100}% ${rows * 100}%` };
    return { kind: "reference", sprite, credit: ref.credit, source: ref.source };
  }
  return { kind: "none" };
}

/** Réduit une photo du joueur (≤ 640 px, JPEG ≈ 60 Ko) : jamais l'original dans la sauvegarde. */
export async function shrinkPhoto(file: File, max = 640): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const k = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.width * k));
    c.height = Math.max(1, Math.round(img.height * k));
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    let q = 0.7;
    let out = c.toDataURL("image/jpeg", q);
    while (out.length > 82_000 && q > 0.35) out = c.toDataURL("image/jpeg", (q -= 0.1));
    return out;
  } finally {
    URL.revokeObjectURL(url);
  }
}
