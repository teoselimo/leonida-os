import { assetUrl } from "./gtadb";
import type { Landmark } from "./gtadb";

/**
 * V0.19 · Extrait de la carte LEONIDA (tuiles GTADB embarquées, CC BY 4.0) autour d'un repère, pour que Claude compare
 * une capture de carte avec les zones candidates. Rendu dans le navigateur (canvas, même origine : pas de blocage CSP).
 * Niveau 3 : 0,5 px par unité de jeu ; un extrait de ±1 800 unités = 1 800 px source, réduit à `size`.
 */
const Z = 3;
const TILE = 2048;
const PX_PER_UNIT = 2 / 2 ** (5 - Z);

function loadImg(src: string): Promise<HTMLImageElement | null> {
  return new Promise((res) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => res(null);
    im.src = src;
  });
}

export async function renderMapRef(lm: Pick<Landmark, "x" | "y">, radius = 1800, size = 768): Promise<Blob | null> {
  if (typeof document === "undefined") return null;
  const cx = (lm.x + 16384) * PX_PER_UNIT;
  const cy = (16384 - lm.y) * PX_PER_UNIT;
  const r = radius * PX_PER_UNIT;
  const x0 = cx - r;
  const y0 = cy - r;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  if (!g) return null;
  g.fillStyle = "#2a7fa0"; // eau par défaut (tuiles de pleine mer absentes)
  g.fillRect(0, 0, size, size);
  const k = size / (2 * r);
  const jobs: Promise<void>[] = [];
  for (let tx = Math.floor(x0 / TILE); tx <= Math.floor((cx + r) / TILE); tx++)
    for (let ty = Math.floor(y0 / TILE); ty <= Math.floor((cy + r) / TILE); ty++)
      jobs.push(
        loadImg(assetUrl(`tiles/${Z}/${tx}/${ty}.jpg`)).then((im) => {
          if (im) g.drawImage(im, (tx * TILE - x0) * k, (ty * TILE - y0) * k, TILE * k, TILE * k);
        }),
      );
  await Promise.all(jobs);
  return new Promise((res) => c.toBlob((b) => res(b), "image/jpeg", 0.82));
}

/** Fabrique la fonction `renderRef(landmarkId)` attendue par le copilote, à partir des repères chargés. */
export function mapRefRenderer(landmarks: Array<{ id: string; x?: number; y?: number }>): (landmarkId: string) => Promise<Blob | null> {
  return async (id) => {
    const lm = landmarks.find((l) => l.id === id);
    return lm && Number.isFinite(lm.x) && Number.isFinite(lm.y) ? renderMapRef({ x: lm.x!, y: lm.y! }) : null;
  };
}
