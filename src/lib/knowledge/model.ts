/**
 * LEONIDA KNOWLEDGE (V0.19) — modèle d'entités du monde de GTA VI, relié à ce qui existe déjà :
 *   - repères GTADB (`landmarkId`, 3 663 repères, CC BY 4.0) ;
 *   - établissements (`establishmentId`, src/data/establishments.ts) ;
 *   - graphe de missions (`missions`, ids de src/data/progression.ts) ;
 *   - véhicules du flux RADAR (`vehicleId`).
 * On ne recopie pas ces données : une entité les RELIE et ajoute ce qui manquait au copilote, surtout les
 * caractéristiques VISUELLES distinctives (sourcées) et les indices normalisés pour la reconnaissance.
 *
 * Principe : une donnée absente n'est pas une information négative. `coverage` dit ce qui a été documenté.
 */

/** Indices visuels normalisés : vocabulaire commun entre l'extraction d'image (Claude) et le référentiel. */
export const CLUES = [
  // bâti
  "maison_sur_pilotis", "escalier_exterieur", "balcon_sur_l_eau", "facade_verte", "panier_de_basket", "salle_de_sport_exterieure",
  "hangar_a_bateaux", "enseigne_sur_le_toit", "racks_a_bateaux", "moulin_sur_le_toit", "tables_de_pique_nique", "auvent_raye",
  "drapeau_pirate", "statue_de_baleine", "station_service", "motel", "devanture_de_boutique", "facade_bleue_et_jaune",
  // eau et nature
  "bateau_dans_la_cour", "bateau_sur_cales", "marina", "ponton", "quai", "plage", "mangrove", "eau_libre", "ile", "palmiers",
  // transport
  "pont", "longue_route_sur_l_eau", "piste_d_atterrissage", "hangar_avion", "tour_de_controle", "avions", "helicoptere",
  "heliport", "cloture_militaire", "vehicules_militaires", "grues_portuaires", "conteneurs",
  // véhicules
  "pick_up", "vehicule_jaune", "vehicule_turquoise", "4x4_gris", "bandes_rouges", "prise_d_air_capot",
  // carte
  "vue_carte", "littoral", "port", "aeroport", "pistes_multiples", "base_militaire", "interieur_des_terres",
] as const;
export type Clue = (typeof CLUES)[number];

/** Poids d'un indice : générique (palmiers, eau) ≈ nul ; distinctif (moulin sur le toit) fort. */
export const CLUE_WEIGHT: Partial<Record<Clue, number>> = {
  palmiers: 0.1, eau_libre: 0.2, plage: 0.3, ile: 0.4, pont: 0.4, quai: 0.6, ponton: 0.6, marina: 1, devanture_de_boutique: 0.4,
  pick_up: 1, vehicule_jaune: 0.8, vehicule_turquoise: 0.8, escalier_exterieur: 1.2, balcon_sur_l_eau: 1.4, facade_verte: 1.2,
  maison_sur_pilotis: 3, panier_de_basket: 2, bateau_dans_la_cour: 2, bateau_sur_cales: 2, salle_de_sport_exterieure: 1.5,
  hangar_a_bateaux: 2, enseigne_sur_le_toit: 1.5, racks_a_bateaux: 3, moulin_sur_le_toit: 4, tables_de_pique_nique: 1, auvent_raye: 2,
  drapeau_pirate: 2.5, statue_de_baleine: 4, station_service: 1, motel: 2, facade_bleue_et_jaune: 1.5,
  piste_d_atterrissage: 2, hangar_avion: 1.5, tour_de_controle: 2, avions: 1, helicoptere: 1, heliport: 1.5, cloture_militaire: 3,
  vehicules_militaires: 3, grues_portuaires: 3, conteneurs: 2, longue_route_sur_l_eau: 1.5, mangrove: 0.6,
  "4x4_gris": 1, bandes_rouges: 1.5, prise_d_air_capot: 1.2,
  vue_carte: 0, littoral: 0.8, port: 1.5, aeroport: 2, pistes_multiples: 2, base_militaire: 3, interieur_des_terres: 1.5,
};
export const clueWeight = (c: Clue) => CLUE_WEIGHT[c] ?? 1;

export type EntityType = "planque" | "lieu" | "établissement" | "zone" | "aérodrome" | "port" | "véhicule" | "personnage";
export type Coverage = "documenté" | "partiel" | "minimal";
export type KConfidence = "Vérifié" | "Probable" | "Non confirmé";

export interface KSource {
  name: string;
  url: string;
  /** Ce que la source affirme (reformulé, court). */
  says: string;
  checkedAt: string;
}

/** Caractéristique visuelle distinctive : texte lisible + indices normalisés + sources qui l'appuient. */
export interface VisualFeature {
  text: string;
  clues: Clue[];
  /** Index dans `sources`. */
  src: number[];
  /** Vraie seulement pour l'édition Ultimate, de jour, etc. */
  condition?: string;
}

export interface KRelation {
  type: "appartient_à" | "garé_à" | "voisin_de" | "proche_de" | "fait_partie_de" | "débloqué_par" | "perdu_à" | "lieu_de_mission" | "possédé_par";
  /** Id d'entité Knowledge, ou de mission (préfixe « mission: »). */
  to: string;
  note?: string;
}

export interface KEntity {
  id: string;
  name: string;
  aliases: string[];
  type: EntityType;
  /** Chapitres où l'entité compte pour le joueur (vide = toute la partie). */
  chapters: number[];
  /** Après ce chapitre, le lieu n'est plus accessible (ex. la maison de Jason). */
  lostAfterChapter?: number;
  description: string;
  visual: VisualFeature[];
  relations: KRelation[];
  location: {
    /** Repère GTADB existant (jamais une coordonnée inventée). */
    landmarkId?: string;
    establishmentId?: string;
    district: string;
    precision: "repère" | "zone" | "inconnue";
    note?: string;
  };
  vehicleId?: string;
  sources: KSource[];
  verifiedAt: string;
  contradictions: string[];
  coverage: Coverage;
  /** Ce qui n'est pas documenté (jamais interprété comme une absence). */
  unknowns: string[];
}
