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

test("Écran mission : nom, état en un geste, analyse automatique de LA mission, question via le bouton LEONIDA", async ({ page }, info) => {
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
    // aucun doublon : le point passé en objectif quitte la liste d'alertes
    await expect(page.getByTestId("brief")).not.toContainText("Point critique de Swamped");
  } else await expect(page.getByTestId("brief-empty")).toBeVisible();
  await page.getByTestId("mission-start").click();
  await expect(page.getByTestId("mission-live")).toBeVisible();
  // aucune autre zone de discussion sur la fiche : seule entrée = bouton LEONIDA
  await expect(page.getByTestId("ask-mission")).toHaveCount(0);
  await page.getByTestId("ai-open").click();
  await page.getByTestId("ai-input").fill("Je prends quelle arme ?");
  await page.getByTestId("ai-send").click();
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

test("V0.10–0.11 compacité et bandeau d'état : mission visible tout de suite, une seule alerte, le reste dans « Voir plus », bouton LEONIDA sans chevauchement", async ({ page }) => {
  await page.route("**/__live/radar.json*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...prod, generatedAt: new Date().toISOString() }) }));
  await page.addInitScript(() => {
    const sample = async (messages: { role: string; content: string }[]) => {
      const ids = [...messages.at(-1)!.content.matchAll(/"id":"([^"]+)"/g)].map((m) => m[1]);
      const el = (t: string, p: string) => `{"texte":"${t}","quand":"pendant","type":"manquable","priorite":"${p}","sources":["${ids[0]}"]}`;
      return { text: `Ok.\n@@@\n{"confiance":"signalé","sources":[],"actions":[],"elements":[${el("Alerte A", "haute")},${el("Alerte B", "haute")},${el("Point C", "normale")}]}` };
    };
    (window as unknown as { claude: unknown }).claude = { use: async (n: string) => (n === "sample" ? sample : null) };
    localStorage.clear();
    localStorage.setItem("leonida-os/radar-url", `${location.origin}/__live/radar.json`);
    localStorage.setItem("leonida-os/progress/v1", JSON.stringify({ schema: 1, rev: 7, showDemo: false, done: {}, vehicles: {}, profile: { pseudo: "Théo", console: "ps5", edition: "standard", preorder: "unknown", chapter: 1, lastMission: "Swamped", nextMission: "Don Gone", missionsDone: ["Swamped"], spoilerMode: "strict" } }));
  });
  await page.goto("/#accueil");
  await page.waitForSelector(".app.is-ready");
  await expect(page.getByTestId("brief-alert")).toHaveCount(1, { timeout: 15_000 });
  await expect(page.getByTestId("brief-alert")).toContainText("Alerte A");
  await expect(page.getByTestId("brief")).not.toContainText("Alerte B");
  await page.getByTestId("brief-more").click();
  await expect(page.getByTestId("brief-item")).toHaveCount(2);
  const g = await page.evaluate(() => {
    const r = (s: string) => document.querySelector(s)!.getBoundingClientRect();
    const h = r('[data-testid="home-header"]'), m = r('[data-testid="next-mission-name"]'), f = r('[data-testid="ai-open"]');
    const nav = document.querySelector(".nav")!.getBoundingClientRect();
    return { header: h.height, missionTop: m.top, fab: [f.left, f.top, f.right, f.bottom], nav: [nav.left, nav.top, nav.right, nav.bottom], vw: innerWidth, vh: innerHeight };
  });
  expect(g.header).toBeLessThan(72);
  // V0.11 : bandeau d'état utile — mission, état, alertes de l'analyse, anti-spoiler explicite
  await expect(page.getByTestId("status-mission")).toHaveText("Don Gone");
  await expect(page.getByTestId("mission-upcoming")).toHaveText("À venir");
  await expect(page.getByTestId("status-line")).toContainText("2 alertes");
  await expect(page.getByTestId("shield").first()).toContainText("Masqués");
  await expect(page.getByTestId("ai-open").locator(".copilotglyph")).toHaveCount(1);
  if (g.vw < 760) {
    expect(g.missionTop).toBeLessThan(260); // sans bandeau d'alerte (instantané masqué sur l'accueil dans l'Artifact), la mission arrive encore plus haut
    expect(g.fab[0]).toBeGreaterThanOrEqual(g.nav[2]); // jamais sur la navigation
    expect(g.fab[2]).toBeLessThanOrEqual(g.vw);
    expect(g.fab[3]).toBeLessThanOrEqual(g.vh);
  }
});
