import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";

/** Rare Vehicle Locator V1 · Sprint 1 — parcours iPhone / iPad, sauvegarde, anti-spoiler. */
const prod = JSON.parse(readFileSync("tests/fixtures/radar-prod.json", "utf8"));
const KEY = "leonida-os/progress/v1";

async function start(page: Page, profile: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  await page.route("**/__live/radar.json*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...prod, generatedAt: new Date().toISOString() }) }));
  await page.addInitScript(
    ([p, e, k]) => {
      (window as unknown as { claude: unknown }).claude = { use: async () => null };
      if (sessionStorage.getItem("__s")) return;
      sessionStorage.setItem("__s", "1");
      localStorage.clear();
      localStorage.setItem("leonida-os/radar-url", `${location.origin}/__live/radar.json`);
      localStorage.setItem(k as string, JSON.stringify({ schema: 1, rev: 7, showDemo: false, done: { "real:keep": "2026-11-20T10:00:00Z" }, vehicles: {}, ...(e as object), profile: { pseudo: "Théo", console: "ps5", edition: "standard", preorder: "no", chapter: 1, lastMission: null, nextMission: null, missionInProgress: false, missionsDone: [], spoilerMode: "strict", ...(p as object) } }));
    },
    [profile, extra, KEY],
  );
  await page.goto("/#carte");
  await page.waitForSelector(".app.is-ready");
  await page.waitForFunction(() => !!(window as unknown as { __leonidaMap?: { loaded(): boolean } }).__leonidaMap?.loaded());
  const chip = page.getByTestId("filter-garage");
  if ((await chip.getAttribute("aria-pressed")) !== "true") await chip.click();
}
const saved = (page: Page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "{}"), KEY);

test("Penumbra FF : zone Vespucci, présence garantie, trouvé → récupéré → conservé, sauvegarde intacte après rechargement", async ({ page }, info) => {
  await start(page, { chapter: 2 });
  await page.getByTestId("vehicle-v-maibatsu-penumbra-ff").first().click();
  const sheet = page.getByTestId("vehicle-sheet");
  await expect(sheet.getByTestId("rvl-access")).toContainText("Accessible maintenant");
  await expect(sheet.getByTestId("rvl-hero")).toBeVisible();
  await expect(sheet.getByTestId("rvl-video")).toHaveAttribute("href", /youtube\.com\/watch/);
  await expect(sheet.getByTestId("rvl-precision")).toContainText("Calibré à ±35 m, non testé en jeu");
  await expect(sheet.getByTestId("rvl-presence")).toContainText("Garantie");
  await expect(sheet.getByTestId("rvl-loc-trust")).toContainText("Calibré ±35 m");
  await expect(sheet.getByTestId("rvl-v016")).toContainText("contenait bien");
  // la capture du joueur devient l'image de la fiche
  await sheet.getByTestId("rvl-hero-file").setInputFiles({ name: "penumbra.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGNgYGD4z8DAwMDAwMDAAAAJAAH3mN0SAAAAAElFTkSuQmCC", "base64") });
  await expect(sheet.getByTestId("rvl-hero-img")).toBeVisible();
  await page.screenshot({ path: `captures/${info.project.name}-rvl-penumbra.png` });
  await sheet.getByTestId("rvl-found").click();
  await sheet.getByTestId("rvl-got").click();
  await expect(sheet.getByTestId("rvl-found")).toBeDisabled();
  await sheet.getByTestId("rvl-kept").click();
  await expect(sheet.getByTestId("rvl-kept")).toContainText("Conservé");
  // preuve par lien : gardée dans la partie, jamais comptée comme source
  await sheet.getByTestId("rvl-proofs-toggle").click();
  await expect(sheet.getByTestId("rvl-ev").first()).toBeVisible();
  await sheet.getByTestId("rvl-add-proof").click();
  await sheet.getByTestId("rvl-link").fill("https://youtu.be/exemple");
  await sheet.getByTestId("rvl-link-ok").click();
  await expect(sheet.getByTestId("rvl-mine")).toHaveCount(2);
  await page.reload();
  await page.waitForSelector(".app.is-ready");
  const s = await saved(page);
  expect(s.vehicles["v-maibatsu-penumbra-ff"].state).toBe("registered");
  expect(s.proofs["v-maibatsu-penumbra-ff"]).toHaveLength(2); // capture-visuel + lien
  expect(s.done["real:keep"]).toBe("2026-11-20T10:00:00Z"); // l'existant n'est pas écrasé
  expect(s.profile.chapter).toBe(2);
});

test("Voir sur la carte : point calibré avec son incertitude, jamais une épingle « validée »", async ({ page }, info) => {
  await start(page, { chapter: 1 });
  await page.getByTestId("vehicle-v-maibatsu-penumbra-ff").first().click();
  await page.getByTestId("vehicle-sheet").getByTestId("rvl-map").click();
  await expect(page.locator('[data-testid="marker-veh:v-maibatsu-penumbra-ff"]')).toHaveCount(0);
  await expect(page.getByTestId("zone-tag")).toContainText("Calibré, non testé ±35 m");
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `captures/${info.project.name}-rvl-carte-penumbra.png` });
});

test("anti-spoiler chapitre 1 : les cibles de la série restent masquées, sans nom de mission ni de donneur", async ({ page }) => {
  await start(page, { chapter: 1 });
  await expect(page.getByTestId("vehicle-v-bf-bandito")).toHaveCount(0);
  await expect(page.getByTestId("vehicle-v-declasse-vamos")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("Daily Driver");
  await expect(page.locator("body")).not.toContainText("Moses");
});

test("chapitre 2 : « Après une mission », puis commande à recevoir, puis disponible ; Bandito sur son parcours", async ({ page }, info) => {
  await start(page, { chapter: 2, spoilerMode: "relaxed" });
  await page.getByTestId("vehicle-v-bf-bandito").first().click();
  let sheet = page.getByTestId("vehicle-sheet");
  await expect(sheet.getByTestId("rvl-access")).toContainText("Après une mission");
  await expect(sheet.getByTestId("rvl-presence")).toContainText("Non garantie");
  await expect(sheet.getByTestId("rvl-precision")).toContainText("Parcours tracé");
  await sheet.getByTestId("rvl-map").click();
  await expect(page.getByTestId("zone-tag")).toContainText("Parcours");
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `captures/${info.project.name}-rvl-bandito.png` });
});

test("commande de Moses : reçue confirmée par le joueur, sauvegardée, visible au journal ; Vamos localisé à Grayson", async ({ page }) => {
  await start(page, { chapter: 2, spoilerMode: "relaxed", missionsDone: ["Daily Driver"] });
  await page.getByTestId("vehicle-v-declasse-vamos").first().click();
  const sheet = page.getByTestId("vehicle-sheet");
  await expect(sheet.getByTestId("rvl-access")).toContainText("Commande à recevoir");
  await expect(sheet.getByTestId("rvl-place")).toContainText("Lieu accessible");
  await expect(sheet.getByTestId("rvl-condition")).toContainText("Declasse Yosemite 1500 et Karin Futo");
  await sheet.getByTestId("rvl-order").click();
  await expect(sheet.getByTestId("rvl-access")).toContainText("Accessible maintenant");
  await expect(sheet.getByTestId("rvl-precision")).toContainText("Calibré à ±30 m");
  await expect(sheet.getByTestId("rvl-map")).toBeEnabled();
  await expect(sheet.getByTestId("rvl-howto")).toContainText("2727");
  const s = await saved(page);
  expect(s.done["order:v-declasse-vamos"]).toBeTruthy();
  expect(s.done["real:keep"]).toBe("2026-11-20T10:00:00Z");
});
