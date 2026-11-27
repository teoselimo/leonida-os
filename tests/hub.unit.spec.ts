import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { PROGRESSION, PROG_BY_ID, MANUAL_NODE_COUNT } from "../src/data/progression";
import { HUB_MISSIONS, HUB_META } from "../src/lib/hub/missions";
import { computeProgress, progressionContext } from "../src/lib/progress";
import { autopilot } from "../src/lib/autopilot";
import { simulateLaunch } from "../src/lib/story/engine";
import { hubBlock, hubMentions } from "../src/lib/hub/knowledge";
import { buildGarage, filterGarage } from "../src/lib/hub/garage";
import type { HubVehicle } from "../src/lib/hub/model";
import { initialState, migrate, reducer } from "../src/lib/store";
import type { PersistedState, Profile } from "../src/lib/types";

/**
 * V0.20 · Data Hub → Story Intelligence / Autopilot / Knowledge / Garage (tests automatisés, aucune donnée réseau :
 * les bundles générés par hub/refresh.py sont lus tels qu'ils sont publiés).
 */
const feed = JSON.parse(readFileSync("tests/fixtures/radar-prod.json", "utf8"));
const base = initialState();
const st = (p: Partial<Profile> = {}, extra: Partial<PersistedState> = {}): PersistedState => ({ ...base, ...extra, profile: { ...base.profile, chapter: 1, spoilerMode: "strict", ...p } });

test.describe("Story Intelligence enrichie (critère : plus de missions et de conséquences qu'en V0.19)", () => {
  test("le moteur connaît davantage de missions : 33 nœuds audités + missions du Hub, chapitres 1 à 5", () => {
    expect(MANUAL_NODE_COUNT).toBe(33);
    expect(PROGRESSION.length).toBeGreaterThan(MANUAL_NODE_COUNT + 100);
    const chapters = new Set(PROGRESSION.map((n) => n.chapter));
    for (const c of [1, 2, 3, 4, 5]) expect(chapters.has(c)).toBeTruthy();
    expect(HUB_META.counts.missions + HUB_META.counts.strangers).toBeGreaterThan(150);
  });

  test("le graphe audité n'est jamais remplacé : prérequis identiques, faits GTABase seulement rattachés", () => {
    const sw = PROG_BY_ID.get("swamped")!;
    expect(sw.prereq!.all).toEqual(["day-release", "clear-skies", "building-a-life"]);
    expect(sw.origin).toBeUndefined();
    expect(sw.hub?.url).toContain("gtabase.com");
    expect(sw.hub?.number).toBeGreaterThan(0);
    // alias GTABase ajouté sans doublon : « Save for the Future » = l'épargne Family Savings
    expect(PROG_BY_ID.get("family-savings")!.aliases).toContain("Save for the Future");
    expect(PROGRESSION.filter((n) => n.name === "Save for the Future")).toHaveLength(0);
  });

  test("mission ajoutée par le Hub : une seule source → jamais « accessible » (Vérifié), au mieux « potentiellement »", () => {
    const n = PROGRESSION.find((x) => x.name === "Sinfrontera National Bank")!;
    expect(n.origin).toBe("hub");
    expect(n.prereq!.sources).toHaveLength(1);
    const v = computeProgress(st({ chapter: 3, spoilerMode: "off", lastMission: "Credit Check", missionsDone: ["Credit Check"] }));
    expect(v.byId.get(n.id)!.status).toBe("potentiellement accessible");
  });

  test("conséquences : fenêtre de perte lue sur GTABase, et « s'ouvre ensuite » calculé pour un chapitre non audité", () => {
    const bd = PROG_BY_ID.get("bad-driver")!;
    expect(bd.lostAt?.node).toBe(PROGRESSION.find((x) => x.name === "Power Play")!.id);
    // la règle validée (3 sources) prime : une seule ligne, pas de doublon venant du graphe
    const pp = simulateLaunch(st({ chapter: 4, spoilerMode: "off", lastMission: "Party Hard", missionsDone: ["Party Hard"] }), "Power Play")!;
    const all = [...pp.disappears, ...pp.choices].map((l) => l.text).join(" | ");
    expect(all.match(/Bad Driver!/g)).toHaveLength(1);
    // V0.19 : rien à dire sur Credit Check ; V0.20 : ses suites sont connues (source GTABase, non auditée)
    const cc = simulateLaunch(st({ chapter: 3, spoilerMode: "off", lastMission: "Crosstown Traffic", missionsDone: ["Car Service", "Crosstown Traffic"] }), "Credit Check")!;
    expect(cc.opens.map((l) => l.text).join(" ")).toContain("Sinfrontera National Bank");
    expect(cc.coverage).toBe("non auditée");
    expect(cc.unknowns.join(" ")).toContain("GTABase");
  });

  test("points de non-retour des chapitres 2, 4 et 5 connus (signalés par GTABase, détail non inventé)", () => {
    const pnr = PROGRESSION.filter((x) => x.pointOfNoReturn && x.origin === "hub").map((x) => x.chapter);
    expect(pnr).toEqual(expect.arrayContaining([4, 5]));
    const co = PROG_BY_ID.get("checking-out")!;
    expect(co.pointOfNoReturn?.note).toContain("pas documenté");
  });

  test("Autopilot chapitre 3 : après Credit Check, les suites citées par GTABase sont proposées « à confirmer »", () => {
    const a = autopilot(st({ chapter: 3, spoilerMode: "off", lastMission: "Credit Check", missionsDone: ["Credit Check", "Crosstown Traffic", "Car Service"] }));
    const names = a.mains.map((m) => m.name);
    expect(names).toEqual(expect.arrayContaining(["Sinfrontera National Bank", "Ride or Die"]));
    expect(a.mains.every((m) => m.state !== "accessible")).toBeTruthy();
    expect(a.uncertain).toBeNull();
  });

  test("anti-spoiler : au chapitre 1, le contexte de LEONIDA AI ne cite aucune mission d'un chapitre suivant", () => {
    const ctx = progressionContext(st({ lastMission: "Don Gone", missionsDone: ["Swamped", "Don Gone"] }));
    for (const n of HUB_MISSIONS.filter((m) => (m.chapter ?? 0) >= 2)) expect(ctx).not.toContain(n.name);
    expect(ctx.length).toBeLessThan(3000);
  });

  test("Data Hub dans LEONIDA AI : mission citée → faits sourcés ; chapitre non atteint en strict → masquée", async () => {
    const ch3 = await hubMentions("Comment débloquer Car Service ?", st({ chapter: 3, spoilerMode: "off" }));
    expect(ch3[0].line).toContain("Meet the Heders");
    expect(hubBlock(ch3)).toContain("gtabase.com");
    const ch1 = await hubMentions("Comment débloquer Car Service ?", st({ chapter: 1 }));
    expect(ch1[0].line).toContain("masqués");
    expect(ch1[0].line).not.toContain("Meet the Heders");
    expect(await hubMentions("Salut, ça va ?", st())).toHaveLength(0);
  });
});

test.describe("Garage A+ : une fiche par véhicule, positions jamais inventées", () => {
  const hub: HubVehicle[] = [
    { id: "gtabase:vehicles/penumbra-ff", n: "Penumbra FF '97", m: "Maibatsu", c: "Coupes", t: "model", u: "https://www.gtabase.com/x", lk: { rareVehicle: "v-maibatsu-penumbra-ff" } },
    { id: "gtabase:vehicles/sultan", n: "Sultan", m: "Emperor", c: "Sports", t: "model", vars: ["gtabase:vehicles/moses-sultan"], s: { speed: 4.9 }, u: "https://www.gtabase.com/y" },
    { id: "gtabase:vehicles/moses-sultan", n: "Moses' Sultan", m: "Emperor", c: "Sports", t: "variant", base: "gtabase:vehicles/sultan", u: "https://www.gtabase.com/z" },
  ];
  test("liaison Rare Vehicle Locator → sur la carte ; catalogue seul → aucune position", () => {
    const g = buildGarage(hub, feed.vehicles ?? [], st({}, { done: {} }));
    const pen = g.find((x) => x.name.includes("Penumbra"))!;
    expect(pen.key).toBe("v-maibatsu-penumbra-ff");
    expect(pen.onMap).toBeTruthy();
    expect(g.find((x) => x.name === "Sultan")!.onMap).toBeFalsy();
    expect(g.find((x) => x.name === "Sultan")!.access.label).toBe("Disponibilité non documentée");
    // véhicules rares suivis absents du catalogue : conservés
    expect(g.length).toBeGreaterThanOrEqual(hub.length);
  });
  test("filtres : constructeur, catégorie, type de fiche, recherchés, possédés", () => {
    const s = st({}, { done: {}, vehicles: { "gtabase:vehicles/sultan": { state: "registered", at: "2026-11-24" } } });
    const g = buildGarage(hub, [], s);
    const q = { q: "", maker: null, cls: null, tier: "all" as const, only: "all" as const };
    expect(filterGarage(g, { ...q, maker: "Emperor" }, [], s.vehicles)).toHaveLength(2);
    expect(filterGarage(g, { ...q, tier: "variant" }, [], s.vehicles).map((x) => x.name)).toEqual(["Moses' Sultan"]);
    expect(filterGarage(g, { ...q, cls: "Coupes" }, [], s.vehicles)).toHaveLength(1);
    expect(filterGarage(g, { ...q, only: "owned" }, [], s.vehicles).map((x) => x.name)).toEqual(["Sultan"]);
    expect(filterGarage(g, { ...q, only: "wanted" }, ["gtabase:vehicles/moses-sultan"], s.vehicles).map((x) => x.name)).toEqual(["Moses' Sultan"]);
    expect(filterGarage(g, { ...q, q: "lexus" }, [], s.vehicles)).toHaveLength(0);
  });
});

test.describe("Sauvegardes", () => {
  test("une sauvegarde V0.19 (sans « wanted ») migre sans perte ; « Recherchés » se coche et se décoche", () => {
    const old = { schema: 1, rev: 9, profile: { ...base.profile, lastMission: "Don Gone", missionsDone: ["Swamped", "Don Gone"] }, vehicles: { "v-karin-futo": { state: "stored", at: "2026-11-20T10:00:00Z" } }, done: { "prog:family-savings": "2026-11-21" } } as unknown as Partial<PersistedState>;
    const m = migrate(old);
    expect(m.wanted).toEqual([]);
    expect(m.vehicles["v-karin-futo"].state).toBe("stored");
    expect(m.profile.missionsDone).toEqual(["Swamped", "Don Gone"]);
    expect(m.done["prog:family-savings"]).toBe("2026-11-21");
    const a = reducer(m, { type: "wanted", id: "gtabase:vehicles/sultan" });
    expect(a.wanted).toEqual(["gtabase:vehicles/sultan"]);
    expect(reducer(a, { type: "wanted", id: "gtabase:vehicles/sultan" }).wanted).toEqual([]);
    expect(migrate({ ...old, wanted: ["x", 3, null] as unknown as string[] }).wanted).toEqual(["x"]);
  });
});

test.describe("V0.20.1 · soluces GTABase → faits structurés", () => {
  const M = (n: string) => HUB_MISSIONS.find((m) => m.name === n)!;
  test("gain mesurable : étapes, entités et drapeaux sur des missions du chapitre 1 et des chapitres suivants", () => {
    for (const n of ["Don Gone", "Recalibration", "Swamped", "Gear Up", "Car Service", "Power Play", "Bad Driver!"]) {
      const g = M(n).g!;
      expect(g, n).toBeTruthy();
      expect(g.steps.length, n).toBeGreaterThanOrEqual(3);
    }
    // Don Gone : l'arme manquable est nommée (fiche du catalogue), rattachée à son étape, sans texte de la soluce
    const dg = M("Don Gone").g!.flags.find((f) => f.k === "manquable")!;
    expect(dg.e?.weapon?.[0]).toContain("Donnie's H&L .38");
    expect(dg.step).toBe("Leave Key Lento in Donnie's Car");
    expect(JSON.stringify(M("Don Gone").g)).not.toMatch(/gone for good|trunk/i);
    // Recalibration : le point de non-retour et le montant de 5 000 $ sont relevés
    expect(M("Recalibration").g!.flags.map((f) => f.k)).toContain("non-retour");
    expect(M("Bad Driver!").g!.steps.flatMap((s) => s.$ ?? [])).toContain(20000);
  });
  test("faits rattachés au graphe audité (Story) sans changer ses prérequis", () => {
    const dg = PROG_BY_ID.get("don-gone")!;
    expect(dg.hub?.guide?.steps.length).toBe(4);
    expect(dg.prereq!.all).toEqual(["swamped"]);
  });
  test("LEONIDA AI : la question décide des faits joints ; mission en cours retrouvée sans être nommée", async () => {
    const s = st({ lastMission: "Swamped", missionsDone: ["Swamped"], nextMission: "Don Gone", missionInProgress: true, spoilerMode: "off" });
    const miss = await hubMentions("Qu'est-ce que je ne dois pas rater dans cette mission ?", s);
    expect(miss[0].line).toContain("mission en cours");
    expect(miss[0].line).toContain("Donnie's H&L .38");
    expect(miss[0].line).not.toContain("étapes (titres GTABase)");
    const how = await hubMentions("Comment je fais Don Gone ?", s);
    expect(how[0].line).toContain("Collect Donnie's Bag → Pack Donnie's Belongings");
    // anti-spoiler : mission d'un chapitre non atteint, mode strict → rien de la soluce
    const far = await hubMentions("Comment je fais Power Play ?", st({ chapter: 1 }));
    expect(far[0].line).not.toContain("Meet Kordell");
  });
});
