import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";

/**
 * V0.20.1 — Références visuelles GTADB dans le chat (iPhone, iPad, WebKit). Claude SIMULÉ : la 1re passe rend des
 * indices, la 2de une identification. On vérifie l'APP (photos réellement jointes à l'appel, candidat retenu, carte,
 * mémoire, absence de fausse identification) — pas la qualité de reconnaissance du vrai modèle, non testée ici.
 */
const prod = JSON.parse(readFileSync("tests/fixtures/radar-prod.json", "utf8"));
const SAVE = { schema: 1, rev: 9, showDemo: false, done: {}, vehicles: {}, profile: { pseudo: "Théo", console: "ps5", edition: "ultimate", preorder: "yes", chapter: 1, lastMission: "Don Gone", nextMission: null, missionInProgress: false, missionsDone: ["Swamped", "Don Gone"], spoilerMode: "strict" } };
const ex = (o: Record<string, unknown>) => JSON.stringify({ type: "scène", gta6: "oui", indices: [], textes: [], vehicules: [], resume: "", ...o });
const ans = (cand: string, conf: string, text = "Réponse simulée.") => `${text}\n@@@\n${JSON.stringify({ identification: { candidat: cand, confiance: conf }, indices: ["indice simulé"], action: "Vérifie l'enseigne" })}`;

async function start(page: Page, extract: string, answer: string) {
  await page.route("**/__live/radar.json*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...prod, generatedAt: new Date().toISOString() }) }));
  await page.addInitScript(([s, exr, an]) => {
    const w = window as unknown as { claude: unknown; __calls: Array<{ text: string; images: number; sizes: number[] }> };
    w.__calls = [];
    const sample = async (m: Array<{ content: string }>, o?: { images?: Blob[] }) => {
      const last = m.at(-1)!.content;
      w.__calls.push({ text: last, images: o?.images?.length ?? 0, sizes: (o?.images ?? []).map((b) => b.size) });
      return { text: last.includes("MODE EXTRACTION") ? exr : an, truncated: false };
    };
    (sample as unknown as { limits: unknown }).limits = async () => ({ images: { maxCount: 5, maxInputBytes: 5_000_000, mediaTypes: ["image/jpeg", "image/png"] } });
    w.claude = { use: async (n: string) => (n === "sample" ? sample : null) };
    if (sessionStorage.getItem("__seeded")) return;
    sessionStorage.setItem("__seeded", "1");
    localStorage.clear();
    localStorage.setItem("leonida-os/radar-url", `${location.origin}/__live/radar.json`);
    localStorage.setItem("leonida-os/progress/v1", JSON.stringify(s));
  }, [SAVE, extract, answer] as const);
  await page.goto("/#accueil");
  await page.waitForSelector(".app.is-ready");
}
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64");
async function send(page: Page, q: string) {
  await page.getByTestId("ai-open").click();
  await page.getByTestId("file-capture").setInputFiles({ name: "capture.png", mimeType: "image/png", buffer: PNG });
  await page.getByTestId("ai-input").fill(q);
  await page.getByTestId("ai-send").click();
  await expect(page.getByTestId("ai-grounding").last()).toBeVisible({ timeout: 15_000 });
}
const calls = (page: Page) => page.evaluate(() => (window as unknown as { __calls: Array<{ text: string; images: number; sizes: number[] }> }).__calls);

test("The Rusty Anchor (enseigne lue) : capture + photo de référence GTADB réellement jointes, lieu retenu = carte", async ({ page }) => {
  await start(page, ex({ indices: ["tables_de_pique_nique", "palmiers", "auvent_raye"], textes: ["THE RUSTY ANCHOR"] }), ans("the-rusty-anchor", "élevée"));
  await send(page, "C'est où ici ?");
  const c = await calls(page);
  expect(c).toHaveLength(2);
  expect(c[1].images).toBeGreaterThanOrEqual(2); // capture du joueur + au moins une photo GTADB
  expect(c[1].images).toBeLessThanOrEqual(4);
  expect(c[1].sizes.slice(1).every((n) => n > 1000 && n <= 70_000)).toBeTruthy();
  expect(c[1].text).toContain("PHOTOS DE RÉFÉRENCE GTADB");
  expect(c[1].text).toContain("the-rusty-anchor");
  const card = page.getByTestId("ai-grounding").last();
  await expect(card.getByTestId("grounding-name")).toHaveText("The Rusty Anchor");
  await expect(card.getByTestId("grounding-ref-L325")).toHaveClass(/is-chosen/);
  await expect(card.getByTestId("grounding-meta")).toContainText("photo");
  await expect(page.getByTestId("ai-action-show_place").last()).toContainText("The Rusty Anchor");
  // un seul « Détaille » (plus de doublon)
  await expect(page.getByText("Détaille", { exact: true })).toHaveCount(1);
});

test("candidat RETENU ≠ 1er du moteur : la carte et « Montre-moi le lieu » suivent le choix, sans nouvel appel", async ({ page }) => {
  await start(page, ex({ indices: ["marina", "ponton", "hangar_a_bateaux", "racks_a_bateaux", "palmiers"] }), ans("key-lento-marina-club", "faible", "Plutôt la marina du club, à confirmer."));
  await send(page, "C'est quelle marina ?");
  const card = page.getByTestId("ai-grounding").last();
  await expect(card.getByTestId("grounding-name")).toHaveText("Key Lento Marina Club");
  await expect(page.getByTestId("ai-action-show_place").last()).toContainText("Key Lento Marina Club");
  const before = (await calls(page)).length;
  await page.getByTestId("ai-reply").filter({ hasText: "Montre-moi le lieu" }).click();
  await expect(page.getByTestId("ai-action-show_place").last()).toContainText("Key Lento Marina Club");
  expect((await calls(page)).length).toBe(before);
});

test("capture sans correspondance : références de la progression comparées, aucune identification, aucun bouton carte", async ({ page }) => {
  await start(page, ex({ indices: ["palmiers", "plage"], resume: "une plage générique" }), ans("aucun", "aucune", "Je ne reconnais pas ce lieu avec certitude."));
  await send(page, "Tu reconnais ?");
  const c = await calls(page);
  expect(c[1].images).toBeGreaterThanOrEqual(2); // références choisies d'après le chapitre 1 malgré tout
  const card = page.getByTestId("ai-grounding").last();
  await expect(card.getByTestId("grounding-name")).toHaveText("Lieu non identifié");
  await expect(card.locator(".is-chosen")).toHaveCount(0);
  await expect(page.getByTestId("ai-action-show_place")).toHaveCount(0);
  await page.getByTestId("ai-reply").filter({ hasText: "Montre-moi le lieu" }).click();
  await expect(page.getByTestId("ai-answer").last()).toContainText("aucun lieu");
  await expect(page.getByTestId("ai-action-show_place")).toHaveCount(0);
});

test("mémoire visuelle : « Détaille » renvoie la capture ET les mêmes photos de référence (1 appel)", async ({ page }) => {
  await start(page, ex({ indices: ["tables_de_pique_nique", "auvent_raye"], textes: ["THE RUSTY ANCHOR"] }), ans("the-rusty-anchor", "élevée"));
  await send(page, "C'est où ?");
  const first = (await calls(page))[1].images;
  await page.getByText("Détaille", { exact: true }).click();
  await expect.poll(async () => (await calls(page)).length).toBe(3);
  expect((await calls(page))[2].images).toBe(first);
});

test("capture de carte : extraits de carte comme avant, aucune photo de référence", async ({ page }) => {
  await start(page, JSON.stringify({ type: "carte", gta6: "oui", indices: ["vue_carte", "piste_d_atterrissage", "littoral", "ile"], textes: [], vehicules: [], resume: "carte" }), ans("aucun", "aucune"));
  await send(page, "Je suis où sur la carte ?");
  const c = await calls(page);
  expect(c[1].text).not.toContain("PHOTOS DE RÉFÉRENCE GTADB");
  await expect(page.getByTestId("grounding-refs")).toHaveCount(0);
});

// ── Garage visuel et soluces structurées (aucun appel Claude) ──
async function startPlain(page: Page, profile: Record<string, unknown> = {}, hash = "#radar") {
  await page.route("**/__live/radar.json*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...prod, generatedAt: new Date().toISOString() }) }));
  await page.addInitScript(([s]) => {
    if (sessionStorage.getItem("__seeded")) return;
    sessionStorage.setItem("__seeded", "1");
    localStorage.clear();
    localStorage.setItem("leonida-os/radar-url", `${location.origin}/__live/radar.json`);
    localStorage.setItem("leonida-os/progress/v1", JSON.stringify(s));
  }, [{ ...SAVE, profile: { ...SAVE.profile, ...profile } }] as const);
  await page.goto(`/${hash}`);
  await page.waitForSelector(".app.is-ready");
}

test("Garage visuel : images exactes en planches chargées à la demande, grille inchangée, remplacement propre si l'image manque", async ({ page }) => {
  const requested = new Set<string>();
  page.on("request", (r) => r.url().includes("/data/hub/vatlas/") && requested.add(r.url()));
  await startPlain(page);
  await page.getByTestId("guide-view-garage").click();
  await expect(page.getByTestId("garage-grid").locator(".gv").first()).toBeVisible();
  await expect(page.getByTestId("garage-coverage")).toContainText(/\d{3} fiches illustrées/);
  // pas de téléchargement massif : seulement les planches des cartes affichées (16 planches en tout)
  await page.waitForTimeout(800);
  expect(requested.size).toBeGreaterThan(0);
  expect(requested.size).toBeLessThanOrEqual(8);
  // la fiche Sultan montre SA case de planche (même fiche) ; une planche absente retombe sur la silhouette
  await page.getByTestId("garage-search").fill("sultan");
  const card = page.getByTestId("garage-grid").locator(".gv").filter({ hasNotText: "Variante" }).first();
  const sprite = card.locator("[data-media=reference] .gv__sprite");
  await expect(sprite).toHaveAttribute("style", /data\/hub\/vatlas\/\d+\.jpg/);
  const atlas = (await sprite.getAttribute("data-atlas"))!;
  await card.click();
  await expect(page.getByTestId("garage-media")).toContainText("même fiche");
  await page.getByTestId("garage-close").click();
  await page.route(`**/data/hub/vatlas/${atlas}`, (r) => r.abort());
  await page.reload();
  await page.waitForSelector(".app.is-ready");
  await page.getByTestId("guide-view-garage").click();
  await page.getByTestId("garage-search").fill("sultan");
  await expect(page.getByTestId("garage-grid").locator(".gv").filter({ hasNotText: "Variante" }).first().locator(".gv__sil")).toBeVisible();
});

test("Garage : la photo du joueur prime, réduite et sauvegardée, retirable", async ({ page }) => {
  await startPlain(page);
  await page.getByTestId("guide-view-garage").click();
  await page.getByTestId("garage-search").fill("sultan");
  await page.getByTestId("garage-grid").locator(".gv").filter({ hasNotText: "Variante" }).first().click();
  const jpg = await page.evaluate(() => { const c = document.createElement("canvas"); c.width = 1600; c.height = 900; const x = c.getContext("2d")!; x.fillStyle = "#c33"; x.fillRect(0, 0, 1600, 900); return c.toDataURL("image/jpeg", 0.95).split(",")[1]; });
  await page.getByTestId("garage-photo-input").setInputFiles({ name: "ma-sultan.jpg", mimeType: "image/jpeg", buffer: Buffer.from(jpg, "base64") });
  await expect(page.getByTestId("garage-media")).toContainText("Ta photo");
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("leonida-os/progress/v1") || "{}"));
  const proofs = Object.values(saved.proofs ?? {}).flat() as Array<{ value: string }>;
  expect(proofs).toHaveLength(1);
  expect(proofs[0].value.length).toBeLessThan(90_000);
  await page.getByTestId("garage-photo-remove").click();
  await expect(page.getByTestId("garage-media")).toContainText("même fiche");
});

test("Soluce structurée : manquable nommé dans l'Encyclopédie, déroulé replié ; anti-spoiler sur un chapitre non atteint", async ({ page }) => {
  await startPlain(page);
  await page.getByTestId("guide-view-encyclo").click();
  await page.getByTestId("enc-m-don-gone").locator("button").click();
  await expect(page.getByTestId("enc-flags")).toContainText("Donnie's H&L .38");
  const fold = page.getByTestId("enc-guide");
  await expect(fold.locator("ol")).toBeHidden();
  await fold.locator("summary").click();
  await expect(fold.locator("ol li")).toHaveCount(4);
  await expect(page.getByTestId("encyclopedia")).not.toContainText("Meet Kordell");
});

test("Accueil : aucune étape de soluce affichée spontanément ; le manquable apparaît dans « Si je lance » ouvert", async ({ page }) => {
  await startPlain(page, { lastMission: "Swamped", missionsDone: ["Swamped"], nextMission: "Don Gone" }, "#accueil");
  await expect(page.getByText("Collect Donnie's Bag", { exact: false })).toHaveCount(0);
  await page.getByTestId("story-sim-open").first().click();
  await expect(page.getByTestId("hub-flag").first()).toContainText("Donnie's H&L .38");
  // les étapes restent repliées (« révèle le déroulé ») tant que le joueur ne les ouvre pas
  await expect(page.getByText("Collect Donnie's Bag", { exact: false })).toBeHidden();
});
