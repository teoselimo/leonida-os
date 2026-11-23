import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";

/**
 * Synchronisation du Radar en direct : l'interface déjà construite lit un flux qui change
 * (v1 → v2 → v3, produits par le vrai moteur de collecte) sans rebuild ni redéploiement.
 */
const FEED_URL = "http://localhost:4321/__live/radar.json";
const load = (v: string) => JSON.parse(readFileSync(`tests/fixtures/radar-${v}.json`, "utf8"));

async function serveFeed(page: Page, get: () => unknown, opts: { ageMin?: number } = {}) {
  await page.route("**/__live/radar.json*", async (route) => {
    const feed = get() as { generatedAt: string; items: Array<{ firstSeenAt: string }>; sources: Array<{ lastSuccessAt: string | null }> };
    if (!feed) return route.fulfill({ status: 503, body: "indisponible" });
    const now = new Date().toISOString();
    if (opts.ageMin != null) {
      // flux figé : simule un collecteur qui ne publie plus
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...feed, generatedAt: new Date(Date.now() - opts.ageMin * 60_000).toISOString() }) });
    }
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
  if (hash === "#radar") await page.getByTestId("guide-full").click({ timeout: 6000 }).catch(() => {}); // flux injoignable : pas de Guide

}
/** V0.14 : bouclier = menu ; baisser la protection demande confirmation. */
async function spoiler(page: Page, mode: "strict" | "relaxed" | "off") {
  await page.getByTestId("shield").first().click();
  await page.getByTestId(`shield-${mode}`).click();
  if (await page.getByTestId("shield-ok").isVisible().catch(() => false)) await page.getByTestId("shield-ok").click();
}
/** V0.14 : le Radar complet (statuts, actualités, santé de la collecte) est derrière le Guide. */
async function fullRadar(page: Page) {
  await page.getByTestId("guide-full").click();
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
  await spoiler(page, "relaxed");
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
  await spoiler(page, "relaxed"); // modéré : la rumeur (spoiler) est visible floutée
  await page.getByRole("radio", { name: /À vérifier/ }).click();
  await expect(page.getByTestId("live-list")).toContainText("Non confirmé"); // V0.14 : « rumeur » → « Non confirmé »
  current = load("v2");
  await page.getByTestId("sync-status").locator(".sync__main").click();
  await page.getByRole("button", { name: "Relire le flux" }).click();
  await expect(page.getByTestId("live-list")).not.toContainText("Non confirmé");
});

test("dégradation : flux injoignable → bascule propre en démonstration", async ({ page }) => {
  await serveFeed(page, () => null);
  await start(page);
  await expect(page.getByTestId("demo-banner")).toContainText("injoignable");
});

// ───────────── V0.5.1 : fiche structurée, conseil personnalisé, santé du collecteur ─────────────
test("V0.5.1 : la cache du perroquet devient une fiche structurée sourcée dans le Radar", async ({ page }, info) => {
  await serveFeed(page, () => load("v4"));
  await start(page);
  await page.getByRole("radio", { name: /Confirmé/ }).click();
  const card = page.locator("article.live-card", { hasText: "Three Sheets Liquor" }).first();
  await expect(card.getByTestId("rel-confirmed")).toBeVisible();
  const sheet = card.getByTestId("fact-sheet");
  await expect(sheet).toContainText("≈ 1 000–1 400 $");
  await expect(sheet).toContainText("Three Sheets Liquor, Key Lento");
  await expect(sheet).toContainText("Get Shirley's Rum (Shirley)");
  await expect(sheet).toContainText("Après une mission à venir"); // V0.14 : strict, mission future jamais nommée
  await expect(sheet).not.toContainText("Pipework");
  await expect(sheet).toContainText("Chapitre 1");
  await expect(sheet).not.toContainText("Tourist Trap");
  await sheet.getByRole("button", { name: /≈ 1 000–1 400 \$/ }).click();
  await expect(sheet.locator(".fsrow__proof q")).toHaveCount(2); // une citation par source
  await expect(card.getByTestId("propose-point")).toHaveAttribute("href", /github\.com\/teoselimo\/leonida-os\/issues\/new/);
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `captures/${info.project.name}-20-fiche-structuree.png` });
});

test("V0.5.1 : « Que faire maintenant ? » propose le conseil au chapitre 1, pas avant", async ({ page }, info) => {
  await serveFeed(page, () => load("v4"));
  await start(page, "#accueil");
  // V0.14 : le conseil vit dans « Avant de continuer » (anti-spoiler strict : la mission future n'est pas nommée)
  const adv = page.getByTestId("before");
  await expect(adv).toContainText("Three Sheets Liquor");
  await expect(adv).not.toContainText("Tourist Trap");
  await page.screenshot({ path: `captures/${info.project.name}-21-conseil-accueil.png` });
  // « C'est fait » retire le conseil (et le mémorise)
  await adv.getByTestId("before-item").filter({ hasText: "Three Sheets Liquor" }).getByTestId("done-btn").click();
  await expect(page.getByTestId("before-item").filter({ hasText: "Three Sheets Liquor" })).toHaveCount(0);
});

test("V0.5.1 : chapitre du joueur antérieur → conseil gardé pour plus tard", async ({ page }) => {
  await serveFeed(page, () => load("v4"));
  await start(page, "#profil");
  await page.getByTestId("chapter-0").click();
  await page.goto("/#accueil");
  await page.waitForSelector(".app.is-ready");
  await expect(page.getByTestId("next-mission")).toBeVisible();
  await expect(page.locator(".main")).not.toContainText("Three Sheets Liquor");
});

test("V0.5.1 : collecteur arrêté → alerte claire sur l'accueil et le Radar", async ({ page }, info) => {
  await serveFeed(page, () => load("v4"), { ageMin: 240 });
  await start(page, "#accueil");
  await expect(page.getByTestId("collector-alert").first()).toContainText("Veille arrêtée");
  await page.goto("/#radar");
  await fullRadar(page);
  await expect(page.getByTestId("collector-alert")).toContainText("aucune nouvelle collecte depuis 4 h");
  await expect(page.getByTestId("sync-status")).toContainText("Collecteur arrêté");
  await page.getByTestId("sync-status").locator(".sync__main").click();
  await expect(page.getByTestId("cycles")).toContainText("planifié (cron)");
  await page.screenshot({ path: `captures/${info.project.name}-22-collecteur-arrete.png` });
});

// ───────────── V0.6 : Garage des légendes ─────────────
async function setProfile(page: Page, edition: "Standard" | "Ultimate", chapter: number) {
  await page.goto("/#profil");
  await page.waitForSelector(".app.is-ready");
  await page.getByRole("radio", { name: edition, exact: true }).click();
  await page.getByTestId(`chapter-${chapter}`).click();
}
async function openGarage(page: Page) {
  await page.goto("/#carte");
  await page.waitForSelector(".app.is-ready");
  await page.waitForFunction(() => !!(window as unknown as { __leonidaMap?: unknown }).__leonidaMap);
  const chip = page.getByTestId("filter-garage");
  if ((await chip.getAttribute("aria-pressed")) !== "true") await chip.click();
}

test("V0.6 : Standard et Ultimate au même chapitre obtiennent des recommandations différentes", async ({ page }, info) => {
  await serveFeed(page, () => load("v5"));
  await start(page, "#profil");
  await setProfile(page, "Standard", 1);
  await page.goto("/#accueil");
  const car = async (id: string) => {
    const all = page.getByTestId("discover-all");
    if ((await all.count()) && /Tout voir/.test((await all.textContent()) ?? "")) await all.click();
    return page.locator(`[data-testid="discover-veh:${id}"]`);
  };
  // V0.14 : les voitures recommandées sont dans « Si tu as le temps »
  await expect(await car("v-maibatsu-penumbra-ff")).toBeVisible();
  await expect(page.locator(".main")).not.toContainText("Dinka Enduro");
  await setProfile(page, "Ultimate", 1);
  await page.goto("/#accueil");
  await expect(page.getByTestId("before-item").filter({ hasText: "Dinka Enduro" })).toContainText("jusqu'au chapitre 1"); // limité dans le temps → « Avant de continuer »
  await page.screenshot({ path: `captures/${info.project.name}-30-accueil-ultimate.png` });
});

test("V0.6 : filtre Voitures cachées — zone approximative, point exact validé, fiche premium", async ({ page }, info) => {
  await serveFeed(page, () => load("v5"));
  await start(page, "#profil");
  await setProfile(page, "Standard", 1);
  await openGarage(page);
  await expect(page.getByTestId("filter-garage")).toContainText("Voitures");
  // point validé : épingle ; zone : pas d'épingle
  await expect(page.locator('[data-testid="marker-veh:v-pegassi-vitello"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="marker-veh:v-maibatsu-penumbra-ff"]')).toHaveCount(0);
  await page.getByTestId("vehicle-v-maibatsu-penumbra-ff").first().click();
  const sheet = page.getByTestId("vehicle-sheet");
  await expect(sheet.getByTestId("vehicle-name")).toHaveText("'97 Maibatsu Penumbra FF");
  // V0.16 (Rare Vehicle Locator) : fiche issue du référentiel vérifié
  await expect(sheet.getByTestId("rvl-precision")).toContainText("Calibré à ±35 m, non testé en jeu");
  await expect(sheet.getByTestId("rvl-location")).toContainText("Vespucci");
  await expect(sheet.getByTestId("compat")).toContainText("Compatible");
  await expect(sheet.getByTestId("rvl-keep")).toContainText("chapitre 2");
  await expect(page.getByTestId("zone-tag")).toContainText(/Zone|Calibré|Parcours/);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `captures/${info.project.name}-31-fiche-auto.png` });
  // exclusivité Ultimate vue par un joueur Standard : consultable, indicateur explicite, jamais « récupérable »
  await sheet.locator(".vmedia__close").click();
  await page.getByTestId("gfilter-ultimate").click();
  await page.getByTestId("vehicle-v-dinka-enduro").first().click();
  await expect(page.getByTestId("vehicle-sheet").getByTestId("ultimate-tag")).toHaveText("ULTIMATE");
  await expect(page.getByTestId("vehicle-sheet").getByTestId("compat")).toContainText("Réservé à l'édition Ultimate");
  await expect(page.getByTestId("vehicle-sheet").getByTestId("v-found")).toBeDisabled();
});

test("V0.6 : repéré → volé → conservé → rangé, persistant après rechargement et visible dans Mon garage", async ({ page }) => {
  await serveFeed(page, () => load("v5"));
  await start(page, "#profil");
  await setProfile(page, "Standard", 1);
  await openGarage(page);
  await page.getByTestId("vehicle-v-maibatsu-penumbra-ff").first().click();
  const sheet = page.getByTestId("vehicle-sheet");
  await sheet.getByTestId("rvl-found").click();
  await expect(sheet.getByTestId("vehicle-state").locator(".is-cur")).toContainText("Repéré");
  await sheet.getByTestId("rvl-got").click(); // « Je l'ai récupéré »
  await expect(sheet.getByTestId("vehicle-state").locator(".is-cur")).toContainText("Volé");
  await sheet.getByTestId("rvl-kept").click(); // « Je l'ai conservé »
  await expect(sheet.getByTestId("vehicle-state").locator(".is-cur")).toContainText("Véhicule personnel");
  await sheet.getByTestId("v-keep").click(); // « Ranger au garage »
  await sheet.getByTestId("v-store").getByRole("button", { name: "Planque" }).click();
  await expect(sheet.getByTestId("vehicle-state").locator(".is-cur")).toContainText("Rangé au garage");
  await page.reload();
  await page.waitForSelector(".app.is-ready");
  await page.goto("/#profil");
  await expect(page.getByTestId("inv-v-maibatsu-penumbra-ff")).toContainText("Rangé au garage");
  await expect(page.getByTestId("inv-v-maibatsu-penumbra-ff")).toContainText("Planque");
  // un véhicule conservé n'est plus recommandé
  await page.goto("/#accueil");
  await expect(page.getByTestId("car-advice-v-maibatsu-penumbra-ff")).toHaveCount(0);
});

test("V0.6 : véhicule d'un chapitre plus avancé masqué (anti-spoiler), révélé au bon chapitre", async ({ page }) => {
  await serveFeed(page, () => load("v5"));
  await start(page, "#profil");
  await setProfile(page, "Ultimate", 1);
  await openGarage(page);
  await expect(page.getByTestId("vehicle-v-grotti-itali-rsx")).toHaveCount(0); // cloneur de clé : chapitre 3
  await expect(page.getByTestId("vehicle-v-grotti-cheetah")).toHaveCount(0); // chapitre 5
  await setProfile(page, "Ultimate", 3);
  await openGarage(page);
  await expect(page.getByTestId("vehicle-v-grotti-itali-rsx").first()).toBeVisible();
  await expect(page.getByTestId("vehicle-v-grotti-cheetah")).toHaveCount(0);
  await expect(page.getByTestId("vehicle-v-dinka-enduro")).toHaveCount(1); // fenêtre dépassée : consultable, plus recommandé
  await page.goto("/#accueil");
  await expect(page.getByTestId("car-advice-v-dinka-enduro")).toHaveCount(0);
});

test("V0.6 : un nouveau véhicule détecté par la veille apparaît sans redéployer l'app", async ({ page }) => {
  let current: unknown = load("v5");
  await serveFeed(page, () => current);
  await start(page, "#carte");
  await openGarage(page);
  await expect(page.getByTestId("vehicle-v-bravado-banshee")).toHaveCount(0);
  current = load("v6");
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.getByTestId("vehicle-v-bravado-banshee").first()).toBeVisible({ timeout: 10_000 });
});
