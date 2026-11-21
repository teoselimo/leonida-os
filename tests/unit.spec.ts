import { expect, test } from "@playwright/test";
import { DISCOVERIES, RADAR } from "../src/data/demo";
import { progress, recommend, statusOf, visibleSignal, wouldUnlock } from "../src/lib/engine";
import { isReliable } from "../src/lib/meta";
import { asPlayerRecord } from "../src/lib/records";
import { initialState, migrate } from "../src/lib/store";
import type { Discovery, PersistedState } from "../src/lib/types";

const NOW = new Date("2026-11-20T12:00:00+01:00");
const state = (patch: Partial<PersistedState> = {}): PersistedState => ({ ...initialState(), ...patch });
const byId = (id: string) => DISCOVERIES.find((d) => d.id === id)!;

test.describe("Anti-spoiler", () => {
  test("un contenu au-delà du repère narratif est masqué", () => {
    const s = state({ profile: { ...initialState().profile, chapter: 1 } });
    expect(statusOf(byId("vc-night"), s)).toBe("hidden"); // spoilerChapter 2
    expect(statusOf(byId("gr-anomaly"), s)).toBe("hidden"); // spoilerChapter 3
  });
  test("le contenu devient visible quand la progression le permet", () => {
    const s = state({ profile: { ...initialState().profile, chapter: 2 } });
    expect(statusOf(byId("vc-night"), s)).toBe("available");
    expect(statusOf(byId("gr-anomaly"), s)).toBe("hidden");
  });
  test("signal radar : strict = retiré, modéré = flouté", () => {
    const sig = RADAR.find((g) => g.spoilerChapter > 1)!;
    expect(visibleSignal(sig, state())).toBe("hidden");
    expect(visibleSignal(sig, state({ profile: { ...initialState().profile, spoilerMode: "relaxed" } }))).toBe("blurred");
  });
  test("les recommandations n'exposent jamais un contenu masqué", () => {
    const recs = recommend(DISCOVERIES, state(), NOW, 50);
    expect(recs.every((r) => statusOf(r.discovery, state()) === "available")).toBe(true);
    expect(recs.some((r) => r.discovery.spoilerChapter > 1)).toBe(false);
  });
});

test.describe("Progression et recommandations", () => {
  test("terminer une découverte débloque la suivante et met à jour la progression", () => {
    const s0 = state();
    expect(statusOf(byId("vc-garage"), s0)).toBe("locked");
    expect(wouldUnlock("vc-rooftop", DISCOVERIES, s0).map((d) => d.id)).toEqual(["vc-garage"]);
    const s1 = state({ completed: { ...s0.completed, "vc-rooftop": NOW.toISOString() }, freshUnlocks: ["vc-garage"] });
    expect(statusOf(byId("vc-garage"), s1)).toBe("available");
    expect(progress(DISCOVERIES, s1).done).toBe(progress(DISCOVERIES, s0).done + 1);
    const recs = recommend(DISCOVERIES, s1, NOW, 10);
    expect(recs.find((r) => r.discovery.id === "vc-rooftop")).toBeUndefined();
    expect(recs.find((r) => r.discovery.id === "vc-garage")?.isFresh).toBe(true);
  });
  test("un événement expiré n'est plus recommandé", () => {
    const later = new Date("2026-12-01T12:00:00+01:00");
    expect(recommend(DISCOVERIES, state(), later, 50).some((r) => r.discovery.id === "vc-meet")).toBe(false);
  });
});

test.describe("Modèle de fiabilité", () => {
  test("un relevé personnel reste « personal » même si l'entrée prétend le contraire", () => {
    const forged = { ...byId("vc-garage"), id: "x1", source: { label: "Officiel !", reliability: "official" }, provenance: { kind: "demo" } } as unknown as Discovery;
    const r = asPlayerRecord(forged, NOW);
    expect(r.source.reliability).toBe("personal");
    expect(r.provenance.kind).toBe("player");
    expect(isReliable(r.source.reliability)).toBe(false);
  });
  test("les valeurs hors bornes sont ramenées dans les limites", () => {
    const r = asPlayerRecord({ id: "x2", title: "Test", x: 1, y: 2, difficulty: 9 as 1, spoilerChapter: 12 as 0, durationMin: -4, category: "inconnue" as "mission" }, NOW);
    expect([r.difficulty, r.spoilerChapter, r.durationMin, r.category]).toEqual([3, 6, 1, "collectible"]);
  });
  test("migration V0.3 : les relevés marqués « vérifié » deviennent personnels", () => {
    const old = { schema: 1, custom: [{ ...byId("am-sign"), id: "p-old", source: { label: "Mon relevé", reliability: "verified" }, provenance: { kind: "player", createdAt: "2026-11-20T09:00:00Z" } }] } as unknown as PersistedState;
    const m = migrate(old);
    expect(m.custom[0].source.reliability).toBe("personal");
    expect(m.custom[0].provenance).toEqual({ kind: "player", createdAt: "2026-11-20T09:00:00Z" });
    expect(m.showDemo).toBe(true);
  });
  test("démo, rumeur, signalement et confirmation restent distincts", () => {
    const levels = new Set(RADAR.map((g) => g.reliability));
    expect(levels.has("rumor") && levels.has("reported") && levels.has("confirmed")).toBe(true);
    expect(RADAR.every((g) => g.provenance.kind === "demo")).toBe(true);
    expect(DISCOVERIES.every((d) => d.source.reliability !== "official")).toBe(true); // rien d'inventé n'est « officiel »
  });
});

// ── V0.6 : logique du Garage des légendes (sur le flux réel produit par le moteur, fixtures v5) ──
import { readFileSync as rf } from "node:fs";
import { compatibility, vehicleRecommendations, viewOf } from "../src/lib/garage";
test.describe("Garage des légendes", () => {
  const feed = JSON.parse(rf("tests/fixtures/radar-v5.json", "utf8"));
  const V = (id: string) => feed.vehicles.find((v: { id: string }) => v.id === id);
  const st = (edition: "standard" | "ultimate" | "unknown", chapter: number, vehicles = {}) => ({ profile: { pseudo: "", console: "ps5" as const, edition, chapter: chapter as 1, spoilerMode: "strict" as const }, vehicles });
  test("exclusivité confirmée : réservée Ultimate, à vérifier si l'édition est inconnue", () => {
    expect(compatibility(V("v-dinka-enduro"), "standard")).toBe("ultimate-only");
    expect(compatibility(V("v-dinka-enduro"), "ultimate")).toBe("ok");
    expect(compatibility(V("v-dinka-enduro"), "unknown")).toBe("check");
    expect(compatibility(V("v-vapid-stanier"), "standard")).toBe("preorder");
  });
  test("même chapitre, éditions différentes ⇒ recommandations différentes", () => {
    const s = vehicleRecommendations(feed.vehicles, st("standard", 1)).map((x) => x.v.id);
    const u = vehicleRecommendations(feed.vehicles, st("ultimate", 1)).map((x) => x.v.id);
    expect(s).not.toContain("v-dinka-enduro");
    expect(u).toContain("v-dinka-enduro");
    expect(u).not.toEqual(s);
  });
  test("chapitre insuffisant ⇒ plus tard (masqué en strict) ; fenêtre dépassée ⇒ plus recommandé", () => {
    expect(viewOf(V("v-grotti-itali-rsx"), st("ultimate", 1)).hidden).toBe(true);
    expect(viewOf(V("v-grotti-itali-rsx"), st("ultimate", 3)).now).toBe(true);
    expect(viewOf(V("v-dinka-enduro"), st("ultimate", 2)).expired).toBe(true);
    expect(viewOf(V("v-dinka-enduro"), st("ultimate", 2)).now).toBe(false);
  });
  test("un véhicule conservé n'est plus recommandé ; un simple repérage, si", () => {
    const at = "2026-11-21T10:00:00Z";
    expect(vehicleRecommendations(feed.vehicles, st("standard", 1, { "v-maibatsu-penumbra-ff": { state: "spotted", at } })).map((x) => x.v.id)).toContain("v-maibatsu-penumbra-ff");
    expect(vehicleRecommendations(feed.vehicles, st("standard", 1, { "v-maibatsu-penumbra-ff": { state: "registered", at } })).map((x) => x.v.id)).not.toContain("v-maibatsu-penumbra-ff");
  });
  test("précision : zone pour la Penumbra, point exact seulement pour la Vitello validée", () => {
    expect(V("v-maibatsu-penumbra-ff").location.precision).toBe("zone");
    expect(V("v-maibatsu-penumbra-ff").location.point).toBeNull();
    expect(V("v-pegassi-vitello").location.precision).toBe("exact");
  });
  test("migration : l'ancienne édition « spéciale » devient « à renseigner », les véhicules suivis sont conservés", () => {
    const m = migrate({ schema: 1, profile: { edition: "special" } } as unknown as PersistedState);
    expect(m.profile.edition).toBe("unknown");
    expect(m.vehicles).toEqual({});
  });
});
