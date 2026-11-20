import type { Discovery, Provenance, RadarSignal, Region } from "@/lib/types";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  JEU DE DONNÉES DE DÉMONSTRATION
 * ─────────────────────────────────────────────────────────────────────────────
 *  Seuls les NOMS des six régions de Leonida sont des faits officiels
 *  (site Rockstar Games, vérifié le 19/11/2026).
 *  Le fond de carte et les lieux viennent de la carte communautaire gtadb.org
 *  (CC BY 4.0, voir lib/gtadb.ts). Tout le reste — découvertes, prérequis,
 *  récompenses, signaux radar — est FICTIF ; les découvertes de démo sont
 *  simplement posées à des emplacements réels de cette carte et sert uniquement à
 *  démontrer l'expérience. Chaque objet porte `provenance: { kind: "demo" }`.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const DEMO: Provenance = { kind: "demo" };
const OFFICIAL_REGION: Provenance = {
  kind: "official",
  source: "Site officiel Rockstar Games — régions de Leonida",
  checkedAt: "2026-11-19",
};

export const DATASET_INFO = {
  label: "Données de démonstration",
  version: "demo-2026.11-v0.2",
  officialFacts: [
    "Leonida comprend six régions nommées : Vice City, Leonida Keys, Grassrivers, Port Gellhorn, Ambrosia, Mount Kalaga National Park.",
    "Sortie annoncée le 19 novembre 2026 sur PS5 et Xbox Series X|S.",
  ],
  disclaimer:
    "Découvertes, prérequis, récompenses et signaux sont fictifs (posés sur la carte pour la démo). Le fond de carte et les lieux sont une reconstitution communautaire (gtadb.org, CC BY 4.0), pas la carte officielle de Rockstar.",
};

export const REGIONS: Region[] = [
  {
    id: "kalaga",
    name: "Mount Kalaga",
    provenance: OFFICIAL_REGION,
    tagline: "Parc national au nord de l'État",
    label: [-3700, 6700],
    hue: "#7CF29A",
  },
  {
    id: "gellhorn",
    name: "Port Gellhorn",
    provenance: OFFICIAL_REGION,
    tagline: "Côte balnéaire sur le déclin",
    label: [-6500, 3400],
    hue: "#FFB547",
  },
  {
    id: "ambrosia",
    name: "Ambrosia",
    provenance: OFFICIAL_REGION,
    tagline: "Cœur industriel de Leonida",
    label: [-2800, 3900],
    hue: "#C9A2FF",
  },
  {
    id: "grassrivers",
    name: "Grassrivers",
    provenance: OFFICIAL_REGION,
    tagline: "Zones humides et mangroves",
    label: [-3800, -3600],
    hue: "#2EE6D6",
  },
  {
    id: "vicecity",
    name: "Vice City",
    provenance: OFFICIAL_REGION,
    tagline: "Métropole côtière, cœur urbain",
    label: [-500, 800],
    hue: "#FF3D8B",
  },
  {
    id: "keys",
    name: "Leonida Keys",
    provenance: OFFICIAL_REGION,
    tagline: "Archipel tropical",
    label: [-2900, -6200],
    hue: "#5AB8FF",
  },
];

const d = (x: Omit<Discovery, "provenance">): Discovery => ({ ...x, provenance: DEMO });

export const DISCOVERIES: Discovery[] = [
  // ── Vice City ──────────────────────────────────────────────────────────────
  d({ id: "vc-rooftop", title: "Toit panoramique", category: "activity", regionId: "vicecity", x: 1950, y: 1500, summary: "Un point de vue en hauteur qui dégage toute la baie. Idéal au coucher du soleil.", prerequisites: [], reward: "Révèle les marqueurs voisins", durationMin: 8, difficulty: 1, spoilerChapter: 0, contentPotential: 82, source: { label: "Signalements recoupés (démo)", reliability: "confirmed" } }),
  d({ id: "vc-mural-1", title: "Fresque néon nº1", category: "collectible", regionId: "vicecity", x: -650, y: 480, summary: "Une fresque lumineuse dans une ruelle, visible uniquement de nuit.", prerequisites: [], reward: "Collection Fresques 1/3", durationMin: 5, difficulty: 1, spoilerChapter: 0, contentPotential: 64, source: { label: "Exploration (démo)", reliability: "confirmed" } }),
  d({ id: "vc-mural-2", title: "Fresque néon nº2", category: "collectible", regionId: "vicecity", x: -480, y: 1600, summary: "Deuxième fresque de la série, sur un mur de parking.", prerequisites: [], reward: "Collection Fresques 2/3", durationMin: 6, difficulty: 1, spoilerChapter: 0, contentPotential: 58, source: { label: "Exploration (démo)", reliability: "reported" } }),
  d({ id: "vc-garage", title: "Garage discret", category: "vehicle", regionId: "vicecity", x: -1400, y: 560, summary: "Un atelier fermé qui s'ouvre une fois le quartier repéré depuis les hauteurs.", prerequisites: [{ type: "discovery", id: "vc-rooftop" }], reward: "Véhicule de collection (démo)", durationMin: 15, difficulty: 2, spoilerChapter: 0, contentPotential: 88, source: { label: "Signalements recoupés (démo)", reliability: "confirmed" } }),
  d({ id: "vc-container", title: "Conteneur oublié", category: "secret", regionId: "vicecity", x: 1240, y: -400, summary: "Au fond du port, un conteneur qui ne figure sur aucun manifeste.", prerequisites: [{ type: "discovery", id: "vc-garage" }], reward: "Objet rare (démo)", durationMin: 12, difficulty: 2, spoilerChapter: 0, contentPotential: 91, source: { label: "Rumeur (démo)", reliability: "rumor" } }),
  d({ id: "vc-night", title: "Contrat de nuit", category: "mission", regionId: "vicecity", x: -300, y: 430, summary: "Une mission annexe liée à l'intrigue principale.", prerequisites: [{ type: "chapter", min: 2 }], reward: "Contact débloqué (démo)", durationMin: 25, difficulty: 3, spoilerChapter: 2, contentPotential: 76, source: { label: "Signalements recoupés (démo)", reliability: "reported" } }),
  d({ id: "vc-meet", title: "Rassemblement auto", category: "event", regionId: "vicecity", x: 1500, y: 1340, summary: "Événement temporaire : rassemblement de voitures sur le front de mer.", prerequisites: [], reward: "Peinture exclusive (démo)", durationMin: 20, difficulty: 1, spoilerChapter: 0, contentPotential: 95, endsAt: "2026-11-22T23:00:00+01:00", source: { label: "Annonce relayée (démo)", reliability: "confirmed" } }),

  // ── Leonida Keys ──────────────────────────────────────────────────────────
  d({ id: "lk-dive", title: "Épave immergée", category: "activity", regionId: "keys", x: -2560, y: -5860, summary: "Plongée libre autour d'une épave à faible profondeur.", prerequisites: [], reward: "Accès plongée avancée (démo)", durationMin: 14, difficulty: 1, spoilerChapter: 0, contentPotential: 79, source: { label: "Exploration (démo)", reliability: "confirmed" } }),
  d({ id: "lk-shell", title: "Coquillages rares", category: "collectible", regionId: "keys", x: -3390, y: -6800, summary: "Cinq coquillages dispersés sur les plages de l'archipel.", prerequisites: [], reward: "Collection Plages 1/2", durationMin: 18, difficulty: 1, spoilerChapter: 0, contentPotential: 40, source: { label: "Exploration (démo)", reliability: "reported" } }),
  d({ id: "lk-boat", title: "Hors-bord de location", category: "vehicle", regionId: "keys", x: -2270, y: -5260, summary: "Un loueur de bateaux qui ne fait confiance qu'aux plongeurs confirmés.", prerequisites: [{ type: "discovery", id: "lk-dive" }], reward: "Hors-bord (démo)", durationMin: 10, difficulty: 1, spoilerChapter: 0, contentPotential: 70, source: { label: "Signalements recoupés (démo)", reliability: "confirmed" } }),
  d({ id: "lk-lighthouse", title: "Phare isolé", category: "secret", regionId: "keys", x: -4430, y: -6830, summary: "Accessible uniquement par la mer. Quelque chose clignote la nuit.", prerequisites: [{ type: "discovery", id: "lk-boat" }], reward: "Secret de l'archipel (démo)", durationMin: 16, difficulty: 2, spoilerChapter: 0, contentPotential: 93, source: { label: "Rumeur (démo)", reliability: "rumor" } }),

  // ── Grassrivers ───────────────────────────────────────────────────────────
  d({ id: "gr-airboat", title: "Balade en hydroglisseur", category: "activity", regionId: "grassrivers", x: -2950, y: -4550, summary: "Traversée des canaux à toute vitesse, avec un guide local.", prerequisites: [], reward: "Hydroglisseur (démo)", durationMin: 12, difficulty: 1, spoilerChapter: 0, contentPotential: 85, source: { label: "Exploration (démo)", reliability: "confirmed" } }),
  d({ id: "gr-totem", title: "Totem des marais", category: "collectible", regionId: "grassrivers", x: -3250, y: -1630, summary: "Une sculpture de bois au milieu des mangroves.", prerequisites: [], reward: "Collection Marais 1/2", durationMin: 9, difficulty: 2, spoilerChapter: 0, contentPotential: 55, source: { label: "Exploration (démo)", reliability: "reported" } }),
  d({ id: "gr-shack", title: "Cabane du braconnier", category: "mission", regionId: "grassrivers", x: -2600, y: -3460, summary: "Un ermite des marais a un travail à proposer… si vous savez naviguer.", prerequisites: [{ type: "discovery", id: "gr-airboat" }, { type: "chapter", min: 1 }], reward: "Mission annexe (démo)", durationMin: 22, difficulty: 2, spoilerChapter: 1, contentPotential: 72, source: { label: "Signalements recoupés (démo)", reliability: "confirmed" } }),
  d({ id: "gr-anomaly", title: "Phénomène inexpliqué", category: "secret", regionId: "grassrivers", x: -3600, y: -7900, summary: "Contenu de fin de partie.", prerequisites: [{ type: "chapter", min: 3 }], reward: "Secret majeur (démo)", durationMin: 30, difficulty: 3, spoilerChapter: 3, contentPotential: 99, source: { label: "Rumeur (démo)", reliability: "rumor" } }),

  // ── Port Gellhorn ─────────────────────────────────────────────────────────
  d({ id: "pg-motel", title: "Enseigne de motel", category: "collectible", regionId: "gellhorn", x: -6360, y: 3440, summary: "Une enseigne vintage à moitié éteinte, à photographier de nuit.", prerequisites: [], reward: "Collection Enseignes 1/2", durationMin: 6, difficulty: 1, spoilerChapter: 0, contentPotential: 61, source: { label: "Exploration (démo)", reliability: "confirmed" } }),
  d({ id: "pg-pier", title: "Pêche sur la jetée", category: "activity", regionId: "gellhorn", x: -6480, y: 3140, summary: "Un concours de pêche improvisé avec les habitués du port.", prerequisites: [], reward: "Canne améliorée (démo)", durationMin: 15, difficulty: 1, spoilerChapter: 0, contentPotential: 47, source: { label: "Exploration (démo)", reliability: "reported" } }),
  d({ id: "pg-arcade", title: "Borne d'arcade cachée", category: "secret", regionId: "gellhorn", x: -6370, y: 2850, summary: "Dans l'arrière-salle d'une galerie marchande fermée.", prerequisites: [{ type: "discovery", id: "pg-motel" }], reward: "Mini-jeu (démo)", durationMin: 10, difficulty: 2, spoilerChapter: 0, contentPotential: 87, source: { label: "Rumeur (démo)", reliability: "rumor" } }),
  d({ id: "pg-delivery", title: "Livraison douteuse", category: "mission", regionId: "gellhorn", x: -6200, y: 4470, summary: "Mission annexe liée à l'intrigue principale.", prerequisites: [{ type: "chapter", min: 2 }], reward: "Récompense (démo)", durationMin: 20, difficulty: 2, spoilerChapter: 2, contentPotential: 66, source: { label: "Signalements recoupés (démo)", reliability: "reported" } }),

  // ── Ambrosia ──────────────────────────────────────────────────────────────
  d({ id: "am-race", title: "Course de campagne", category: "activity", regionId: "ambrosia", x: -2800, y: 3950, summary: "Une course sur routes de campagne, à la tombée de la nuit.", prerequisites: [], reward: "Réputation pilote (démo)", durationMin: 11, difficulty: 2, spoilerChapter: 0, contentPotential: 80, source: { label: "Exploration (démo)", reliability: "confirmed" } }),
  d({ id: "am-bike", title: "Moto custom abandonnée", category: "vehicle", regionId: "ambrosia", x: -4705, y: 1852, summary: "Une moto préparée, laissée derrière un hangar.", prerequisites: [{ type: "discovery", id: "am-race" }], reward: "Moto custom (démo)", durationMin: 9, difficulty: 2, spoilerChapter: 0, contentPotential: 84, source: { label: "Signalements recoupés (démo)", reliability: "confirmed" } }),
  d({ id: "am-sign", title: "Panneau de ferme", category: "collectible", regionId: "ambrosia", x: -3300, y: 3500, summary: "Un panneau peint à la main au bord d'une route secondaire.", prerequisites: [], reward: "Collection Enseignes 2/2", durationMin: 5, difficulty: 1, spoilerChapter: 0, contentPotential: 35, source: { label: "Exploration (démo)", reliability: "reported" } }),
  d({ id: "am-restricted", title: "Zone d'accès restreint", category: "secret", regionId: "ambrosia", x: -2400, y: 4600, summary: "Contenu lié à l'intrigue principale.", prerequisites: [{ type: "chapter", min: 2 }], reward: "Secret (démo)", durationMin: 18, difficulty: 3, spoilerChapter: 2, contentPotential: 90, source: { label: "Rumeur (démo)", reliability: "rumor" } }),

  // ── Mount Kalaga ──────────────────────────────────────────────────────────
  d({ id: "mk-trail", title: "Sentier du belvédère", category: "activity", regionId: "kalaga", x: -3430, y: 6370, summary: "Une randonnée jusqu'à un belvédère sur la forêt.", prerequisites: [], reward: "Point de vue (démo)", durationMin: 16, difficulty: 1, spoilerChapter: 0, contentPotential: 74, source: { label: "Exploration (démo)", reliability: "confirmed" } }),
  d({ id: "mk-cabin", title: "Refuge du garde", category: "collectible", regionId: "kalaga", x: -4500, y: 6256, summary: "Un refuge forestier et son registre des visiteurs.", prerequisites: [], reward: "Collection Forêt 1/1", durationMin: 8, difficulty: 1, spoilerChapter: 0, contentPotential: 42, source: { label: "Exploration (démo)", reliability: "reported" } }),
  d({ id: "mk-hunt", title: "Permis de chasse", category: "activity", regionId: "kalaga", x: -5300, y: 6316, summary: "Obtenir le permis auprès du poste des gardes.", prerequisites: [{ type: "discovery", id: "mk-trail" }], reward: "Activité chasse (démo)", durationMin: 12, difficulty: 2, spoilerChapter: 0, contentPotential: 60, source: { label: "Signalements recoupés (démo)", reliability: "confirmed" } }),
  d({ id: "mk-summit", title: "Sommet nocturne", category: "secret", regionId: "kalaga", x: -2560, y: 6297, summary: "Contenu de fin de partie.", prerequisites: [{ type: "discovery", id: "mk-trail" }, { type: "discovery", id: "mk-cabin" }, { type: "chapter", min: 3 }], reward: "Secret majeur (démo)", durationMin: 25, difficulty: 3, spoilerChapter: 3, contentPotential: 97, source: { label: "Rumeur (démo)", reliability: "rumor" } }),
];

export const RADAR: RadarSignal[] = [
  { id: "sig-1", title: "Véhicule rare repéré près d'un garage", summary: "Plusieurs joueurs signalent un atelier qui s'ouvre après exploration du quartier.", regionId: "vicecity", category: "vehicle", reportedAt: "2026-11-19T15:40:00+01:00", reliability: "confirmed", confirmations: 14, contentPotential: 88, potentialBreakdown: { visual: 90, rarity: 82, trend: 92 }, spoilerChapter: 0, discoveryId: "vc-garage", provenance: DEMO },
  { id: "sig-2", title: "Lumière étrange au large de l'archipel", summary: "Des captures montrent un clignotement régulier la nuit, près d'un phare.", regionId: "keys", category: "secret", reportedAt: "2026-11-19T14:05:00+01:00", reliability: "rumor", confirmations: 3, contentPotential: 93, potentialBreakdown: { visual: 95, rarity: 96, trend: 88 }, spoilerChapter: 0, discoveryId: "lk-lighthouse", provenance: DEMO },
  { id: "sig-3", title: "Rassemblement auto ce week-end", summary: "Événement temporaire annoncé, récompense cosmétique exclusive.", regionId: "vicecity", category: "event", reportedAt: "2026-11-19T12:00:00+01:00", reliability: "confirmed", confirmations: 1, contentPotential: 95, potentialBreakdown: { visual: 98, rarity: 90, trend: 97 }, spoilerChapter: 0, discoveryId: "vc-meet", provenance: DEMO },
  { id: "sig-4", title: "Borne d'arcade jouable cachée", summary: "Une arrière-salle accessible après avoir repéré une enseigne.", regionId: "gellhorn", category: "secret", reportedAt: "2026-11-19T11:20:00+01:00", reliability: "reported", confirmations: 6, contentPotential: 87, potentialBreakdown: { visual: 80, rarity: 89, trend: 90 }, spoilerChapter: 0, discoveryId: "pg-arcade", provenance: DEMO },
  { id: "sig-5", title: "Révélation sur un personnage secondaire", summary: "Détail d'intrigue lié à une mission avancée.", regionId: "ambrosia", category: "mission", reportedAt: "2026-11-19T10:10:00+01:00", reliability: "reported", confirmations: 9, contentPotential: 81, potentialBreakdown: { visual: 60, rarity: 85, trend: 98 }, spoilerChapter: 2, discoveryId: "am-restricted", provenance: DEMO },
  { id: "sig-6", title: "Course nocturne très rentable", summary: "Bon ratio temps / récompense selon plusieurs retours.", regionId: "ambrosia", category: "activity", reportedAt: "2026-11-19T09:30:00+01:00", reliability: "confirmed", confirmations: 21, contentPotential: 68, potentialBreakdown: { visual: 72, rarity: 40, trend: 92 }, spoilerChapter: 0, discoveryId: "am-race", provenance: DEMO },
  { id: "sig-7", title: "Fin alternative supposée", summary: "Théorie non confirmée sur le dénouement.", regionId: "grassrivers", category: "secret", reportedAt: "2026-11-19T08:15:00+01:00", reliability: "rumor", confirmations: 2, contentPotential: 99, potentialBreakdown: { visual: 90, rarity: 99, trend: 99 }, spoilerChapter: 3, provenance: DEMO },
  { id: "sig-8", title: "Hydroglisseur : itinéraire le plus rapide", summary: "Un tracé à travers les canaux qui fait gagner du temps.", regionId: "grassrivers", category: "activity", reportedAt: "2026-11-19T07:50:00+01:00", reliability: "reported", confirmations: 5, contentPotential: 62, potentialBreakdown: { visual: 78, rarity: 45, trend: 63 }, spoilerChapter: 0, discoveryId: "gr-airboat", provenance: DEMO },
];

/** Progression de départ de la démo (réinitialisable depuis le Profil). */
export const DEMO_SEED_COMPLETED: Record<string, string> = {
  "vc-mural-1": "2026-11-19T09:12:00+01:00",
  "pg-motel": "2026-11-19T10:02:00+01:00",
  "lk-dive": "2026-11-19T11:47:00+01:00",
};
