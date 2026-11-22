import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";

/**
 * V0.9 — écran mission (iPhone, iPad, WebKit) avec runtime Artifact SIMULÉ pour Claude (`sample`) ;
 * PAS de connecteur web dans ces tests (`mcp` absent) : l'app doit le dire, jamais simuler une recherche.
 */
const prod = JSON.parse(readFileSync("tests/fixtures/radar-prod.json", "utf8"));
type Win = Window & { __calls: { role: string; content: string }[][] };

async function start(page: Page, profile: Record<string, unknown> = {}) {
  await page.route("**/__live/radar.json*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...prod, generatedAt: new Date().toISOString() }) }));
  await page.addInitScript(
    ({ p }) => {
      const w = window as unknown as Win & { claude: unknown };
      w.__calls = [];
      const sample = async (messages: { role: string; content: string }[]) => {
        w.__calls.push(messages);
        const last = messages[messages.length - 1].content;
        const ids = [...last.matchAll(/"id":"([^"]+)"/g)].map((m) => m[1]);
        const mission = last.match(/« RIEN À MANQUER » — analyse préventive[\s\S]*?MESSAGE DU JOUEUR : Rien à manquer dans (.+?) \?/)?.[1] ?? "";
        const text = /RIEN À MANQUER/.test(last)
          ? `Analyse de ${mission}.\n@@@\n{"confiance":"signalé","sources":[],"actions":[],"elements":${ids.length ? `[{"texte":"Point critique de ${mission}","quand":"avant","type":"manquable","priorite":"haute","sources":["${ids[0]}"]}]` : "[]"}}`
          : "Bien vu.\n@@@\n{}";
        return { text };
      };
      w.claude = { use: async (n: string) => (n === "sample" ? sample : null) };
      if (sessionStorage.getItem("__seeded")) return;
      sessionStorage.setItem("__seeded", "1");
      localStorage.clear();
      localStorage.setItem("leonida-os/radar-url", `${location.origin}/__live/radar.json`);
      localStorage.setItem("leonida-os/progress/v1", JSON.stringify({ schema: 1, rev: 7, showDemo: false, done: {}, vehicles: {}, profile: { pseudo: "Théo", console: "ps5", edition: "standard", preorder: "unknown", chapter: 1, lastMission: "Down to Earth", nextMission: null, missionsDone: ["Down to Earth"], spoilerMode: "strict", ...p } }));
    },
    { p: profile },
  );
  await page.goto("/#accueil");
  await page.waitForSelector(".app.is-ready");
}
const briefCalls = (page: Page) => page.evaluate(() => (window as unknown as Win).__calls.filter((c) => /RIEN À MANQUER/.test(c.at(-1)!.content)).map((c) => c.at(-1)!.content.match(/MESSAGE DU JOUEUR : (.*)/)?.[1] ?? ""));

test("Écran mission : nom, état en un geste, analyse automatique de LA mission, question libre", async ({ page }, info) => {
  await start(page, { nextMission: "Swamped", missionInProgress: false });
  await expect(page.getByTestId("next-mission-name")).toHaveText("Swamped");
  await expect(page.getByTestId("mission-stop")).toHaveAttribute("aria-pressed", "true");
  // analyse lancée seule, une fois, pour Swamped
  await expect(page.getByTestId("brief-meta")).toContainText(/il y a|à l'instant/, { timeout: 15_000 });
  expect(await briefCalls(page)).toEqual(["Rien à manquer dans Swamped ?"]);
  // pas de connecteur ici : l'analyse le dit, sans prétendre avoir cherché sur le web
  await expect(page.getByTestId("brief-meta")).toContainText("LEONIDA RADAR");
  await expect(page.getByTestId("brief-meta")).not.toContainText("source web");
  const alert = page.getByTestId("brief-alert").first();
  if (await alert.count()) {
    await expect(alert).toContainText("Point critique de Swamped");
    await expect(alert).toHaveAttribute("data-status", "une source");
    await expect(alert.getByTestId("brief-source").first()).toHaveAttribute("href", /^https:\/\//);
    await alert.getByTestId("brief-add").click();
    await expect(page.getByTestId("objective").first()).toContainText("Point critique de Swamped");
  } else await expect(page.getByTestId("brief-empty")).toBeVisible();
  await page.getByTestId("mission-start").click();
  await expect(page.getByTestId("mission-live")).toBeVisible();
  await page.getByTestId("ask-mission-input").fill("Je prends quelle arme ?");
  await page.getByTestId("ask-mission-input").press("Enter");
  await expect(page.getByTestId("ai-answer").last().getByTestId("ai-engine")).toBeVisible({ timeout: 15_000 });
  const chat = await page.evaluate(() => (window as unknown as Win).__calls.at(-1)!.at(-1)!.content);
  expect(chat).toContain("Je prends quelle arme ?");
  expect(chat).toContain("Mission EN COURS");
  await page.screenshot({ path: `captures/${info.project.name}-80-ecran-mission.png` });
});

test("Terminer une mission (confirmation), puis la suivante : aucune alerte de la mission terminée n'est mélangée", async ({ page }) => {
  await start(page, { nextMission: "Swamped" });
  await expect(page.getByTestId("brief-meta")).toContainText(/il y a|à l'instant/, { timeout: 15_000 });
  await page.getByTestId("mission-done").click();
  await page.getByTestId("mission-done-confirm").getByRole("button", { name: "Oui" }).click();
  await expect(page.getByTestId("next-mission-name")).toHaveCount(0);
  if (await page.getByTestId("confirm-guess").isVisible().catch(() => false)) await page.getByRole("button", { name: "Une autre" }).click();
  await page.getByTestId("next-mission-input").fill("Don Gone");
  await page.getByTestId("next-mission-save").click();
  await expect(page.getByTestId("next-mission-name")).toHaveText("Don Gone");
  await expect(page.getByTestId("mission-stop")).toHaveAttribute("aria-pressed", "true"); // pas lancée automatiquement
  await expect(page.getByTestId("brief-meta")).toContainText(/il y a|à l'instant/, { timeout: 15_000 });
  expect(await briefCalls(page)).toEqual(["Rien à manquer dans Swamped ?", "Rien à manquer dans Don Gone ?"]);
  await expect(page.getByTestId("brief")).not.toContainText("Swamped");
  // persistance : rechargement → même état, analyse conservée sans nouvel appel
  await page.reload();
  await page.waitForSelector(".app.is-ready");
  await expect(page.getByTestId("next-mission-name")).toHaveText("Don Gone");
  await expect(page.getByTestId("brief-meta")).toContainText(/il y a|à l'instant/);
  expect(await briefCalls(page)).toEqual([]);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("leonida-os/progress/v1")!));
  expect(saved.profile.missionsDone).toContain("Swamped");
  expect(saved.profile.missionsDone).not.toContain("Don Gone");
});

test("Diagnostic web : sans connecteur dans cette vue, l'app dit « indisponible » et n'invente aucun résultat", async ({ page }) => {
  await start(page);
  await page.getByTestId("nav-profil").click();
  const d = page.getByTestId("web-diag");
  await expect(d.getByTestId("web-diag-state")).toContainText("Indisponible");
  await d.getByTestId("web-diag-run").click();
  await expect(d.getByTestId("web-diag-result")).toHaveAttribute("data-status", "unavailable");
  await expect(d.getByTestId("web-diag-result")).toContainText("0 résultat");
});
