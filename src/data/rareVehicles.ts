import type { Evidence } from "@/lib/evidence";

/**
 * Rare Vehicle Locator — référentiel vérifié à la main (V0.16.1, 23/11/2026).
 *
 * Chaque fiche complète la fiche collectée par la veille (même identifiant, donc même sauvegarde « vehicles[id] »).
 * Positions : coordonnées GTADB (unités de jeu ≈ mètres). Un point « calibré » vient d'une capture de carte du jeu
 * recalée sur notre fond par des points de correspondance (scripts/rvl_calibrate.py, docs/rvl-calibration/) : il n'a
 * PAS été testé en jeu. Une épingle d'un site tiers seule ne donne jamais de précision : elle sert de contrôle.
 */

export type Presence = "fixe" | "mobile" | "aleatoire";

/** Position exacte ou calibrée, avec son incertitude mesurée. */
export interface RvlPoint {
  x: number;
  y: number;
  /** Rayon d'incertitude (m) : écart de calibration + taille du bâtiment visé. */
  errorM: number;
  method: "capture-calibree" | "capture-identifiee" | "releve-jeu";
  methodNote: string;
  /** Preuves (ids) qui fondent la position. */
  sources: string[];
  date: string;
  /** calibre : recalé depuis des captures · teste-en-jeu : relevé sur place (aucun à ce jour). */
  status: "calibre" | "teste-en-jeu";
  /** Contrôle indépendant (repère non utilisé pour le calage, autre source). */
  check: string;
}

/** Parcours d'un véhicule mobile : tracé, jamais un point d'apparition garanti. */
export interface RvlRoute {
  lines: Array<Array<[number, number]>>;
  errorM: number;
  note: string;
  sources: string[];
  date: string;
  status: "calibre";
}

export interface RvlLocation {
  id: string;
  label: string;
  area: string;
  /** point : bâtiment / maison identifié · parcours : circuit d'un véhicule mobile · zone · inconnue (pas d'épingle). */
  precision: "point" | "parcours" | "zone" | "inconnue";
  point?: RvlPoint;
  route?: RvlRoute;
  /** Cercle affiché sur la carte (incertitude du point, ou zone englobant le parcours). */
  zone: { x: number; y: number; radius: number } | null;
  zoneBasis: string;
  presence: Presence;
  presenceNote: string;
  claims: { location: string; presence: string };
  steps: string[];
  risks: string[];
  /** Zone affichée en V0.16, pour la comparaison (contenait-elle vraiment la voiture ?). */
  v016: { x: number; y: number; radius: number } | null;
}

export interface RvlVariant {
  label: string;
  claim: string;
}

/** Série de commandes (Moses) : l'ordre et les lots documentés, jamais « tout disponible » d'office. */
export interface RvlSeries {
  id: "moses";
  /** Lot dans lequel la commande arrive (1 = Yosemite + Futo ; 2 = Hellion, Bandito, Vamos). */
  batch: number;
  /** Rang dans l'ordre PowerPyx (1 à 6). */
  rank: number;
  of: number;
  /** Véhicules à livrer avant de recevoir cette commande (selon les sources). */
  after: string[];
  orderNote: string;
}

export interface RvlCondition {
  chapterMin: number;
  afterMission?: { name: string; chapter: number };
  giver?: { name: string; chapter: number };
  series?: RvlSeries;
  other: string[];
  claim: string;
}

export interface RvlKeep {
  possible: "oui" | "non" | "inconnu";
  how: string;
  chapterMin?: number;
  claim?: string;
}

/** Visuel du véhicule et statut de ses droits (jamais une illustration inventée). */
export interface RvlVisual {
  /** Image intégrée dans l'app ; null tant qu'aucune n'a de droits d'intégration établis. */
  image: { src: string; creator: string; game: "GTA VI"; rights: string; link: string } | null;
  /** Vidéo de référence qui montre le véhicule exact (lien, non intégrée). */
  video: { url: string; creator: string; title: string; at?: string; shows: string };
  rightsNote: string;
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
  visual: RvlVisual;
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
const PPX = "https://www.powerpyx.com/gta-6-steal-vehicles-for-moses-walkthrough/";
const BOOM = "https://www.gtaboom.com/gta-6-moses-vehicle-theft-guide-2d3f";
const PUSH = "https://www.pushsquare.com/guides/gta-6-moses-vehicle-drop-off-locations";
const GPS = "https://gta6gps.com/map/game/vehicle-thefts";
const NO_IMAGE =
  "Aucune image de ce véhicule exact n'a de droit d'intégration établi : l'Artifact ne charge pas d'image distante, et recopier la capture d'un guide ou la miniature d'une vidéo serait la republier sans autorisation. Ajoute ta propre capture : elle devient l'image de la fiche.";
const ORDER_NOTE =
  "Moses envoie ses commandes par SMS au fur et à mesure : d'abord la Yosemite 1500 et la Futo, puis, une fois les deux livrées, la Hellion, le Bandito et la Vamos (GTA BOOM). PowerPyx et d'autres guides les reçoivent une par une dans l'ordre Yosemite, Futo, Hellion, Bandito, Vamos, Nightblade. Tant que tu n'as pas reçu la commande, la voiture n'est pas garantie sur place.";

export const RARE_VEHICLES: RvlVehicle[] = [
  {
    id: "v-maibatsu-penumbra-ff",
    name: "'97 Maibatsu Penumbra FF",
    why: "Clin d'œil à la voiture verte de Brian dans Fast & Furious (1995 Mitsubishi Eclipse), cachée dans le garage d'une villa. Accessible dès l'exploration libre.",
    variants: [{ label: "Vert vif, graphismes bleus, néons dessous, plaque « HAD YOU »", claim: "variant:vert" }],
    locations: [
      {
        id: "vespucci",
        label: "Villa grise à deux étages, juste au nord de la chaussée, entre les deux rues nord-sud de l'île de Vespucci",
        area: "Île de Vespucci, Rialto Islands (Vice City)",
        precision: "point",
        point: {
          x: 532,
          y: 1305,
          errorM: 35,
          method: "capture-calibree",
          methodNote:
            "Carte du jeu (GamesHorizon, d'après la vidéo de Jokemen FC) recalée sur 4 repères (étiquettes des îles Catalan, Vespucci, Casanova et Salton Memorial) : le point jaune tombe en (540, 1285), écart de calage 6 à 12 m, validation croisée jusqu'à 37 m. Placé sur le seul grand bloc bâti situé entre les deux rues, au nord de la chaussée, comme le décrivent GTA Culture et Polygon.",
          sources: ["gameshorizon", "gtaculture", "polygon", "xtreme"],
          date: C,
          status: "calibre",
          check: "Trois descriptions indépendantes désignent le même bloc : « entre les deux rues nord-sud, juste au nord de la chaussée » (GTA Culture), « au coin, face à un chantier » (Polygon), « juste au nord de la route » (GTA Xtreme).",
        },
        zone: { x: 532, y: 1305, radius: 35 },
        zoneBasis: "Point calibré depuis une capture de la carte du jeu, à ±35 m : pas encore vérifié en jeu.",
        presence: "fixe",
        presenceNote: "Toujours garée dans le garage. Un guide (Jalopnik, cité par GTA Culture) signale un garage vide pour certains joueurs : repasse plus tard.",
        claims: { location: "loc:vespucci", presence: "presence:garage" },
        steps: [
          "Prends la chaussée des Rialto Islands vers Vice Beach : traverse Catalan Island, puis passe le pont suivant.",
          "Sur Vespucci, arrête-toi au carrefour avec la première rue nord-sud (ouest), face au chantier.",
          "Remonte vers le nord et tourne à droite dans l'allée fermée par un portail blanc, entre deux haies hautes.",
          "Soulève la porte blanche du garage par le bas, ou passe par la porte vitrée à droite (elle déclenche l'alarme de la maison).",
          "Slim Jim (dès le chapitre 2) ou vitre cassée, puis démarre (deux sticks).",
        ],
        risks: [
          "La porte latérale déclenche l'alarme : coupe-la au boîtier sur le mur du garage.",
          "Au chapitre 1, tu peux la conduire mais pas la garder : elle est perdue si tu meurs, si tu es arrêté ou si tu la laisses.",
        ],
        v016: { x: 550, y: 1255, radius: 270 },
      },
    ],
    condition: { chapterMin: 1, other: ["Dès la fin des séquences d'introduction, quand l'exploration libre s'ouvre."], claim: "acces:exploration-libre" },
    keep: { possible: "oui", how: "Immatricule-la chez Moses (Watkins Auto Parts, Port Gellhorn) : 6 750 $, ou l'immatriculation gratuite offerte une fois par Moses. Vérifie d'abord avec WAiNK qu'elle n'a pas de traqueur.", chapterMin: 2, claim: "garder:ch2" },
    visual: {
      image: null,
      video: { url: "https://www.youtube.com/watch?v=g6pNfpij-JE", creator: "Maka91Productions", title: "GTA 6 - Fast & Furious Secret Car (Paul Walker's Mitsubishi Eclipse) Location Guide", shows: "La Penumbra FF verte dans son garage, puis en extérieur" },
      rightsNote: NO_IMAGE,
    },
    evidence: [
      ev({ id: "alcast", platform: "guide", url: "https://alcasthq.com/gta-6-paul-walker-car/", creator: "AlcastHQ", publishedAt: null, says: "Garage d'une villa sur l'île de Vespucci (ovale, ouest de Vice Beach) ; dispo dès l'exploration libre ; immatriculation à partir du chapitre 2.", stance: "confirme", claims: ["existe", "loc:vespucci", "presence:garage", "acces:exploration-libre", "garder:ch2", "variant:vert"] }),
      ev({ id: "gamesradar", platform: "guide", url: "https://www.gamesradar.com/games/grand-theft-auto/gta-6-paul-walker-fast-and-furious-car", creator: "GamesRadar+", publishedAt: null, says: "Garage sur l'île de Vespucci ; l'alarme se coupe sur le mur.", stance: "confirme", claims: ["existe", "loc:vespucci", "presence:garage"] }),
      ev({ id: "xtreme", platform: "guide", url: "https://www.gta-xtreme.com/en/gta-6-paul-walker-car-location", creator: "GTA Xtreme", publishedAt: null, says: "Garage d'une villa sur Vespucci, juste au nord de la route.", stance: "confirme", claims: ["existe", "loc:vespucci", "presence:garage", "loc:vespucci-nord"] }),
      ev({ id: "gtaculture", platform: "guide", url: "https://gtaculture.com/guides/gta-6-fast-and-furious-car", creator: "GTA Culture", publishedAt: "2026-11-22", says: "Villa grise à deux étages dans le bloc entre les deux rues nord-sud, juste au nord de la chaussée ; allée fermée à droite en remontant la rue ouest. Épingle placée d'après la carte de pause de Maka91Productions, contrôlée sur celle de TheGamingRevolution.", stance: "confirme", claims: ["existe", "loc:vespucci", "loc:vespucci-nord", "presence:garage", "garder:ch2"], origin: "youtube:maka91productions" }),
      ev({ id: "gameshorizon", platform: "capture", url: "https://gameshorizon.com/?p=82621", creator: "GamesHorizon (captures de Jokemen FC)", publishedAt: null, says: "Carte du jeu avec la maison marquée d'un point jaune sur Vespucci, au nord de la chaussée ; route depuis Catalan Island.", stance: "confirme", claims: ["existe", "loc:vespucci", "loc:vespucci-nord", "acces:exploration-libre"], origin: "youtube:jokemenfc" }),
      ev({ id: "polygon", platform: "guide", url: "https://www.polygon.com/gta-6-mitsubishi-eclipse-fast-and-furious-brian-oconner-car/", creator: "Polygon", publishedAt: "2026-11-22", says: "En venant de l'ouest, tourne à gauche dans la rue vers le nord ; grande maison au portail blanc juste au coin, face à un chantier.", stance: "confirme", claims: ["existe", "loc:vespucci", "loc:vespucci-nord"] }),
      ev({ id: "fandomwire", platform: "guide", url: "https://fandomwire.com/gta-6-hidden-easter-egg-honoring-paul-walker/", creator: "FandomWire (captures de Jokemen FC)", publishedAt: null, says: "Après le deuxième pont, tourner à gauche ; villa moderne voisine d'une propriété avec une voiture de luxe ; plaque « HAD YOU ».", stance: "confirme", claims: ["existe", "loc:vespucci", "variant:vert"], origin: "youtube:jokemenfc" }),
      ev({ id: "maka91", platform: "video", url: "https://www.youtube.com/watch?v=g6pNfpij-JE", creator: "Maka91Productions", publishedAt: null, says: "Vidéo : la plus grande maison au milieu de l'île, portail avant puis porte latérale du garage ; conseille d'attendre le chapitre 2 pour la garder.", stance: "confirme", claims: ["existe", "loc:vespucci", "presence:garage", "garder:ch2"], origin: "youtube:maka91productions" }),
      ev({ id: "bgr", platform: "guide", url: "https://www.bgr.com/2322463/gta-6-hidden-fast-and-furious-paul-walker-car/", creator: "BGR", publishedAt: null, says: "Reprend Vice : garage attenant à une maison blanche au milieu de l'île.", stance: "confirme", claims: ["existe", "loc:vespucci"], origin: "vice.com" }),
    ],
  },
  {
    id: "v-karin-futo",
    name: "Karin '85 Futo",
    why: "Coupé de drift rouge enfermé dans un box des douanes, sur les docks de Draper Island.",
    variants: [{ label: "Rouge, capot noir (photo envoyée par Moses : publicité « FUTO »)", claim: "variant:rouge" }],
    locations: [
      {
        id: "draper",
        label: "Box au bout ouest du long entrepôt Postal / douanes, quai sud de Draper Island",
        area: "Docks de Draper Island, comté de Kelly (au nord-ouest de Port Gellhorn)",
        precision: "point",
        point: {
          x: -7655,
          y: 4684,
          errorM: 20,
          method: "capture-calibree",
          methodNote:
            "Carte du jeu de GTA BOOM recalée par homographie sur 7 repères (étang, deux navires, petit bâtiment arrondi, pétrolier, deux cuves) : écart de calage 2 à 7 m, validation croisée 4 à 12 m près du bâtiment. Le marqueur du jeu tombe sur le long entrepôt (-7669 → -7598) ; le box est à son extrémité ouest selon PowerPyx et Metaforge.",
          sources: ["boom-map", "ppx", "push", "metaforge", "gta6gps"],
          date: C,
          status: "calibre",
          check: "Contrôle indépendant : les deux extrémités de l'entrepôt, non utilisées pour le calage, retombent à 2 à 3 m de celles du fond GTADB ; l'épingle GTA6GPS (-7640, 4681) est à 8 m du marqueur recalé.",
        },
        zone: { x: -7655, y: 4684, radius: 20 },
        zoneBasis: "Point calibré sur le bâtiment identifié (±20 m) : pas encore vérifié en jeu.",
        presence: "fixe",
        presenceNote: "Rangée dans un box fermé, un ouvrier souvent à l'intérieur.",
        claims: { location: "loc:draper", presence: "presence:box" },
        steps: [
          "Laisse ta voiture avant les barrières de sécurité et franchis la clôture basse près de la voie ferrée.",
          "Suis les rails jusqu'au long bâtiment Postal au sud de l'île.",
          "Entre par la porte nord-ouest, côté voie ferrée (ou par l'échelle et la trappe du toit), traverse le bureau jusqu'au box.",
          "Slim Jim, démarre le moteur, puis ouvre le rideau avec l'interrupteur à droite de la porte.",
        ],
        risks: ["Zone surveillée : un ouvrier qui te voit appelle la sécurité, et la police arrive vite."],
        v016: { x: -7013, y: 4697, radius: 450 },
      },
    ],
    condition: {
      chapterMin: 2,
      afterMission: DAILY_DRIVER,
      giver: MOSES,
      series: { id: "moses", batch: 1, rank: 2, of: 6, after: [], orderNote: ORDER_NOTE },
      other: ["Slim Jim (remis au chapitre 2)."],
      claim: "acces:moses",
    },
    keep: { possible: "inconnu", how: "Livraison pour Moses (≈ 1 500 $ affichés, payés moins si la voiture est abîmée). Les sources ne disent pas si on peut la garder." },
    reward: "≈ 1 500 $ + bonus d'état",
    visual: {
      image: null,
      video: { url: "https://www.youtube.com/watch?v=H5TImsMDaX8", creator: "Trophygamers", title: "GTA 6 - Karin Futo - Steal vehicles for Moses - Walkthrough Part 35", shows: "La photo de la Futo rouge envoyée par Moses, puis le vol dans le box" },
      rightsNote: NO_IMAGE,
    },
    evidence: [
      ev({ id: "ppx", platform: "guide", url: PPX, creator: "PowerPyx", publishedAt: "2026-11-17", says: "2ᵉ commande : box au bout ouest du bâtiment de la zone de recherche, bord sud de Draper Island ; porte côté nord.", stance: "confirme", claims: ["existe", "loc:draper", "loc:draper-ouest", "presence:box", "acces:moses"] }),
      ev({ id: "boom-map", platform: "capture", url: BOOM, creator: "GTA BOOM (capture de la carte du jeu)", publishedAt: "2026-11-21", says: "Marqueur de la mission sur le long bâtiment au sud des docks, juste sous la voie ferrée.", stance: "confirme", claims: ["existe", "loc:draper", "presence:box", "acces:moses"] }),
      ev({ id: "push", platform: "guide", url: PUSH, creator: "Push Square", publishedAt: "2026-11-18", says: "Grand bâtiment Postal à la pointe sud de l'île ; porte nord-ouest, la plus proche de la voie ferrée ; voiture derrière les rideaux.", stance: "confirme", claims: ["existe", "loc:draper", "presence:box"] }),
      ev({ id: "metaforge", platform: "guide", url: "https://metaforge.app/gta-6/gta-6-steal-vehicles-for-moses", creator: "Metaforge", publishedAt: "2026-11-22", says: "Box au bout ouest du bâtiment ; Futo rouge ; Moses débloque les commandes une ou deux à la fois.", stance: "confirme", claims: ["existe", "loc:draper", "loc:draper-ouest", "presence:box", "variant:rouge"] }),
      ev({ id: "gta6gps", platform: "guide", url: GPS, creator: "GTA6 GPS (épingle importée de Gamersky, dite approximative)", publishedAt: null, says: "Épingle X −7640, Y 4681 (même système que GTADB, vérifié sur un repère commun).", stance: "confirme", claims: ["existe", "loc:draper"], origin: "gamersky" }),
      ev({ id: "leonidex", platform: "guide", url: "https://leonidex.com/missions/karin-futo-for-moses", creator: "Leonidex", publishedAt: null, says: "SMS de Moses : box des douanes au sud de Draper Island, près de la voie ferrée ; payé 1 075 $ pour une voiture abîmée.", stance: "confirme", claims: ["existe", "loc:draper", "variant:rouge"] }),
    ],
  },
  {
    id: "v-annis-hellion",
    name: "Annis '95 Hellion",
    why: "4×4 clair garé devant un bungalow : le vol le plus simple de la série.",
    variants: [{ label: "Blanc / clair (fiche « Annis Hellion 4x4 » envoyée par Moses)", claim: "variant:clair" }],
    locations: [
      {
        id: "orchard",
        label: "Allée d'un bungalow d'Orchard Avenue, rangée ouest de la boucle résidentielle au sud de Port Gellhorn",
        area: "Sud de Port Gellhorn, au sud de Watkins Auto Parts",
        precision: "point",
        point: {
          x: -6509,
          y: 2924,
          errorM: 40,
          method: "capture-identifiee",
          methodNote:
            "Le seul quartier de bungalows au sud de la boutique de Moses est la boucle d'Orchard Avenue. Sur les captures de Push Square et GTA BOOM, le marqueur tombe sur sa rangée ouest, entre la 2ᵉ et la 4ᵉ maison depuis le nord. Pas de calage numérique : la carte capturée est trop sombre pour placer trois repères non alignés.",
          sources: ["push", "boom-map", "ppx", "metaforge"],
          date: C,
          status: "calibre",
          check: "Push Square : « au sud de la boutique de Moses, devant le bungalow » ; PowerPyx : « la maison au centre de la zone de recherche ». Les deux concordent avec la rangée ouest.",
        },
        zone: { x: -6509, y: 2924, radius: 40 },
        zoneBasis: "Maison identifiée à ±40 m (une à deux maisons d'écart possibles) : pas encore vérifiée en jeu.",
        presence: "fixe",
        presenceNote: "Garé dans l'allée ; un chien garde le jardin et le propriétaire peut sortir.",
        claims: { location: "loc:orchard", presence: "presence:allee" },
        steps: [
          "Depuis Watkins Auto Parts (Moses), descends vers le sud jusqu'à la boucle résidentielle d'Orchard Avenue.",
          "Repère le 4×4 clair dans l'allée d'un bungalow, côté ouest de la boucle.",
          "Calme le chien (ou lance-lui le ballon), Slim Jim côté conducteur, et repars vers le nord dès que le moteur tourne.",
        ],
        risks: ["Le chien aboie et le propriétaire peut sortir."],
        v016: { x: -6900, y: 3650, radius: 650 },
      },
    ],
    condition: {
      chapterMin: 2,
      afterMission: DAILY_DRIVER,
      giver: MOSES,
      series: { id: "moses", batch: 2, rank: 3, of: 6, after: ["Declasse Yosemite 1500", "Karin Futo"], orderNote: ORDER_NOTE },
      other: ["Slim Jim (remis au chapitre 2)."],
      claim: "acces:moses",
    },
    keep: { possible: "inconnu", how: "Livraison pour Moses (≈ 1 400 $, + 500 $ si intact). Les sources ne disent pas si on peut le garder." },
    reward: "≈ 1 400 $ + bonus d'état",
    visual: {
      image: null,
      video: { url: "https://www.youtube.com/watch?v=aAmOyiCLRDY", creator: "Trophygamers", title: "GTA 6 - Annis Hellion - Steal vehicles for Moses - Walkthrough Part 36", shows: "La fiche « Annis Hellion 4x4 » envoyée par Moses, puis le 4×4 dans l'allée" },
      rightsNote: NO_IMAGE,
    },
    evidence: [
      ev({ id: "ppx", platform: "guide", url: PPX, creator: "PowerPyx", publishedAt: "2026-11-17", says: "3ᵉ commande : allée de la maison au centre de la zone, quartier au sud de Port Gellhorn ; un chien aboie.", stance: "confirme", claims: ["existe", "loc:orchard", "presence:allee", "acces:moses"] }),
      ev({ id: "push", platform: "capture", url: PUSH, creator: "Push Square", publishedAt: "2026-11-18", says: "Orchard Ave, au sud de la boutique de Moses, garé devant un bungalow ; capture de carte avec le marqueur.", stance: "confirme", claims: ["existe", "loc:orchard", "presence:allee"] }),
      ev({ id: "boom-map", platform: "capture", url: BOOM, creator: "GTA BOOM (capture de la carte du jeu)", publishedAt: "2026-11-21", says: "Objectif au bord sud de Port Gellhorn ; SUV clair dans une allée d'Orchard Avenue.", stance: "confirme", claims: ["existe", "loc:orchard", "presence:allee", "variant:clair"] }),
      ev({ id: "metaforge", platform: "guide", url: "https://metaforge.app/gta-6/gta-6-steal-vehicles-for-moses", creator: "Metaforge", publishedAt: "2026-11-22", says: "SUV blanc dans l'allée de la maison au milieu de la zone.", stance: "confirme", claims: ["existe", "loc:orchard", "variant:clair"] }),
    ],
  },
  {
    id: "v-bf-bandito",
    name: "BF '77 Bandito",
    why: "Buggy monoplace qui tourne avec une bande de pilotes sur un circuit de terre du marais.",
    variants: [{ label: "Gris argent / blanc, toujours suivi d'une moto (Polygon)", claim: "variant:argent" }],
    locations: [
      {
        id: "buckskin",
        label: "Circuit de terre sur l'île en Y au nord-est du marais de Buckskin",
        area: "Nord-est du marais de Buckskin, sud-est du comté de Kelly",
        precision: "parcours",
        route: {
          lines: [
            [[-3783, 1825], [-3758, 1804], [-3738, 1792], [-3725, 1798], [-3700, 1808], [-3677, 1813]],
            [[-3738, 1792], [-3733, 1771], [-3730, 1758]],
            [[-3715, 1738], [-3692, 1725], [-3662, 1717], [-3642, 1687], [-3617, 1635]],
            [[-3662, 1717], [-3646, 1744], [-3635, 1756], [-3650, 1787], [-3662, 1802]],
            [[-3635, 1756], [-3617, 1773], [-3598, 1779]],
          ],
          errorM: 15,
          note: "Pistes tracées sur le fond GTADB, identifiées sur la capture de GTA BOOM (zone de recherche autour de la même île en Y). Le buggy roule dessus avec le groupe : pas de point d'apparition garanti.",
          sources: ["boom-map", "push", "polygon", "gta6gps"],
          date: C,
          status: "calibre",
        },
        point: {
          x: -3570,
          y: 1709,
          errorM: 25,
          method: "capture-calibree",
          methodNote: "Marqueur de mission de la capture GTA BOOM recalé (affine, 6 jonctions et extrémités de pistes) : écart 2 à 20 m, validation croisée 23 m en moyenne. C'est la position du marqueur à l'instant de la capture, pas un emplacement fixe.",
          sources: ["boom-map"],
          date: C,
          status: "calibre",
          check: "L'épingle GTA6GPS (-3566, 1707), importée d'une autre source, tombe à 5 m du marqueur recalé.",
        },
        zone: { x: -3690, y: 1730, radius: 130 },
        zoneBasis: "Le cercle englobe le circuit (±15 m sur le tracé) : c'est le parcours qui compte, pas un point.",
        presence: "mobile",
        presenceNote: "Le Bandito roule en boucle avec d'autres tout-terrain et une moto ; GTA BOOM l'a aussi vu garé au bord des arbres de jour. Attends-le sur le circuit plutôt que sur le marqueur.",
        claims: { location: "loc:buckskin", presence: "presence:mobile" },
        steps: [
          "Arrive par le pont de la route au nord du marais, puis prends les pistes de terre vers l'île en Y.",
          "Gare un véhicule en travers du circuit, reste à côté et attends que le groupe repasse.",
          "Quand le Bandito ralentit, vise le conducteur (L2) et choisis « Mislead » pour qu'il s'arrête et descende.",
          "Monte (une seule place : renvoie ton coéquipier avant) et file vers Moses : ses amis te poursuivent.",
        ],
        risks: ["Les autres pilotes et la moto te poursuivent et tirent.", "Une seule place : renvoie ton coéquipier avant."],
        v016: { x: -4116, y: 893, radius: 320 },
      },
    ],
    condition: {
      chapterMin: 2,
      afterMission: DAILY_DRIVER,
      giver: MOSES,
      series: { id: "moses", batch: 2, rank: 4, of: 6, after: ["Declasse Yosemite 1500", "Karin Futo"], orderNote: ORDER_NOTE },
      other: ["Un véhicule costaud pour bloquer la piste aide (un pick-up est garé au carrefour à l'est, selon Polygon)."],
      claim: "acces:moses",
    },
    keep: { possible: "inconnu", how: "Livraison pour Moses (≈ 3 350 $, + 500 $ si intact). Les sources ne disent pas si on peut le garder." },
    reward: "≈ 3 350 $ + bonus d'état",
    visual: {
      image: null,
      video: { url: "https://www.youtube.com/watch?v=6WF8FeJPuBI", creator: "Trophygamers", title: "GTA 6 - BF Bandito - Steal vehicles for Moses - Walkthrough Part 37", shows: "La fiche « BF Bandito » envoyée par Moses, puis le buggy sur le circuit" },
      rightsNote: NO_IMAGE,
    },
    evidence: [
      ev({ id: "ppx", platform: "guide", url: PPX, creator: "PowerPyx", publishedAt: "2026-11-17", says: "4ᵉ commande : un groupe roule en tout-terrain dans le marais de Buckskin, le véhicule argenté est le Bandito.", stance: "confirme", claims: ["existe", "loc:buckskin", "presence:mobile", "acces:moses", "variant:argent"] }),
      ev({ id: "boom-map", platform: "capture", url: BOOM, creator: "GTA BOOM (capture de la carte du jeu)", publishedAt: "2026-11-21", says: "Zone de recherche autour de l'île aux pistes en Y ; buggy argenté vu garé près des arbres de jour.", stance: "confirme", claims: ["existe", "loc:buckskin", "acces:moses", "variant:argent"] }),
      ev({ id: "boom-gare", platform: "guide", url: BOOM, creator: "GTA BOOM", publishedAt: "2026-11-21", says: "Observé garé (pas en mouvement) lors d'un passage de jour.", stance: "nuance", claims: ["presence:mobile"] }),
      ev({ id: "push", platform: "capture", url: PUSH, creator: "Push Square", publishedAt: "2026-11-18", says: "Nord-est du marais de Buckskin ; le Bandito roule sur la piste de terre, suis-la jusqu'à lui.", stance: "confirme", claims: ["existe", "loc:buckskin", "presence:mobile"] }),
      ev({ id: "polygon", platform: "guide", url: "https://www.polygon.com/gta-6-bf-bandito-steal-how-to-moses-grand-theft-auto/", creator: "Polygon", publishedAt: "2026-11-22", says: "Circuit tout-terrain au nord du marais ; Bandito blanc toujours suivi d'une moto ; bloquer la piste avec un véhicule.", stance: "confirme", claims: ["existe", "loc:buckskin", "presence:mobile"] }),
      ev({ id: "pcg", platform: "video", url: "https://www.pcgamer.com/games/grand-theft-auto/gta-6-bf-bandito-location/", creator: "PC Gamer", publishedAt: "2026-11-21", says: "Le propriétaire tourne en cercle dans la zone ; bloquer la piste puis « Mislead ».", stance: "confirme", claims: ["existe", "loc:buckskin", "presence:mobile"] }),
      ev({ id: "gta6gps", platform: "guide", url: GPS, creator: "GTA6 GPS (épingle importée de Gamersky, dite approximative)", publishedAt: null, says: "Épingle X −3566, Y 1707.", stance: "confirme", claims: ["existe", "loc:buckskin"], origin: "gamersky" }),
    ],
  },
  {
    id: "v-declasse-vamos",
    name: "Declasse '74 Vamos",
    why: "Muscle car rouge préparée, enfermée derrière un digicode chez des locaux armés.",
    variants: [{ label: "Rouge, préparée (« souped up »), affiche « Racing Classics » envoyée par Moses", claim: "variant:rouge" }],
    locations: [
      {
        id: "grayson",
        label: "Garage indépendant à l'est d'une maison blanche et rouge couverte de panneaux, Rockledge Rd",
        area: "Bord est de Grayson, sud-ouest du comté de Lummox (sur le fond GTADB, le bourg est nommé « Yorktown »)",
        precision: "point",
        point: {
          x: -5075,
          y: 7066,
          errorM: 30,
          method: "capture-calibree",
          methodNote:
            "Carte 2D du jeu de Push Square recalée sur 5 repères (bâtiments de la boucle, sommet de la boucle, virage de l'autoroute) : écart 3 à 8 m, validation croisée 19 m en moyenne. Le marqueur tombe sur le groupe maison + garage au bout de la petite route en boucle ; le garage est le bâtiment est.",
          sources: ["push", "gta6map", "polygon", "ppx"],
          date: C,
          status: "calibre",
          check: "gta6map.io décrit « le garage détaché d'une maison blanche et rouge, sur une route secondaire de Rockledge Rd au bord est de Grayson » ; Polygon et PowerPyx placent le garage à l'est de la maison.",
        },
        zone: { x: -5075, y: 7066, radius: 30 },
        zoneBasis: "Point calibré depuis une carte 2D du jeu (±30 m) : pas encore vérifié en jeu. V0.16 ne savait pas où était Grayson : le bourg figure sur notre fond sous le nom « Yorktown ».",
        presence: "fixe",
        presenceNote: "Rangée dans le garage fermé : toujours là.",
        claims: { location: "loc:grayson", presence: "presence:abri" },
        steps: [
          "Prends Rockledge Rd jusqu'au bord est de Grayson, puis la petite route en boucle vers la maison couverte de panneaux.",
          "Le code 2727 est sur les plaques accrochées aux murs de la maison (inutile d'entrer si tu le connais).",
          "Tape 2727 sur le clavier de la porte latérale du garage (côté ouest, face à la maison).",
          "À l'intérieur, ouvre le rideau avec le bouton à droite, démarre la Vamos et repars vers Port Gellhorn.",
        ],
        risks: ["Les locaux armés tirent s'ils te voient.", "Certains te barrent la route au retour."],
        v016: null,
      },
    ],
    condition: {
      chapterMin: 2,
      afterMission: DAILY_DRIVER,
      giver: MOSES,
      series: { id: "moses", batch: 2, rank: 5, of: 6, after: ["Declasse Yosemite 1500", "Karin Futo"], orderNote: ORDER_NOTE },
      other: ["Code 2727 (la porte ne se force pas)."],
      claim: "acces:moses",
    },
    keep: { possible: "inconnu", how: "Livraison pour Moses (≈ 4 200 $, + 500 $ si intacte). Les sources ne disent pas si on peut la garder." },
    reward: "≈ 4 200 $ + bonus d'état",
    visual: {
      image: null,
      video: { url: "https://www.youtube.com/watch?v=g6PLlqpp_8c", creator: "Trophygamers", title: "GTA 6 - Declasse Vamos - Find Key Code For Garage Door - Walkthrough Part 38", shows: "L'affiche « Racing Classics » de la Vamos rouge envoyée par Moses, puis le garage" },
      rightsNote: NO_IMAGE,
    },
    evidence: [
      ev({ id: "ppx", platform: "guide", url: PPX, creator: "PowerPyx", publishedAt: "2026-11-17", says: "5ᵉ commande : abri à l'est d'une maison au nord-est de Grayson ; code 2727 dans la caravane.", stance: "confirme", claims: ["existe", "loc:grayson", "presence:abri", "code:2727", "acces:moses"] }),
      ev({ id: "push", platform: "capture", url: PUSH, creator: "Push Square", publishedAt: "2026-11-18", says: "Rockledge Rd, juste à l'est de Grayson ; cartes 2D du jeu avec le marqueur ; garage à code 2727.", stance: "confirme", claims: ["existe", "loc:grayson", "presence:abri", "code:2727", "variant:rouge"] }),
      ev({ id: "gta6map", platform: "guide", url: "https://gta6map.io/location", creator: "gta6map.io", publishedAt: null, says: "Garage détaché d'une maison blanche et rouge couverte de panneaux, route secondaire de Rockledge Rd au bord est de Grayson.", stance: "confirme", claims: ["existe", "loc:grayson", "presence:abri"] }),
      ev({ id: "polygon", platform: "guide", url: "https://www.polygon.com/gta-6-declasse-vamos-code-car-location/", creator: "Polygon", publishedAt: "2026-11-21", says: "Garage indépendant au bord est de Grayson ; porte à clavier côté ouest ; code 2727 sur les murs de la maison.", stance: "confirme", claims: ["existe", "loc:grayson", "presence:abri", "code:2727"] }),
      ev({ id: "boom", platform: "guide", url: BOOM, creator: "GTA BOOM", publishedAt: "2026-11-21", says: "Cour aux panneaux routiers ; porte latérale face à la maison, code 2727 ; Vamos rouge.", stance: "confirme", claims: ["existe", "loc:grayson", "presence:abri", "code:2727", "variant:rouge"] }),
    ],
  },
];

export const RVL_BY_ID = new Map(RARE_VEHICLES.map((v) => [v.id, v]));

/** Distance (m) entre la position établie et le centre de la zone V0.16, et si cette zone la contenait. */
export function v016Check(l: RvlLocation): { contained: boolean; offM: number } | null {
  const p = l.point ?? (l.zone ? { x: l.zone.x, y: l.zone.y } : null);
  if (!l.v016 || !p) return null;
  const offM = Math.round(Math.hypot(p.x - l.v016.x, p.y - l.v016.y));
  return { contained: offM <= l.v016.radius, offM };
}
