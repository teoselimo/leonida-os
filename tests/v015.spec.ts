import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";

/** V0.15 — carte : fond natif HD, filtre « Commerces » visible tout de suite et regroupé, point sélectionné préservé. */
const prod = JSON.parse(readFileSync("tests/fixtures/radar-prod.json", "utf8"));
type W = { __leonidaMap: { getStyle(): { sources: Record<string, { maxzoom?: number; tileSize?: number }> }; queryRenderedFeatures(o: { layers: string[] }): Array<{ properties: Record<string, unknown> }>; jumpTo(o: object): void; isMoving(): boolean; areTilesLoaded(): boolean; loaded(): boolean; getMaxZoom(): number } };

async function start(page: Page) {
  await page.route("**/__live/radar.json*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...prod, generatedAt: new Date().toISOString() }) }));
  await page.addInitScript(() => {
    (window as unknown as { claude: unknown }).claude = { use: async () => null };
    if (sessionStorage.getItem("__s")) return;
    sessionStorage.setItem("__s", "1");
    localStorage.clear();
    localStorage.setItem("leonida-os/radar-url", `${location.origin}/__live/radar.json`);
    localStorage.setItem("leonida-os/progress/v1", JSON.stringify({ schema: 1, rev: 7, showDemo: false, done: {}, vehicles: {}, pins: { "key-lento-kahuna": { x: -2500, y: -6000, at: "2026-11-22T09:00:00Z", by: "joueur" } }, profile: { pseudo: "Théo", console: "ps5", edition: "ultimate", preorder: "yes", chapter: 1, lastMission: "Don Gone", nextMission: "Talk to Lucia", missionInProgress: false, missionsDone: ["Swamped", "Don Gone"], spoilerMode: "strict" } }));
  });
  await page.goto("/#carte");
  await page.waitForSelector(".app.is-ready");
  await page.waitForFunction(() => !!(window as unknown as W).__leonidaMap?.loaded());
}
const idle = (page: Page) => page.waitForFunction(() => { const m = (window as unknown as W).__leonidaMap; return m.areTilesLoaded() && !m.isMoving(); }, null, { timeout: 20_000 });

test("fond : niveau natif z5, tuiles déclarées pour l'écran Retina, zoom maximal sans agrandissement excessif", async ({ page }) => {
  await start(page);
  const s = await page.evaluate(() => { const m = (window as unknown as W).__leonidaMap; return { src: m.getStyle().sources.leonida, max: m.getMaxZoom() }; });
  expect(s.src.maxzoom).toBe(5);
  expect(s.src.tileSize).toBe(1024);
  expect(s.max).toBeLessThanOrEqual(8.4);
  await expect(page.getByText("gtadb.org").first()).toBeVisible(); // crédit conservé
});

test("filtre « Commerces » : résultats visibles tout de suite, regroupés en vue d'ensemble, détaillés en zoomant ; position sauvegardée intacte", async ({ page }) => {
  await start(page);
  await page.getByTestId("filter-shops").click();
  await page.evaluate(() => (window as unknown as W).__leonidaMap.jumpTo({ center: [-29.5, -36.5], zoom: 2 }));
  await idle(page);
  const far = await page.evaluate(() => (window as unknown as W).__leonidaMap.queryRenderedFeatures({ layers: ["lmf-cl", "lmf-pt"] }).length);
  expect(far).toBeGreaterThan(0);
  await page.evaluate(() => (window as unknown as W).__leonidaMap.jumpTo({ center: [-29.5, -36.5], zoom: 6.2 }));
  await idle(page);
  const near = await page.evaluate(() => (window as unknown as W).__leonidaMap.queryRenderedFeatures({ layers: ["lmf-pt"] }).map((f) => String(f.properties.kind)));
  expect(near.length).toBeGreaterThan(0);
  expect(near.every((k) => k !== "autre")).toBe(true);
  const pins = await page.evaluate(() => JSON.parse(localStorage.getItem("leonida-os/progress/v1")!).pins);
  expect(pins["key-lento-kahuna"]).toEqual({ x: -2500, y: -6000, at: "2026-11-22T09:00:00Z", by: "joueur" });
});

test("lieu ouvert depuis la recherche : sa fiche donne la précision, aucun faux point pour une position inconnue", async ({ page }) => {
  await start(page);
  await page.getByTestId("search-btn").first().click();
  await page.getByTestId("search-input").fill("Wonder Whale");
  await page.getByTestId("est-wonder-whale").click();
  await expect(page.getByTestId("est-card")).toHaveAttribute("data-precision", "repere");
  await expect(page.getByTestId("zone-tag")).toContainText("Repère communautaire");
  if (await page.locator(".panel .back").isVisible().catch(() => false)) await page.locator(".panel .back").click(); // iPad : retour à l'inspecteur
  await page.getByTestId("search-btn").first().click();
  await page.getByTestId("search-input").fill("Billie");
  await page.getByTestId("est-billies-gift-shop").click();
  await expect(page.getByTestId("est-card")).toHaveAttribute("data-precision", "inconnue");
  await expect(page.getByTestId("zone-tag")).toHaveCount(0);
});
