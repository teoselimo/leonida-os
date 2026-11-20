import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";

/**
 * Synchronisation du Radar en direct : l'interface déjà construite lit un flux qui change
 * (v1 → v2 → v3, produits par le vrai moteur de collecte) sans rebuild ni redéploiement.
 */
const FEED_URL = "http://localhost:4321/__live/radar.json";
const load = (v: string) => JSON.parse(readFileSync(`tests/fixtures/radar-${v}.json`, "utf8"));

async function serveFeed(page: Page, get: () => unknown) {
  await page.route("**/__live/radar.json*", async (route) => {
    const feed = get() as { generatedAt: string; items: Array<{ firstSeenAt: string }>; sources: Array<{ lastSuccessAt: string | null }> };
    if (!feed) return route.fulfill({ status: 503, body: "indisponible" });
    const now = new Date().toISOString();
    // fraîcheur relative au moment du test
    const fresh = { ...feed, generatedAt: now, items: feed.items.map((i) => ({ ...i, firstSeenAt: now })), sources: feed.sources.map((s) => ({ ...s, lastSuccessAt: s.lastSuccessAt ? now : null })) };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fresh) });
  });
}

async function start(page: Page, hash = "#radar") {
  await page.goto("/");
  await page.evaluate((u) => {
    localStorage.clear();
    localStorage.setItem("leonida-os/radar-url", u);
  }, FEED_URL);
  await page.goto(`/${hash}`);
  await page.reload(); // l'ancre seule ne recharge pas le document
  await page.waitForSelector(".app.is-ready");
}

test("une nouvelle fiche publiée par la collecte apparaît sans redéployer l'interface", async ({ page }, info) => {
  let current: unknown = load("v1");
  await serveFeed(page, () => current);
  await start(page);
  await expect(page.getByTestId("sync-status")).toContainText("Veille automatique active");
  await page.getByRole("radio", { name: /Actualités/ }).click();
  await expect(page.getByTestId("live-list")).toContainText("Grand Theft Auto VI Now Available");
  await expect(page.getByTestId("live-list")).not.toContainText("Stinger");
  await page.getByRole("radio", { name: /Confirmé/ }).click();
  await expect(page.getByTestId("live-list")).not.toContainText("Stinger");

  current = load("v2"); // la collecte suivante a trouvé une seconde source indépendante
  await page.getByTestId("sync-status").locator(".sync__main").click();
  await page.getByRole("button", { name: "Relire le flux" }).click();
  await expect(page.getByTestId("live-list")).toContainText("Stinger");
  await page.screenshot({ path: `captures/${info.project.name}-10-radar-live.png` });
});

test("anti-spoiler du flux : strict retire, modéré floute", async ({ page }) => {
  await serveFeed(page, () => load("v1"));
  await start(page);
  await page.getByRole("radio", { name: /À vérifier/ }).click();
  await expect(page.getByTestId("live-list")).not.toContainText("ending");
  await expect(page.getByTestId("live-hidden")).toContainText("1 fiche masquée");
  await page.locator(".shield").first().click();
  await expect(page.getByTestId("live-list").locator(".spoiler").first()).toBeVisible();
});

test("statuts distincts, preuves et médias autorisés uniquement", async ({ page }) => {
  await serveFeed(page, () => load("v1"));
  await start(page);
  await page.getByRole("radio", { name: /Actualités/ }).click();
  const official = page.locator("article.live-card", { hasText: "Now Available" }).first();
  await expect(official.getByTestId("rel-official")).toBeVisible();
  await expect(official.getByTestId("open-proof")).toHaveAttribute("href", /youtube\.com\/watch\?v=/);
  const srcs = await page.locator(".live-thumb img").evaluateAll((els) => els.map((e) => (e as HTMLImageElement).src));
  expect(srcs.length).toBeGreaterThan(0);
  expect(srcs.every((s) => s.startsWith("https://i.ytimg.com/"))).toBe(true);
  await page.getByRole("radio", { name: /À vérifier/ }).click();
  const press = page.locator("article.live-card", { hasText: "Stinger" }).first();
  await expect(press.getByTestId("rel-reported")).toBeVisible();
  await expect(press.locator("img")).toHaveCount(0); // image d'article : jamais republiée
  await expect(press).toContainText("non localisé");
});

test("carte : aucun point sans validation, point affiché dès qu'il est validé", async ({ page }) => {
  let current: unknown = load("v2");
  await serveFeed(page, () => current);
  await start(page, "#carte");
  await page.waitForFunction(() => !!(window as unknown as { __leonidaMap?: unknown }).__leonidaMap);
  await expect(page.locator("[data-testid^=marker-live-]")).toHaveCount(0);
  current = load("v3");
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.locator("[data-testid^=marker-live-]")).toHaveCount(1, { timeout: 10_000 });
});

test("la fiche retirée par un administrateur disparaît", async ({ page }) => {
  let current: unknown = load("v1");
  await serveFeed(page, () => current);
  await start(page);
  await page.locator(".shield").first().click(); // modéré : la rumeur (spoiler) est visible floutée
  await page.getByRole("radio", { name: /À vérifier/ }).click();
  await expect(page.getByTestId("live-list")).toContainText("leak");
  current = load("v2");
  await page.getByTestId("sync-status").locator(".sync__main").click();
  await page.getByRole("button", { name: "Relire le flux" }).click();
  await expect(page.getByTestId("live-list")).not.toContainText("leak");
});

test("dégradation : flux injoignable → bascule propre en démonstration", async ({ page }) => {
  await serveFeed(page, () => null);
  await start(page);
  await expect(page.getByTestId("demo-banner")).toContainText("injoignable");
});
