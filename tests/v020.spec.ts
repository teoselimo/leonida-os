import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";

/**
 * V0.20 — Data Hub dans l'app : Guide › Garage, Guide › Encyclopédie, faits GTABase dans Story (iPhone, iPad, WebKit).
 * Données : bundles réellement générés par hub/refresh.py (aucun appel réseau vers GTABase ou GTADB pendant le test).
 */
const prod = JSON.parse(readFileSync("tests/fixtures/radar-prod.json", "utf8"));
const SAVE = { schema: 1, rev: 9, showDemo: false, done: {}, vehicles: {}, profile: { pseudo: "Théo", console: "ps5", edition: "ultimate", preorder: "yes", chapter: 1, lastMission: "Don Gone", nextMission: "Talk to Lucia", missionInProgress: false, missionsDone: ["Swamped", "Don Gone"], spoilerMode: "strict" } };

async function start(page: Page, profile: Record<string, unknown> = {}, hash = "#radar") {
  await page.route("**/__live/radar.json*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...prod, generatedAt: new Date().toISOString() }) }));
  await page.addInitScript(([s]) => {
    if (sessionStorage.getItem("__seeded")) return;
    sessionStorage.setItem("__seeded", "1");
    localStorage.clear();
    localStorage.setItem("leonida-os/radar-url", `${location.origin}/__live/radar.json`);
    localStorage.setItem("leonida-os/progress/v1", JSON.stringify(s));
  }, [{ ...SAVE, profile: { ...SAVE.profile, ...profile } }] as const);
  await page.goto(`/${hash}`);
  await page.waitForSelector(".app.is-ready");
}
const saved = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("leonida-os/progress/v1") || "{}"));

test("Garage dans le Guide (pas de sixième onglet) : catalogue, recherche, filtres, fiche, « Recherché » sauvegardé", async ({ page }) => {
  await start(page);
  await expect(page.locator(".tabbar button, nav [role=tab], .tabs button").filter({ hasText: "Garage" })).toHaveCount(0);
  const t0 = Date.now();
  await page.getByTestId("guide-view-garage").click();
  await expect(page.getByTestId("garage-grid").locator(".gv").first()).toBeVisible();
  const loadMs = Date.now() - t0;
  expect(loadMs).toBeLessThan(4000);
  await expect(page.getByTestId("garage-count")).toContainText(/\d{3} véhicules/);
  // V0.20.1 : images exactes servies par l'Artifact lui-même en planches (jamais un lien vers un site tiers)
  expect(await page.getByTestId("garage-grid").locator(".gv__sprite").evaluateAll((els) => els.every((e) => (e as HTMLElement).style.backgroundImage.includes("/data/hub/vatlas/")))).toBeTruthy();
  const srcs = await page.getByTestId("garage-grid").locator("img").evaluateAll((els) => els.map((e) => (e as HTMLImageElement).src));
  expect(srcs.every((u) => u.startsWith("data:image/"))).toBeTruthy(); // seules les photos du joueur sont des <img>
  expect(srcs.every((u) => !u.includes("gtabase.com"))).toBeTruthy();
  await page.getByTestId("garage-search").fill("sultan");
  await expect(page.getByTestId("garage-grid").locator(".gv__n").filter({ hasText: /^Sultan$/ })).toHaveCount(1);
  await page.getByTestId("garage-maker").selectOption("Emperor");
  await expect(page.getByTestId("garage-results")).toContainText("résultat");
  await page.getByTestId("garage-grid").locator(".gv").filter({ hasText: /^.*Sultan/ }).filter({ hasNotText: "Variante" }).first().click();
  const sheet = page.getByTestId("garage-sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByTestId("garage-stats")).toContainText("Vitesse");
  await expect(sheet.getByTestId("garage-family")).toContainText("Moses");
  await expect(sheet.getByTestId("garage-sources").locator("a").first()).toHaveAttribute("href", /gtabase\.com\/gta-6\/vehicles\//);
  await expect(sheet.getByTestId("garage-nomap")).toBeVisible();
  await sheet.getByTestId("garage-want").click();
  expect((await saved(page)).wanted?.length).toBe(1);
  // variante → navigation vers sa fiche, puis fermeture
  await sheet.getByTestId("garage-family").locator("button").first().click();
  await expect(sheet.getByTestId("garage-access")).toBeVisible();
  await sheet.getByTestId("garage-close").click();
  await expect(sheet).toHaveCount(0);
  await page.getByTestId("garage-search").fill("");
  await page.getByTestId("garage-maker").selectOption("");
  await page.getByTestId("garage-only-wanted").click();
  await expect(page.getByTestId("garage-grid").locator(".gv")).toHaveCount(1);
  await page.reload();
  await page.waitForSelector(".app.is-ready");
  expect((await saved(page)).wanted?.length).toBe(1);
});

test("Garage → Carte : un véhicule à position calibrée (Rare Vehicle Locator) s'ouvre sur la carte", async ({ page }) => {
  await start(page);
  await page.getByTestId("guide-view-garage").click();
  await page.getByTestId("garage-only-map").click();
  await page.getByTestId("garage-grid").locator(".gv").filter({ hasText: "Penumbra" }).first().click();
  await page.getByTestId("garage-map").click();
  await expect(page.getByTestId("vehicle-sheet")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("vehicle-name")).toContainText("Penumbra");
});

test("catalogue indisponible : signalé, véhicules suivis par LEONIDA toujours affichés (rien d'inventé)", async ({ page }) => {
  await page.route("**/data/hub/vehicles.json", (r) => r.abort());
  await start(page);
  await page.getByTestId("guide-view-garage").click();
  await expect(page.getByTestId("garage-failed")).toBeVisible();
  await expect(page.getByTestId("garage-grid").locator(".gv").first()).toBeVisible();
  await expect(page.getByTestId("garage-count")).toContainText("0 modèles");
});

test("Encyclopédie : missions par chapitre, anti-spoiler strict, autres catégories datées et sourcées", async ({ page }) => {
  await start(page);
  await page.getByTestId("guide-view-encyclo").click();
  await expect(page.getByTestId("enc-fresh")).toContainText("GTADB révision");
  await expect(page.getByTestId("enc-ch-1")).toContainText("Gear Up");
  await expect(page.getByTestId("enc-ch-3")).toContainText("Masqué par l'anti-spoiler strict");
  await expect(page.getByTestId("encyclopedia")).not.toContainText("Car Service");
  await page.getByTestId("enc-m-swamped").locator("button").click();
  await expect(page.getByTestId("enc-m-swamped")).toContainText("Prérequis audités par LEONIDA");
  await page.getByTestId("enc-tab-weapon").click();
  await expect(page.getByTestId("enc-count")).toContainText(/\d+ fiches/);
  await expect(page.getByTestId("enc-list").locator("a").first()).toHaveAttribute("href", /gtabase\.com/);
  await page.getByTestId("enc-tab-map").click();
  await expect(page.getByTestId("enc-unplaced")).toContainText("sans position");
});

test("Encyclopédie, anti-spoiler léger : chapitres suivants réduits à un compte, sans nom", async ({ page }) => {
  await start(page, { spoilerMode: "relaxed" });
  await page.getByTestId("guide-view-encyclo").click();
  await expect(page.getByTestId("enc-ch-3")).toContainText("noms masqués");
  await expect(page.getByTestId("encyclopedia")).not.toContainText("Car Service");
});

test("Story : la fiche GTABase s'ajoute à la simulation de lancement, objectifs repliés (spoiler)", async ({ page }) => {
  await start(page, {}, "#accueil");
  await page.getByTestId("story-sim-open").first().click();
  const f = page.getByTestId("hub-facts").first();
  await expect(f).toContainText("Fiche GTABase");
  await expect(f).toContainText("graphe audité");
  await expect(f.getByTestId("hub-objectives").locator("p")).toBeHidden();
});

test("encyclopédie du motel : seules les missions déclarées sont nommées en strict", async ({ page }) => {
  await start(page, { chapter: 2, lastMission: "Ambulance Chaser", missionsDone: ["Ambulance Chaser"], nextMission: "Just Moved In" });
  await page.getByTestId("guide-view-encyclo").click();
  const chapter = page.getByTestId("enc-ch-2");
  await expect(chapter).toContainText("Ambulance Chaser");
  await expect(chapter).not.toContainText(/Checking Out|Girls' Trip/);
  await chapter.getByTestId("enc-m-just-moved-in").getByRole("button").click();
  await expect(chapter).toContainText("Étapes et conséquences masquées");
  await expect(chapter.getByTestId("enc-guide")).toHaveCount(0);
});
