import { expect, test } from "@playwright/test";
import { groundMap, parseObservation } from "../src/lib/knowledge/engine";

/**
 * V0.19 · Mesure de la reconnaissance de carte (moteur seul) — docs/v019-eval-cartes.jpg.
 * Images : extraits GTADB SANS nom (CC BY 4.0), rendus autour de 4 aérodromes. Indices : extraits À LA MAIN, en
 * regardant chaque image, avec le vocabulaire de l'app (pas par le runtime de l'Artifact).
 * Résultat mesuré le 23/11/2026 : bonne zone dans le top 3 pour 4/4, en 1re position pour 3/4 (1 et 3 : égalité à
 * départager par la comparaison visuelle avec les extraits de carte, qui demande le vrai modèle).
 */
const CASES: Array<[string, string, string[], number]> = [
  ["1 · île, pistes croisées", "zone-L354", ["vue_carte", "aeroport", "piste_d_atterrissage", "pistes_multiples", "ile", "littoral", "pont", "longue_route_sur_l_eau"], 3],
  ["2 · côte, piste unique, quais", "zone-L1554", ["vue_carte", "aeroport", "piste_d_atterrissage", "littoral", "port", "quai"], 1],
  ["3 · côte marécageuse, petite piste, marina", "zone-L1561", ["vue_carte", "aeroport", "piste_d_atterrissage", "littoral", "marina", "mangrove"], 3],
  ["4 · grand aéroport intérieur, pistes parallèles", "zone-L345", ["vue_carte", "aeroport", "pistes_multiples", "interieur_des_terres"], 1],
];
for (const [name, want, clues, maxRank] of CASES)
  test(`carte ${name} : ${want} dans le top ${maxRank}`, () => {
    const g = groundMap(parseObservation({ type: "carte", gta6: "oui", indices: clues })!);
    const rank = g.candidates.findIndex((c) => c.id === want) + 1;
    expect(rank).toBeGreaterThan(0);
    expect(rank).toBeLessThanOrEqual(maxRank);
    // égalité ⇒ confiance « faible » (jamais « élevée » sans élément qui tranche)
    if (g.candidates[1] && g.candidates[0].score === g.candidates[1].score) expect(g.confidence).toBe("faible");
  });
