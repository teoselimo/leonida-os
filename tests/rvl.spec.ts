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
  await expect(sheet.getByTestId("rvl-precision")).toContainText("zone documentée");
  await expect(sheet.getByTestId("rvl-presence")).toContainText("Toujours au même endroit");
  await expect(sheet.getByTestId("rvl-trust")).toContainText("Vérifié");
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
  await expect(sheet.getByTestId("rvl-mine")).toHaveCount(1);
  await page.reload();
  await page.waitForSelector(".app.is-ready");
  const s = await saved(page);
  expect(s.vehicles["v-maibatsu-penumbra-ff"].state).toBe("registered");
  expect(s.proofs["v-maibatsu-penumbra-ff"]).toHaveLength(1);
  expect(s.done["real:keep"]).toBe("2026-11-20T10:00:00Z"); // l'existant n'est pas écrasé
  expect(s.profile.chapter).toBe(2);
});

test("Voir sur la carte : la zone est cadrée, pas d'épingle exacte", async ({ page }) => {
  await start(page, { chapter: 1 });
  await page.getByTestId("vehicle-v-maibatsu-penumbra-ff").first().click();
  await page.getByTestId("vehicle-sheet").getByTestId("rvl-map").click();
  await expect(page.locator('[data-testid="marker-veh:v-maibatsu-penumbra-ff"]')).toHaveCount(0);
  await expect(page.getByTestId("zone-tag")).toBeVisible();
});

test("anti-spoiler chapitre 1 : les cibles de la série restent masquées, sans nom de mission ni de donneur", async ({ page }) => {
  await start(page, { chapter: 1 });
  await expect(page.getByTestId("vehicle-v-bf-bandito")).toHaveCount(0);
  await expect(page.getByTestId("vehicle-v-declasse-vamos")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("Daily Driver");
  await expect(page.locator("body")).not.toContainText("Moses");
});

test("chapitre 2 avant la mission : visible, « Après une mission », Bandito en mouvement, Vamos sans carte", async ({ page }, info) => {
  await start(page, { chapter: 2, spoilerMode: "relaxed" });
  await page.getByTestId("vehicle-v-bf-bandito").first().click();
  let sheet = page.getByTestId("vehicle-sheet");
  await expect(sheet.getByTestId("rvl-access")).toContainText("Après une mission");
  await expect(sheet.getByTestId("rvl-presence")).toContainText("pas garanti");
  await page.screenshot({ path: `captures/${info.project.name}-rvl-bandito.png` });
  await sheet.locator(".vmedia__close").click();
  await page.getByTestId("vehicle-v-declasse-vamos").first().click();
  sheet = page.getByTestId("vehicle-sheet");
  await expect(sheet.getByTestId("rvl-precision")).toContainText("Position inconnue");
  await expect(sheet.getByTestId("rvl-map")).toBeDisabled();
  await expect(sheet.getByTestId("rvl-howto")).toContainText("2727");
});
