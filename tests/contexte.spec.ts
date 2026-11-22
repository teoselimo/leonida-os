import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";

/**
 * V0.12 — scénarios bout en bout dans l'app complète (iPhone, iPad, WebKit), runtime Artifact SIMULÉ pour Claude,
 * sans connecteur web dans cette vue. Progression de départ : Swamped terminée, Don Gone EN COURS.
 */
const prod = JSON.parse(readFileSync("tests/fixtures/radar-prod.json", "utf8"));
type Win = Window & { __calls: { role: string; content: string }[][] };
const isPhone = (page: Page) => (page.viewportSize()?.width ?? 0) < 760;

async function start(page: Page, hash = "#accueil") {
  await page.route("**/__live/radar.json*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...prod, generatedAt: new Date().toISOString() }) }));
  await page.addInitScript(() => {
    const w = window as unknown as Win & { claude: unknown };
    w.__calls = [];
    const sample = async (messages: { role: string; content: string }[]) => {
      w.__calls.push(messages);
      const last = messages.at(-1)!.content;
      if (/Tu prépares les recherches/.test(last)) return { text: '{"web":false,"requetes":[]}' };
      if (/RIEN À MANQUER/.test(last)) return { text: 'Analyse.\n@@@\n{"elements":[]}' };
      return { text: "Réponse de test.\n@@@\n{}" };
    };
    w.claude = { use: async (n: string) => (n === "sample" ? sample : null) };
    if (sessionStorage.getItem("__seeded")) return;
    sessionStorage.setItem("__seeded", "1");
    localStorage.clear();
    localStorage.setItem("leonida-os/radar-url", `${location.origin}/__live/radar.json`);
    localStorage.setItem("leonida-os/progress/v1", JSON.stringify({ schema: 1, rev: 7, showDemo: false, done: {}, vehicles: {}, profile: { pseudo: "Théo", console: "ps5", edition: "standard", preorder: "unknown", chapter: 1, lastMission: "Swamped", nextMission: "Don Gone", missionInProgress: true, missionsDone: ["Swamped"], spoilerMode: "strict" } }));
  });
  await page.goto(`/${hash}`);
  await page.waitForSelector(".app.is-ready");
}
async function say(page: Page, q: string) {
  if (!(await page.getByTestId("ai-panel").isVisible().catch(() => false))) await page.getByTestId("ai-open").click();
  const n = await page.getByTestId("ai-answer").count();
  await page.getByTestId("ai-input").fill(q);
  await page.getByTestId("ai-send").click();
  const a = page.getByTestId("ai-answer").nth(n);
  await expect(a.getByTestId("ai-engine")).toBeVisible({ timeout: 15_000 });
  return a;
}

test("A — « Je peux faire quoi maintenant ? » : Claude reçoit Don Gone en cours et la progression, sans que le joueur la nomme", async ({ page }) => {
  await start(page);
  await say(page, "Je peux faire quoi maintenant ?");
  const turn = await page.evaluate(() => (window as unknown as Win).__calls.at(-1)!.at(-1)!.content);
  expect(turn).toContain("EN COURS : Don Gone");
  expect(turn).toContain("Donnie's H&L .38");
  expect(turn).toContain("Donnie's Lost Drugs");
  expect(turn).not.toContain("Tourist Trap"); // anti-spoiler complet
});

test("B + G — « J'ai terminé » → confirmation → déblocages recalculés ; progression, historique et brouillon conservés au rechargement", async ({ page }) => {
  await start(page);
  const a = await say(page, "J'ai terminé !");
  await a.getByTestId("ai-action-set_mission").click();
  await page.getByTestId("ai-confirm").getByRole("button", { name: "Confirmer" }).click();
  const after = page.getByTestId("ai-answer").last();
  await expect(after).toContainText("« Don Gone » terminée");
  await expect(after).toContainText("Recalibration");
  await expect(after.getByTestId("ai-action-start_mission")).toBeVisible(); // proposée, jamais lancée d'office
  // brouillon d'un message long, puis fermeture accidentelle
  await page.getByTestId("ai-input").fill("Brouillon à garder\nsur deux lignes");
  if (isPhone(page)) await page.getByTestId("ai-close").click();
  await page.waitForTimeout(400);
  await page.reload();
  await page.waitForSelector(".app.is-ready");
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("leonida-os/progress/v1")!).profile);
  expect(saved.missionsDone).toEqual(expect.arrayContaining(["Swamped", "Don Gone"]));
  expect(saved.nextMission).toBeNull();
  expect(saved.missionInProgress).toBe(false);
  await page.getByTestId("ai-open").click();
  await expect(page.getByTestId("ai-input")).toHaveValue("Brouillon à garder\nsur deux lignes");
  await expect(page.getByTestId("ai-list")).toContainText("« Don Gone » terminée");
});

test("C — boutique confirmée : l'action IA ouvre la fiche avec le badge « Établissement confirmé » et ses sources", async ({ page }) => {
  await start(page);
  const a = await say(page, "Meilleurs magasins de vêtements à Key Lento");
  await expect(a).toHaveAttribute("data-intent", "shops");
  await a.getByTestId("ai-action-show_place").first().click();
  await expect(page).toHaveURL(/#carte$/);
  const est = page.getByTestId("establishment");
  await expect(est).toContainText("Établissement confirmé");
  await expect(est.locator("a").first()).toHaveAttribute("href", /^https:\/\//);
});

test("F — message de 1 000 caractères : le champ grandit jusqu'à 6 lignes puis défile, reste éditable, Envoyer toujours visible", async ({ page }) => {
  await start(page);
  await page.getByTestId("ai-open").click();
  if (isPhone(page)) await expect(page.getByTestId("ai-sheet")).toHaveAttribute("data-settled", "true");
  const box = page.getByTestId("ai-input");
  const h1 = (await box.boundingBox())!.height;
  const long = Array.from({ length: 20 }, (_, i) => `Ligne ${i + 1} : je décris ma situation en détail pour LEONIDA.`).join("\n").slice(0, 1000).padEnd(1000, ".");
  await box.fill(long);
  await expect(box).toHaveValue(long);
  const h2 = (await box.boundingBox())!.height;
  expect(h2).toBeGreaterThan(h1 * 2);
  expect(h2).toBeLessThanOrEqual(152);
  const sc = await box.evaluate((el: HTMLTextAreaElement) => ({ overflow: getComputedStyle(el).overflowY, scrollable: el.scrollHeight > el.clientHeight + 4 }));
  expect(sc).toEqual({ overflow: "auto", scrollable: true });
  // revenir au début et corriger
  await box.evaluate((el: HTMLTextAreaElement) => {
    el.focus();
    el.setSelectionRange(0, 0);
    el.scrollTop = 0;
  });
  await page.keyboard.type("CORRECTION ");
  await expect(box).toHaveValue(new RegExp(`^CORRECTION ${long.slice(0, 20)}`));
  const send = (await page.getByTestId("ai-send").boundingBox())!;
  expect(send.y + send.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  await page.getByTestId("ai-send").click();
  await expect(page.locator(".bubble--me").last()).toContainText("Ligne 17");
  expect((await page.locator(".bubble--me").last().innerText()).split("\n").length).toBeGreaterThan(10); // retours à la ligne conservés
  await expect(box).toHaveValue("");
});
