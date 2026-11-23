import type { Evidence } from "@/lib/evidence";

/**
 * Rare Vehicle Locator V1 — référentiel vérifié à la main (23/11/2026).
 *
 * Chaque fiche complète la fiche collectée automatiquement par la veille (même identifiant, donc même
 * sauvegarde « vehicles[id] ») : emplacements, variantes, présence garantie ou non, conditions, preuves.
 * Aucune coordonnée n'est inventée : une zone est soit délimitée par un élément identifiable du fond de carte
 * gtadb, soit centrée sur des repères communautaires nommés ; sinon la position reste « inconnue » (pas d'épingle).
 */

export type Presence = "fixe" | "mobile" | "aleatoire";

export interface RvlLocation {
  id: string;
  /** Description courte en français. */
  label: string;
  area: string;
  /** point : position exacte vérifiée en jeu · zone : zone documentée ou estimée · inconnue : pas d'épingle. */
  precision: "point" | "zone" | "inconnue";
  zone: { x: number; y: number; radius: number } | null;
  /** Comment la zone a été tracée (toujours affiché). */
  zoneBasis: string;
  /** Zone « documentée » (élément du fond identifié par la description) ou « estimée » (centrée sur des repères). */
  zoneKind?: "documentee" | "estimee" | "large";
  presence: Presence;
  presenceNote: string;
  /** Affirmations (clés de preuve) que cet emplacement représente. */
  claims: { location: string; presence: string };
  steps: string[];
  risks: string[];
}

export interface RvlVariant {
  label: string;
  claim: string;
}

export interface RvlCondition {
  /** Chapitre minimal pour le trouver. */
  chapterMin: number;
  /** Mission (nom anglais du jeu, masqué par l'anti-spoiler si elle est à venir). */
  afterMission?: { name: string; chapter: number };
  /** Donneur de quête (masqué en anti-spoiler strict avant son chapitre). */
  giver?: { name: string; chapter: number };
  /** Rang dans une série imposée (les cibles arrivent dans l'ordre). */
  order?: { rank: number; of: number; series: string };
  other: string[];
  claim: string;
}

export interface RvlKeep {
  /** oui : on peut le garder · non · inconnu : les sources ne le disent pas. */
  possible: "oui" | "non" | "inconnu";
  how: string;
  chapterMin?: number;
  claim?: string;
}

export interface RvlVehicle {
  id: string;
  name: string;
  why: string;
  variants: RvlVariant[];
  locations: RvlLocation[];
  condition: RvlCondition;
  keep: RvlKeep;
  reward?: string;
  evidence: Evidence[];
}

const C = "2026-11-23";
const ev = (e: Omit<Evidence, "collectedAt" | "host"> & { collectedAt?: string; host?: string | null }): Evidence => ({
  collectedAt: C,
  host: e.url ? new URL(e.url).hostname.replace(/^www\./, "") : null,
  ...e,
});

const MOSES = { name: "Moses", chapter: 2 };
const DAILY_DRIVER = { name: "Daily Driver", chapter: 2 };
const POWERPYX_MOSES = "https://www.powerpyx.com/gta-6-steal-vehicles-for-moses-walkthrough";
const GTABOOM_MOSES = "https://www.gtaboom.com/gta-6-moses-vehicle-theft-guide-2d3f";

export const RARE_VEHICLES: RvlVehicle[] = [
  {
    id: "v-maibatsu-penumbra-ff",
    name: "'97 Maibatsu Penumbra FF",
    why: "Clin d'œil à la voiture verte de Paul Walker (Fast & Furious), cachée dans un garage. Accessible dès l'exploration libre.",
    variants: [{ label: "Vert vif, néons dessous, plaque « HAD YOU »", claim: "variant:vert" }],
    locations: [
      {
        id: "vespucci",
        label: "Garage d'une villa sur l'île de Vespucci",
        area: "Île de Vespucci, Rialto Islands (Vice City)",
        precision: "zone",
        zone: { x: 550, y: 1255, radius: 270 },
        zoneKind: "documentee",
        zoneBasis:
          "Île délimitée sur le fond de carte : la deuxième île en partant de Vice Beach par la chaussée, de forme ovale, comme la décrivent les guides. La villa précise n'est pas placée : aucune source ne donne de coordonnées.",
        presence: "fixe",
        presenceNote: "Toujours garée dans le garage (ce n'est pas une apparition aléatoire).",
        claims: { location: "loc:vespucci", presence: "presence:garage" },
        steps: [
          "Depuis Vice Beach, prends la chaussée vers l'ouest à travers les Rialto Islands.",
          "Passe la première île, franchis le deuxième pont : tu es sur l'île de Vespucci.",
          "Entre dans le jardin de la villa moderne, puis dans le garage par la petite porte verte.",
          "Ouvre le grand portail du garage de l'intérieur et démarre la voiture (deux sticks).",
        ],
        risks: [
          "La porte latérale déclenche une alarme : un guide indique qu'on peut la couper sur le mur à gauche en entrant.",
          "Au chapitre 1, la voiture est perdue si tu meurs, si tu es arrêté ou si tu la laisses.",
        ],
      },
    ],
    condition: { chapterMin: 1, other: ["Dès la fin des séquences d'introduction, quand l'exploration libre s'ouvre."], claim: "acces:exploration-libre" },
    keep: { possible: "oui", how: "Immatricule-la dans un Pay 'n' Spray (payant). Vérifie d'abord avec l'appli WAiNK qu'elle n'a pas de traqueur.", chapterMin: 2, claim: "garder:ch2" },
    evidence: [
      ev({ id: "alcast", platform: "guide", url: "https://alcasthq.com/gta-6-paul-walker-car", creator: "AlcastHQ", publishedAt: null, says: "Garage d'une villa sur l'île de Vespucci (ovale, ouest de Vice Beach) ; dispo dès l'exploration libre ; passer par le grand portail ; immatriculation à partir du chapitre 2.", stance: "confirme", claims: ["loc:vespucci", "presence:garage", "acces:exploration-libre", "garder:ch2", "variant:vert"] }),
      ev({ id: "gamesradar", platform: "guide", url: "https://www.gamesradar.com/games/grand-theft-auto/gta-6-paul-walker-fast-and-furious-car", creator: "GamesRadar+", publishedAt: null, says: "Enfermée dans un garage sur l'île de Vespucci, à l'ouest de Vice Beach ; l'alarme se coupe sur le mur à gauche ; immatriculable.", stance: "confirme", claims: ["loc:vespucci", "presence:garage", "garder:ch2"] }),
      ev({ id: "xtreme", platform: "guide", url: "https://www.gta-xtreme.com/en/gta-6-paul-walker-car-location", creator: "GTA Xtreme", publishedAt: null, says: "Garage d'une villa sur Vespucci, « juste au nord de la route » ; petite porte verte puis grand portail.", stance: "confirme", claims: ["loc:vespucci", "presence:garage"] }),
      ev({ id: "insider", platform: "guide", url: "https://insider-gaming.com/paul-walker-gta-6-easter-egg/", creator: "Insider Gaming", publishedAt: null, says: "Garage d'une villa sur Vespucci ; récupérable très tôt, dès la fin des séquences initiales.", stance: "confirme", claims: ["loc:vespucci", "presence:garage", "acces:exploration-libre"] }),
      ev({ id: "gfinity", platform: "guide", url: "https://www.gfinityesports.com/article/gta-6-how-to-find-the-fast-furious-1995-mitsubishi-eclipse", creator: "Gfinity", publishedAt: "2026-11-20", says: "Garage d'une villa résidentielle sur l'île ovale de Vespucci, Rialto Islands.", stance: "confirme", claims: ["loc:vespucci", "presence:garage"] }),
      ev({ id: "gamesgg", platform: "guide", url: "https://games.gg/grand-theft-auto-vi/guides/grand-theft-auto-6-paul-walker-car-location-how-to-get/", creator: "games.gg", publishedAt: null, says: "Garage d'une maison sur Vespucci ; volable tôt, dès l'exploration libre, puis immatriculable.", stance: "confirme", claims: ["loc:vespucci", "presence:garage", "acces:exploration-libre"] }),
      ev({ id: "fandomwire", platform: "guide", url: "https://fandomwire.com/gta-6-hidden-easter-egg-honoring-paul-walker/", creator: "FandomWire", publishedAt: null, says: "Vespucci (Rialto Islands) dès l'exploration libre ; après le deuxième pont, tourner à gauche ; villa moderne voisine d'une propriété avec une voiture de luxe garée devant ; plaque « HAD YOU ».", stance: "confirme", claims: ["loc:vespucci", "acces:exploration-libre", "variant:vert"] }),
      ev({ id: "gameshorizon", platform: "guide", url: "https://gameshorizon.com/?p=82621", creator: "GamesHorizon", publishedAt: null, says: "Traverser d'abord Catalan Island, puis le pont suivant : Vespucci ; récupérable dès qu'on peut voler des voitures.", stance: "confirme", claims: ["loc:vespucci", "acces:exploration-libre"] }),
      ev({ id: "bgr", platform: "guide", url: "https://www.bgr.com/2322463/gta-6-hidden-fast-and-furious-paul-walker-car/", creator: "BGR", publishedAt: null, says: "Reprend l'information de Vice : garage attenant à une maison blanche au milieu de l'île.", stance: "confirme", claims: ["loc:vespucci"], origin: "vice.com" }),
    ],
  },
  {
    id: "v-bf-bandito",
    name: "BF Bandito",
    why: "Buggy monoplace, la cible la mieux payée parmi les premiers vols pour Moses.",
    variants: [{ label: "Argent (le buggy gris du groupe)", claim: "variant:argent" }],
    locations: [
      {
        id: "buckskin",
        label: "Boucle de terre dans le marais de Buckskin",
        area: "Marais de Buckskin, sud-est du comté de Kelly",
        precision: "zone",
        zone: { x: -4116, y: 893, radius: 320 },
        zoneKind: "estimee",
        zoneBasis: "Centrée sur les 7 repères « Buckskin » de la carte communautaire. En jeu, la mission affiche sa propre zone de recherche.",
        presence: "mobile",
        presenceNote: "Un groupe roule en tout-terrain dans le marais : le Bandito se déplace. Un guide l'a trouvé garé près des arbres lors d'un passage de jour.",
        claims: { location: "loc:buckskin", presence: "presence:mobile" },
        steps: [
          "Suis le marqueur de la mission jusqu'à la boucle de terre du marais.",
          "Approche-toi et parle au conducteur du buggy argenté : il s'arrête et descend.",
          "Monte pendant qu'il proteste (une seule place : laisse ton partenaire), puis quitte la boucle.",
          "Ramène-le à Moses à Port Gellhorn : la prime dépend de l'état du véhicule.",
        ],
        risks: ["Le groupe peut te poursuivre et tirer.", "Une seule place : envoie d'abord ton coéquipier ailleurs."],
      },
    ],
    condition: { chapterMin: 2, afterMission: DAILY_DRIVER, giver: MOSES, order: { rank: 4, of: 6, series: "Vols pour Moses" }, other: ["Jason ou Lucia peuvent lancer la série."], claim: "acces:moses" },
    keep: { possible: "inconnu", how: "C'est une livraison pour Moses (environ 3 350 à 3 400 $ selon l'état). Les sources ne disent pas si on peut le garder." },
    reward: "≈ 3 350 $ + bonus d'état",
    evidence: [
      ev({ id: "ppx", platform: "guide", url: POWERPYX_MOSES, creator: "PowerPyx", publishedAt: "2026-11-17", says: "Après « Daily Driver » (chapitre 2), 4ᵉ cible de Moses : un groupe roule dans le marais de Buckskin, le Bandito est le véhicule argenté ; 3 350 $.", stance: "confirme", claims: ["loc:buckskin", "presence:mobile", "acces:moses", "variant:argent"] }),
      ev({ id: "boom", platform: "guide", url: GTABOOM_MOSES, creator: "GTA BOOM", publishedAt: null, says: "Boucle de terre dans le marais de Buckskin ; lors de leur passage de jour, le buggy argenté était garé près des arbres.", stance: "confirme", claims: ["loc:buckskin", "variant:argent", "acces:moses"] }),
      ev({ id: "boom-garé", platform: "guide", url: GTABOOM_MOSES, creator: "GTA BOOM", publishedAt: null, says: "Observé garé près des arbres (pas en mouvement) lors d'un passage de jour.", stance: "nuance", claims: ["presence:mobile"] }),
      ev({ id: "pcg", platform: "guide", url: "https://www.pcgamer.com/games/grand-theft-auto/gta-6-bf-bandito-location", creator: "PC Gamer", publishedAt: null, says: "À ramener à Moses, environ 3 400 $ selon l'état.", stance: "confirme", claims: ["acces:moses"] }),
    ],
  },
  {
    id: "v-annis-hellion",
    name: "Annis Hellion",
    why: "4×4 facile à prendre : toujours garé au même endroit.",
    variants: [],
    locations: [
      {
        id: "orchard",
        label: "Allée d'une maison d'Orchard Avenue",
        area: "Quartier sud de Port Gellhorn",
        precision: "zone",
        zone: { x: -6900, y: 3650, radius: 650 },
        zoneKind: "large",
        zoneBasis: "Zone large sur la ville de Port Gellhorn : Orchard Avenue n'est pas nommée sur notre carte. En jeu, la mission affiche sa zone de recherche ; le Hellion est dans l'allée de la maison au centre de cette zone.",
        presence: "fixe",
        presenceNote: "Toujours garé dans l'allée.",
        claims: { location: "loc:orchard", presence: "presence:allee" },
        steps: [
          "Va dans le quartier d'Orchard Avenue, au sud de Port Gellhorn (zone de la mission).",
          "Repère la maison au centre de la zone, le Hellion dans l'allée.",
          "Calme le chien qui aboie (interaction), ouvre au Slim Jim côté conducteur et pars dès que le moteur démarre.",
        ],
        risks: ["Le chien aboie et peut alerter le voisinage."],
      },
    ],
    condition: { chapterMin: 2, afterMission: DAILY_DRIVER, giver: MOSES, order: { rank: 3, of: 6, series: "Vols pour Moses" }, other: ["Slim Jim (remis au chapitre 2)."], claim: "acces:moses" },
    keep: { possible: "inconnu", how: "Livraison pour Moses (≈ 1 400 $). Les sources ne disent pas si on peut le garder." },
    reward: "≈ 1 400 $ + bonus d'état",
    evidence: [
      ev({ id: "ppx", platform: "guide", url: POWERPYX_MOSES, creator: "PowerPyx", publishedAt: "2026-11-17", says: "3ᵉ cible : garé dans l'allée d'une maison d'Orchard Avenue, au sud de Port Gellhorn ; un chien aboie ; 1 400 $.", stance: "confirme", claims: ["loc:orchard", "presence:allee", "acces:moses"] }),
      ev({ id: "boom", platform: "guide", url: GTABOOM_MOSES, creator: "GTA BOOM", publishedAt: null, says: "Maisons d'Orchard Avenue au sud de Port Gellhorn ; Slim Jim côté conducteur, quitter l'allée dès le démarrage.", stance: "confirme", claims: ["loc:orchard", "presence:allee", "acces:moses"] }),
    ],
  },
  {
    id: "v-karin-futo",
    name: "Karin Futo",
    why: "Coupé de drift rangé dans un box : il est toujours là.",
    variants: [],
    locations: [
      {
        id: "draper",
        label: "Box au bout ouest d'un bâtiment des docks, bord sud de l'île de Draper",
        area: "Docks de Draper Island (comté de Kelly)",
        precision: "zone",
        zone: { x: -7013, y: 4697, radius: 450 },
        zoneKind: "estimee",
        zoneBasis: "Centrée sur le repère communautaire « Draper Island ». Le bâtiment précis n'est pas placé.",
        presence: "fixe",
        presenceNote: "Rangé dans un box fermé : toujours là.",
        claims: { location: "loc:draper", presence: "presence:box" },
        steps: [
          "Cherche le long du bord sud de l'île de Draper, dans les docks.",
          "Franchis la petite clôture près de la voie ferrée et suis les rails pour éviter le poste de sécurité.",
          "Le box est au bout ouest du bâtiment, porte côté nord ; ouvre au Slim Jim, démarre, puis actionne l'interrupteur à droite de la porte.",
        ],
        risks: ["La sécurité est appelée si un ouvrier te repère ; un ouvrier est souvent à l'intérieur."],
      },
    ],
    condition: { chapterMin: 2, afterMission: DAILY_DRIVER, giver: MOSES, order: { rank: 2, of: 6, series: "Vols pour Moses" }, other: [], claim: "acces:moses" },
    keep: { possible: "inconnu", how: "Livraison pour Moses (≈ 1 500 $). Les sources ne disent pas si on peut le garder." },
    reward: "≈ 1 500 $ + bonus d'état",
    evidence: [
      ev({ id: "ppx", platform: "guide", url: POWERPYX_MOSES, creator: "PowerPyx", publishedAt: "2026-11-17", says: "2ᵉ cible : box au bout ouest d'un bâtiment des docks, bord sud de Draper Island, porte côté nord ; 1 500 $.", stance: "confirme", claims: ["loc:draper", "presence:box", "acces:moses"] }),
      ev({ id: "boom", platform: "guide", url: GTABOOM_MOSES, creator: "GTA BOOM", publishedAt: null, says: "Franchir la clôture basse près de la voie ferrée, suivre les rails dans les docks ; interrupteur à droite de la porte du garage.", stance: "confirme", claims: ["loc:draper", "presence:box", "acces:moses"] }),
    ],
  },
  {
    id: "v-declasse-vamos",
    name: "Declasse Vamos",
    why: "Muscle car préparée, enfermée derrière un digicode : la meilleure prime de la série avant la moto.",
    variants: [{ label: "Rouge, préparée (« souped up »)", claim: "variant:rouge" }],
    locations: [
      {
        id: "grayson",
        label: "Abri à l'est d'une maison, au nord-est de Grayson",
        area: "Nord-est de Grayson (comté de Lummox)",
        precision: "inconnue",
        zone: null,
        zoneBasis: "Grayson n'est pas repéré sur notre carte communautaire : pas d'épingle plutôt qu'une position inventée. En jeu, la mission affiche sa zone de recherche.",
        presence: "fixe",
        presenceNote: "Rangée dans l'abri : toujours là.",
        claims: { location: "loc:grayson", presence: "presence:abri" },
        steps: [
          "Prends le chemin de terre jusqu'à la cour aux panneaux routiers, au nord-est de Grayson.",
          "Code de la porte latérale de l'abri (côté maison) : 2727 — il est aussi affiché dans la caravane principale.",
          "Ouvre la voiture au Slim Jim, puis le portail avec le bouton à droite, et repars vers Port Gellhorn.",
        ],
        risks: ["Des hommes armés tirent près d'une caravane puis passent à l'arrière : ils tirent s'ils te voient.", "Des habitants peuvent te barrer la route au retour."],
      },
    ],
    condition: { chapterMin: 2, afterMission: DAILY_DRIVER, giver: MOSES, order: { rank: 5, of: 6, series: "Vols pour Moses" }, other: ["Code 2727 (porte impossible à forcer ou crocheter)."], claim: "acces:moses" },
    keep: { possible: "inconnu", how: "Livraison pour Moses (≈ 4 200 $). Les sources ne disent pas si on peut la garder." },
    reward: "≈ 4 200 $ + bonus d'état",
    evidence: [
      ev({ id: "ppx", platform: "guide", url: POWERPYX_MOSES, creator: "PowerPyx", publishedAt: "2026-11-17", says: "5ᵉ cible : abri à l'est d'une maison au nord-est de Grayson ; code 2727 affiché dans la caravane ; 4 200 $.", stance: "confirme", claims: ["loc:grayson", "presence:abri", "code:2727", "acces:moses"] }),
      ev({ id: "boom", platform: "guide", url: GTABOOM_MOSES, creator: "GTA BOOM", publishedAt: null, says: "Cour aux panneaux routiers ; porte latérale face à la maison, code 2727 ; Vamos rouge ; retour à Port Gellhorn.", stance: "confirme", claims: ["loc:grayson", "presence:abri", "code:2727", "variant:rouge", "acces:moses"] }),
      ev({ id: "pcg", platform: "guide", url: "https://www.pcgamer.com/games/grand-theft-auto/gta-6-declasse-vamos-code", creator: "PC Gamer", publishedAt: null, says: "Entrer le code, ouvrir au Slim Jim, bouton pour ouvrir la porte.", stance: "confirme", claims: ["code:2727", "presence:abri"] }),
    ],
  },
];

export const RVL_BY_ID = new Map(RARE_VEHICLES.map((v) => [v.id, v]));
