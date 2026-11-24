import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";

/**
 * V0.14 — stabilisation et refonte UX (iPhone, iPad, WebKit). Claude simulé, aucun connecteur web dans cette vue.
 * Progression de départ : la sauvegarde réelle du 22/11 (Swamped et Don Gone terminées, « Talk to Lucia » prévue).
 */
const prod = JSON.parse(readFileSync("tests/fixtures/radar-prod.json", "utf8"));
const isPhone = (page: Page) => (page.viewportSize()?.width ?? 0) < 760;
const SAVE = { schema: 1, rev: 7, showDemo: false, done: {}, vehicles: {}, pins: { "wonder-whale": { x: 10, y: 20, at: "2026-11-22T09:00:00Z", by: "joueur" } }, profile: { pseudo: "Théo", console: "ps5", edition: "ultimate", preorder: "yes", chapter: 1, lastMission: "Don Gone", nextMission: "Talk to Lucia", missionInProgress: false, missionsDone: ["Swamped", "Don Gone"], spoilerMode: "strict" } };

async function start(page: Page, hash = "#accueil", save: unknown = SAVE) {
  await page.route("**/__live/radar.json*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...prod, generatedAt: new Date().toISOString() }) }));
  await page.addInitScript((s) => {
    const w = window as unknown as { claude: unknown };
    w.claude = { use: async (n: string) => (n === "sample" ? async () => ({ text: "Réponse de test.\n@@@\n{}" }) : null) };
    if (sessionStorage.getItem("__seeded")) return;
    sessionStorage.setItem("__seeded", "1");
    localStorage.clear();
    localStorage.setItem("leonida-os/radar-url", `${location.origin}/__live/radar.json`);
    localStorage.setItem("leonida-os/progress/v1", JSON.stringify(s));
  }, save);
  await page.goto(`/${hash}`);
  await page.waitForSelector(".app.is-ready");
}
const saved = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("leonida-os/progress/v1")!));

test("1–2 · anti-spoiler : un toucher sur le bouclier ouvre un menu ; baisser la protection demande confirmation ; aucune mission future nommée en strict", async ({ page }) => {
  await start(page);
  await expect(page.locator("body")).not.toContainText("Tourist Trap");
  const shield = page.getByTestId("shield").first();
  await shield.click();
  await expect(page.getByTestId("shield-menu")).toBeVisible();
  expect((await saved(page)).profile.spoilerMode).toBe("strict"); // un toucher ne change rien
  await page.getByTestId("shield-off").click();
  await expect(page.getByTestId("shield-confirm")).toBeVisible();
  await expect(page.getByTestId("shield-confirm")).not.toContainText("Tourist Trap");
  await page.getByTestId("shield-cancel").click();
  expect((await saved(page)).profile.spoilerMode).toBe("strict");
  for (const tab of ["radar", "carte", "profil"]) {
    await page.getByTestId(`nav-${tab}`).click();
    await page.waitForTimeout(300);
    await expect(page.locator(".main")).not.toContainText("Tourist Trap");
  }
});

test("3 · accueil : une seule liste « Avant de continuer », une seule mention du point de non-retour, aucune promesse « rien à manquer »", async ({ page }) => {
  await start(page);
  await expect(page.getByTestId("next-mission-name")).toContainText("Talk to Lucia");
  await expect(page.getByTestId("before-item").first()).toBeVisible();
  expect(await page.getByTestId("pnr").count()).toBeLessThanOrEqual(1);
  await expect(page.locator(".main")).not.toContainText(/tout se perd|rien à manquer/i);
});

test("4 · « J'ai terminé » : confirmation explicite, puis les nouvelles possibilités et le choix de la suite", async ({ page }) => {
  await start(page);
  await page.getByTestId("mission-start").click();
  await page.getByTestId("mission-done").click();
  await expect(page.getByTestId("mission-done-confirm")).toBeVisible();
  expect((await saved(page)).profile.missionsDone).not.toContain("Talk to Lucia");
  await page.getByTestId("mission-done-confirm").getByRole("button", { name: /Oui, terminée/ }).click();
  await expect(page.getByTestId("next-choice")).toBeVisible();
  expect((await saved(page)).profile.missionsDone).toContain("Talk to Lucia");
});

test("5 · « Fait » : retour immédiat + annulation 5 s, puis annulation depuis Partie › Récupéré / Fait", async ({ page }) => {
  await start(page);
  const btn = page.getByTestId("done-btn").first();
  await btn.click();
  await expect(page.getByTestId("toast-undo")).toBeVisible();
  const n1 = Object.keys((await saved(page)).done).length;
  expect(n1).toBe(1);
  await page.getByTestId("toast-undo").click();
  await expect.poll(async () => Object.keys((await saved(page)).done).length).toBe(0);
  await page.getByTestId("done-btn").first().click();
  await page.getByTestId("nav-profil").click();
  const j = page.getByTestId("journal");
  await expect(j.getByTestId("journal-undo").first()).toBeVisible();
  const before = (await saved(page)).done;
  const key = Object.keys(before)[0];
  expect(before[key]).toMatch(/^\d{4}-/); // daté
  await j.locator(`[data-testid="journal-${key}"]`).getByTestId("journal-undo").click();
  await expect.poll(async () => Object.keys((await saved(page)).done).length).toBe(0);
  // une mission principale ne s'annule qu'avec confirmation
  await j.locator('[data-testid="journal-mission:Don Gone"]').getByTestId("journal-undo").click();
  expect((await saved(page)).profile.missionsDone).toContain("Don Gone");
});

test("6–7 · recherche d'un magasin : précision et action ; un établissement sans position n'a pas de faux point", async ({ page }) => {
  await start(page, "#carte");
  await page.getByTestId("search-btn").first().click();
  await page.getByTestId("search-input").fill("Billie");
  const row = page.getByTestId("est-billies-gift-shop");
  await expect(row).toHaveAttribute("data-precision", "inconnue");
  await expect(row).toContainText("Placer");
  await row.click();
  await expect(page.getByTestId("est-card")).toBeVisible();
  await expect(page.getByTestId("zone-tag")).toHaveCount(0);
});

test("8 · dock à cinq positions : Accueil, Carte, LEONIDA, Guide, Partie ; le contenu n'est jamais sous le dock", async ({ page }) => {
  await start(page);
  for (const [id, h] of [["nav-carte", "#carte"], ["nav-radar", "#radar"], ["nav-profil", "#profil"], ["nav-accueil", "#accueil"]]) {
    await page.getByTestId(id).click();
    await expect(page).toHaveURL(new RegExp(`${h}$`));
  }
  await expect(page.getByTestId("ai-open")).toBeVisible();
  await expect(page.locator(".aifab")).toHaveCount(0);
  if (isPhone(page)) {
    await page.locator(".main").evaluate((el) => el.scrollTo(0, 1e6));
    const bottom = await page.locator(".main .screen").evaluate((el) => Math.max(...Array.from(el.querySelectorAll("*")).map((c) => c.getBoundingClientRect()).filter((r) => r.height > 0).map((r) => r.bottom)));
    const dock = await page.locator(".nav").boundingBox();
    expect(bottom).toBeLessThanOrEqual(dock!.y + 2);
  }
});

test("9–10 · chat ouvert depuis la carte (demi-fiche sur iPhone, panneau à côté sur iPad) ; message long au clavier", async ({ page }) => {
  await start(page, "#carte");
  await page.getByTestId("ai-open").click();
  await expect(page.getByTestId("ai-panel")).toBeVisible();
  if (isPhone(page)) {
    const box = await page.getByTestId("ai-sheet").boundingBox();
    expect(box!.y).toBeGreaterThan((page.viewportSize()!.height) * 0.25); // la carte reste visible au-dessus
  } else if (page.viewportSize()!.width >= 1100) {
    // paysage : la carte se range à côté du panneau (fin des transitions attendue)
    await expect.poll(async () => {
      const side = (await page.getByTestId("ai-side").boundingBox())!;
      const map = (await page.locator(".mapsplit__map").boundingBox())!;
      return map.x + map.width - side.x;
    }, { timeout: 3000 }).toBeLessThanOrEqual(2);
  } else await expect(page.getByTestId("ai-scrim")).toBeVisible(); // portrait : volet par-dessus, un toucher à côté le referme
  const long = "Je cherche une arme, un véhicule rapide et un magasin de vêtements, ".repeat(6);
  await page.getByTestId("ai-input").fill(long);
  await expect(page.getByTestId("ai-input")).toHaveValue(long);
  await page.getByTestId("ai-send").click();
  await expect(page.getByTestId("ai-answer").last().getByTestId("ai-engine")).toBeAttached({ timeout: 15_000 });
  // menu : Effacer avec confirmation
  await page.getByTestId("ai-menu").click();
  await page.getByTestId("ai-clear").click();
  await expect(page.getByTestId("ai-answer")).toHaveCount(1);
  await page.getByTestId("ai-clear-ok").click();
  await expect(page.getByTestId("ai-answer")).toHaveCount(0);
});

test("13 · la sauvegarde réelle est restaurée intacte après la mise à jour (positions, missions, coches)", async ({ page }) => {
  await start(page, "#profil", { ...SAVE, done: { "prog:steal-the-scooter": "2026-11-21T20:10:00Z" } });
  const s = await saved(page);
  expect(s.profile.missionsDone).toEqual(["Swamped", "Don Gone"]);
  expect(s.pins["wonder-whale"].at).toBe("2026-11-22T09:00:00Z");
  expect(s.done["prog:steal-the-scooter"]).toBe("2026-11-21T20:10:00Z");
  await expect(page.getByTestId("p-mains")).toHaveText("2");
  await expect(page.getByTestId("journal")).toContainText("Steal the Scooter");
  await page.getByTestId("advanced").locator("summary").click();
  await expect(page.getByTestId("storage-note")).toContainText("uniquement dans ce navigateur"); // hors Artifact : pas de promesse de synchro
  await expect(page.getByTestId("partie-version")).toContainText(/V0\.\d+(\.\d)?/); // version centralisée
});

test("V0.14.1 · iPhone : la zone de saisie n'a plus de fond opaque ; iPad : LEONIDA est une action en bas du rail, pas un onglet", async ({ page }) => {
  await start(page);
  await page.getByTestId("ai-open").click();
  const bg = await page.locator(".ai__input").evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).toBe("rgba(0, 0, 0, 0)");
  if (!isPhone(page)) {
    const ai = (await page.getByTestId("ai-open").boundingBox())!;
    const last = (await page.getByTestId("nav-profil").boundingBox())!;
    expect(ai.y).toBeGreaterThan(last.y + last.height + 40); // séparé des onglets
    await expect(page.getByTestId("ai-open")).toHaveAttribute("aria-pressed", "true");
  }
});

test("V0.14.1 · iPad portrait : accueil en deux colonnes, copilote en volet refermable sans perdre la conversation, inspecteur de carte rempli", async ({ page }) => {
  test.skip(isPhone(page), "iPad seulement");
  await page.setViewportSize({ width: 820, height: 1180 });
  await start(page);
  const main = (await page.locator(".home__main").boundingBox())!;
  const side = (await page.locator(".home__side").boundingBox())!;
  expect(side.x).toBeGreaterThan(main.x + main.width - 2); // colonnes côte à côte
  await page.getByTestId("ai-open").click();
  await expect(page.getByTestId("ai-scrim")).toBeVisible();
  await page.getByTestId("ai-input").fill("Où trouver un magasin de vêtements ?");
  await page.getByTestId("ai-send").click();
  await expect(page.getByTestId("ai-answer").last().getByTestId("ai-engine")).toBeAttached({ timeout: 15_000 });
  await page.getByTestId("ai-scrim").click({ position: { x: 20, y: 600 } });
  await expect(page.getByTestId("ai-scrim")).toHaveCount(0);
  await page.getByTestId("ai-open").click();
  await expect(page.getByTestId("ai-answer")).toHaveCount(1); // conversation conservée
  await page.getByTestId("ai-close").click();
  await page.getByTestId("nav-carte").click();
  await expect(page.getByTestId("map-useful")).toBeVisible();
  await expect(page.getByTestId("map-useful").locator("button").first()).toBeVisible();
});
