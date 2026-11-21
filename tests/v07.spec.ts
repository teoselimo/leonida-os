import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * V0.7 — critères d'acceptation de l'issue #2, sur le flux de production figé (tests/fixtures/radar-prod.json).
 * LEONIDA AI fonctionne ici SANS aucune clé : moteur « recherche d'abord » local.
 */
const FEED_URL = "http://localhost:4321/__live/radar.json";
const prod = JSON.parse(readFileSync("tests/fixtures/radar-prod.json", "utf8"));
const isPhone = (page: Page) => (page.viewportSize()?.width ?? 0) < 760;

async function start(page: Page, profile: Record<string, unknown>, done: Record<string, string> = {}, hash = "#accueil") {
  await page.route("**/__live/radar.json*", (route) => {
    const now = new Date().toISOString();
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...prod, generatedAt: now }) });
  });
  await page.addInitScript(
    ({ u, p, d }) => {
      if (sessionStorage.getItem("__seeded")) return;
      sessionStorage.setItem("__seeded", "1");
      localStorage.clear();
      localStorage.setItem("leonida-os/radar-url", u);
      localStorage.setItem("leonida-os/progress/v1", JSON.stringify({ schema: 1, rev: 7, showDemo: false, done: d, profile: { pseudo: "Théo", console: "ps5", edition: "standard", preorder: "unknown", chapter: 1, lastMission: null, missionsDone: [], spoilerMode: "strict", ...p } }));
    },
    { u: FEED_URL, p: profile, d: done },
  );
  await page.goto(`/${hash}`);
  await page.waitForSelector(".app.is-ready");
}

async function ask(page: Page, q: string) {
  await page.getByTestId("ai-open").click();
  await expect(page.getByTestId("ai-panel")).toBeVisible();
  await page.getByTestId("ai-input").fill(q);
  await page.getByTestId("ai-input").press("Enter");
  const a = page.getByTestId("ai-answer").last();
  await expect(a).toBeVisible();
  return a;
}

const mapCount = (page: Page) => page.evaluate(() => (window as unknown as { __leonidaMapCount?: number }).__leonidaMapCount ?? 0);

test("PS5 Standard ch.1 après « Down to Earth », Shirley et perroquet faits : arme gratuite sourcée → carte", async ({ page }, info) => {
  const parrot = prod.items.find((r: { title: string }) => /Three Sheets|Parrot/i.test(r.title));
  await start(page, { lastMission: "Down to Earth", missionsDone: ["Down to Earth", "Get Shirley's Rum"] }, parrot ? { [parrot.id]: "2026-11-21T10:00:00Z" } : {});
  const a = await ask(page, "Quelle arme gratuite puis-je récupérer maintenant ?");
  await expect(a).toHaveAttribute("data-intent", "weapon");
  await expect(a).toContainText("SM-69");
  await expect(a.locator("a[href^='https://']").first()).toBeVisible(); // source citée
  await expect(a).not.toContainText("Shirley");
  await page.screenshot({ path: `captures/${info.project.name}-40-ia-arme.png` });
  await a.getByTestId("ai-action-show_place").click();
  await expect(page).toHaveURL(/#carte$/);
  await expect(page.getByTestId("landmark")).toContainText("Phil's Ammu-Nation");
});

test("« voiture Fast & Furious » : zone + fiche Penumbra + conseil pour la garder, sans recréer la carte ni perdre les filtres", async ({ page }, info) => {
  await start(page, {}, {}, "#carte");
  await page.waitForFunction(() => !!(window as unknown as { __leonidaMap?: unknown }).__leonidaMap);
  await page.getByTestId("filter-landmarks").click(); // un filtre choisi par le joueur
  await expect(page.getByTestId("filter-landmarks")).toHaveAttribute("aria-pressed", "false");
  const a = await ask(page, "Où trouver la voiture de Fast & Furious ?");
  await expect(a).toContainText("Penumbra FF");
  await expect(a).toContainText("pas un point exact");
  await a.getByTestId("ai-action-focus_vehicle").click();
  const sheet = page.getByTestId("vehicle-sheet");
  await expect(sheet.getByTestId("vehicle-name")).toHaveText("'97 Maibatsu Penumbra FF");
  await expect(sheet.getByTestId("v-keep-text")).toContainText("chapitre 2");
  await expect(page.getByTestId("zone-tag")).toContainText("Zone approximative");
  expect(await mapCount(page)).toBe(1);
  await page.waitForTimeout(700);
  await page.screenshot({ path: `captures/${info.project.name}-41-ia-fast-furious.png` });
  await sheet.locator(".vmedia__close").click();
  await page.getByTestId("filter-garage").click(); // retour aux lieux
  await expect(page.getByTestId("filter-landmarks")).toHaveAttribute("aria-pressed", "false");
  expect(await mapCount(page)).toBe(1);
});

test("chapitre 5 : aucune injonction Shirley, ni sur l'accueil ni dans l'IA", async ({ page }) => {
  await start(page, { chapter: 5 });
  await expect(page.getByTestId("live-advice")).toBeVisible();
  // la planque reste mentionnée comme simple information (la source dit qu'on ne rate rien), jamais comme urgence
  await expect(page.getByTestId("live-advice")).not.toContainText("À faire avant de continuer");
  await expect(page.getByTestId("live-advice")).not.toContainText("Pendant « Get Shirley's Rum »");
  const a = await ask(page, "Je peux lancer ma prochaine mission sans rien manquer ?");
  await expect(a).not.toContainText("Shirley");
});

test("« c'est fait » : rien n'est modifié avant la confirmation du joueur", async ({ page }) => {
  await start(page, {});
  const a = await ask(page, "Quelle arme gratuite puis-je récupérer maintenant ?");
  await a.getByTestId("ai-action-mark_done").click();
  await expect(page.getByTestId("ai-confirm")).toBeVisible();
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem("leonida-os/progress/v1")!).done);
  expect(Object.keys(before)).toHaveLength(0);
  await page.getByTestId("ai-confirm").getByRole("button", { name: "Confirmer" }).click();
  await expect.poll(async () => Object.keys(await page.evaluate(() => JSON.parse(localStorage.getItem("leonida-os/progress/v1")!).done)).length).toBe(1);
});

test("historique local effaçable ; aucune requête vers un fournisseur d'IA depuis le navigateur", async ({ page }) => {
  const external: string[] = [];
  page.on("request", (r) => {
    const u = r.url();
    if (/anthropic|openai|mistral|generativelanguage|api\.groq|workers\.dev/i.test(u)) external.push(u);
  });
  await start(page, {});
  await ask(page, "Comment acheter une voiture ?");
  expect(await page.evaluate(() => localStorage.getItem("leonida-os/ai-history/v1"))).toContain("acheter");
  await page.getByTestId("ai-clear").click();
  await expect(page.getByTestId("ai-answer")).toHaveCount(0);
  expect(external).toEqual([]);
});

test("build statique : aucune clé ni secret d'IA embarqué", async ({}, info) => {
  test.skip(info.project.name !== "iphone", "vérification unique");
  const files: string[] = [];
  const walk = (d: string) => readdirSync(d).forEach((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : /\.(js|html|json|txt)$/.test(f) && files.push(join(d, f))));
  walk(process.env.SERVE_DIR || "out");
  const bad = /sk-ant-[A-Za-z0-9_-]{10,}|sk-[A-Za-z0-9]{32,}|ANTHROPIC_API_KEY|OPENAI_API_KEY|x-api-key/;
  const hits = files.filter((f) => !f.includes("/data/") && bad.test(readFileSync(f, "utf8")));
  expect(hits).toEqual([]);
});

test("rendu : dock, bouton IA et carte « à la une » ne se chevauchent pas", async ({ page }, info) => {
  await start(page, { edition: "ultimate" });
  await expect(page.getByTestId("live-advice")).toBeVisible();
  const fab = (await page.getByTestId("ai-open").boundingBox())!;
  const nav = (await page.locator(".nav").boundingBox())!;
  if (isPhone(page)) expect(fab.x).toBeGreaterThanOrEqual(nav.x + nav.width); // bouton IA à côté du dock, jamais dessus
  await page.screenshot({ path: `captures/${info.project.name}-42-accueil-v07.png` });
});
