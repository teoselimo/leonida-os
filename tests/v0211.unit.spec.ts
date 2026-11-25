import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { answer } from "../src/lib/ai/engine";
import { afterDone } from "../src/lib/ai/progressAnswers";
import { autopilot, autopilotContext } from "../src/lib/autopilot";
import { buildBefore } from "../src/lib/before";
import { playerContext } from "../src/lib/copilot/context";
import { discoverNow } from "../src/lib/discover";
import { motelSituation, reportedTasks } from "../src/lib/motel";
import { sessionPlan } from "../src/lib/session";
import { hiddenMissionNames } from "../src/lib/spoiler";
import { homeStoryAlerts } from "../src/lib/story/engine";
import { initialState } from "../src/lib/store";
import type { Profile } from "../src/lib/types";

/** V0.21.1 (issue #19) — Accueil et continuité du chapitre 2, profil réel de Théo (25/11/2026). */
const feed = JSON.parse(readFileSync("tests/fixtures/radar-prod.json", "utf8"));
const base = initialState();
const prof = (patch: Partial<Profile> = {}): Profile => ({ ...base.profile, edition: "ultimate", preorder: "yes", spoilerMode: "strict", chapter: 2, lastMission: "Ambulance Chaser", missionsDone: ["Ambulance Chaser"], nextMission: null, missionInProgress: false, ...patch });
const theo = (patch: Partial<Profile> = {}) => ({ ...base, profile: prof(patch), done: {} });
const told = ["J’ai fait disparaître l’ambulance", "J’ai récupéré les provisions pour Jason", "Là je parle avec la proprio du motel"];
const esc = (n: string) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const freeze = <T>(o: T): T => {
  Object.freeze(o);
  for (const v of Object.values(o as object)) if (v && typeof v === "object" && !Object.isFrozen(v)) freeze(v);
  return o;
};

test("tâches racontées : provisions et réception gardées, l’ambulance confirmée n’y figure plus", () => {
  const r = reportedTasks(told, theo());
  expect(r.map((x) => x.id)).toEqual(["just-moved-in", "overnight-charges"]);
  expect(r.map((x) => x.label)).toEqual(["provisions pour Jason", "conversation à la réception"]);
  // une tâche choisie comme mission (confirmée par le joueur) n'est plus « racontée »
  expect(reportedTasks(told, theo({ nextMission: "Just Moved In", missionInProgress: true })).map((x) => x.id)).toEqual(["overnight-charges"]);
  expect(reportedTasks(told, theo({ chapter: 1 }))).toEqual([]);
});

test("situation de l’Accueil : cinq niveaux distincts, aucun nom de principale future en strict", () => {
  const s = theo();
  const sit = motelSituation(s, told)!;
  expect(sit.title).toBe("Chapitre 2 · Starlet Motel");
  expect(sit.confirmed).toBe("Ambulance Chaser terminée");
  expect(sit.reported.map((x) => x.label)).toEqual(["provisions pour Jason", "conversation à la réception"]);
  expect(sit.conditional).toContainEqual({ name: "Check Out McKittrick Farm", condition: "lire une affiche de Kyle" });
  expect(sit.accessible).not.toContain("Check Out McKittrick Farm");
  expect(sit.goals.join(" ")).toMatch(/15 000 \$/);
  // en strict, la carte ne porte que des libellés : aucun nom de mission principale cachée
  const card = JSON.stringify({ ...sit, reported: sit.reported.map((r) => r.label) });
  for (const n of hiddenMissionNames(s, feed)) expect(card, n).not.toMatch(new RegExp(`\\b${esc(n)}\\b`, "i"));
  // une mission choisie, ou l'exploration libre : pas de carte de situation
  expect(motelSituation(theo({ nextMission: "Just Moved In" }), told)).toBeNull();
  expect(motelSituation(theo({ exploring: "2026-11-25T20:00:00Z" }), told)).toBeNull();
});

test("15 000 $ : objectif du chapitre, jamais « Avant de continuer » tant qu’il n’est pas imminent", () => {
  const s = theo();
  const before = buildBefore({ ...s, briefs: {} }, feed, discoverNow(feed, s), sessionPlan(feed, s).before, undefined);
  expect([...before.critical, ...before.optional].map((x) => x.text).join(" | ")).not.toMatch(/15 000/);
  expect(before.goals.join(" ")).toMatch(/15 000 \$/);
  expect(homeStoryAlerts(s).some((a) => a.rule.id === "ch2-checking-out")).toBe(false);
  // imminent dès que la mission qui déclenche le seuil est la prochaine : l'alerte revient avant de la lancer
  const near = theo({ nextMission: "Checking Out" });
  const b2 = buildBefore({ ...near, briefs: {} }, feed, discoverNow(feed, near), sessionPlan(feed, near).before, undefined);
  expect(b2.critical.map((x) => x.text).join(" | ")).toMatch(/15 000/);
  expect(b2.goals).toEqual([]);
});

test("Check Out McKittrick Farm : condition dans le monde, jamais « disponible » ni proposée comme suite", () => {
  const a = autopilot(theo());
  expect(a.sides.map((x) => x.name)).not.toContain("Check Out McKittrick Farm");
  expect(a.conditional.map((x) => [x.name, x.condition])).toContainEqual(["Check Out McKittrick Farm", "lire une affiche de Kyle"]);
  expect(autopilotContext(theo())).toMatch(/condition à remplir dans le monde[^\n]*Check Out McKittrick Farm — lire une affiche de Kyle/);
  const now = answer("Je peux faire quoi maintenant en secondaire ?", { feed, state: { ...theo(), pins: [] } as never });
  expect(now.text).not.toMatch(/Accessible maintenant[^.]*McKittrick/);
  // choisie par le joueur (condition remplie) : elle redevient une mission normale
  expect(autopilot(theo({ nextMission: "Check Out McKittrick Farm" })).conditional).toEqual([]);
});

test("continuité : après « Ambulance Chaser terminée », les provisions et la gérante sont rappelées sans être enregistrées", () => {
  const before = prof({ lastMission: "Discharge Time", missionsDone: ["Discharge Time"] });
  freeze(before);
  const r = reportedTasks(told, { profile: before }, ["Ambulance Chaser"]);
  const next = afterDone(before, "Ambulance Chaser", r);
  expect(next.text).toContain("Tu m’avais aussi indiqué avoir récupéré les provisions pour Jason et parlé à la gérante.");
  expect(next.text).toContain("Je ne les marque pas comme terminées sans confirmation.");
  expect(next.text).not.toMatch(/Je n'ai pas de nouvelle mission documentée/);
  // propositions À CONFIRMER, jamais une écriture
  expect(next.actions.map((x) => [x.type, "name" in x ? x.name : ""])).toEqual([["start_mission", "Just Moved In"], ["start_mission", "Overnight Charges"]]);
  expect(before.missionsDone).toEqual(["Discharge Time"]);
  // sans récit : le message d'origine reste inchangé
  expect(afterDone(before, "Ambulance Chaser").text).toMatch(/Je n'ai pas de nouvelle mission documentée/);
});

test("« Mettre ma progression à jour » : récit relu, rien d’écrit, aucun nom caché hors tâches racontées", () => {
  const s = freeze(theo());
  const a = answer("Mettre ma progression à jour", { feed, state: { ...s, pins: [] } as never, chatTexts: told });
  expect(a.intent).toBe("motel_status");
  expect(a.text).toMatch(/Confirmé par toi : Ambulance Chaser terminée\./);
  expect(a.text).toMatch(/probablement en cours \(non confirmé\) : provisions pour Jason, conversation à la réception/);
  expect(a.text).toMatch(/Condition à remplir dans le jeu d’abord : Check Out McKittrick Farm \(lire une affiche de Kyle\)/);
  expect(a.text).toMatch(/Objectif du chapitre, plus tard : .*15 000 \$/);
  const allowed = new Set(["Just Moved In", "Overnight Charges"]);
  for (const n of hiddenMissionNames(s, feed).filter((x) => !allowed.has(x))) expect(a.text + JSON.stringify(a.actions), n).not.toMatch(new RegExp(`\\b${esc(n)}\\b`, "i"));
  expect(a.actions.every((x) => x.type === "start_mission" && "confirm" in x)).toBe(true);
  expect(s.profile).toMatchObject({ lastMission: "Ambulance Chaser", missionsDone: ["Ambulance Chaser"], nextMission: null });
  // « Que faire maintenant ? » donne la même situation
  expect(answer("Que faire maintenant ?", { feed, state: { ...s, pins: [] } as never, chatTexts: told }).intent).toBe("motel_status");
});

test("vrai Claude : le contexte joueur distingue les tâches racontées non confirmées", () => {
  const pc = playerContext(theo(), feed, told);
  expect(pc).toMatch(/TÂCHES RACONTÉES PAR LE JOUEUR, NON CONFIRMÉES[^\n]*provisions pour Jason[^\n]*conversation à la réception/);
  expect(playerContext(theo(), feed)).not.toMatch(/TÂCHES RACONTÉES/);
});
