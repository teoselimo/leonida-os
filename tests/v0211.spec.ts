import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";

/**
 * V0.21.1 (issue #19) — Accueil contextuel et continuité du chapitre 2 (iPhone, iPad, WebKit ; Claude simulé).
 * Profil réel de Théo au 25/11/2026 : chapitre 2, Ambulance Chaser terminée ; provisions pour Jason et conversation à la
 * réception RACONTÉES au copilote, jamais confirmées. Aucun test n'écrit sans un geste explicite du joueur.
 */
const prod = JSON.parse(readFileSync("tests/fixtures/radar-prod.json", "utf8"));
const THEO = { pseudo: "Théo", console: "ps5", edition: "ultimate", preorder: "yes", chapter: 2, lastMission: "Ambulance Chaser", nextMission: null, missionInProgress: false, missionsDone: ["Ambulance Chaser"], spoilerMode: "strict" };
const SAVE = { schema: 1, rev: 9, showDemo: false, done: {}, vehicles: {}, profile: THEO };
const TOLD = [
  { id: 1, role: "user", text: "J’ai récupéré les provisions pour Jason" },
  { id: 2, role: "ai", a: { intent: "motel_report", text: "Cela correspond à « Just Moved In ».", reliability: "signalé", sources: [], actions: [] }, engine: "direct" },
  { id: 3, role: "user", text: "Là je parle avec la proprio du motel" },
  { id: 4, role: "ai", a: { intent: "motel_report", text: "La conversation pourrait correspondre à « Overnight Charges ».", reliability: "signalé", sources: [], actions: [] }, engine: "direct" },
];
// noms de missions principales du chapitre 2 qui ne doivent jamais apparaître en strict sur l'Accueil
const FUTURE = /Girls' Trip|Checking Out|Slam Dunk|Breakfast Run|Coffee Break|Prepare for Vice City|Afternoon Delight|Moses|Daily Driver|Welcome to Vice City/;

async function start(page: Page, profile: Record<string, unknown> = {}, history: unknown[] = []) {
  await page.route("**/__live/radar.json*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...prod, generatedAt: new Date().toISOString() }) }));
  await page.addInitScript(([s, h]) => {
    (window as unknown as { claude: unknown }).claude = { use: async (n: string) => (n === "sample" ? async () => ({ text: "Réponse de test.\n@@@\n{}" }) : null) };
    if (sessionStorage.getItem("__seeded")) return;
    sessionStorage.setItem("__seeded", "1");
    localStorage.clear();
    localStorage.setItem("leonida-os/radar-url", `${location.origin}/__live/radar.json`);
    localStorage.setItem("leonida-os/progress/v1", JSON.stringify(s));
    localStorage.setItem("leonida-os/ai-history/v2", JSON.stringify(h));
  }, [{ ...SAVE, profile: { ...THEO, ...profile } }, history] as const);
  await page.goto("/#accueil");
  await page.waitForSelector(".app.is-ready");
}
const saved = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("leonida-os/progress/v1")!));
async function say(page: Page, text: string) {
  await page.getByTestId("ai-input").fill(text);
  await page.getByTestId("ai-send").click();
  return page.getByTestId("ai-answer").last();
}

test("Accueil : carte « Chapitre 2 · Starlet Motel » en cinq niveaux, sans principale future ni écriture", async ({ page }, info) => {
  await start(page, {}, TOLD);
  await expect(page.getByTestId("next-mission-name")).toHaveText("Chapitre 2 · Starlet Motel");
  await expect(page.getByTestId("home-header")).toContainText("Ta situation");
  await expect(page.getByTestId("home-header")).not.toContainText("Prochaine mission à choisir");
  const card = page.getByTestId("situation-card");
  await expect(card.getByTestId("situation-confirmed")).toContainText("Ambulance Chaser terminée");
  await expect(card.getByTestId("situation-reported")).toContainText("provisions pour Jason");
  await expect(card.getByTestId("situation-reported")).toContainText("conversation à la réception");
  await expect(card.getByTestId("situation-conditional")).toContainText("Check Out McKittrick Farm (lire une affiche de Kyle)");
  await expect(card.getByTestId("situation-goal")).toContainText("Objectif du chapitre · plus tard");
  await expect(card.getByTestId("situation-goal")).toContainText("15 000 $");
  // le seuil n'est plus dans « Avant de continuer », et la ferme n'est pas proposée comme mission secondaire disponible
  await expect(page.getByTestId("before")).toHaveCount(0);
  await expect(page.getByTestId("choose-side").filter({ hasText: "McKittrick" })).toHaveCount(0);
  await expect(page.locator(".home__main")).not.toContainText(FUTURE);
  await expect(page.locator(".home__main")).not.toContainText(/Just Moved In|Overnight Charges/);
  await page.screenshot({ path: `captures/${info.project.name}-v0211-accueil.png` });
  expect((await saved(page)).profile).toMatchObject({ lastMission: "Ambulance Chaser", missionsDone: ["Ambulance Chaser"], nextMission: null, missionInProgress: false });
});

test("Accueil : ce qui est raconté au copilote apparaît « à confirmer » et persiste au rechargement, sans écriture", async ({ page }) => {
  await start(page, {}, [{ id: 1, role: "user", text: "Je dois récupérer les provisions pour Jason ?" }]);
  const progressKey = "leonida-os/progress/v1";
  const before = await page.evaluate((key) => localStorage.getItem(key), progressKey);
  const card = page.getByTestId("situation-card");
  await expect(card.getByTestId("situation-confirmed")).toContainText("Ambulance Chaser terminée");
  await expect(card.getByTestId("situation-reported")).toHaveCount(0);
  await page.getByTestId("ai-open").click();
  await expect(await say(page, "J’ai récupéré les provisions pour Jason")).toContainText("Just Moved In");
  await page.reload();
  await page.waitForSelector(".app.is-ready");
  await expect(page.getByTestId("situation-reported")).toContainText("provisions pour Jason");
  expect(await page.evaluate((key) => localStorage.getItem(key), progressKey)).toBe(before);
});

test("continuité : la confirmation d’Ambulance Chaser rappelle les provisions et la gérante, sans les enregistrer", async ({ page }) => {
  await start(page, { lastMission: "Discharge Time", missionsDone: ["Discharge Time"] }, TOLD);
  await page.getByTestId("ai-open").click();
  const r = await say(page, "J’ai fait disparaître l’ambulance");
  await r.getByTestId("ai-action-set_mission").click();
  await r.getByRole("button", { name: "Confirmer" }).click();
  const after = page.getByTestId("ai-answer").last();
  await expect(after).toContainText("C'est noté : « Ambulance Chaser » terminée.");
  await expect(after).toContainText("Tu m’avais aussi indiqué avoir récupéré les provisions pour Jason et parlé à la gérante.");
  await expect(after).toContainText("Je ne les marque pas comme terminées sans confirmation.");
  await expect(after).not.toContainText("Je n'ai pas de nouvelle mission documentée");
  await expect(after).not.toContainText(FUTURE);
  // seule la mission confirmée est enregistrée
  expect((await saved(page)).profile).toMatchObject({ lastMission: "Ambulance Chaser", missionsDone: ["Discharge Time", "Ambulance Chaser"], nextMission: null });
  // la proposition suivante reste à confirmer : Annuler ne change rien
  await after.getByTestId("ai-action-start_mission").first().click();
  await after.getByRole("button", { name: "Annuler" }).click();
  expect((await saved(page)).profile).toMatchObject({ nextMission: null, missionInProgress: false });
});

test("« Mettre ma progression à jour » ouvre le copilote sur la situation ; rien n’est écrit sans confirmer", async ({ page }) => {
  await start(page, {}, TOLD);
  await page.getByTestId("situation-update").click();
  const a = page.getByTestId("ai-answer").last();
  await expect(a).toContainText("Confirmé par toi : Ambulance Chaser terminée.");
  await expect(a).toContainText("probablement en cours (non confirmé) : provisions pour Jason, conversation à la réception");
  await expect(a).toContainText("Condition à remplir dans le jeu d’abord : Check Out McKittrick Farm");
  await expect(a).toContainText("Objectif du chapitre, plus tard");
  await expect(a).not.toContainText(FUTURE);
  await a.getByTestId("ai-action-start_mission").first().click();
  await a.getByRole("button", { name: "Annuler" }).click();
  expect((await saved(page)).profile).toMatchObject({ lastMission: "Ambulance Chaser", missionsDone: ["Ambulance Chaser"], nextMission: null, missionInProgress: false });
});

test("mission choisie au chapitre 2 : en-tête habituel, et le seuil des 15 000 $ reste un objectif « plus tard »", async ({ page }) => {
  await start(page, { nextMission: "Just Moved In" }, TOLD);
  await expect(page.getByTestId("next-mission-name")).toHaveText("Just Moved In");
  await expect(page.getByTestId("situation-card")).toHaveCount(0);
  await expect(page.getByTestId("chapter-goals")).toContainText("15 000 $");
  await expect(page.getByTestId("before")).not.toContainText("15 000");
});
