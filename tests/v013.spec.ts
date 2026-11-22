import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";

/**
 * V0.13 — bout en bout (iPhone, iPad, WebKit) : carte des établissements (B, C, repère manuel), « À découvrir
 * maintenant » (D, E), défilement du chat (F). Claude simulé (runtime Artifact), pas de connecteur web dans cette vue.
 * Progression de départ : la sauvegarde réelle du 22/11 (Swamped et Don Gone terminées, « Talk to Lucia » prévue).
 */
const prod = JSON.parse(readFileSync("tests/fixtures/radar-prod.json", "utf8"));
const isPhone = (page: Page) => (page.viewportSize()?.width ?? 0) < 760;

async function start(page: Page, hash = "#accueil", history: unknown[] = []) {
  await page.route("**/__live/radar.json*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...prod, generatedAt: new Date().toISOString() }) }));
  await page.addInitScript((hist) => {
    const w = window as unknown as { claude: unknown };
    const sample = async () => ({ text: "Réponse de test.\n@@@\n{}" });
    w.claude = { use: async (n: string) => (n === "sample" ? sample : null) };
    if (sessionStorage.getItem("__seeded")) return;
    sessionStorage.setItem("__seeded", "1");
    localStorage.clear();
    localStorage.setItem("leonida-os/radar-url", `${location.origin}/__live/radar.json`);
    localStorage.setItem("leonida-os/ai-history/v2", JSON.stringify(hist));
    localStorage.setItem(
      "leonida-os/progress/v1",
      JSON.stringify({ schema: 1, rev: 7, showDemo: false, done: {}, vehicles: {}, profile: { pseudo: "Théo", console: "ps5", edition: "ultimate", preorder: "yes", chapter: 1, lastMission: "Don Gone", nextMission: "Talk to Lucia", missionInProgress: false, missionsDone: ["Swamped", "Don Gone"], spoilerMode: "strict" } }),
    );
  }, history);
  await page.goto(`/${hash}`);
  await page.waitForSelector(".app.is-ready");
}
async function say(page: Page, q: string) {
  if (!(await page.getByTestId("ai-panel").isVisible().catch(() => false))) await page.getByTestId("ai-open").click();
  const n = await page.getByTestId("ai-answer").count();
  await page.getByTestId("ai-input").fill(q);
  await page.getByTestId("ai-send").click();
  const a = page.getByTestId("ai-answer").nth(n);
  await expect(a.getByTestId("ai-engine")).toBeAttached({ timeout: 15_000 });
  return a;
}

test("B — « Montre-moi les magasins sur la carte » : tous les établissements connus listés, y compris sans position (fiche + source, pas de faux point)", async ({ page }) => {
  await start(page);
  const a = await say(page, "Montre-moi les magasins de vêtements de Key Lento sur la carte");
  await a.getByTestId("ai-action-show_place").filter({ hasText: /Voir les \d+/ }).click();
  await expect(page).toHaveURL(/#carte$/);
  const res = page.getByTestId("search-results");
  for (const id of ["billies-gift-shop", "wonder-whale", "key-lento-kahuna", "leroys", "chucks-tackle-shot"]) await expect(res.getByTestId(`est-${id}`)).toBeVisible();
  await expect(res.getByTestId("est-billies-gift-shop")).toHaveAttribute("data-precision", "inconnue");
  await expect(res.getByTestId("est-wonder-whale")).toHaveAttribute("data-precision", "repere");
  await res.getByTestId("est-billies-gift-shop").click();
  const card = page.getByTestId("est-card");
  await expect(card).toHaveAttribute("data-precision", "inconnue");
  await expect(card.getByTestId("est-precision")).toContainText("Position inconnue");
  await expect(card.locator("a").first()).toHaveAttribute("href", /^https:\/\//);
  await expect(page.getByTestId("zone-tag")).toHaveCount(0); // aucun cercle, aucune zone de quartier
});

test("C — plus de zone géante : une zone restreinte (Chuck's) ou un point (Wonder Whale), jamais tout Key Lento", async ({ page }) => {
  await start(page, "#carte");
  await page.getByTestId("search-btn").click();
  await page.getByTestId("search-input").fill("Chuck's");
  await page.getByTestId("est-chucks-tackle-shot").click();
  await expect(page.getByTestId("est-card")).toHaveAttribute("data-precision", "zone");
  await expect(page.getByTestId("zone-tag")).toContainText("Zone estimée · Chuck's Tackle & Shot (Ammu-Nation)");
  if (isPhone(page)) {
    await page.getByTestId("search-btn").click();
    await page.getByTestId("search-input").fill("Wonder Whale");
    await page.getByTestId("est-wonder-whale").click();
    await expect(page.getByTestId("zone-tag")).toContainText("Repère communautaire · The Wonder Whale");
  }
});

test("Repère manuel : « Je l'ai trouvé » → point posé depuis la carte, sauvegardé avec sa provenance, retirable", async ({ page }) => {
  await start(page, "#carte");
  await page.getByTestId("search-btn").click();
  await page.getByTestId("search-input").fill("Kahuna");
  await page.getByTestId("est-key-lento-kahuna").click();
  await page.getByTestId("est-place").click();
  await expect(page.getByTestId("pin-bar")).toBeVisible();
  await page.getByTestId("pin-center").click();
  const card = page.getByTestId("est-card");
  await expect(card).toHaveAttribute("data-precision", "joueur");
  await expect(card.getByTestId("est-precision")).toContainText("placé par toi en jeu");
  const pins = await page.evaluate(() => JSON.parse(localStorage.getItem("leonida-os/progress/v1")!).pins);
  expect(pins["key-lento-kahuna"]).toMatchObject({ by: "joueur" });
  expect(Number.isFinite(pins["key-lento-kahuna"].x)).toBe(true);
  await card.getByTestId("est-unpin").click();
  await card.getByTestId("est-unpin-confirm").click();
  await expect(card).toHaveAttribute("data-precision", "inconnue");
});

test("D + E — accueil « À découvrir maintenant » : sous la mission, priorités, détail ; « Fait » confirmé retire l'élément et garde sa date", async ({ page }) => {
  await start(page);
  // V0.14 : pertes définitives dans la liste unique « Avant de continuer », juste sous la mission
  const sec = page.getByTestId("before");
  await expect(sec).toBeVisible();
  const mission = (await page.getByTestId("next-mission").boundingBox())!;
  const box = (await sec.boundingBox())!;
  expect(box.y).toBeGreaterThan(mission.y);
  if (isPhone(page)) expect(box.y - (mission.y + mission.height)).toBeLessThan(60);
  const rows = sec.getByTestId("before-item");
  expect(await rows.count()).toBeGreaterThanOrEqual(2);
  expect(await rows.count()).toBeLessThanOrEqual(3);
  await expect(rows.first()).toContainText("Vérifié");
  await expect(sec).not.toContainText("Tourist Trap");
  const name = (await rows.first().locator("strong").first().innerText()).trim();
  await rows.first().locator(".bl__body").click();
  await expect(sec.getByTestId("before-detail")).toBeVisible();
  const before = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("leonida-os/progress/v1")!).done));
  await rows.first().getByTestId("done-btn").click();
  await expect(sec.getByText(name, { exact: true })).toHaveCount(0);
  const done = await page.evaluate(() => JSON.parse(localStorage.getItem("leonida-os/progress/v1")!).done);
  const added = Object.keys(done).filter((k) => !before.includes(k));
  expect(added.length).toBe(1);
  expect(typeof done[added[0]]).toBe("string"); // date conservée
  const profile = await page.evaluate(() => JSON.parse(localStorage.getItem("leonida-os/progress/v1")!).profile);
  expect(profile.missionsDone).toEqual(["Swamped", "Don Gone"]);
});

const longHistory = Array.from({ length: 30 }, (_, i) =>
  i % 2 === 0
    ? { id: i + 1, role: "user", text: `Question numéro ${i / 2 + 1} : où en suis-je dans Leonida ?` }
    : { id: i + 1, role: "ai", engine: "direct", a: { intent: "unknown", text: `Réponse ${Math.ceil(i / 2)}. ${"Un paragraphe assez long pour occuper plusieurs lignes à l'écran du téléphone. ".repeat(3)}`, reliability: null, sources: [], actions: [] } },
);
const gap = (page: Page) => page.getByTestId("ai-list").evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);

test("F — chat : à l'ouverture (et après rechargement) le dernier message est affiché ; pendant la lecture, rien ne force le bas", async ({ page }) => {
  await start(page, "#accueil", longHistory);
  await page.getByTestId("ai-open").click();
  if (isPhone(page)) await expect(page.getByTestId("ai-sheet")).toHaveAttribute("data-settled", "true");
  await expect.poll(() => gap(page)).toBeLessThan(80);
  await expect(page.getByTestId("ai-list").getByText("Réponse 15.", { exact: false })).toBeInViewport();
  // le joueur remonte lire : un redimensionnement (clavier, rotation) ne le ramène pas en bas
  await page.getByTestId("ai-list").evaluate((el) => {
    el.dispatchEvent(new WheelEvent("wheel", { deltaY: -4000, bubbles: true })); // geste du joueur
    el.scrollTop = 0;
  });
  await page.waitForTimeout(150);
  await page.setViewportSize({ width: page.viewportSize()!.width, height: page.viewportSize()!.height - 60 });
  await page.waitForTimeout(300);
  expect(await page.getByTestId("ai-list").evaluate((el) => el.scrollTop)).toBeLessThan(40);
  // fermer puis rouvrir : retour direct au dernier message
  if (isPhone(page)) {
    await page.getByTestId("ai-close").click();
    await page.getByTestId("ai-open").click();
    await expect(page.getByTestId("ai-sheet")).toHaveAttribute("data-settled", "true");
    await expect.poll(() => gap(page)).toBeLessThan(80);
  }
  // envoi d'un message : on suit jusqu'à la réponse
  await say(page, "Et maintenant ?");
  await expect.poll(() => gap(page)).toBeLessThan(80);
  // rechargement : historique et position corrects
  await page.reload();
  await page.waitForSelector(".app.is-ready");
  await page.getByTestId("ai-open").click();
  if (isPhone(page)) await expect(page.getByTestId("ai-sheet")).toHaveAttribute("data-settled", "true");
  await expect.poll(() => gap(page)).toBeLessThan(80);
  await expect(page.getByTestId("ai-list")).toContainText("Et maintenant ?");
});
