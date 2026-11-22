import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";

/**
 * V0.8 « En partie » — parcours réels dans l'app complète, runtime Artifact SIMULÉ (`window.claude`).
 * Vérifie le câblage et l'UX mobile ; la qualité des réponses du vrai Claude se juge dans l'Artifact publié.
 */
const prod = JSON.parse(readFileSync("tests/fixtures/radar-prod.json", "utf8"));
const isPhone = (page: Page) => (page.viewportSize()?.width ?? 0) < 760;
type Win = Window & { __calls: { role: string; content: string }[][] };

async function start(page: Page, profile: Record<string, unknown> = {}, history: unknown[] = []) {
  await page.route("**/__live/radar.json*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...prod, generatedAt: new Date().toISOString() }) }));
  await page.addInitScript(
    ({ p, h }) => {
      const w = window as unknown as Win & { claude: unknown };
      w.__calls = [];
      const sample = async (messages: { role: string; content: string }[], opts: { onText?: (c: { text: string }) => void }) => {
        w.__calls.push(messages);
        const last = messages[messages.length - 1].content;
        const ids = [...last.matchAll(/"id":"([^"]+)"/g)].map((m) => m[1]);
        const text = /RIEN À MANQUER/.test(last)
          ? `On passe la mission au crible.\n@@@\n{"confiance":"signalé","sources":[],"actions":[],"elements":[{"texte":"Objectif repéré par une source","quand":"pendant","type":"facultatif","priorite":"haute","sources":["${ids[0] ?? "none"}"]}]}`
          : "Bien vu ! On continue.\n@@@\n{\"confiance\":\"non établi\",\"sources\":[],\"actions\":[]}";
        for (let i = 15; i < text.length; i += 15) {
          await new Promise((r) => setTimeout(r, 8));
          opts.onText?.({ text: text.slice(0, i) });
        }
        return { text };
      };
      w.claude = { use: async (n: string) => (n === "sample" ? sample : null) };
      if (sessionStorage.getItem("__seeded")) return;
      sessionStorage.setItem("__seeded", "1");
      localStorage.clear();
      localStorage.setItem("leonida-os/radar-url", `${location.origin}/__live/radar.json`);
      localStorage.setItem("leonida-os/ai-history/v2", JSON.stringify(h));
      localStorage.setItem("leonida-os/progress/v1", JSON.stringify({ schema: 1, rev: 7, showDemo: false, done: {}, vehicles: {}, profile: { pseudo: "Théo", console: "ps5", edition: "standard", preorder: "unknown", chapter: 1, lastMission: "Down to Earth", nextMission: null, missionsDone: ["Down to Earth"], spoilerMode: "strict", ...p } }));
    },
    { p: profile, h: history },
  );
  await page.goto("/#accueil");
  await page.waitForSelector(".app.is-ready");
}

const longHistory = Array.from({ length: 30 }, (_, i) =>
  i % 2 ? { id: i, role: "ai", a: { intent: "x", text: `Réponse numéro ${i} — assez longue pour remplir l'écran du téléphone et obliger la conversation à défiler.`, reliability: null, sources: [], actions: [] } } : { id: i, role: "user", text: `Question ${i}` },
);

test("#12 — conversation longue : on défile dans le fil sans jamais déplacer ni fermer la fiche ; bouton Fermer", async ({ page }) => {
  await start(page, {}, longHistory);
  await page.getByTestId("ai-open").click();
  const list = page.getByTestId("ai-list");
  await expect(list).toBeVisible();
  if (isPhone(page)) {
    const sheet = page.getByTestId("ai-sheet");
    await expect(sheet).toHaveAttribute("data-handle-only", "true");
    await expect(sheet).toHaveAttribute("data-settled", "true");
    const before = await sheet.evaluate((el) => getComputedStyle(el).transform);
    // le fil est bien le conteneur qui défile (un seul conteneur de défilement)
    expect(await list.evaluate((el) => el.scrollHeight > el.clientHeight + 100)).toBe(true);
    await list.evaluate((el) => el.scrollTo({ top: 0 }));
    await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBeLessThan(50);
    // geste « tirer vers le bas » depuis le haut du fil : la fiche ne bouge pas (aucun écouteur de geste sur le contenu)
    await list.evaluate((el) => {
      let t: (y: number) => Touch;
      try {
        new Touch({ identifier: 0, target: el, clientX: 0, clientY: 0 });
        t = (y: number) => new Touch({ identifier: 1, target: el, clientX: 200, clientY: y });
      } catch {
        return; // WebKit headless : pas de constructeur Touch — le contrat « aucun écouteur sur le contenu » reste vérifié par data-handle-only
      }
      el.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, cancelable: true, touches: [t(300)] }));
      for (let y = 310; y <= 700; y += 30) el.dispatchEvent(new TouchEvent("touchmove", { bubbles: true, cancelable: true, touches: [t(y)] }));
      el.dispatchEvent(new TouchEvent("touchend", { bubbles: true, cancelable: true, changedTouches: [t(700)] }));
    });
    await page.waitForTimeout(400);
    await expect(sheet).toBeVisible();
    await expect(sheet).toHaveAttribute("data-snap", "full");
    expect(await sheet.evaluate((el) => getComputedStyle(el).transform)).toBe(before);
    await list.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
    await expect.poll(() => list.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(40);
  }
  await page.getByTestId("ai-close").click();
  await expect(page.getByTestId("ai-open")).toBeVisible();
});

test("Anti-spoiler : complet → léger → aucun, mémorisé au rechargement et transmis à Claude", async ({ page }) => {
  await start(page);
  const shield = page.getByTestId("shield").first();
  await expect(shield).toHaveAttribute("data-mode", "strict");
  await expect(shield).toContainText("Masqués");
  await shield.click();
  await expect(shield).toContainText("Floutés");
  await shield.click();
  await expect(shield).toContainText("Visibles");
  await page.reload();
  await page.waitForSelector(".app.is-ready");
  await expect(page.getByTestId("shield").first()).toHaveAttribute("data-mode", "off");
  await page.getByTestId("ai-open").click();
  await page.getByTestId("ai-input").fill("Salut");
  await page.getByTestId("ai-input").press("Enter");
  await expect(page.getByTestId("ai-engine")).toBeVisible();
  const sent = await page.evaluate(() => (window as unknown as Win).__calls[0]);
  expect(sent.at(-1)!.content).toMatch(/Anti-spoiler : aucun/);
});

test("Mission en cours (Swamped) : déclarée en cours, jamais considérée terminée ; « Rien à manquer » → objectif coché, conservé", async ({ page }, info) => {
  await start(page);
  if (await page.getByTestId("confirm-guess").isVisible().catch(() => false)) await page.getByRole("button", { name: "Une autre" }).click();
  await page.getByTestId("next-mission-input").fill("Swamped");
  await page.getByTestId("next-mission-live").click();
  await expect(page.getByTestId("mission-live")).toBeVisible();
  await expect(page.getByTestId("next-mission-name")).toHaveText("Swamped");
  // l'analyse « Rien à manquer » se lance seule sur l'écran de mission ; la conversation passe par le bouton LEONIDA
  await page.getByTestId("ai-open").click();
  await page.getByTestId("ai-input").fill("Je suis en pleine mission, un conseil ?");
  await page.getByTestId("ai-input").press("Enter");
  const a = page.getByTestId("ai-answer").last();
  await expect(a.getByTestId("ai-engine")).toBeVisible({ timeout: 15_000 });
  const sent = await page.evaluate(() => (window as unknown as Win).__calls.find((c) => /MESSAGE DU JOUEUR : Je suis en pleine mission/.test(c.at(-1)!.content))!);
  expect(sent.at(-1)!.content).toContain("Mission EN COURS");
  expect(sent.at(-1)!.content).toContain("PAS terminée");
  if (isPhone(page)) await page.getByTestId("ai-close").click();
  const add = page.getByTestId("brief-add");
  if (await add.count()) {
    await add.first().click();
    const obj = page.getByTestId("objective").first();
    await expect(obj).toContainText("Objectif repéré par une source");
    await expect(obj).toContainText(/incertain/i);
    await obj.locator(".objs__check").click();
    await expect(obj).toHaveClass(/is-done/);
  }
  // objectif perso
  await page.getByTestId("objective-input").fill("Garder le bateau intact");
  await page.getByTestId("objective-add").click();
  await page.screenshot({ path: `captures/${info.project.name}-70-mission-en-cours.png` });
  await page.reload();
  await page.waitForSelector(".app.is-ready");
  await expect(page.getByTestId("mission-live")).toBeVisible();
  await expect(page.getByTestId("objectives")).toContainText("Garder le bateau intact");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("leonida-os/progress/v1")!).profile.missionsDone)).not.toContain("Swamped");
});

test("Commerces de Key Lento : icônes visibles sans zoom maximal, commande acquittée", async ({ page }) => {
  await start(page);
  await page.getByTestId("ai-open").click();
  await page.getByTestId("ai-input").fill("Montre-moi les commerces de Key Lento");
  await page.getByTestId("ai-input").press("Enter");
  const a = page.getByTestId("ai-answer").last();
  await expect(a.getByTestId("ai-engine")).toBeVisible({ timeout: 15_000 });
  await a.getByTestId("ai-action-show_place").first().click();
  await expect(page.locator("[data-place-ack^='applied:']")).toHaveCount(1);
  // la caméra se pose sur la zone (animation) : on attend un état stable plutôt qu'un instant précis
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const m = (window as unknown as { __leonidaMap: { getZoom(): number; isMoving(): boolean; queryRenderedFeatures(o: unknown): Array<{ properties: { cat: string } }> } }).__leonidaMap;
          if (!m) return "no map";
          if (m.isMoving()) return "moving";
          const shops = m.queryRenderedFeatures({ layers: ["lm"] }).filter((f) => f.properties.cat === "commerce").length;
          return m.getZoom() < 5.5 && shops > 0 ? "ok" : `zoom ${m.getZoom().toFixed(2)}, ${shops} commerces`;
        }),
      { timeout: 15_000 },
    )
    .toBe("ok");
});
