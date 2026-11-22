/**
 * LEONIDA PROGRESSION — graphe de progression GTA VI, chapitre 1 (incrément 1, vérifié le 22/11/2026 via Exa).
 *
 * Règles de saisie :
 * - un PRÉREQUIS n'est saisi que si une source l'écrit explicitement (« requiert », « débloqué après », « démarre
 *   automatiquement après »). L'ordre d'une liste de guide (« Story Recap ») n'est PAS un prérequis : il sert à
 *   ordonner l'affichage, jamais à déclarer une mission accessible ;
 * - `basis: "déduit"` = lien probable mais non écrit tel quel (ex. listé après une mission, ou « pendant ou après ») ;
 * - chaque nœud, manquable, déblocage ou point de non-retour porte ses sources ; le nombre de sources distinctes
 *   compte (≥ 2 sites = recoupé) ;
 * - missions non couvertes par cet incrément : statut « disponibilité inconnue », jamais deviné.
 * Couverture : chapitre 1 (missions principales de Gear Up à Discharge Time, missions et activités facultatives de
 * Key Lento). Les chapitres suivants viendront par incréments sourcés.
 */

export interface Src {
  name: string;
  url: string;
}

export interface Prereq {
  /** Tous ces nœuds doivent être terminés. */
  all: string[];
  basis: "explicite" | "déduit";
  sources: Src[];
  /** Condition hors progression (« lire un flyer », « de nuit »), en clair. */
  condition?: string;
  note?: string;
}

export interface Missable {
  text: string;
  when: "avant" | "pendant" | "apres";
  /** Emplacement précis établi par les sources (sinon l'app dit « emplacement incertain »). */
  locationCertain: boolean;
  sources: Src[];
}

export interface ProgNode {
  id: string;
  name: string;
  /** Autres noms affichés en jeu (étiquette de la carte, ex. « Talk to Lucia » pour Recalibration), sourcés. */
  aliases?: string[];
  kind: "main" | "side" | "activity";
  chapter: number;
  /** Rang dans le « Story Recap » du jeu (affichage seulement — jamais une preuve de prérequis). */
  recap?: number;
  character?: "Jason" | "Lucia";
  where?: string;
  district?: string;
  /** null = prérequis non documentés → « disponibilité inconnue ». */
  prereq: Prereq | null;
  /** Démarre seule quand ses prérequis sont faits. */
  auto?: boolean;
  /** Devient indisponible au début (start) ou à la fin (end) d'un autre nœud. */
  lostAt?: { node: string; at: "start" | "end"; sources: Src[] };
  missables?: Missable[];
  unlocks?: Array<{ text: string; sources: Src[] }>;
  pointOfNoReturn?: { text: string; lose: string[]; keep: string[]; sources: Src[]; note?: string };
  choices?: Array<{ text: string; sources: Src[] }>;
}

const S = {
  polygon: { name: "Polygon", url: "https://www.polygon.com/gta-6-mission-chapter-list-how-many/" },
  playgta6: { name: "PlayGTA6", url: "https://playgta6.co.uk/gta-6-walkthrough-chapter-1/" },
  howto: { name: "How To Video Game", url: "https://howtovideogame.com/gta-6-chapter-1-missions/" },
  gtabaseList: { name: "GTABase", url: "https://www.gtabase.com/gta-6/missions/" },
  gtabaseRecal: { name: "GTABase", url: "https://www.gtabase.com/gta-6/missions/recalibration" },
  gtabaseDonGone: { name: "GTABase", url: "https://www.gtabase.com/gta-6/missions/don-gone" },
  wikiSwamped: { name: "The Games Wiki", url: "https://thegameswiki.com/gta6/wiki/swamped" },
  wikiDonGone: { name: "The Games Wiki", url: "https://thegameswiki.com/gta6/wiki/don-gone" },
  wikiOptional: { name: "The Games Wiki", url: "https://thegameswiki.com/gta6/wiki/optional-missions" },
  wikiMissables: { name: "The Games Wiki", url: "https://thegameswiki.com/gta6/wiki/missable-content-and-points-of-no-return" },
  wikiWeapons: { name: "The Games Wiki", url: "https://thegameswiki.com/gta6/wiki/weapons-and-combat" },
  powerpyxRecal: { name: "PowerPyx", url: "https://www.powerpyx.com/gta-6-recalibration-talk-to-lucia-walkthrough/" },
  powerpyxDonGone: { name: "PowerPyx", url: "https://www.powerpyx.com/gta-6-don-gone-head-to-donnies-trailer-walkthrough/" },
  powerpyxSF: { name: "PowerPyx", url: "https://www.powerpyx.com/gta-6-all-strangers-freaks-side-missions/" },
  gta6walkSwamped: { name: "GTA6Walk", url: "https://www.gta6walk.com/walkthrough/swamped/" },
  gta6walkRecal: { name: "GTA6Walk", url: "https://www.gta6walk.com/walkthrough/recalibration/" },
  viceAtlas: { name: "Vice Atlas", url: "https://www.vice-atlas.com/briefings/gta6-recalibration-walkthrough/" },
  game8Missables: { name: "Game8", url: "https://game8.co/games/GTA-6/archives/638531" },
  game8GearUp: { name: "Game8", url: "https://game8.co/games/GTA-6/archives/638530" },
  gtaboomDonGone: { name: "GTA BOOM", url: "https://www.gtaboom.com/gta-6-don-gone-walkthrough-35e0" },
  viceboard: { name: "ViceBoard", url: "https://viceboard.com/answers/missable-unique-weapons-gta-6/" },
  fextraRum: { name: "Fextralife", url: "https://gta6.wiki.fextralife.com/Get_Shirley%27s_Rum" },
  checklists: { name: "Game Checklists", url: "https://game-checklists.com/gta6/side-missions-checklist/" },
  tech4gamers: { name: "Tech4Gamers", url: "https://gta.tech4gamers.com/gta-6/guides/strangers-and-freaks/" },
  notebookScratch: { name: "GTA 6 Notebook", url: "https://gta6notebook.com/walkthrough/just-a-scratch/" },
  notebookMods: { name: "GTA 6 Notebook", url: "https://gta6notebook.com/vehicles/how-does-car-customization-work-in-gta-6/" },
  house: { name: "gta6.house", url: "https://gta6.house/library/businesses/coastal-auto-care" },
} satisfies Record<string, Src>;

const KEY_JOBS = ["gear-up", "lab-fees", "just-a-scratch", "unwanted-attention"];

export const PROGRESSION: ProgNode[] = [
  // ── Missions principales (ordre du Story Recap : affichage uniquement) ──
  { id: "prologue", name: "Prologue", kind: "main", chapter: 1, recap: 1, prereq: null },
  { id: "gone-fishing", name: "Gone Fishing", kind: "main", chapter: 1, recap: 2, prereq: null },
  {
    id: "gear-up",
    name: "Gear Up",
    kind: "main",
    chapter: 1,
    recap: 3,
    district: "Key Lento",
    where: "Chuck's Tackle & Shot (Ammu-Nation)",
    prereq: { all: ["gone-fishing"], basis: "explicite", sources: [S.game8GearUp] },
    unlocks: [{ text: "Achat d'armes dans les Ammu-Nation, casiers d'armes et coffres de véhicule", sources: [S.game8GearUp, S.wikiWeapons] }],
  },
  { id: "just-a-scratch", name: "Just a Scratch", aliases: ["Fix Your Car"], kind: "main", chapter: 1, recap: 4, district: "Key Lento", where: "Coastal Auto Care", prereq: { all: ["gone-fishing"], basis: "explicite", sources: [S.notebookScratch] }, unlocks: [{ text: "Ateliers de customisation et Pay 'n' Spray", sources: [S.house, S.notebookScratch] }] },
  { id: "lab-fees", name: "Lab Fees", kind: "main", chapter: 1, recap: 5, district: "Key Lento", prereq: { all: ["gone-fishing"], basis: "déduit", sources: [S.playgta6], note: "jouable dans n'importe quel ordre avec Gear Up, Just a Scratch et Unwanted Attention" } },
  { id: "unwanted-attention", name: "Unwanted Attention", kind: "main", chapter: 1, recap: 6, prereq: { all: ["gone-fishing"], basis: "déduit", sources: [S.playgta6], note: "jouable dans n'importe quel ordre avec les trois autres missions de Key Lento" } },
  { id: "pipework", name: "Pipework", kind: "main", chapter: 1, recap: 7, district: "Key Lento", prereq: { all: KEY_JOBS, basis: "explicite", sources: [S.playgta6, S.fextraRum, S.checklists] } },
  { id: "hey-arnold", name: "Hey Arnold!", kind: "main", chapter: 1, recap: 8, prereq: { all: ["pipework"], basis: "explicite", sources: [S.playgta6] } },
  { id: "island-dreams", name: "Island Dreams", kind: "main", chapter: 1, recap: 9, prereq: { all: ["hey-arnold"], basis: "explicite", sources: [S.playgta6] } },
  { id: "feng-shui", name: "Feng Shui", kind: "main", chapter: 1, recap: 10, prereq: null },
  { id: "coming-home", name: "Coming Home", kind: "main", chapter: 1, recap: 11, prereq: null },
  { id: "buck-me", name: "Buck Me", kind: "main", chapter: 1, recap: 12, prereq: null },
  { id: "clean-up-after-donnie", name: "Clean Up After Donnie", kind: "main", chapter: 1, recap: 13, prereq: null },
  { id: "down-to-earth", name: "Down to Earth", kind: "main", chapter: 1, recap: 14, prereq: { all: ["clean-up-after-donnie", "buck-me"], basis: "explicite", sources: [S.playgta6] } },
  { id: "clear-skies", name: "Clear Skies", kind: "main", chapter: 1, recap: 15, prereq: { all: ["down-to-earth"], basis: "explicite", sources: [S.playgta6], note: "disponible en parallèle de Day Release" } },
  { id: "day-release", name: "Day Release", kind: "main", chapter: 1, recap: 16, prereq: { all: ["down-to-earth"], basis: "explicite", sources: [S.playgta6], note: "disponible en parallèle de Clear Skies" } },
  { id: "building-a-life", name: "Building a Life", kind: "main", chapter: 1, prereq: { all: ["clear-skies"], basis: "déduit", sources: [S.playgta6, S.gtabaseList], note: "étape de transition après Clear Skies (comptée comme mission par certains guides)" } },
  {
    id: "swamped",
    name: "Swamped",
    kind: "main",
    chapter: 1,
    recap: 17,
    district: "Key Lento",
    where: "Brian's Boat Works & Marina",
    prereq: { all: ["day-release", "clear-skies", "building-a-life"], basis: "explicite", sources: [S.wikiSwamped, S.gta6walkSwamped, S.playgta6] },
  },
  {
    id: "don-gone",
    name: "Don Gone",
    aliases: ["Head to Donnie's Trailer"],
    kind: "main",
    chapter: 1,
    recap: 18,
    district: "Key Lento",
    where: "mobile home de Donnie",
    auto: true,
    prereq: { all: ["swamped"], basis: "explicite", sources: [S.powerpyxDonGone, S.wikiDonGone, S.playgta6] },
    missables: [
      { text: "Revolver unique « Donnie's H&L .38 » dans le coffre de la voiture de Donnie : le prendre avant de la détruire", when: "pendant", locationCertain: true, sources: [S.powerpyxDonGone, S.wikiDonGone, S.gtabaseDonGone, S.gtaboomDonGone, S.game8Missables, S.viceboard] },
      { text: "Lunettes aviateur de Donnie, sur l'étagère de la salle de bain du mobile home (à récupérer à la garde-robe ensuite)", when: "pendant", locationCertain: true, sources: [S.wikiDonGone, S.gtaboomDonGone] },
      { text: "Abaisser le drapeau devant le mobile home (points « Professional » du profil criminel)", when: "avant", locationCertain: true, sources: [S.wikiDonGone, S.gtaboomDonGone] },
    ],
  },
  {
    id: "recalibration",
    name: "Recalibration",
    aliases: ["Talk to Lucia"],
    kind: "main",
    chapter: 1,
    recap: 19,
    district: "Key Lento",
    prereq: { all: ["don-gone"], basis: "explicite", sources: [S.gtabaseRecal, S.gta6walkRecal, S.viceAtlas, S.powerpyxRecal], note: "Lucia appelle pendant ou après Donnie's Lost Drugs (cette mission n'est pas un prérequis strict)" },
  },
  {
    id: "tourist-trap",
    name: "Tourist Trap",
    aliases: ["Take Up Mattia's Offer"],
    kind: "main",
    chapter: 1,
    recap: 20,
    auto: true,
    prereq: { all: ["recalibration"], basis: "explicite", sources: [S.playgta6, S.gta6walkRecal] },
    pointOfNoReturn: {
      text: "Point de non-retour du chapitre 1 : enchaînement de trois missions sans exploration libre jusqu'au chapitre 2",
      lose: ["la maison de Key Lento", "l'argent sur toi", "la planque et le compte BuckMe", "les véhicules personnels"],
      keep: ["l'épargne Family Savings (jusqu'à 5 000 $)", "les armes uniques", "la relation avec Lucia"],
      sources: [S.game8Missables, S.wikiMissables, S.howto, S.playgta6, S.viceAtlas],
      note: "PowerPyx place l'alerte dès Recalibration, IGN et VGC au début de Tourist Trap ; les pertes d'argent et de maison viennent surtout de PowerPyx",
    },
  },
  { id: "home-sweet-home", name: "Home Sweet Home", kind: "main", chapter: 1, recap: 21, auto: true, prereq: { all: ["tourist-trap"], basis: "explicite", sources: [S.howto, S.playgta6] } },
  { id: "discharge-time", name: "Discharge Time", kind: "main", chapter: 1, recap: 22, auto: true, prereq: { all: ["home-sweet-home"], basis: "explicite", sources: [S.howto, S.playgta6] } },

  // ── Missions facultatives et activités (Key Lento, chapitre 1) ──
  {
    id: "get-shirleys-rum",
    name: "Get Shirley's Rum",
    kind: "side",
    chapter: 1,
    district: "Key Lento",
    where: "maison de Shirley, voisine de Jason",
    prereq: { all: KEY_JOBS, basis: "explicite", sources: [S.fextraRum, S.checklists, S.playgta6] },
    lostAt: { node: "tourist-trap", at: "start", sources: [S.wikiOptional, S.fextraRum, S.powerpyxSF] },
  },
  { id: "steal-the-scooter", name: "Steal the Scooter", kind: "side", chapter: 1, district: "Key Lento", prereq: { all: ["get-shirleys-rum"], basis: "explicite", sources: [S.wikiOptional, S.checklists, S.fextraRum] }, lostAt: { node: "tourist-trap", at: "start", sources: [S.wikiOptional, S.powerpyxSF] } },
  { id: "catch-a-bigger-fish", name: "Catch a Bigger Fish", kind: "side", chapter: 1, where: "Gambit Bay", prereq: { all: ["feng-shui"], basis: "explicite", sources: [S.tech4gamers, S.checklists] } },
  {
    id: "skunk-apeology",
    name: "Skunk Apeology 101 (Kirk)",
    aliases: ["Search for the Skunk Ape", "Skunk Apeology 101"],
    kind: "side",
    chapter: 1,
    where: "Pelican Bay, Mariana County",
    prereq: { all: [], basis: "explicite", sources: [S.wikiOptional, S.checklists, S.tech4gamers], condition: "lire un avis de recherche du Skunk Ape (il y en a un à The Rusty Anchor) puis appeler Kirk ; première étape de nuit seulement" },
  },
  { id: "find-the-lost-drugs", name: "Find the Lost Drugs", kind: "side", chapter: 1, where: "quatre zones au nord de Key Lento", prereq: { all: ["down-to-earth"], basis: "déduit", sources: [S.gtabaseList], note: "lancée par un SMS de Cal" }, lostAt: { node: "tourist-trap", at: "start", sources: [S.wikiOptional] } },
  { id: "clock-out", name: "Clock Out", kind: "side", chapter: 1, prereq: { all: ["day-release"], basis: "explicite", sources: [S.wikiOptional] } },
  { id: "ring-the-bell", name: "Ring the Bell!", kind: "side", chapter: 1, district: "Key Lento", where: "The Rusty Anchor", prereq: { all: ["day-release"], basis: "explicite", sources: [S.wikiOptional] }, lostAt: { node: "swamped", at: "start", sources: [S.wikiOptional, S.wikiSwamped] } },
  {
    id: "donnies-lost-drugs",
    name: "Donnie's Lost Drugs",
    kind: "side",
    chapter: 1,
    where: "au large de Corsair Key",
    auto: true,
    prereq: { all: ["swamped"], basis: "explicite", sources: [S.wikiSwamped, S.gtabaseList] },
  },
  {
    id: "donnie-drop-off",
    name: "Revente au point de dépôt de Donnie",
    kind: "activity",
    chapter: 1,
    district: "Key Lento",
    prereq: null,
    lostAt: { node: "swamped", at: "end", sources: [S.game8Missables, S.playgta6, S.wikiSwamped] },
  },
  {
    id: "family-savings",
    name: "Mettre 5 000 $ sur Family Savings",
    kind: "activity",
    chapter: 1,
    prereq: { all: [], basis: "explicite", sources: [S.playgta6, S.gta6walkRecal, S.gtabaseRecal], condition: "à faire avant le point de non-retour : seule épargne conservée" },
    lostAt: { node: "tourist-trap", at: "start", sources: [S.game8Missables, S.wikiMissables] },
  },
];

export const PROG_BY_ID = new Map(PROGRESSION.map((n) => [n.id, n]));
