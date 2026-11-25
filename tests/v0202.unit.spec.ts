import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { buildBefore } from "../src/lib/before";
import { discoverNow } from "../src/lib/discover";
import { computeProgress } from "../src/lib/progress";
import { sessionPlan } from "../src/lib/session";
import { initialState } from "../src/lib/store";
import type { Profile } from "../src/lib/types";

/** V0.20.2 (intégration) — au chapitre 2, rien de ce qui disparaît au lancement d'une mission du chapitre 1 n'est encore proposé. */
const feed = JSON.parse(readFileSync("tests/fixtures/radar-prod.json", "utf8"));
const base = initialState();
const prof = (patch: Partial<Profile>): Profile => ({ ...base.profile, edition: "ultimate", preorder: "yes", spoilerMode: "strict", ...patch });
// progression réelle de Théo : chapitre 2 confirmé, seule Ambulance Chaser déclarée au motel (Tourist Trap jamais cochée)
const ch2 = { ...base, profile: prof({ chapter: 2, lastMission: "Ambulance Chaser", missionsDone: ["Ambulance Chaser"], nextMission: null, missionInProgress: false }), done: {} };
const ch1 = { ...base, profile: prof({ chapter: 1, lastMission: "Don Gone", missionsDone: ["Swamped", "Don Gone"], nextMission: "Talk to Lucia", missionInProgress: false }), done: {} };

test("chapitre 2 : les activités perdues au lancement de Tourist Trap sont « plus disponible », sans rien déclarer comme fait", () => {
  const v = computeProgress(ch2);
  for (const id of ["get-shirleys-rum", "steal-the-scooter", "find-the-lost-drugs"]) expect(v.byId.get(id)?.status).toBe("plus disponible");
  expect(ch2.profile.missionsDone).toEqual(["Ambulance Chaser"]);
});

test("chapitre 2 : « Avant de continuer » ne propose plus le rhum de Shirley ni l'argent de Three Sheets Liquor", () => {
  const disc = discoverNow(feed, ch2);
  const before = buildBefore({ ...ch2, briefs: {} }, feed, disc, sessionPlan(feed, ch2).before, undefined);
  const crit = before.critical.map((x) => `${x.text} ${x.when ?? ""}`).join(" | ");
  expect(crit).not.toMatch(/Tourist Trap|Coming Home|Shirley|Three Sheets|Andy/);
  // l'argent du perroquet n'est plus une perte : la veille indique que le lieu reste accessible
  for (const x of before.optional.filter((o) => /Three Sheets/.test(o.text))) expect(`${x.when ?? ""} ${x.detail.join(" ")}`).not.toMatch(/disparaît|Tourist Trap/);
  expect(before.optional.map((x) => x.text).join(" | ")).not.toMatch(/Andy|Coming Home/);
});

test("chapitre 1 : les mêmes alertes restent affichées tant que Tourist Trap n'est pas lancée (non-régression)", () => {
  const v = computeProgress(ch1);
  expect(v.byId.get("get-shirleys-rum")?.status).not.toBe("plus disponible");
  const disc = discoverNow(feed, ch1);
  expect(disc.map((d) => `${d.name} ${d.noReturn ?? ""}`).join(" | ")).toMatch(/Shirley|Three Sheets/);
});
