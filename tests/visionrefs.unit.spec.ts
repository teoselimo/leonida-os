import { expect, test } from "@playwright/test";
import { readFileSync, statSync } from "node:fs";
import { selectRefs, REF_MAX_BYTES, refLabel } from "../src/lib/hub/visionRefs";
import type { VisionRefIndex } from "../src/lib/hub/visionRefs";
import { ground, parseObservation } from "../src/lib/knowledge/engine";
import { groundingOut } from "../src/lib/copilot/engine";
import { visionAnswerRules } from "../src/lib/copilot/grounding";

/**
 * V0.20.1 · Références visuelles GTADB : index réel (public/data/hub/vision-refs.json), sélection avant comparaison,
 * plafond de confiance. Claude n'est PAS appelé ici (tests du moteur LEONIDA seulement).
 */
const index = JSON.parse(readFileSync("public/data/hub/vision-refs.json", "utf8")) as VisionRefIndex;
const prof = { chapter: 1, spoilerMode: "strict", edition: "ultimate" } as never;
const obs = (o: Record<string, unknown>) => parseObservation({ type: "scène", gta6: "oui", indices: [], textes: [], vehicules: [], resume: "", ...o })!;

test("index : 20 à 50 références, chacune présente, ≤ 70 Ko, avec provenance et licence", () => {
  expect(index.count).toBeGreaterThanOrEqual(20);
  expect(index.count).toBeLessThanOrEqual(50);
  expect(index.available).toBe(2487);
  expect(index.license).toContain("CC BY 4.0");
  for (const r of index.refs) {
    expect(statSync(`public/${r.file}`).size).toBe(r.bytes);
    expect(r.bytes).toBeLessThanOrEqual(70_000);
    expect(r.source).toContain("github.com/rolux/gtadb.org");
  }
  // priorités demandées : maison de Jason, marina de Brian, planques, Key Lento
  const ids = index.refs.map((r) => r.id);
  for (const id of ["L266", "L326", "L325", "L304"]) expect(ids).toContain(id);
  expect(index.refs.filter((r) => r.district === "Key Lento").length).toBeGreaterThanOrEqual(15);
});

test("sélection : candidats du moteur d'abord, puis lieux du chapitre ; 3 au plus, poids plafonné", () => {
  const o = obs({ indices: ["marina", "bateau_sur_cales", "palmiers", "enseigne"], textes: ["BRIAN'S MARINA"] });
  const g = ground(o, prof);
  const picks = selectRefs(index, g, o, { chapter: 1 });
  expect(picks.length).toBeGreaterThan(0);
  expect(picks.length).toBeLessThanOrEqual(3);
  expect(picks[0]).toMatchObject({ reason: "candidat" });
  expect(picks[0].ref.id).toBe(g.candidates[0].landmarkId);
  expect(picks.reduce((n, p) => n + p.ref.bytes, 0)).toBeLessThanOrEqual(REF_MAX_BYTES);
});

test("aucun candidat : références choisies d'après la progression (chapitre 1 → Key Lento), jamais un lieu perdu", () => {
  const o = obs({ indices: ["palmiers"] });
  const picks = selectRefs(index, ground(o, prof), o, { chapter: 1 });
  expect(picks.every((p) => p.reason === "progression")).toBeTruthy();
  expect(picks.some((p) => p.ref.district === "Key Lento")).toBeTruthy();
  // chapitre 3 : la maison de Jason (perdue après le chapitre 1) n'est plus proposée d'office
  const late = selectRefs(index, ground(o, { ...(prof as object), chapter: 3 } as never), o, { chapter: 3 });
  expect(late.map((p) => p.ref.id)).not.toContain("L266");
});

test("pas de photo pour une capture de carte, de menu, ou hors GTA VI", () => {
  for (const k of [{ type: "carte" }, { type: "menu" }, { gta6: "non" }]) {
    const o = obs({ indices: ["marina"], ...k });
    expect(selectRefs(index, ground(o, prof), o, { chapter: 1 })).toHaveLength(0);
  }
});

test("confiance : une ressemblance avec une photo comparée ne dépasse jamais « moyenne » ; « aucun » = pas d'identification", () => {
  const o = obs({ indices: ["palmiers"] });
  const g0 = ground(o, prof);
  const rusty = index.refs.find((r) => r.id === "L325")!;
  const g = { ...g0, candidates: [...g0.candidates, { id: "the-rusty-anchor", name: refLabel(rusty), type: "lieu" as const, score: 0, why: [], toCheck: [], landmarkId: "L325", district: "Key Lento" }] };
  const yes = groundingOut(g, { candidat: "the-rusty-anchor", confiance: "élevée" }, [], null, 0, null, ["L325"]);
  expect(yes.identification).toMatchObject({ landmarkId: "L325", confidence: "moyenne" });
  // non comparée (pas envoyée) : plafond = moteur (aucune) → pas d'identification
  expect(groundingOut(g, { candidat: "the-rusty-anchor", confiance: "élevée" }, [], null, 0, null, []).identification).toBeNull();
  expect(groundingOut(g, { candidat: "aucun", confiance: "aucune" }, [], null, 0, null, ["L325"]).identification).toBeNull();
  // candidat retenu par son repère GTADB (id renvoyé par le modèle)
  expect(groundingOut(g, { candidat: "L325", confiance: "faible" }, [], null, 0, null, ["L325"]).identification?.name).toBe("The Rusty Anchor");
});

test("consigne : les photos sont nommées dans l'ordre d'envoi et « aucun » est permis", () => {
  const t = visionAnswerRules({ purpose: "capture", refs: 0, followUp: null, detail: false, photos: ["photo 1 = candidat « jasons-house » (Jason's House)"] });
  expect(t).toContain("PHOTOS DE RÉFÉRENCE GTADB");
  expect(t).toContain("photo 1 = candidat « jasons-house »");
  expect(t).toContain('"aucun"');
});
