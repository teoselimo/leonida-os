/**
 * Pictogrammes de la carte (V0.15) : dessinés par LEONIDA OS, dans l'esprit des « blips » de carte de jeu
 * (pastille colorée, contour sombre, symbole blanc lisible), sans reprendre aucun fichier d'icône propriétaire.
 * Chaque symbole est un tracé 24×24 rendu sur canvas en 2× : net sur écran Retina, aucun serveur de polices.
 */
export type PoiKind =
  | "repere"
  | "vetements"
  | "armurerie"
  | "coiffeur"
  | "tatoueur"
  | "boutique"
  | "station"
  | "garage"
  | "tuning"
  | "restaurant"
  | "bar"
  | "hotel"
  | "loisirs"
  | "transport"
  | "maison"
  | "autre";

interface Glyph {
  color: string;
  label: string;
  /** Tracés pleins (blanc). */
  fill?: string[];
  /** Tracés en trait (blanc, 2,2 px). */
  stroke?: string[];
  /** Découpes sombres par-dessus (fenêtres, portes). */
  cut?: string[];
}

export const KIND: Record<PoiKind, Glyph> = {
  repere: { color: "#F5A524", label: "Repère", fill: ["M12 3.2l2.7 5.5 6 .9-4.35 4.2 1 6L12 17l-5.35 2.8 1-6L3.3 9.6l6-.9z"] },
  vetements: { color: "#FF3D8B", label: "Vêtements", fill: ["M8.3 4L3.6 6.6l2 3.6 1.6-.9V20h9.6V9.3l1.6.9 2-3.6L15.7 4c-.6 1.5-2 2.4-3.7 2.4S8.9 5.5 8.3 4z"] },
  armurerie: { color: "#F04438", label: "Armurerie", fill: ["M3 7.5h15.5v3.6h-6.2l-.9 2h-2.2L8 19.5H4.4l1.6-6.4H3z", "M18.9 8h2.3v2.5h-2.3z"] },
  coiffeur: { color: "#E879F9", label: "Coiffeur", stroke: ["M8.4 9L20 17.5", "M8.4 15L20 6.5", "M6 9.6a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2z", "M6 19.6a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2z"] },
  tatoueur: { color: "#A78BFA", label: "Tatoueur", fill: ["M15.2 3.4l5.4 5.4-1.9 1.9-5.4-5.4z", "M12.4 6.2l5.4 5.4-6.7 6.7-4.4 1.2 1.2-4.4z"], stroke: ["M5.2 18.8L3.4 20.6"] },
  boutique: { color: "#FF5FA2", label: "Boutique", fill: ["M5.6 8.4h12.8l-1.1 11.8H6.7z"], stroke: ["M9 8.4V6.8a3 3 0 0 1 6 0v1.6"] },
  station: { color: "#FF7A45", label: "Station-service", fill: ["M4.5 4h9v16.5h-9z"], stroke: ["M13.5 8.5h2.3l2 2v6.8a1.5 1.5 0 0 0 3 0V9.6l-2.2-2.2"], cut: ["M6.5 6h5v4h-5z"] },
  garage: { color: "#3BA3FF", label: "Garage", fill: ["M14.8 3.6a4.6 4.6 0 0 0-5.6 5.9L3.4 15.3a1.9 1.9 0 0 0 0 2.7l2.6 2.6a1.9 1.9 0 0 0 2.7 0l5.8-5.8a4.6 4.6 0 0 0 5.9-5.6l-2.9 2.9-2.9-.7-.7-2.9z"] },
  tuning: { color: "#22D3EE", label: "Tuning / peinture", fill: ["M8.5 9.5h7v10.8h-7z", "M10.2 5.3h3.6v3.2h-3.6z"], stroke: ["M17.6 4.2l2.4-1.2", "M17.8 7h2.8", "M17.6 9.8l2.4 1.2"] },
  restaurant: { color: "#FFC233", label: "Restaurant", stroke: ["M7 3v6.4a2 2 0 0 0 2 2V21", "M5 3v4.8", "M9 3v4.8", "M16.5 3c-2.2 2.1-2.2 6.6 0 8.6V21"] },
  bar: { color: "#F59E0B", label: "Bar / club", fill: ["M4 4.8h16l-8 8.2z"], stroke: ["M12 13v6.4", "M8 20.2h8"] },
  hotel: { color: "#A879FF", label: "Hôtel", fill: ["M2.8 13.5h18.4v4.5H2.8z", "M10.5 9h7.2a3.5 3.5 0 0 1 3.5 3.5v1H10.5z"], stroke: ["M3.6 7v13", "M20.4 18v2"], cut: [] },
  loisirs: { color: "#14E0C8", label: "Loisirs", stroke: ["M9 17.2V5.2l10-2.2v12"], fill: ["M6.6 19.6a2.6 2.1 0 1 0 0-4.2 2.6 2.1 0 0 0 0 4.2z", "M16.6 17.4a2.6 2.1 0 1 0 0-4.2 2.6 2.1 0 0 0 0 4.2z"] },
  transport: { color: "#94A3B8", label: "Transport", fill: ["M5 3.8h14v13.4H5z", "M6 17h3v2.8H6z", "M15 17h3v2.8h-3z"], cut: ["M7 6h10v4.6H7z"] },
  maison: { color: "#34D399", label: "Planque / maison", fill: ["M3.6 11.2L12 3.8l8.4 7.4V20.6H3.6z"], cut: ["M10 14h4v6.6h-4z"] },
  autre: { color: "#B8B2C8", label: "Lieu", fill: ["M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z"] },
};

/** Pastille de catégorie : 52 px de côté en 2× (26 px affichés), anneau blanc si établissement confirmé. */
export function drawKind(kind: PoiKind, confirmed = false): ImageData {
  const g0 = KIND[kind] ?? KIND.autre;
  const S = 52;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  const r = S / 2 - 4;
  g.beginPath();
  g.arc(S / 2, S / 2, r + 2.5, 0, Math.PI * 2);
  g.fillStyle = confirmed ? "#ffffff" : "rgba(6,4,12,0.92)";
  g.fill();
  g.beginPath();
  g.arc(S / 2, S / 2, r, 0, Math.PI * 2);
  g.fillStyle = g0.color;
  g.fill();
  g.lineWidth = 1.5;
  g.strokeStyle = "rgba(0,0,0,0.35)";
  g.stroke();
  // symbole centré : 24 → 30 px
  g.save();
  g.translate(S / 2 - 15, S / 2 - 15);
  g.scale(30 / 24, 30 / 24);
  g.fillStyle = "#ffffff";
  g.strokeStyle = "#ffffff";
  g.lineWidth = 2.2;
  g.lineCap = "round";
  g.lineJoin = "round";
  for (const d of g0.fill ?? []) g.fill(new Path2D(d));
  for (const d of g0.stroke ?? []) g.stroke(new Path2D(d));
  g.fillStyle = g0.color;
  for (const d of g0.cut ?? []) g.fill(new Path2D(d));
  g.restore();
  return g.getImageData(0, 0, S, S);
}

/** Groupe de lieux proches : pastille sombre avec le nombre. */
export function drawCluster(n: number, color = "#FF3D8B"): ImageData {
  const t = n > 999 ? "999+" : String(n);
  const S = t.length > 2 ? 64 : 56;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  g.beginPath();
  g.arc(S / 2, S / 2, S / 2 - 3, 0, Math.PI * 2);
  g.fillStyle = "rgba(12,8,24,0.92)";
  g.fill();
  g.lineWidth = 4;
  g.strokeStyle = color;
  g.stroke();
  g.fillStyle = "#ffffff";
  g.font = "700 22px -apple-system, system-ui, 'Segoe UI', sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(t, S / 2, S / 2 + 1);
  return g.getImageData(0, 0, S, S);
}

/** Nom de quartier : capitales espacées, halo sombre, sans fond. */
export function drawDistrict(name: string): ImageData {
  const t = name.toUpperCase();
  const c = document.createElement("canvas");
  const g0 = c.getContext("2d")!;
  const font = "700 22px -apple-system, system-ui, 'Segoe UI', sans-serif";
  g0.font = font;
  const sp = 3;
  const w = Math.ceil(g0.measureText(t).width + sp * t.length) + 16;
  c.width = w;
  c.height = 34;
  const g = c.getContext("2d")!;
  g.font = font;
  g.textBaseline = "middle";
  let x = 8;
  for (const ch of t) {
    g.lineWidth = 5;
    g.strokeStyle = "rgba(6,4,12,0.85)";
    g.strokeText(ch, x, 18);
    g.fillStyle = "#f2ecff";
    g.fillText(ch, x, 18);
    x += g.measureText(ch).width + sp;
  }
  return g.getImageData(0, 0, w, 34);
}
