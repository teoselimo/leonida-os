import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";

/**
 * V0.18 — Mission Autopilot (iPhone, iPad, WebKit). Claude simulé ; aucune mission enregistrée sans un geste du joueur.
 * Départ : la sauvegarde réelle du 22/11 (Swamped et Don Gone terminées, « Talk to Lucia » prévue).
 */
const prod = JSON.parse(readFileSync("tests/fixtures/radar-prod.json", "utf8"));
const SAVE = { schema: 1, rev: 8, showDemo: false, done: {}, vehicles: {}, profile: { pseudo: "Théo", console: "ps5", edition: "ultimate", preorder: "yes", chapter: 1, lastMission: "Don Gone", nextMission: "Talk to Lucia", missionInProgress: false, missionsDone: ["Swamped", "Don Gone"], spoilerMode: "strict" } };

async function start(page: Page, profile: Record<string, unknown> = {}) {
  await page.route("**/__live/radar.json*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...prod, generatedAt: new Date().toISOString() }) }));
  await page.addInitScript((s) => {
    (window as unknown as { claude: unknown }).claude = { use: async (n: string) => (n === "sample" ? async () => ({ text: "Réponse de test.\n@@@\n{}" }) : null) };
    if (sessionStorage.getItem("__seeded")) return;
    sessionStorage.setItem("__seeded", "1");
    localStorage.clear();
    localStorage.setItem("leonida-os/radar-url", `${location.origin}/__live/radar.json`);
    localStorage.setItem("leonida-os/progress/v1", JSON.stringify(s));
  }, { ...SAVE, profile: { ...SAVE.profile, ...profile } });
  await page.goto("/#accueil");
  await page.waitForSelector(".app.is-ready");
}
const saved = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("leonida-os/progress/v1")!));

test("parcours complet : terminée → suite proposée → préparée → lancée, confirmation au point de non-retour, rien d'enregistré sans geste", async ({ page }, info) => {
  await start(page, { missionInProgress: true });
  await page.getByTestId("mission-done").click(); // 1
  await page.getByTestId("mission-done-confirm").getByRole("button", { name: /Oui, terminée/ }).click(); // 2
  const card = page.getByTestId("next-choice");
  await expect(card.getByTestId("autopilot-last")).toContainText("Dernière mission terminée : Talk to Lucia");
  await expect(card.getByTestId("autopilot-suggestion")).toContainText("Tourist Trap");
  await expect(card.getByTestId("autopilot-pnr")).toBeVisible();
  expect((await saved(page)).profile).toMatchObject({ lastMission: "Talk to Lucia", nextMission: null });
  await page.screenshot({ path: `captures/${info.project.name}-v018-1-proposition.png` });
  await card.getByTestId("autopilot-plan").click(); // 3 : envisagée
  await expect(page.getByTestId("next-mission-name")).toHaveText("Tourist Trap");
  await expect(page.getByTestId("mission-upcoming")).toBeVisible();
  await expect(page.getByTestId("before")).toContainText("Family Savings"); // préparation : risques et opportunités documentés
  expect((await saved(page)).profile).toMatchObject({ nextMission: "Tourist Trap", missionInProgress: false });
  await page.screenshot({ path: `captures/${info.project.name}-v018-2-preparation.png` });
  await page.getByTestId("mission-start").click(); // 4 : point de non-retour → confirmation compacte (V0.18.1)
  const guard = page.getByTestId("launch-guard");
  await expect(guard).toContainText("point de non-retour");
  await expect(guard).toContainText("Family Savings");
  expect((await saved(page)).profile.missionInProgress).toBe(false); // rien d'enregistré tant que le joueur n'a pas choisi
  await page.screenshot({ path: `captures/${info.project.name}-v018-2b-garde-fou.png` });
  await guard.getByTestId("guard-go").click(); // 5 : « Lancer quand même »
  await expect(page.getByTestId("mission-live")).toBeVisible();
  expect((await saved(page)).profile).toMatchObject({ nextMission: "Tourist Trap", missionInProgress: true });
  await page.screenshot({ path: `captures/${info.project.name}-v018-3-en-mission.png` });
});

test("explorer librement : la carte se réduit, reste réduite au rechargement, et se rouvre d'un toucher", async ({ page }) => {
  await start(page, { lastMission: "Talk to Lucia", nextMission: null, missionsDone: ["Swamped", "Don Gone", "Talk to Lucia"] });
  await page.getByTestId("explore-free").click();
  await expect(page.getByTestId("next-choice")).toHaveAttribute("data-mode", "exploration");
  await page.reload();
  await page.waitForSelector(".app.is-ready");
  await expect(page.getByTestId("next-choice")).toHaveAttribute("data-mode", "exploration");
  await expect(page.getByTestId("autopilot-suggestion")).toHaveCount(0);
  await page.getByTestId("explore-stop").click();
  await expect(page.getByTestId("autopilot-suggestion")).toContainText("Tourist Trap");
});

test("plusieurs branches : chacune se choisit, aucune n'est imposée", async ({ page }) => {
  await start(page, { lastMission: "Down to Earth", nextMission: null, missionsDone: ["Down to Earth"] });
  await expect(page.getByTestId("choose-next")).toHaveCount(2);
  await page.getByTestId("next-choice").locator("li").filter({ has: page.locator("b", { hasText: /^Day Release$/ }) }).getByTestId("choose-next").click();
  await expect(page.getByTestId("next-mission-name")).toHaveText("Day Release");
});

test("chapitre 2 sans graphe : incertitude explicite et choix manuel", async ({ page }) => {
  await start(page, { chapter: 2, lastMission: "Discharge Time", nextMission: null, missionsDone: ["Discharge Time"] });
  await expect(page.getByTestId("autopilot-uncertain")).toContainText("pas encore de graphe");
  await page.getByTestId("next-mission-input").fill("Checking Out");
  await page.getByTestId("next-mission-save").click();
  await expect(page.getByTestId("next-mission-name")).toHaveText("Checking Out");
});

test("missions probablement faites : proposées à confirmer, enregistrées seulement après « Oui, faites »", async ({ page }) => {
  await start(page, { lastMission: "Swamped", nextMission: null, missionsDone: ["Swamped"] });
  const likely = page.getByTestId("autopilot-likely");
  await expect(likely).toContainText("Prologue");
  expect((await saved(page)).profile.missionsDone).toEqual(["Swamped"]);
  await likely.getByTestId("likely-confirm").click(); // « Tout confirmer » : parcours rapide conservé
  await expect(page.getByTestId("autopilot-likely")).toHaveCount(0);
  const p = (await saved(page)).profile;
  expect(p.missionsDone).toContain("Coming Home");
  expect(p.lastMission).toBe("Swamped");
});

test("la carte tient dans l'écran (aucun débordement horizontal)", async ({ page }) => {
  await start(page, { lastMission: "Talk to Lucia", nextMission: null, missionsDone: ["Swamped", "Don Gone", "Talk to Lucia"] });
  const over = await page.getByTestId("next-choice").evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(over).toBeLessThanOrEqual(1);
});

test("V0.18.1 · « Je la lance » directement depuis la proposition : garde-fou, puis « Revoir d'abord » la prépare sans la lancer", async ({ page }) => {
  await start(page, { lastMission: "Talk to Lucia", nextMission: null, missionsDone: ["Swamped", "Don Gone", "Talk to Lucia"] });
  await page.getByTestId("autopilot-start").click();
  await expect(page.getByTestId("launch-guard")).toBeVisible();
  expect((await saved(page)).profile.nextMission).toBeNull();
  await page.getByTestId("guard-review").click();
  await expect(page.getByTestId("launch-guard")).toHaveCount(0);
  await expect(page.getByTestId("mission-upcoming")).toBeVisible();
  expect((await saved(page)).profile).toMatchObject({ nextMission: "Tourist Trap", missionInProgress: false });
});

test("V0.18.1 · une mission sans risque important se lance sans confirmation", async ({ page }) => {
  await start(page);
  await page.getByTestId("mission-start").click(); // Talk to Lucia
  await expect(page.getByTestId("mission-live")).toBeVisible();
  await expect(page.getByTestId("launch-guard")).toHaveCount(0);
});

test("V0.18.1 · activité libre : cochée « Fait », jamais enregistrée comme mission", async ({ page }) => {
  await start(page, { lastMission: "Talk to Lucia", nextMission: null, missionsDone: ["Swamped", "Don Gone", "Talk to Lucia"] });
  const acts = page.getByTestId("autopilot-activities");
  await expect(acts).toContainText("Family Savings");
  await expect(page.getByTestId("autopilot-sides")).not.toContainText("Family Savings");
  await acts.getByTestId("choose-activity").filter({ hasText: "Family Savings" }).click();
  await acts.getByTestId("activity-done").click();
  const sv = await saved(page);
  expect(sv.profile.nextMission).toBeNull();
  expect(Object.keys(sv.done)).toContain("prog:family-savings");
  await expect(page.getByTestId("choose-activity").filter({ hasText: "Family Savings" })).toHaveCount(0);
  // saisie libre du nom de l'activité : refusée avec une explication
  await page.getByTestId("next-mission-input").fill("Mettre 5 000 $ sur Family Savings");
  await page.getByTestId("next-mission-save").click();
  await expect(page.getByTestId("next-mission-name")).toHaveText("Prochaine mission à choisir");
});

test("V0.18.1 · missions antérieures : liste inspectable, sélection partielle confirmée", async ({ page }, info) => {
  await start(page, { lastMission: "Swamped", nextMission: null, missionsDone: ["Swamped"] });
  const likely = page.getByTestId("autopilot-likely");
  await likely.getByTestId("likely-inspect").click();
  await expect(likely.getByTestId("likely-item")).toHaveCount(11);
  await page.screenshot({ path: `captures/${info.project.name}-v0181-liste.png` });
  await likely.locator("label", { hasText: "Feng Shui" }).getByTestId("likely-item").uncheck();
  await likely.locator("label", { hasText: "Coming Home" }).getByTestId("likely-item").uncheck();
  await expect(likely.getByTestId("likely-confirm-selected")).toHaveText("Confirmer la sélection (9)");
  expect((await saved(page)).profile.missionsDone).toEqual(["Swamped"]);
  await likely.getByTestId("likely-confirm-selected").click();
  const p = (await saved(page)).profile;
  expect(p.missionsDone).toHaveLength(10);
  expect(p.missionsDone).not.toContain("Feng Shui");
  expect(p.lastMission).toBe("Swamped");
  await expect(page.getByTestId("autopilot-likely")).toContainText("Coming Home");
});
