import { expect, test } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { poiCategory, poiKind, POI_CATS } from "../src/lib/poi";
import type { Landmark } from "../src/lib/gtadb";
import { KIND } from "../src/components/map/icons";

/** V0.15 — carte HD : niveau natif, pictogrammes métier, visibilité. */
const lm = (name: string, tags: string[] = []): Landmark => ({ id: "x", name, district: "Key Lento", x: 0, y: 0, real: "", tags });

test("pictogrammes : le métier se lit sans ouvrir la fiche", () => {
  expect(poiKind(lm("Ammu-Nation", ["retail"]))).toBe("armurerie");
  expect(poiKind(lm("Chuck's Tackle & Shot", ["guns"]))).toBe("armurerie");
  expect(poiKind(lm("The Inked Mermaid", ["tattoos", "retail"]))).toBe("tatoueur");
  expect(poiKind(lm("Barnacle Beauties", ["hair", "retail"]))).toBe("coiffeur");
  expect(poiKind(lm("Billie's Key Lento Gift Shop", ["clothes", "retail"]))).toBe("vetements");
  expect(poiKind(lm("Coastal Auto Care Pay 'n' Spray"))).toBe("tuning");
  expect(poiKind(lm("The Rusty Anchor", ["restaurant", "bar"]))).toBe("bar");
  expect(poiKind(lm("Safe house", ["safehouse"]))).toBe("maison");
  expect(poiCategory(lm("Ammu-Nation", ["retail"]))).toBe("commerce"); // le filtre reste « Commerces »
  for (const k of Object.values(KIND)) expect(k.fill?.length || k.stroke?.length).toBeTruthy();
});

test("visibilité : commerces dès la vue de quartier, repères dès la vue d'ensemble", () => {
  expect(POI_CATS.repere.minZoom).toBe(0);
  expect(POI_CATS.commerce.minZoom).toBeLessThanOrEqual(2);
  expect(POI_CATS.restaurant.minZoom).toBeLessThanOrEqual(3);
});

test("fond HD : niveau natif z5 présent, métadonnées à jour, attribution gtadb conservée", () => {
  const meta = JSON.parse(readFileSync("public/data/gtadb.json", "utf8"));
  expect(meta.maxzoom).toBe(5);
  expect(meta.license).toBe("CC BY 4.0");
  expect(meta.attribution).toContain("map.gtadb.org");
  for (const t of ["5/12/22", "5/13/22", "5/14/16"]) expect(existsSync(`public/tiles/${t}.jpg`), t).toBe(true);
});
