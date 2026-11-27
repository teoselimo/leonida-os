import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";

/**
 * V0.7.1 — parcours réels (issues #5 et #6) sur le flux de production figé (tests/fixtures/radar-prod.json).
 * Exécutés sous Chromium (iPhone, iPad) ET sous WebKit, le moteur de Safari (projet « iphone-webkit »).
 * LEONIDA AI fonctionne ici sans backend IA : mode direct, annoncé comme tel.
 */
const prod = JSON.parse(readFileSync("tests/fixtures/radar-prod.json", "utf8"));
const isPhone = (page: Page) => (page.viewportSize()?.width ?? 0) < 760;
const ENGLISH_HEADLINE = /\b(how to|where to find|walkthrough|guide to|early money|hidden cars|you need)\b/i;

async function start(page: Page, profile: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  await page.route("**/__live/radar.json*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...prod, generatedAt: new Date().toISOString() }) }));
  await page.addInitScript(
    ({ p, x }) => {
      if (sessionStorage.getItem("__seeded")) return;
      sessionStorage.setItem("__seeded", "1");
      localStorage.clear();
      localStorage.setItem("leonida-os/radar-url", `${location.origin}/__live/radar.json`);
      localStorage.setItem("leonida-os/progress/v1", JSON.stringify({ schema: 1, rev: 7, showDemo: false, done: {}, vehicles: {}, ...x, profile: { pseudo: "Théo", console: "ps5", edition: "standard", preorder: "unknown", chapter: 1, lastMission: "Down to Earth", nextMission: null, missionsDone: ["Down to Earth"], spoilerMode: "strict", ...p } }));
    },
    { p: profile, x: extra },
  );
  await page.goto("/#accueil");
  await page.waitForSelector(".app.is-ready");
  await expect(page.getByTestId("next-mission")).toBeVisible(); // V0.14 : accueil refondu
}

async function ask(page: Page, q: string) {
  if (!(await page.getByTestId("ai-panel").isVisible().catch(() => false))) await page.getByTestId("ai-open").click();
  await page.getByTestId("ai-input").fill(q);
  await page.getByTestId("ai-send").click();
  const a = page.getByTestId("ai-answer").last();
  await expect(a).toBeVisible();
  return a;
}

test("Test 4 — Accueil : prochaine mission, récupérable (ou incertitude honnête), avant, 2 envies, sans anglais", async ({ page }, info) => {
  await start(page, { nextMission: "Clean Up After Donnie" });
  await expect(page.getByTestId("next-mission-name")).toHaveText("Clean Up After Donnie");
  // V0.10 : état de la mission + « Rien à manquer » ; la conversation passe par le bouton LEONIDA (seule entrée)
  await expect(page.getByTestId("mission-upcoming")).toBeVisible(); // V0.14 : pastille d'état
  await expect(page.getByTestId("before")).toBeVisible();
  await expect(page.getByTestId("ai-open")).toBeVisible();
  // V0.14 : « Avant de continuer » (3 visibles au plus) puis « Si tu as le temps » (2 visibles)
  const before = page.getByTestId("before-item");
  expect(await before.count()).toBeGreaterThan(0);
  expect(await before.count()).toBeLessThanOrEqual(3);
  const fun = page.getByTestId("discover-now").locator("li.ml");
  expect(await fun.count()).toBeLessThanOrEqual(2);
  for (const t of await page.locator(".bl__body strong, .ml__body strong").allInnerTexts()) expect(t).not.toMatch(ENGLISH_HEADLINE);
  // un seul écran de décision sur iPhone : mission + première action visibles sans défiler
  if (isPhone(page)) {
    const first = (await before.first().boundingBox())!;
    expect(first.y).toBeLessThan(page.viewportSize()!.height);
  }
  await page.screenshot({ path: `captures/${info.project.name}-50-accueil-briefing.png` });
});

test("prochaine mission jamais inventée : proposition confirmée par le joueur, conservée au rechargement", async ({ page }) => {
  await start(page);
  // V0.14 : proposition dans « Quelle mission ensuite ? », à choisir explicitement
  await expect(page.getByTestId("next-choice")).toContainText("Clear Skies");
  await expect(page.getByTestId("next-mission-name")).toHaveText("Prochaine mission à choisir");
  await page.getByTestId("next-choice").locator("li").filter({ has: page.locator("b", { hasText: /^Clear Skies$/ }) }).getByRole("button").click(); // V0.18 : chaque branche cite l'autre dans sa note
  await expect(page.getByTestId("next-mission-name")).toHaveText("Clear Skies");
  await page.reload();
  await page.waitForSelector(".app.is-ready");
  await expect(page.getByTestId("next-mission-name")).toHaveText("Clear Skies");
});

test("Test 5 — « C'est fait » retire la recommandation, statut conservé après rechargement", async ({ page }) => {
  await start(page, { nextMission: "Tourist Trap" });
  const first = page.getByTestId("before-item").first();
  const name = (await first.locator("strong").first().textContent())!;
  await first.getByTestId("done-btn").click();
  const gone = page.getByTestId("before-item").filter({ hasText: name });
  await expect(gone).toHaveCount(0);
  await page.reload();
  await page.waitForSelector(".app.is-ready");
  await expect(page.getByTestId("before")).toBeVisible();
  await expect(gone).toHaveCount(0);
  // mission terminée ⇒ elle n'est plus « prochaine »
  await page.getByTestId("mission-start").click();
  await page.getByTestId("launch-guard").getByTestId("guard-go").click(); // V0.18.1 : point de non-retour → confirmation
  await page.getByTestId("mission-done").click();
  await page.getByTestId("mission-done-confirm").getByRole("button", { name: "Oui, terminée" }).click();
  await expect(page.getByTestId("next-mission-name")).toHaveText("Prochaine mission à choisir");
});

test("Test 1 — « Je suis sur le point de lancer Find Donnie's Package » : réponse utile, aucun article hors sujet", async ({ page }, info) => {
  await start(page);
  const a = await ask(page, "Je suis sur le point de lancer Find Donnie's Package.");
  await expect(a).toHaveAttribute("data-intent", "before");
  await expect(a).toContainText("Find Donnie's Package");
  await expect(a).toContainText("aucun guide fiable");
  await expect(a).not.toContainText(/fiches? en rapport|Watson Bay|Lost Drugs|masqués/);
  expect(await a.locator(".bubble__actions button").count()).toBeLessThanOrEqual(2);
  await page.screenshot({ path: `captures/${info.project.name}-51-ia-donnie.png` });
});

test("Test 2 — conversation suivie : Penumbra FF puis « Et comment je la conserve ? »", async ({ page }, info) => {
  await start(page);
  await ask(page, "Où trouver la Penumbra FF ?");
  const b = await ask(page, "Et comment je la conserve ?");
  await expect(b).toHaveAttribute("data-intent", "keep");
  await expect(b).toContainText("immatricul");
  // réponse rapide proposée par Leonida
  await b.getByTestId("ai-reply").filter({ hasText: "Et où exactement" }).click();
  const c = page.getByTestId("ai-answer").last();
  await expect(c).toHaveAttribute("data-intent", "where");
  await expect(c).toContainText("Rialto Islands");
  await page.screenshot({ path: `captures/${info.project.name}-52-ia-suivi.png` });
});

test("Parcours continu : Accueil → Préparer ma mission → voiture sympa → carte → c'est fait → Accueil et garage à jour, conversation conservée", async ({ page }, info) => {
  await start(page, { nextMission: "Clean Up After Donnie" });
  const funRows = async () => {
    const all = page.getByTestId("discover-all");
    if ((await all.count()) && /Tout voir/.test((await all.textContent()) ?? "")) await all.click();
    return page.getByTestId("discover-now").locator("li.ml").allInnerTexts().catch(() => [] as string[]);
  };
  const funBefore = await funRows();
  const a = await ask(page, "Je vais lancer Clean Up After Donnie");
  await expect(a).toHaveAttribute("data-intent", "before");
  await expect(a).toContainText("Clean Up After Donnie");
  await a.getByTestId("ai-reply").filter({ hasText: "voiture sympa" }).click();
  const b = page.getByTestId("ai-answer").last();
  await expect(b).toHaveAttribute("data-intent", "fun");
  const label = (await b.getByTestId("ai-action-focus_vehicle").first().innerText()).trim();
  await b.getByTestId("ai-action-focus_vehicle").first().click();
  await expect(page).toHaveURL(/#carte$/);
  const sheet = page.getByTestId("vehicle-sheet");
  await expect(sheet).toBeVisible();
  await expect(page.getByTestId("zone-tag")).toContainText(/Zone|Calibré|Parcours/);
  await page.waitForFunction(() => (window as unknown as { __leonidaMapCount?: number }).__leonidaMapCount === 1);
  await sheet.locator('[data-testid="v-found"], [data-testid="rvl-found"]').first().click(); // repéré
  // régression V0.7 : sur la carte iPhone, la notification était étirée entre deux ancrages et masquait la fiche
  const toast = page.locator(".toast");
  if (await toast.count()) expect((await toast.boundingBox())!.height).toBeLessThan(140);
  await sheet.locator('[data-testid="v-found"]:not([disabled]), [data-testid="rvl-got"]').first().click(); // volé / récupéré
  await expect(sheet.getByTestId("vehicle-state").locator(".is-cur")).toContainText("Volé");
  await page.screenshot({ path: `captures/${info.project.name}-53-parcours-carte.png` });
  await sheet.locator(".vmedia__close").click();
  await page.getByTestId("nav-accueil").click();
  await expect(page.getByTestId("next-mission")).toBeVisible();
  const funAfter = await funRows();
  const name = label.split(" ").slice(-1)[0];
  expect(funBefore.join(" ")).toContain(name);
  expect(funAfter.join(" ")).not.toContain(name); // le véhicule récupéré n'est plus proposé
  // la conversation est conservée au retour (iPad : le panneau latéral est resté ouvert à côté de la carte)
  if (!(await page.getByTestId("ai-panel").isVisible().catch(() => false))) await page.getByTestId("ai-open").click();
  expect(await page.getByTestId("ai-answer").count()).toBeGreaterThanOrEqual(2);
});

test("Test 9 — IA générative non déployée : annoncé honnêtement, aucun appel externe, l'assistant reste utile", async ({ page }) => {
  const external: string[] = [];
  page.on("request", (r) => {
    if (/anthropic|openai|mistral|generativelanguage|workers\.dev/i.test(r.url())) external.push(r.url());
  });
  await start(page);
  await page.getByTestId("ai-open").click();
  await expect(page.getByTestId("ai-mode")).toContainText("sans IA générative");
  const a = await ask(page, "Je veux gagner 5000 $");
  await expect(a).toHaveAttribute("data-intent", "money");
  await expect(a).toHaveAttribute("data-llm", "off");
  expect(external).toEqual([]);
});

test("Test 8 — clavier : la saisie reste visible et la conversation défile jusqu'au dernier message", async ({ page }) => {
  await start(page);
  for (const q of ["Je vais lancer Tourist Trap", "Et après ?", "Une arme gratuite ?"]) await ask(page, q);
  await page.getByTestId("ai-input").focus();
  if (isPhone(page)) await expect(page.locator(".sheet")).toHaveAttribute("data-settled", "true");
  await page.waitForTimeout(400);
  const vp = page.viewportSize()!;
  const input = (await page.getByTestId("ai-input").boundingBox())!;
  expect(input.y + input.height).toBeLessThanOrEqual(vp.height);
  const last = (await page.getByTestId("ai-answer").last().boundingBox())!;
  const list = (await page.getByTestId("ai-list").boundingBox())!;
  expect(last.y).toBeLessThan(list.y + list.height); // le dernier message est dans la zone visible
});
