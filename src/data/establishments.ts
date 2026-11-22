import type { Src } from "./progression";

/**
 * Référentiel des ÉTABLISSEMENTS CONFIRMÉS (V0.12), distinct de la couche communautaire gtadb.
 * - `verification` : « confirmé » = au moins deux sites indépendants le décrivent ; « signalé » = un seul ;
 * - `position` : seulement si elle est établie. `landmarkId` = repère gtadb dont le NOM correspond exactement
 *   (position communautaire) ; `text` = indication en clair d'une source ; aucune coordonnée inventée ;
 * - `unlock` : nœud de progression qui ouvre l'établissement, avec sources.
 * Incrément 1 : Key Lento (zone de départ, chapitre 1), vérifié le 22/11/2026 via Exa.
 */
export type EstCat = "vetements" | "armurerie" | "tatoueur" | "coiffeur" | "garage" | "paint" | "custom" | "station" | "restaurant" | "service";

export const EST_CATS: Record<EstCat, { label: string; plural: string; rx: RegExp }> = {
  vetements: { label: "Magasin de vêtements", plural: "Magasins de vêtements", rx: /\b(vetements?|fringues?|habits?|t shirts?|tee shirts?|tenues?|vestes?|casquettes?|masques?|boutiques? de vetements|magasins? de vetements|s habiller)\b/ },
  armurerie: { label: "Armurerie", plural: "Armureries", rx: /\b(armureries?|ammu ?nation|magasins? d armes|acheter (des |une )?armes?)\b/ },
  tatoueur: { label: "Tatoueur", plural: "Tatoueurs", rx: /\b(tatou\w*|tattoo\w*|piercings?)\b/ },
  coiffeur: { label: "Coiffeur", plural: "Coiffeurs", rx: /\b(coiffeurs?|coiffure|barbiers?|barbe|coupe de cheveux|cheveux|salon)\b/ },
  garage: { label: "Garage / mécanique", plural: "Garages", rx: /\b(garages?|mecanos?|mecanicien|reparer (ma |la )?(voiture|caisse))\b/ },
  paint: { label: "Peinture (respray)", plural: "Ateliers de peinture", rx: /\b(peinture|repeindre|respray|pay n spray|paint ?shop)\b/ },
  custom: { label: "Customisation", plural: "Ateliers de customisation", rx: /\b(custom\w*|tuning|mod ?shops?|modifier (ma |la )?(voiture|caisse))\b/ },
  station: { label: "Station-service", plural: "Stations-service", rx: /\b(stations? essence|stations? service|essence|carburant|faire le plein)\b/ },
  restaurant: { label: "Bar / restaurant", plural: "Bars et restaurants", rx: /\b(bars?|restos?|restaurants?|manger|boire un verre)\b/ },
  service: { label: "Autre service", plural: "Autres services", rx: /\b(bijout\w*|bijoux|collier|liqueurs?|alcool|rhum)\b/ },
};

export function establishmentCategoryFromQuery(n: string): EstCat | null {
  for (const [k, v] of Object.entries(EST_CATS) as Array<[EstCat, (typeof EST_CATS)[EstCat]]>) if (v.rx.test(n)) return k;
  return null;
}

export interface Establishment {
  id: string;
  name: string;
  cats: EstCat[];
  district: string;
  what?: string;
  verification: "confirmé" | "signalé";
  sources: Src[];
  position: { landmarkId?: string; text?: string } | null;
  unlock?: { node: string; text: string; sources: Src[] };
}

const S = {
  outputlag: { name: "Output Lag", url: "https://outputlag.com/guides/gta-6-clothes-masks-haircuts/" },
  leonidaguide: { name: "Leonida Guide", url: "https://leonidaguide.com/guides/gta-6-clothing-stores-barbers-tattoos" },
  openleonida: { name: "openleonida", url: "https://openleonida.com/guides/gta-vi-clothing-stores-salons-tattoos/" },
  gta6db: { name: "GTA 6 DB", url: "https://gta6db.io/map/shops" },
  intel: { name: "Leonida Intel", url: "https://leonida-intel.com/guides/gta-6-haircuts-tattoos/" },
  game8GearUp: { name: "Game8", url: "https://game8.co/games/GTA-6/archives/638530" },
  wikiWeapons: { name: "The Games Wiki", url: "https://thegameswiki.com/gta6/wiki/weapons-and-combat" },
  gtabaseList: { name: "GTABase", url: "https://www.gtabase.com/gta-6/missions/" },
  notebookScratch: { name: "GTA 6 Notebook", url: "https://gta6notebook.com/walkthrough/just-a-scratch/" },
  notebookMods: { name: "GTA 6 Notebook", url: "https://gta6notebook.com/vehicles/how-does-car-customization-work-in-gta-6/" },
  house: { name: "gta6.house", url: "https://gta6.house/library/businesses/coastal-auto-care" },
  fextraRum: { name: "Fextralife", url: "https://gta6.wiki.fextralife.com/Get_Shirley%27s_Rum" },
  checklists: { name: "Game Checklists", url: "https://game-checklists.com/gta6/side-missions-checklist/" },
  wikiOptional: { name: "The Games Wiki", url: "https://thegameswiki.com/gta6/wiki/optional-missions" },
} satisfies Record<string, Src>;

export const ESTABLISHMENTS: Establishment[] = [
  {
    id: "chucks-tackle-shot",
    name: "Chuck's Tackle & Shot (Ammu-Nation)",
    cats: ["armurerie", "vetements"],
    district: "Key Lento",
    what: "armes, munitions, premier masque (Reel Neck Gaiter), tenues de travail",
    verification: "confirmé",
    sources: [S.outputlag, S.leonidaguide, S.game8GearUp],
    position: { text: "à l'est de la maison de Jason (selon Leonida Guide)" },
    unlock: { node: "gear-up", text: "après Gear Up", sources: [S.game8GearUp, S.wikiWeapons] },
  },
  { id: "billies-gift-shop", name: "Billie's Key Lento Gift Shop", cats: ["vetements"], district: "Key Lento", what: "tops Vice City et Leonida, shorts de bain, lunettes, jeans", verification: "confirmé", sources: [S.outputlag, S.leonidaguide, S.openleonida], position: null },
  { id: "wonder-whale", name: "The Wonder Whale", cats: ["vetements"], district: "Key Lento", what: "souvenirs, tenues d'été, accessoires", verification: "confirmé", sources: [S.outputlag, S.leonidaguide, S.openleonida], position: { landmarkId: "L332", text: "village des artistes, statue de baleine juste au sud" } },
  { id: "key-lento-kahuna", name: "Key Lento Kahuna", cats: ["vetements"], district: "Key Lento", what: "souvenirs", verification: "confirmé", sources: [S.outputlag, S.leonidaguide, S.openleonida], position: null },
  { id: "leroys", name: "Leroy's", cats: ["vetements"], district: "Key Lento", what: "t-shirts, souvenirs", verification: "confirmé", sources: [S.gta6db, S.outputlag, S.openleonida], position: null },
  { id: "barnacle-beauties", name: "Barnacle Beauties", cats: ["coiffeur"], district: "Key Lento", what: "coupes, couleurs, barbes", verification: "confirmé", sources: [S.gta6db, S.leonidaguide, S.outputlag, S.intel], position: { text: "au sud de l'île, à côté de la bijouterie The Siren's Chest" } },
  { id: "inked-mermaid", name: "The Inked Mermaid", cats: ["tatoueur"], district: "Key Lento", what: "tatouages style American traditional, piercings", verification: "confirmé", sources: [S.gta6db, S.leonidaguide, S.outputlag, S.intel], position: null },
  { id: "sirens-chest", name: "The Siren's Chest", cats: ["service"], district: "Key Lento", what: "bijouterie", verification: "confirmé", sources: [S.gtabaseList, S.leonidaguide], position: { text: "au sud de l'île, à côté de Barnacle Beauties" } },
  { id: "three-sheets", name: "Three Sheets Liquor", cats: ["service"], district: "Key Lento", what: "magasin d'alcool", verification: "confirmé", sources: [S.fextraRum, S.checklists], position: { text: "au sud de la maison de Jason, auvent rayé rouge et drapeau pirate" } },
  { id: "rusty-anchor", name: "The Rusty Anchor", cats: ["restaurant"], district: "Key Lento", what: "bar", verification: "confirmé", sources: [S.wikiOptional, S.gtabaseList], position: { landmarkId: "L325" } },
  {
    id: "coastal-auto-care",
    name: "Coastal Auto Care",
    cats: ["garage", "custom", "paint"],
    district: "Key Lento",
    what: "atelier de customisation spécialisé rétro (Joey), réparations et peinture",
    verification: "confirmé",
    sources: [S.notebookScratch, S.notebookMods, S.house],
    position: { text: "extrémité sud de Key Lento" },
    unlock: { node: "just-a-scratch", text: "avec Just a Scratch", sources: [S.house, S.notebookScratch] },
  },
];

/** Établissement confirmé rattaché à un repère gtadb (pour la fiche du lieu sur la carte). */
export function establishmentForLandmark(landmarkId: string): Establishment | null {
  return ESTABLISHMENTS.find((e) => e.position?.landmarkId === landmarkId) ?? null;
}
