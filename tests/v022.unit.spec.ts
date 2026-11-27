import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { matchesMapLayer, poiCategory, poiKind, searchPois } from "../src/lib/poi";
import type { Landmark } from "../src/lib/gtadb";

type Row = [string,string,number,number,string,string[]];
const rows: Row[] = JSON.parse(readFileSync("public/data/landmarks.json","utf8"));
const places: Landmark[] = rows.map(([id, full, x, y, real, tags])=>{
  const [name,...district]=full.split(",").map(s=>s.trim());
  return {id,name,district:district.join(", "),x,y,real,tags};
});

test("chaque métier des Essentiels est présent et la recherche française retrouve les commerces",()=>{
  const shown=places.filter(l=>matchesMapLayer("essentiels",poiKind(l),poiCategory(l),false));
  const kinds=new Set(shown.map(poiKind));
  expect([...kinds].sort()).toEqual(["armurerie","coiffeur","garage","maison","station","tatoueur","tuning","vetements"]);
  for (const [query,kind] of [["armurerie","armurerie"],["boutiques de vêtements","vetements"],["coiffure","coiffeur"],["tatoueurs","tatoueur"],["peinture","tuning"]]) {
    const rows=searchPois(query,places);
    expect(rows.length,query).toBeGreaterThan(0);
    expect(rows.every(l=>poiKind(l)===kind),query).toBe(true);
  }
});

test("un lieu générique reste dans Tout et la recherche, sans devenir un service",()=>{
  const place=places.find(l=>poiKind(l)==="autre" && l.name!=="?" && l.name.length>5)!;
  expect(matchesMapLayer("tout","autre","autre",false)).toBe(true);
  for(const layer of ["essentiels","services","sorties","reperes"] as const)
    expect(matchesMapLayer(layer,"autre","autre",false)).toBe(false);
  expect(searchPois(place.name,places).map(l=>l.id)).toContain(place.id);
});
