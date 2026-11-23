import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { STORY_NODES, STORY_RULES } from "../src/data/story";
import { PROG_BY_ID } from "../src/data/progression";
import { confidenceOf, coverageLine, findStoryNode, homeStoryAlerts, simulateLaunch, storyAlerts, storyContext } from "../src/lib/story/engine";
import { TIER_ORDER } from "../src/lib/story/model";
import { migrate, sanitizeStory } from "../src/lib/store";
import { buildBefore } from "../src/lib/before";
import { playerContext } from "../src/lib/copilot/context";
import { redactorFor } from "../src/lib/spoiler";

/** Story Intelligence V0.17 — référentiel, évaluation, simulation, anti-spoiler, couverture, sauvegarde. */
const profile = (p: Record<string, unknown> = {}) => ({ pseudo: "", console: "ps5", edition: "standard", preorder: "unknown", chapter: 1, lastMission: null, nextMission: null, missionsDone: [] as string[], spoilerMode: "strict", objectives: [], ...p }) as never;
const st = (p: Record<string, unknown> = {}, done: Record<string, string> = {}, story: Record<string, unknown> = {}) => ({ profile: profile(p), vehicles: {}, done, story: story as never });
/** Partie de Théo : Swamped et Don Gone faits, Recalibration (« Talk to Lucia ») prévue. */
const THEO = { missionsDone: ["Swamped", "Don Gone"], lastMission: "Don Gone", nextMission: "Recalibration" };

test("référentiel : chaque règle a identifiant stable, conseil, explication, effets, moment, réversibilité, preuves datées et statut", () => {
  const ids = new Set<string>();
  for (const r of STORY_RULES) {
    expect(r.id).toMatch(/^[a-z0-9-]+$/);
    expect(ids.has(r.id)).toBe(false);
    ids.add(r.id);
    expect(r.advice.length).toBeGreaterThan(30);
    expect(r.explain.length).toBeGreaterThan(20);
    expect(r.effects.length).toBeGreaterThan(0);
    expect(r.timing.length).toBeGreaterThan(5);
    expect(typeof r.reversible).toBe("boolean");
    expect(TIER_ORDER).toContain(r.tier);
    expect(r.evidence.length).toBeGreaterThan(0);
    for (const e of r.evidence) {
      expect(e.url).toMatch(/^https:\/\//);
      expect(e.checkedAt).toMatch(/^2026-11-\d\d$/);
    }
    // un déclencheur pointe vers un nœud connu (graphe du chapitre 1 ou inventaire des chapitres 2 à 5)
    if (r.trigger && "node" in r.trigger) {
      const tn = r.trigger.node;
      expect(PROG_BY_ID.has(tn) || STORY_NODES.some((n) => n.id === tn)).toBe(true);
    }
    // une règle contestée n'est jamais critique une fois évaluée
    if (r.status === "contestée") expect(confidenceOf(r)).toBe("Contesté");
  }
  expect(STORY_RULES.length).toBeGreaterThanOrEqual(20);
  // chapitres 2 à 5 inventoriés
  for (const c of [2, 3, 4, 5]) expect(STORY_RULES.some((r) => r.chapter === c)).toBe(true);
});

test("noms et alias : Tourist Trap, « Take Up Mattia's Offer », Bad Driver, « Find Felipe », Checking Out", () => {
  expect(findStoryNode("Take Up Mattia's Offer")?.id).toBe("tourist-trap");
  expect(findStoryNode("tourist trap")?.id).toBe("tourist-trap");
  expect(findStoryNode("Bad Driver")?.id).toBe("bad-driver");
  expect(findStoryNode("Find Felipe")?.id).toBe("bad-driver");
  expect(findStoryNode("Checking Out")?.chapter).toBe(2);
  expect(findStoryNode("mission inventée")).toBeNull();
});

test("Avant de lancer Tourist Trap : argent exposé, activités qui disparaissent, point de non-retour, ce qui s'ouvre, inconnues", () => {
  const s = st({ ...THEO, missionsDone: [...THEO.missionsDone, "Recalibration"], lastMission: "Recalibration", nextMission: "Tourist Trap" }, {}, { money: { cash: { mode: "exact", value: 3200 }, checking: { mode: "range", min: 5000, max: 15000 } } });
  const sim = simulateLaunch(s, "Tourist Trap")!;
  expect(sim.pointOfNoReturn).toBe(true);
  expect(sim.coverage).toBe("auditée");
  const money = sim.money.map((x) => x.text + " " + (x.money ?? "")).join(" | ");
  expect(money).toMatch(/Family Savings/);
  expect(money).toMatch(/8\s?200 \$ à 18\s?200 \$/); // 3 200 + (5 000 à 15 000), planque inconnue signalée
  expect(money).toMatch(/planque de la maison \(inconnu\)/);
  const gone = sim.disappears.map((x) => x.text).join(" | ");
  expect(gone).toMatch(/Get Shirley's Rum/);
  expect(gone).toMatch(/Find the Lost Drugs/);
  // ce qui s'ouvre reste masqué en anti-spoiler strict
  expect(sim.opens.map((x) => x.text).join(" ")).not.toMatch(/Home Sweet Home/);
  expect(sim.unknowns.length).toBeGreaterThan(0);
  // un risque contesté n'est pas présenté comme vérifié
  const veh = [...sim.disappears, ...sim.money].find((x) => /améliorations/.test(x.text))!;
  expect(veh.confidence).toBe("Contesté");
});

test("perte irréversible : une fois Tourist Trap lancée, ses alertes disparaissent (fenêtre passée), sans culpabiliser", () => {
  const before = storyAlerts(st({ ...THEO, nextMission: "Tourist Trap", missionsDone: [...THEO.missionsDone, "Recalibration"] })).map((a) => a.rule.id);
  expect(before).toContain("ch1-money-lost");
  const after = storyAlerts(st({ ...THEO, nextMission: "Tourist Trap", missionInProgress: true, missionsDone: [...THEO.missionsDone, "Recalibration"] })).map((a) => a.rule.id);
  expect(after).not.toContain("ch1-money-lost");
  expect(after).not.toContain("ch1-savings-5k");
});

test("activité non réalisée : Find the Lost Drugs reste en tête tant qu'elle n'est pas cochée, puis disparaît", () => {
  const ids = homeStoryAlerts(st(THEO)).map((a) => a.rule.id);
  expect(ids).toContain("ch1-lost-drugs");
  const ticked = homeStoryAlerts(st(THEO, { "prog:find-the-lost-drugs": "2026-11-23" })).map((a) => a.rule.id);
  expect(ticked).not.toContain("ch1-lost-drugs");
});

test("Accueil : critiques d'abord, une règle contestée n'est jamais critique, l'épargne déjà à 5 000 $ neutralise le palier", () => {
  const alerts = homeStoryAlerts(st(THEO));
  expect(alerts[0].tier).toBe("Critique");
  expect(alerts.filter((a) => a.confidence === "Contesté").every((a) => a.tier !== "Critique")).toBe(true);
  expect(alerts.map((a) => a.rule.id)).toContain("ch1-savings-5k");
  const saved = homeStoryAlerts(st(THEO, {}, { money: { savings: { mode: "exact", value: 5000 } } })).map((a) => a.rule.id);
  expect(saved).not.toContain("ch1-savings-5k");
});

test("ressources inconnues : aucun solde supposé, le montant exposé est dit inconnu", () => {
  const a = storyAlerts(st(THEO)).find((x) => x.rule.id === "ch1-money-lost")!;
  expect(a.money).toMatch(/inconnu/);
  expect(storyContext(st(THEO))).toMatch(/non renseigné \(ne suppose aucun solde\)/);
});

test("récompense différée et choix : Bad Driver! — 20 000 $ ou un véhicule, avant Power Play ; masqué au chapitre 1", () => {
  const ch4 = storyAlerts(st({ chapter: 4, missionsDone: [] })).find((a) => a.rule.id === "ch4-bad-driver")!;
  expect(ch4.confidence).toBe("Vérifié");
  expect(ch4.explain).toMatch(/20 000 \$/);
  expect(ch4.masked).toBe(false);
  // au chapitre 1, la règle n'est pas encore applicable (le joueur n'a pas atteint le chapitre 4)
  expect(storyAlerts(st(THEO)).some((a) => a.rule.id === "ch4-bad-driver")).toBe(false);
  // une fois la mission déclarée faite, elle disparaît
  expect(storyAlerts(st({ chapter: 4, missionsDone: ["Bad Driver!"] })).some((a) => a.rule.id === "ch4-bad-driver")).toBe(false);
});

test("anti-spoiler : au chapitre 1 en mode strict, la suite donne le conseil mais pas la raison ni les noms futurs", () => {
  const later = storyAlerts(st(THEO)).filter((a) => a.horizon === "plus tard");
  const ending = later.find((a) => a.rule.id === "ending-savings")!;
  expect(ending.masked).toBe(true);
  expect(ending.explain).toBeNull();
  expect(ending.advice).not.toMatch(/Protective Custody|fin|2 000 000/);
  const all = later.map((a) => a.advice + a.when).join(" ");
  expect(all).not.toMatch(/Power Play|Protective Custody|Operation Savage Glory|After Sunset/);
  // le filtre est partagé : une réponse du copilote est nettoyée de la même façon
  expect(redactorFor(st(THEO))("Fais-le avant Protective Custody.")).toBe("Fais-le avant une mission à venir.");
  // en mode « aucun », l'explication est disponible
  const open = storyAlerts(st({ ...THEO, spoilerMode: "off" })).find((a) => a.rule.id === "ending-savings")!;
  expect(open.explain).toMatch(/2 000 000/);
});

test("mission non auditée : la simulation le dit, jamais « rien à manquer »", () => {
  const sim = simulateLaunch(st({ chapter: 1 }), "Lab Fees")!;
  expect(sim.coverage).toBe("non auditée");
  expect(sim.unknowns[0]).toMatch(/aucune alerte ne veut pas dire aucun risque/);
  expect(coverageLine(3)).toMatch(/non auditée/);
});

test("information contradictoire : fence de Donnie (Clear Skies ou Swamped) — contesté, les deux versions affichées", () => {
  const s = st({ missionsDone: ["Down to Earth"], lastMission: "Down to Earth", nextMission: "Clear Skies" });
  const a = storyAlerts(s).find((x) => x.rule.id === "ch1-donnie-fence")!;
  expect(a.confidence).toBe("Contesté");
  expect(a.tier).not.toBe("Critique");
  expect(a.horizon).toBe("imminent");
  // anti-spoiler strict : Swamped n'est pas encore accessible, son nom est masqué jusque dans la contradiction
  expect(a.contradictions[0]).toMatch(/Clear Skies.*une mission à venir/);
  const open = storyAlerts({ ...s, profile: { ...(s.profile as object), spoilerMode: "off" } as never }).find((x) => x.rule.id === "ch1-donnie-fence")!;
  expect(open.contradictions[0]).toMatch(/Clear Skies.*Swamped/);
});

test("plusieurs ordres possibles : Clear Skies ou Day Release après Down to Earth — aucune mission imposée", () => {
  const s = st({ missionsDone: ["Down to Earth"], lastMission: "Down to Earth" });
  const a = simulateLaunch(s, "Day Release")!;
  const b = simulateLaunch(s, "Clear Skies")!;
  expect(a).not.toBeNull();
  expect(b).not.toBeNull();
  // la simulation de l'une ne déclare jamais l'autre impossible
  expect(a.disappears.map((x) => x.text).join(" ")).not.toMatch(/Clear Skies/);
});

test("mission terminée puis annulée : l'état revient exactement à l'identique", () => {
  const base = st(THEO);
  const a1 = JSON.stringify(storyAlerts(base).map((a) => [a.rule.id, a.tier, a.horizon]));
  const done = st({ ...THEO, missionsDone: [...THEO.missionsDone, "Recalibration"], lastMission: "Recalibration", nextMission: "Tourist Trap", missionInProgress: true });
  expect(JSON.stringify(storyAlerts(done).map((a) => [a.rule.id, a.tier, a.horizon]))).not.toBe(a1);
  expect(JSON.stringify(storyAlerts(st(THEO)).map((a) => [a.rule.id, a.tier, a.horizon]))).toBe(a1);
});

test("cohérence Accueil ↔ copilote : les alertes critiques de l'Accueil figurent dans le contexte de LEONIDA AI", () => {
  const s = st(THEO);
  const prod = JSON.parse(readFileSync("tests/fixtures/radar-prod.json", "utf8"));
  const view = buildBefore(s as never, prod, [], [], undefined);
  const storyItems = view.critical.filter((x) => x.key.startsWith("story:"));
  expect(storyItems.length).toBeGreaterThan(0);
  const ctx = playerContext(s as never, prod);
  for (const it of storyItems.slice(0, 3)) expect(ctx).toContain(it.text.slice(0, 40));
  expect(ctx).toMatch(/couverture partielle/);
});

test("sauvegarde V0.16.1 → V0.17 : rien n'est perdu, l'argent invalide est retiré, rien n'est inventé", () => {
  const old = { schema: 1, rev: 7, profile: { ...(profile(THEO) as object) }, done: { "prog:family-savings": "x" }, vehicles: { "v-karin-futo": { state: "stored", at: "x" } }, proofs: {}, briefs: {} };
  const m = migrate(old as never);
  expect(m.rev).toBe(8);
  expect(m.profile.missionsDone).toEqual(["Swamped", "Don Gone"]);
  expect(m.vehicles["v-karin-futo"].state).toBe("stored");
  expect(m.done["prog:family-savings"]).toBe("x");
  expect(m.story?.money).toEqual({});
  const bad = sanitizeStory({ money: { cash: { mode: "exact", value: -5 }, savings: { mode: "range", min: 5000, max: 1000 }, checking: { mode: "range", min: 0, max: 5000 }, foo: { mode: "exact", value: 3 } } });
  expect(bad.money).toEqual({ checking: { mode: "range", min: 0, max: 5000 } });
});

test("anti-spoiler strict : la perte d'un lieu reste signalée sans dire lequel ; en mode désactivé, le détail revient", () => {
  const base = { ...THEO, missionsDone: [...THEO.missionsDone, "Recalibration"], lastMission: "Recalibration", nextMission: "Tourist Trap" };
  const strict = simulateLaunch(st(base, {}, {}), "Tourist Trap")!;
  const txt = strict.disappears.map((x) => x.text).join(" | ");
  expect(txt).toContain("un lieu que tu utilises");
  expect(txt).not.toMatch(/maison/i);
  const off = simulateLaunch(st({ ...base, spoilerMode: "off" }, {}, {}), "Tourist Trap")!;
  expect(off.disappears.map((x) => x.text).join(" | ")).toMatch(/maison de Key Lento/);
});
