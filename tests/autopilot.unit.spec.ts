import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { autopilot, autopilotContext } from "../src/lib/autopilot";
import { askCopilot } from "../src/lib/copilot";
import { playerContext } from "../src/lib/copilot/context";
import type { LlmRequest, LlmTransport, WebSearchFn } from "../src/lib/copilot/types";
import { answer } from "../src/lib/ai/engine";
import { STORY_RULES } from "../src/data/story";
import { confidenceOf, confidenceWhy, evidenceQuality, homeStoryAlerts, launchRisks, storyAlerts } from "../src/lib/story/engine";
import { hiddenMissionNames } from "../src/lib/spoiler";
import { initialState, migrate, reducer } from "../src/lib/store";
import type { PersistedState, Profile } from "../src/lib/types";

/**
 * V0.18 · Mission Autopilot — scénarios du cahier de validation (état déclaré, rien n'est détecté ni enregistré seul).
 * Partie de référence : celle de Théo (Swamped et Don Gone terminées), puis variantes.
 */
const feed = JSON.parse(readFileSync("tests/fixtures/radar-prod.json", "utf8"));
const base = initialState();
const prof = (p: Partial<Profile> = {}): Profile => ({ ...base.profile, chapter: 1, spoilerMode: "strict", ...p });
const st = (p: Partial<Profile> = {}, done: Record<string, string> = {}): PersistedState => ({ ...base, done, profile: prof(p) });
const AFTER_TTL = { lastMission: "Talk to Lucia", missionsDone: ["Swamped", "Don Gone", "Talk to Lucia"] };
const run = (s: PersistedState, ...acts: Parameters<typeof reducer>[1][]) => acts.reduce(reducer, s);

test.describe("Parcours : mission terminée → suite proposée → confirmation → préparation → mission commencée", () => {
  test("une mission terminée débloque une seule mission : proposée, rien n'est enregistré avant le choix", () => {
    // la mission est confirmée terminée (« Oui, terminée ») : seul ce geste écrit dans la partie
    const s = run(st({ lastMission: "Don Gone", missionsDone: ["Swamped", "Don Gone"], nextMission: "Talk to Lucia", missionInProgress: true }), { type: "mission", name: "Talk to Lucia", done: true });
    expect(s.profile).toMatchObject({ lastMission: "Talk to Lucia", nextMission: null, missionInProgress: false });
    const a = autopilot(s);
    expect(a.last).toEqual({ name: "Talk to Lucia", known: true });
    expect(a.suggestion).toMatchObject({ name: "Tourist Trap", state: "accessible", fresh: true, pnr: true });
    expect(a.mains).toHaveLength(1);
    expect(a.pnr?.where).toBe("au début de Tourist Trap");
    expect(s.profile.nextMission).toBeNull(); // proposée, pas choisie
    // « Je la prépare » → envisagée ; « Je lance la mission » → commencée
    const planned = run(s, { type: "profile", patch: { nextMission: "Tourist Trap", missionInProgress: false } });
    expect(autopilot(planned).mode).toBe("envisagée");
    const live = run(planned, { type: "profile", patch: { missionInProgress: true } });
    expect(autopilot(live)).toMatchObject({ mode: "en mission", started: { name: "Tourist Trap", known: true } });
  });

  test("plusieurs missions accessibles : les branches sont présentées, aucune n'est imposée", () => {
    const a = autopilot(st({ lastMission: "Down to Earth", missionsDone: ["Down to Earth"] }));
    expect(a.mains.map((x) => x.name).sort()).toEqual(["Clear Skies", "Day Release"]);
    expect(a.suggestion).toBeNull();
    expect(a.mains.every((x) => x.state === "potentiellement accessible" && /à confirmer/.test(x.why))).toBe(true);
  });

  test("une mission secondaire est choisie : envisagée comme les autres, les activités ouvertes restent listées", () => {
    const s = st(AFTER_TTL);
    expect(autopilot(s).sides.map((x) => x.name)).toContain("Get Shirley's Rum");
    const chosen = run(s, { type: "profile", patch: { nextMission: "Get Shirley's Rum", missionInProgress: false, exploring: null } });
    expect(autopilot(chosen)).toMatchObject({ mode: "envisagée", planned: { name: "Get Shirley's Rum", known: true } });
  });

  test("le joueur préfère explorer librement : plus de proposition imposée, conservé, effacé au prochain choix ou à la fin d'une mission", () => {
    const s = run(st(AFTER_TTL), { type: "profile", patch: { exploring: "2026-11-23T20:00:00Z", nextMission: null, missionInProgress: false } });
    expect(autopilot(s).mode).toBe("exploration");
    expect(autopilotContext(s)).toContain("explore librement");
    expect(migrate(JSON.parse(JSON.stringify(s))).profile.exploring).toBe("2026-11-23T20:00:00Z");
    expect(autopilot(run(s, { type: "mission", name: "Tourist Trap", done: true })).mode).toBe("à choisir");
  });

  test("prérequis inconnus ou mission hors graphe : incertitude explicite et choix manuel, jamais une suite inventée", () => {
    const feng = autopilot(st({ lastMission: "Feng Shui", missionsDone: ["Feng Shui"] }));
    expect(feng.mains).toHaveLength(0);
    expect(feng.uncertain).toContain("ne documentent pas ce que « Feng Shui » débloque");
    const unk = autopilot(st({ lastMission: "Mission inventée", missionsDone: ["Mission inventée"] }));
    expect(unk.uncertain).toContain("n'est pas dans mon graphe");
    expect(unk.manual.length).toBeGreaterThan(5);
  });

  test("chapitre 2 à 5 sans graphe complet : la suite n'est pas calculée, l'inventaire du chapitre sert au choix manuel", () => {
    const a = autopilot(st({ chapter: 2, lastMission: "Discharge Time", missionsDone: ["Discharge Time"] }));
    expect(a.mains).toHaveLength(0);
    expect(a.uncertain).toContain("chapitre 2 n'a pas encore de graphe");
    expect(a.manual).toContain("Checking Out");
    expect(a.manual).not.toContain("Bad Driver!"); // chapitre 4 : jamais proposé au chapitre 2
    expect(a.coverage).toEqual({ chapter: 2, level: "partielle" });
  });
});

test.describe("Déductions, corrections et annulations", () => {
  test("A · mission probablement faite non déclarée : jamais « terminée », l'alerte reste, marquée à confirmer", () => {
    const s = st({ lastMission: "Swamped", missionsDone: ["Swamped"] });
    const a = autopilot(s);
    expect(a.likely.map((x) => x.realName)).toContain("Coming Home");
    expect(s.profile.missionsDone).not.toContain("Coming Home");
    // la course de vêtements d'Andy dépend de Coming Home : avant V0.18 elle disparaissait (« probablement faite » = faite)
    const andy = storyAlerts(s).find((x) => x.rule.id === "ch1-andy-clothes");
    expect(andy).toBeTruthy();
    expect(andy!.uncertain).toContain("Coming Home");
    // confirmation du joueur (« Oui, faites ») : les missions antérieures sont enregistrées, la dernière terminée ne change pas
    const c = run(s, { type: "pastDone", names: a.likely.map((x) => x.realName) });
    expect(c.profile.lastMission).toBe("Swamped");
    expect(autopilot(c).likely).toHaveLength(0);
    expect(storyAlerts(c).find((x) => x.rule.id === "ch1-andy-clothes")).toBeUndefined();
  });

  test("le joueur corrige une erreur : mission envisagée remplacée, puis « Changer de mission » revient à la proposition", () => {
    const s = run(st(AFTER_TTL), { type: "profile", patch: { nextMission: "Clear Skies", missionInProgress: false } });
    expect(autopilot(s).planned?.name).toBe("Clear Skies");
    const fixed = run(s, { type: "profile", patch: { nextMission: "Tourist Trap", missionInProgress: false } });
    expect(autopilot(fixed).planned?.name).toBe("Tourist Trap");
    const cleared = run(fixed, { type: "profile", patch: { nextMission: null, missionInProgress: false } });
    expect(autopilot(cleared).suggestion?.name).toBe("Tourist Trap");
  });

  test("une mission terminée est annulée : la précédente redevient la dernière, la proposition revient à l'identique", () => {
    const s0 = st({ lastMission: "Don Gone", missionsDone: ["Swamped", "Don Gone"] });
    const before = autopilot(s0);
    const s1 = run(s0, { type: "mission", name: "Talk to Lucia", done: true });
    expect(autopilot(s1).suggestion?.name).toBe("Tourist Trap");
    const s2 = run(s1, { type: "mission", name: "Talk to Lucia", done: false });
    expect(s2.profile.lastMission).toBe("Don Gone");
    expect(autopilot(s2).suggestion).toEqual(before.suggestion);
  });

  test("point de non-retour : signalé dès qu'une suite proposée le déclenche, avec les alertes critiques sur l'Accueil", () => {
    const s = st(AFTER_TTL);
    expect(autopilot(s).pnr).toMatchObject({ where: "au début de Tourist Trap" });
    expect(homeStoryAlerts(s).some((x) => x.rule.id === "ch1-money-lost" && x.horizon === "imminent")).toBe(true);
  });

  test("anti-spoiler strict : aucune mission future nommée par l'Autopilot ni dans son contexte", () => {
    const s = st({ lastMission: "Don Gone", missionsDone: ["Swamped", "Don Gone"] });
    const hidden = hiddenMissionNames(s, feed);
    expect(hidden.length).toBeGreaterThan(0);
    const blob = JSON.stringify(autopilot(s)) + autopilotContext(s);
    for (const n of hidden) expect(blob, n).not.toMatch(new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"));
  });

  test("sauvegarde V0.17 importée : rien n'est perdu, exploration absente → nulle, révision 9", () => {
    const v017 = { schema: 1, rev: 8, showDemo: false, done: { "story:ch1-lost-drugs": "2026-11-23T10:00:00Z" }, vehicles: {}, story: { money: { cash: { mode: "exact", value: 3200 } } }, profile: { ...prof({ lastMission: "Don Gone", missionsDone: ["Swamped", "Don Gone"], nextMission: "Talk to Lucia" }) } };
    const m = migrate(JSON.parse(JSON.stringify(v017)));
    expect(m.rev).toBe(9);
    expect(m.profile).toMatchObject({ lastMission: "Don Gone", missionsDone: ["Swamped", "Don Gone"], nextMission: "Talk to Lucia", exploring: null });
    expect(m.done).toEqual(v017.done);
    expect(m.story?.money?.cash).toEqual({ mode: "exact", value: 3200 });
  });
});

test.describe("Cohérence Accueil ↔ LEONIDA AI", () => {
  test("le contexte de LEONIDA AI contient dernière terminée, envisagée, accessibles, activités ouvertes, couverture", () => {
    const s = run(st(AFTER_TTL), { type: "profile", patch: { nextMission: "Tourist Trap", missionInProgress: false } });
    const ctx = playerContext(s, feed);
    expect(ctx).toContain("Dernière mission terminée : Talk to Lucia");
    expect(ctx).toContain("Mission ENVISAGÉE (pas encore lancée) : Tourist Trap");
    expect(ctx).toContain("Missions secondaires encore ouvertes");
    expect(ctx).toContain("Activités libres ouvertes (PAS des missions");
    expect(ctx).toContain("Couverture du référentiel, chapitre 1");
  });
  test("« je lance quoi ? » dans le copilote : même suite que l'Accueil, préparer ou lancer, toujours à confirmer", () => {
    const s = st(AFTER_TTL);
    const a = answer("J'attaque la suivante", { feed, places: [], state: s });
    expect(a.intent).toBe("next_start");
    expect(a.text).toContain("Tourist Trap");
    expect(a.actions.map((x) => x.type).sort()).toEqual(["set_next_mission", "start_mission"]);
    expect(a.actions.every((x) => "confirm" in x && !!x.confirm)).toBe(true);
  });
});

test.describe("B · fiabilité des preuves", () => {
  test("des compilations ne comptent que pour une origine ; « Vérifié » exige un guide joué ou une vérification en jeu", () => {
    const wiki = { name: "W", url: "https://thegameswiki.com/x", says: "", stance: "confirme" as const, checkedAt: "2026-11-23" };
    const agg = { ...wiki, url: "https://gameta.gg/x" };
    const pyx = { ...wiki, url: "https://www.powerpyx.com/x" };
    const ed = { ...wiki, url: "https://www.gtabase.com/x" };
    expect(evidenceQuality([wiki, agg]).independent).toBe(1);
    expect(confidenceOf({ status: "active", evidence: [wiki, agg] })).toBe("Probable");
    expect(confidenceOf({ status: "active", evidence: [wiki, ed] })).toBe("Probable"); // deux domaines, aucun guide joué
    expect(confidenceOf({ status: "active", evidence: [wiki, pyx] })).toBe("Vérifié");
    expect(confidenceOf({ status: "active", evidence: [pyx, { ...ed, origin: "powerpyx.com" }] })).toBe("Probable"); // recopie
    expect(confidenceOf({ status: "active", evidence: [pyx, { ...ed, scope: "partiel" }] })).toBe("Probable"); // périmètre voisin
    expect(confidenceOf({ status: "active", evidence: [wiki], inGame: { at: "2026-11-24" } })).toBe("Vérifié");
  });
  test("aucune alerte retirée : les règles critiques restent critiques ; leur confiance est expliquée", () => {
    for (const r of STORY_RULES.filter((x) => x.tier === "Critique")) {
      expect(["Vérifié", "Probable"]).toContain(confidenceOf(r));
      expect(confidenceWhy(r)).toMatch(/origine|vérifié en jeu/);
    }
    expect(confidenceOf(STORY_RULES.find((r) => r.id === "ch1-savings-5k")!)).toBe("Probable"); // ex-« Vérifié » : 2 compilations + 1 guide éditorial
    expect(homeStoryAlerts(st(AFTER_TTL)).map((x) => x.rule.id)).toEqual(expect.arrayContaining(["ch1-money-lost", "ch1-savings-5k"]));
  });
});

test.describe("D · recherche externe toujours possible", () => {
  function mock(): LlmTransport & { calls: LlmRequest[] } {
    const calls: LlmRequest[] = [];
    return { id: "claude-artifact", label: "mock", calls, available: async () => true, generate: async (r) => (calls.push(r), { text: "D'après le web…\n@@@\n{}", model: "mock", truncated: false }) };
  }
  test("question absente du référentiel : Exa est interrogé malgré le contexte Story / Autopilot local", async () => {
    const queries: string[] = [];
    const search: WebSearchFn = async (q) => (queries.push(q), { status: "ok", hits: [{ title: "GTA 6 patch notes", url: "https://news.example/patch", text: "Patch 1.03 changes", date: null }] });
    const c = await askCopilot({ question: "Qu'est-ce qui change avec la dernière mise à jour de GTA 6 ?", ctx: { feed, places: [], state: st(AFTER_TTL) }, topic: null, history: [], transport: mock(), search });
    expect(queries.length).toBeGreaterThan(0);
    expect(c.web?.status).toBe("ok");
  });
});

test.describe("V0.18.1 · stabilisation", () => {
  test("1 · point de non-retour : lancer Tourist Trap signale le non-retour et les risques critiques ; une mission sans risque important, rien", () => {
    const s = st(AFTER_TTL);
    const r = launchRisks(s, "Tourist Trap")!;
    expect(r.pnr).toBe(true);
    expect(r.count).toBeGreaterThanOrEqual(1);
    expect(r.lines.join(" ")).toContain("Family Savings");
    expect(launchRisks(st({ lastMission: "Don Gone", missionsDone: ["Swamped", "Don Gone"] }), "Recalibration")).toBeNull();
    expect(launchRisks(st(), "Swamped")).toBeNull();
    // copilote : la confirmation de « Lancer » le dit, le joueur reste libre
    const a = answer("J'attaque la suivante", { feed, places: [], state: s });
    const startAct = a.actions.find((x) => x.type === "start_mission") as { confirm: string };
    expect(startAct.confirm).toMatch(/^Attention : point de non-retour et \d risques? critiques?/);
  });

  test("2 · une activité libre n'est jamais une mission : séparée dans l'Autopilot, refusée par le store, retirée d'une ancienne sauvegarde", () => {
    const s = st(AFTER_TTL);
    const a = autopilot(s);
    expect(a.activities.map((x) => x.name)).toContain("Mettre 5 000 $ sur Family Savings");
    expect(a.sides.map((x) => x.name)).not.toContain("Mettre 5 000 $ sur Family Savings");
    expect(a.sides.every((x) => x.kind === "side")).toBe(true);
    expect(a.manual).not.toContain("Mettre 5 000 $ sur Family Savings");
    const refused = run(s, { type: "profile", patch: { nextMission: "Mettre 5 000 $ sur Family Savings", missionInProgress: true, exploring: null } });
    expect(refused.profile.nextMission).toBeNull();
    expect(refused.profile.missionInProgress).toBeFalsy();
    // « C'est fait » : registre des activités, jamais nextMission
    const done = run(s, { type: "done", id: "prog:family-savings", value: true });
    expect(done.profile.nextMission).toBeNull();
    expect(autopilot(done).activities.map((x) => x.id)).not.toContain("family-savings");
    // sauvegarde V0.18 qui contiendrait l'erreur : nettoyée au chargement, le reste intact
    const m = migrate(JSON.parse(JSON.stringify({ ...s, rev: 9, profile: { ...s.profile, nextMission: "Mettre 5 000 $ sur Family Savings", missionInProgress: false } })));
    expect(m.profile).toMatchObject({ nextMission: null, lastMission: "Talk to Lucia", missionsDone: AFTER_TTL.missionsDone });
    // une mission secondaire reste sélectionnable comme mission
    expect(run(s, { type: "profile", patch: { nextMission: "Get Shirley's Rum", missionInProgress: false } }).profile.nextMission).toBe("Get Shirley's Rum");
  });

  test("3 · confirmation des missions antérieures : une sélection partielle n'enregistre que les missions cochées", () => {
    const s = st({ lastMission: "Swamped", missionsDone: ["Swamped"] });
    const all = autopilot(s).likely.map((x) => x.realName);
    expect(all.length).toBe(11);
    const picked = all.filter((n) => n !== "Feng Shui" && n !== "Coming Home");
    const c = run(s, { type: "pastDone", names: picked });
    expect(c.profile.missionsDone).toEqual(["Swamped", ...picked]);
    expect(autopilot(c).likely.map((x) => x.realName).sort()).toEqual(["Coming Home", "Feng Shui"]);
    expect(c.profile.lastMission).toBe("Swamped");
  });
});
