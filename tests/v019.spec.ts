import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";

/**
 * V0.19 — Visual Grounding dans le chat (iPhone, iPad, WebKit). Claude SIMULÉ : la 1re passe rend des indices,
 * la 2de une réponse ; on vérifie l'app (ancrage, carte de reconnaissance, mémoire, Markdown, garde-fou), pas le modèle.
 */
const prod = JSON.parse(readFileSync("tests/fixtures/radar-prod.json", "utf8"));
const SAVE = { schema: 1, rev: 9, showDemo: false, done: {}, vehicles: {}, profile: { pseudo: "Théo", console: "ps5", edition: "ultimate", preorder: "yes", chapter: 1, lastMission: "Talk to Lucia", nextMission: null, missionInProgress: false, missionsDone: ["Swamped", "Don Gone", "Talk to Lucia"], spoilerMode: "strict" } };
const EXTRACT = JSON.stringify({ type: "scène", gta6: "oui", indices: ["pick_up", "vehicule_jaune", "bateau_sur_cales", "palmiers", "maison_sur_pilotis", "escalier_exterieur"], textes: [], vehicules: ["pick-up jaune"], resume: "pick-up jaune devant une maison sur pilotis, bateau sur cales" });
const ANSWER = 'Ça ressemble à **Jason\'s House**, ta première planque à Key Lento.\n@@@\n{"identification":{"candidat":"jasons-house","confiance":"élevée"},"indices":["maison sur pilotis","Ganado jaune","bateau sur cales"],"action":"Vérifie le panier de basket au pied de l\'escalier"}';

async function start(page: Page, profile: Record<string, unknown> = {}) {
  await page.route("**/__live/radar.json*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...prod, generatedAt: new Date().toISOString() }) }));
  await page.addInitScript(([s, ex, an]) => {
    const w = window as unknown as { claude: unknown; __calls: Array<{ text: string; images: number }> };
    w.__calls = [];
    const sample = async (m: Array<{ content: string }>, o?: { images?: Blob[] }) => {
      const last = m.at(-1)!.content;
      w.__calls.push({ text: last, images: o?.images?.length ?? 0 });
      return { text: last.includes("MODE EXTRACTION") ? ex : /D[ée]taille/.test(last.slice(-200)) ? "### Pourquoi\n- **Pilotis** et escalier extérieur\n- *Ganado* jaune (édition Ultimate)\n@@@\n{}" : an, truncated: false };
    };
    (sample as unknown as { limits: unknown }).limits = async () => ({ images: { maxCount: 5, maxInputBytes: 5_000_000, mediaTypes: ["image/jpeg", "image/png"] } });
    w.claude = { use: async (n: string) => (n === "sample" ? sample : null) };
    if (sessionStorage.getItem("__seeded")) return;
    sessionStorage.setItem("__seeded", "1");
    localStorage.clear();
    localStorage.setItem("leonida-os/radar-url", `${location.origin}/__live/radar.json`);
    localStorage.setItem("leonida-os/progress/v1", JSON.stringify(s));
  }, [{ ...SAVE, profile: { ...SAVE.profile, ...profile } }, EXTRACT, ANSWER] as const);
  await page.goto("/#accueil");
  await page.waitForSelector(".app.is-ready");
}
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64");

test("capture → reconnaissance ancrée (Jason's House, confiance, indices), Markdown lisible, suivi « Détaille », « Montre-moi le lieu » sans appel", async ({ page }, info) => {
  await start(page);
  await page.getByTestId("ai-open").click();
  await page.getByTestId("file-capture").setInputFiles({ name: "maison.png", mimeType: "image/png", buffer: PNG });
  await page.getByTestId("ai-input").fill("C'est quoi cette maison ?");
  await page.getByTestId("ai-send").click();
  const card = page.getByTestId("ai-grounding").last();
  await expect(card.getByTestId("grounding-name")).toHaveText("Jason's House");
  await expect(card).toHaveAttribute("data-confidence", "élevée");
  await expect(card).toContainText("Ganado jaune");
  const bubble = page.getByTestId("ai-answer").last();
  await expect(bubble).not.toContainText("**"); // Markdown rendu
  await expect(bubble.locator("strong", { hasText: "Jason's House" })).toHaveCount(1);
  await expect(bubble).not.toContainText(/Family Savings|Tourist Trap/); // pas de récitation Story pour une question de lieu
  const calls = await page.evaluate(() => (window as unknown as { __calls: Array<{ text: string; images: number }> }).__calls);
  expect(calls).toHaveLength(2);
  expect(calls[0].text).toContain("MODE EXTRACTION");
  await page.screenshot({ path: `captures/${info.project.name}-v019-1-reconnaissance.png` });
  // suivi : l'image reste en mémoire vive
  await page.getByTestId("ai-input").fill("Détaille.");
  await page.getByTestId("ai-send").click();
  await expect(page.getByTestId("ai-answer").last().locator(".rt__h")).toContainText("Pourquoi");
  await expect(page.getByTestId("ai-answer").last().locator(".rt li")).toHaveCount(2);
  const calls2 = await page.evaluate(() => (window as unknown as { __calls: Array<{ images: number }> }).__calls);
  expect(calls2).toHaveLength(3);
  // V0.20.1 : le suivi renvoie la capture ET les mêmes photos de référence GTADB que la 1re réponse
  expect(calls2[2].images).toBe(calls2[1].images);
  expect(calls2[2].images).toBeGreaterThanOrEqual(1);
  // « montre-moi le lieu » : local, bouton carte
  await page.getByTestId("ai-input").fill("Montre-moi le lieu.");
  await page.getByTestId("ai-send").click();
  await expect(page.getByTestId("ai-answer").last()).toContainText("Voici Jason's House sur la carte");
  expect(await page.evaluate(() => (window as unknown as { __calls: unknown[] }).__calls.length)).toBe(3);
  await page.screenshot({ path: `captures/${info.project.name}-v019-2-suivi.png` });
});

test("garde-fou centralisé : le menu d'état « En cours » de l'en-tête passe aussi par la confirmation du point de non-retour", async ({ page }) => {
  await start(page, { nextMission: "Tourist Trap" });
  await page.getByTestId("mission-upcoming").click();
  await page.getByTestId("mission-state-live").click();
  await expect(page.getByTestId("launch-guard")).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("leonida-os/progress/v1")!).profile.missionInProgress)).toBe(false);
  await page.getByTestId("guard-go").click();
  await expect(page.getByTestId("mission-live")).toBeVisible();
});
