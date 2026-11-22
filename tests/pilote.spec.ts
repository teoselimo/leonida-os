import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";

/**
 * Pilote Artifact (issue #10) — les 7 parcours du cahier, dans l'app complète, avec le runtime Artifact SIMULÉ :
 * `window.claude.use("sample" | "db" | "user")` est remplacé par un double de test. Ces tests prouvent le câblage
 * (ce que l'app envoie, ce qu'elle affiche, ce qu'elle refuse), pas la qualité des réponses du vrai Claude :
 * celle-ci se vérifie dans l'Artifact publié, sur ton compte (voir docs/ARTIFACT-PILOTE.md).
 */
const prod = JSON.parse(readFileSync("tests/fixtures/radar-prod.json", "utf8"));
const isPhone = (page: Page) => (page.viewportSize()?.width ?? 0) < 760;
const mapCount = (page: Page) => page.evaluate(() => (window as unknown as { __leonidaMapCount?: number }).__leonidaMapCount ?? 0);

type Win = Window & { __calls: { role: string; content: string }[][]; __db: Record<string, unknown> };

async function start(page: Page, hash = "#accueil", profile: Record<string, unknown> = {}) {
  await page.route("**/__live/radar.json*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...prod, generatedAt: new Date().toISOString() }) }));
  await page.addInitScript(
    ({ p }) => {
      const w = window as unknown as Win & { claude: unknown };
      w.__calls = [];
      w.__db = JSON.parse(sessionStorage.getItem("__db") || "{}");
      // Double du runtime Artifact : Claude répond sans chiffre et choisit la première action proposée.
      const sample = async (messages: { role: string; content: string }[], opts: { onText?: (c: { text: string }) => void }) => {
        w.__calls.push(messages);
        const last = messages[messages.length - 1].content;
        const q = (last.match(/Question du joueur[^\n]*\n([^\n]+)/i)?.[1] ?? last).toLowerCase();
        const body = /garde|conserve/.test(q)
          ? "Pour la garder, range-la dans ton garage et fais-la immatriculer, comme l'indique la source."
          : "D'après les données LEONIDA RADAR, voici ce que je peux te dire de fiable. Ouvre la fiche pour le détail.";
        const text = `${body}\n@@@\n{"confiance":"signalé","sources":[],"actions":[0]}`;
        for (let i = 12; i < text.length; i += 12) {
          await new Promise((r) => setTimeout(r, 10));
          opts.onText?.({ text: text.slice(0, i) });
        }
        return { text, truncated: false, modelTierApplied: "quick", modelApplied: "test" };
      };
      const db = {
        doc: (path: string) => ({
          get: async () => ({ exists: path in w.__db, data: () => w.__db[path] }),
          set: async (d: unknown) => {
            w.__db[path] = d;
            sessionStorage.setItem("__db", JSON.stringify(w.__db));
          },
        }),
      };
      w.claude = { use: async (n: string) => (n === "sample" ? sample : n === "user" ? { id: async () => "u-test" } : n === "db" ? db : null) };
      if (sessionStorage.getItem("__seeded")) return;
      sessionStorage.setItem("__seeded", "1");
      localStorage.clear();
      localStorage.setItem("leonida-os/radar-url", `${location.origin}/__live/radar.json`);
      localStorage.setItem("leonida-os/progress/v1", JSON.stringify({ schema: 1, rev: 7, showDemo: false, done: {}, vehicles: {}, profile: { pseudo: "Théo", console: "ps5", edition: "standard", preorder: "unknown", chapter: 1, lastMission: "Down to Earth", nextMission: null, missionsDone: ["Down to Earth"], spoilerMode: "strict", ...p } }));
    },
    { p: profile },
  );
  await page.goto(`/${hash}`);
  await page.waitForSelector(".app.is-ready");
}

async function ask(page: Page, q: string) {
  if (!(await page.getByTestId("ai-panel").isVisible().catch(() => false))) await page.getByTestId("ai-open").click();
  await expect(page.getByTestId("ai-mode")).toContainText("Claude");
  const n = await page.getByTestId("ai-answer").count();
  await page.getByTestId("ai-input").fill(q);
  await page.getByTestId("ai-send").click();
  const a = page.getByTestId("ai-answer").nth(n);
  await expect(a.getByTestId("ai-engine")).toContainText("Rédigé par", { timeout: 15_000 });
  return a;
}

test("Pilote 1 — Find Donnie's Package : Claude reçoit la mission, le profil et les règles ; réponse rédigée et sourcée", async ({ page }, info) => {
  await start(page);
  const a = await ask(page, "Je suis sur le point de lancer Find Donnie's Package.");
  await expect(a).toHaveAttribute("data-intent", "before");
  await expect(a).toContainText("LEONIDA RADAR");
  const sent = await page.evaluate(() => (window as unknown as Win).__calls[0]);
  expect(sent[0].content).toContain("copilote de GTA VI");
  expect(sent[sent.length - 1].content).toContain("Find Donnie's Package");
  expect(sent[sent.length - 1].content).toMatch(/PS5/);
  await page.screenshot({ path: `captures/${info.project.name}-60-pilote-donnie.png` });
});

test("Pilote 2 — voiture rare puis suivi « comment je la garde définitivement ? » : l'historique part avec la question", async ({ page }, info) => {
  await start(page);
  await ask(page, "Où trouver la Penumbra FF ?");
  const b = await ask(page, "Et comment je la garde définitivement ?");
  await expect(b).toContainText("immatriculer");
  const calls = await page.evaluate(() => (window as unknown as Win).__calls);
  expect(calls[1].map((m) => m.role)).toEqual(["user", "user", "assistant", "user"]);
  expect(calls[1][1].content).toContain("Penumbra FF");
  await page.screenshot({ path: `captures/${info.project.name}-61-pilote-suivi.png` });
});

test("Pilote 3 — « magasin à Key Lento » : la carte s'ouvre sur la liste des commerces de Key Lento, filtre commerces actif (V0.13 : sans zone de quartier)", async ({ page }, info) => {
  await start(page);
  const a = await ask(page, "Je cherche un magasin à Key Lento");
  await a.getByTestId("ai-action-show_place").first().click();
  await expect(page).toHaveURL(/#carte$/);
  await expect(page.getByTestId("search-results")).toContainText("Billie's Key Lento Gift Shop");
  await expect(page.getByTestId("zone-tag")).toHaveCount(0);
  await page.getByRole("button", { name: "Fermer la recherche" }).click();
  await expect(page.getByTestId("filter-landmarks")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("poi-commerce")).toHaveAttribute("aria-pressed", "true");
  await page.waitForTimeout(900);
  await page.screenshot({ path: `captures/${info.project.name}-62-pilote-key-lento.png` });
});

test("Pilote 4 — arme gratuite au chapitre du joueur : réponse sourcée, aucun chiffre inventé accepté", async ({ page }) => {
  await start(page);
  const a = await ask(page, "Quelle arme gratuite puis-je récupérer maintenant ?");
  await expect(a).toHaveAttribute("data-intent", "weapon");
  await a.getByTestId("ai-sources").locator("summary").click();
  await expect(a.locator("a[href^='https://']").first()).toBeVisible();
});

test("Pilote 5 — une action de Claude ouvre la fiche d'un lieu (The Rusty Anchor, repère communautaire)", async ({ page }, info) => {
  await start(page);
  const a = await ask(page, "Où est The Rusty Anchor à Key Lento ?");
  await a.getByTestId("ai-action-show_place").first().click();
  await expect(page).toHaveURL(/#carte$/);
  const card = page.getByTestId("landmark");
  await expect(card).toContainText("The Rusty Anchor");
  await expect(card).toContainText(/communautaire|incertain/i); // repère gtadb, ou établissement confirmé à position communautaire
  await page.waitForTimeout(900);
  await page.screenshot({ path: `captures/${info.project.name}-63-pilote-rusty-anchor.png` });
});

test("Pilote 6 — « C'est fait » : mémorisé localement et dans le stockage personnel de l'Artifact, restauré au rechargement", async ({ page }) => {
  await start(page, "#accueil", { nextMission: "Tourist Trap" });
  const first = page.getByTestId("live-advice").locator("article").first();
  const id = (await first.getAttribute("data-testid"))!;
  await first.getByTestId("advice-done").click();
  await expect(page.getByTestId(id)).toHaveCount(0);
  await page.waitForFunction(() => Object.keys((window as unknown as Win).__db).length > 0, null, { timeout: 8_000 });
  const saved = await page.evaluate(() => (window as unknown as Win).__db["data/users/u-test/progress"] as { state: string; savedAt: string });
  expect(saved.savedAt).toBeTruthy();
  expect(Object.keys(JSON.parse(saved.state).done).length).toBeGreaterThan(0);
  await page.reload();
  await page.waitForSelector(".app.is-ready");
  await expect(page.getByTestId("live-advice")).toBeVisible();
  await expect(page.getByTestId(id)).toHaveCount(0);
});

test("Pilote 7 — aller-retour IA ↔ carte sans perdre la conversation, les filtres ni recréer la carte", async ({ page }) => {
  await start(page, "#carte");
  await page.waitForFunction(() => !!(window as unknown as { __leonidaMap?: unknown }).__leonidaMap);
  await page.getByTestId("poi-station").click();
  await expect(page.getByTestId("poi-station")).toHaveAttribute("aria-pressed", "true");
  const a = await ask(page, "Où trouver la Penumbra FF ?");
  await a.getByTestId("ai-action-focus_vehicle").first().click();
  await expect(page.getByTestId("vehicle-sheet")).toBeVisible();
  expect(await mapCount(page)).toBe(1);
  await page.getByTestId("vehicle-sheet").locator(".vmedia__close").click();
  await page.getByTestId("filter-garage").click(); // retour aux lieux
  await expect(page.getByTestId("poi-station")).toHaveAttribute("aria-pressed", "true");
  if (isPhone(page)) await page.getByTestId("ai-open").click();
  expect(await page.getByTestId("ai-answer").count()).toBeGreaterThanOrEqual(1);
  expect(await mapCount(page)).toBe(1);
});
