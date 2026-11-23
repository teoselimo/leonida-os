import type { Discovery, DiscoveryStatus, Region } from "@/lib/types";
import type { Landmark } from "@/lib/gtadb";
import type { PoiCat } from "@/lib/poi";

/**
 * Contrat de la carte. Implémentation actuelle : `LeonidaMap` (MapLibre GL + tuiles gtadb).
 * L'écran Carte ne dépend que de ces props.
 */
export interface MapMarker {
  discovery: Discovery;
  status: DiscoveryStatus;
  fresh: boolean;
  tracked: boolean;
  /** Masqué par les filtres (le marqueur existe mais n'est pas affiché). */
  visible: boolean;
}

/** Zone de recherche approximative (jamais présentée comme un point exact). */
export interface MapZone {
  id: string;
  x: number;
  y: number;
  radius: number;
  color: string;
  label: string;
  /** Zone élargie (« à l'est de… ») : trait pointillé plus marqué. */
  widened?: boolean;
  /** « point » : position vérifiée (dessinée comme un petit cercle plein, sans mention « approximative »). */
  kind?: "zone" | "point" | "calibre";
  /** Parcours (véhicule mobile) : lignes en coordonnées de jeu, dessinées par-dessus le cercle. */
  path?: Array<Array<[number, number]>>;
  /** Libellé de provenance d'un point (« Placée par toi », « Repère communautaire »). */
  tag?: string;
}

export interface MapViewProps {
  regions: Region[];
  markers: MapMarker[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Change de valeur à chaque demande de recentrage sur la sélection. */
  focusNonce: number;
  /** Zone masquée par l'UI (barre du haut, fiche mobile en bas, panneau tablette à gauche). */
  occlusion: { top: number; bottom: number; left: number };
  landmarks: Landmark[];
  showLandmarks: boolean;
  /** Catégories de repères affichées (vide ou absent : toutes). */
  poiCats?: PoiCat[];
  selectedLandmarkId: string | null;
  onSelectLandmark: (id: string | null) => void;
  /** L'onglet Carte est affiché (la carte reste montée en arrière-plan sinon). */
  active: boolean;
  /** Mode cartographe : un toucher sur la carte renvoie des coordonnées de jeu. */
  pickMode: boolean;
  onPick: (x: number, y: number) => void;
  /** Change de valeur pour demander « poser au centre de la vue ». */
  pickCenterNonce: number;
  /** Point en cours de relevé (déplaçable au doigt). */
  draft: { x: number; y: number } | null;
  onDraftMove: (x: number, y: number) => void;
  /** Garage des légendes : zones de recherche affichées sous les marqueurs. */
  zones?: MapZone[];
  selectedZoneId?: string | null;
  onSelectZone?: (id: string) => void;
  /** Cadrage demandé (liste de lieux) : la caméra montre ce cercle, RIEN n'est dessiné. */
  view?: { x: number; y: number; radius: number; nonce: number } | null;
}
