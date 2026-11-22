import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { progressDelta } from "../src/lib/ai/progressAnswers";
import { buildBefore } from "../src/lib/before";
import { discoverNow } from "../src/lib/discover";
import { buildJournal, JOURNAL_FR } from "../src/lib/journal";
import { PRECISION_FR } from "../src/lib/places";
import { progDoneKey } from "../src/lib/progress";
import { sessionPlan } from "../src/lib/session";
import { hiddenMissionNames, lowersProtection, redact, redactorFor } from "../src/lib/spoiler";
import { initialState } from "../src/lib/store";
import type { Profile, SpoilerMode } from "../src/lib/types";
import { APP_VERSION } from "../src/lib/version";

/** V0.14 — anti-spoiler à la source, « Avant de continuer » sans contradiction, suite après « Terminée », journal unifié. */
const feed = JSON.parse(readFileSync("tests/fixtures/radar-prod.json", "utf8"));
const base = initialState();
const real = (patch: Partial<Profile> = {}): Profile => ({ ...base.profile, chapter: 1, edition: "ultimate", preorder: "yes", lastMission: "Don Gone", missionsDone: ["Swamped", "Don Gone"], nextMission: "Talk to Lucia", missionInProgress: false, spoilerMode: "strict", ...patch });
const st = (patch: Partial<Profile> = {}, done: Record<string, string> = {}) => ({ ...base, profile: real(patch), done });

test.describe("1–2 · anti-spoiler strict / flouté / désactivé", () => {
  test("strict : les missions principales futures sont cachées, jamais celles déjà jouées ni la prochaine", () => {
    const names = hiddenMissionNames(st(), feed);
    expect(names).toContain("Tourist Trap");
    for (const n of ["Swamped", "Don Gone", "Talk to Lucia"]) expect(names).not.toContain(n);
  });
  test("désactivé : rien n'est caché ; progression plus avancée : moins de noms cachés", () => {
    expect(hiddenMissionNames(st({ spoilerMode: "off" }), feed)).toEqual([]);
    const later = hiddenMissionNames(st({ chapter: 3, missionsDone: ["Swamped", "Don Gone", "Talk to Lucia", "Tourist Trap"], lastMission: "Tourist Trap", nextMission: null }), feed);
    expect(later).not.toContain("Tourist Trap");
  });
  test("redact remplace le nom, avec ou sans guillemets, sans toucher au reste", () => {
    const r = redactorFor(st(), feed);
    expect(r("Tout se joue au début de « Tourist Trap ».")).toBe("Tout se joue au début d'une mission à venir.");
    expect(redact("Avant Tourist Trap, passe au garage", ["Tourist Trap"])).toBe("Avant une mission à venir, passe au garage");
  });
  test("aucune fuite dans le plan de session, « À découvrir » et « Avant de continuer » (strict)", () => {
    const s = st();
    const plan = sessionPlan(feed, s);
    const disc = discoverNow(feed, s);
    const before = buildBefore({ ...s, briefs: {} }, feed, disc, plan.before, undefined);
    const blob = JSON.stringify({ b: plan.before, f: plan.fun, c: plan.mission.choices, g: plan.mission.guess, crit: before.critical, opt: before.optional, pnr: before.pnr });
    for (const n of hiddenMissionNames(s, feed)) expect(blob, n).not.toMatch(new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"));
  });
  test("baisser la protection est détecté (confirmation), la remonter ne l'est pas", () => {
    const m: SpoilerMode[] = ["strict", "relaxed", "off"];
    expect(lowersProtection(m[0], m[1])).toBe(true);
    expect(lowersProtection(m[0], m[2])).toBe(true);
    expect(lowersProtection(m[2], m[0])).toBe(false);
  });
});

test.describe("3 · « Avant de continuer » sans contradiction", () => {
  const s = st();
  const plan = sessionPlan(feed, s);
  const before = buildBefore({ ...s, briefs: {} }, feed, discoverNow(feed, s), plan.before, undefined);
  test("pas de doublon entre urgent et facultatif ; une seule mention du point de non-retour", () => {
    const all = [...before.critical, ...before.optional].map((x) => x.text.toLowerCase());
    expect(new Set(all).size).toBe(all.length);
    if (before.pnr) expect(before.pnr).not.toContain("Tourist Trap");
  });
  test("vocabulaire de confiance unique ; jamais de promesse « rien à manquer » ni « tout se perd »", () => {
    for (const x of [...before.critical, ...before.optional]) {
      expect(["Vérifié", "Probable", "Non confirmé"]).toContain(x.status);
      expect(x.text).not.toMatch(/tout se perd|rien à manquer/i);
    }
  });
});

test.describe("4 · après « Terminée » : la suite, sans ordre inventé", () => {
  test("Talk to Lucia terminée : nouvelles possibilités listées", () => {
    const d = progressDelta(real(), "Talk to Lucia");
    expect(d.mains.length + d.potentials.length + d.sides.length).toBeGreaterThan(0);
  });
});

test.describe("5 · journal « Récupéré / Fait »", () => {
  test("lecture unifiée, datée, avec l'annulation propre à chaque type", () => {
    const at = "2026-11-22T14:00:00Z";
    const s = { ...st({}, { [progDoneKey("steal-the-scooter")]: at }), pins: { "wonder-whale": { x: 1, y: 2, at, by: "joueur" as const } } };
    const j = buildJournal(s, feed);
    expect(j.find((e) => e.id === "prog:steal-the-scooter")).toMatchObject({ kind: "activite", name: "Steal the Scooter", at, undo: { type: "done" } });
    expect(j.find((e) => e.kind === "position")?.undo).toMatchObject({ type: "pin", id: "wonder-whale" });
    expect(j.filter((e) => e.kind === "mission").map((e) => e.name)).toEqual(["Swamped", "Don Gone"]);
    expect(JOURNAL_FR.arme.done).toBe("Arme récupérée");
    expect(JOURNAL_FR.vehicule.done).toBe("Véhicule trouvé");
  });
});

test("précision des lieux et version centralisée", () => {
  expect(Object.values(PRECISION_FR)).toEqual(["Placée par toi", "Repère communautaire", "Zone estimée", "Position inconnue"]);
  expect(APP_VERSION).toBe("V0.14.1");
});

test.describe("V0.14.1 · salutation", () => {
  test("« Salut » : réponse locale brève, mission du joueur seulement, aucune conséquence narrative", async () => {
    const { askCopilot } = await import("../src/lib/copilot");
    const calls: unknown[] = [];
    const t = { id: "claude-api" as const, label: "mock", available: async () => true, generate: async (r: unknown) => (calls.push(r), { text: "Tourist Trap fait tout perdre.\n@@@\n{}", model: "m", truncated: false }) };
    for (const mode of ["strict", "relaxed", "off"] as const) {
      const r = await askCopilot({ question: "Salut", ctx: { feed, places: [], state: st({ spoilerMode: mode }) }, topic: null, history: [], transport: t, search: async () => ({ status: "ok", hits: [] }) });
      expect(r.message).toContain("Talk to Lucia");
      expect(r.message).not.toMatch(/Tourist Trap|non-retour|perd/i);
      expect(r.trust).toBeNull();
    }
    expect(calls).toHaveLength(0);
  });
});
