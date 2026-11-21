// Mesures de fluidité V0.7 (laboratoire) : node scripts/perf.mjs [chromium|webkit] — serveur sur :4321 (out/)
// Frame pacing par requestAnimationFrame, latence tap → première image, tâches longues (Chromium).
import { chromium, webkit } from "playwright";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const engine = process.argv[2] || "chromium";
const BASE = process.env.BASE || "http://localhost:4321";
const feed = JSON.parse(readFileSync("tests/fixtures/radar-prod.json", "utf8"));
const launcher = engine === "webkit" ? webkit : chromium;
const browser = await launcher.launch(engine === "chromium" ? { executablePath: process.env.CHROME_PATH || undefined, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] } : {});
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: Number(process.env.DPR || 3), hasTouch: true, isMobile: engine === "chromium" });
const page = await ctx.newPage();
await page.route("**/__live/radar.json*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...feed, generatedAt: new Date().toISOString() }) }));
await page.addInitScript(() => {
  if (!sessionStorage.getItem("s")) {
    sessionStorage.setItem("s", "1");
    localStorage.clear();
    localStorage.setItem("leonida-os/radar-url", location.origin + "/__live/radar.json");
    localStorage.setItem("leonida-os/glass/v1", "on"); // mesure à verre forcé (le mode auto pourrait le réduire)
    localStorage.setItem("leonida-os/progress/v1", JSON.stringify({ schema: 1, rev: 7, profile: { pseudo: "Théo", console: "ps5", edition: "ultimate", preorder: "unknown", chapter: 1, lastMission: "Down to Earth", nextMission: "Clean Up After Donnie", missionsDone: ["Down to Earth"], spoilerMode: "strict" } }));
  }
  window.__frames = [];
  window.__long = [];
  const loop = (t) => { window.__frames.push(t); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  try { new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__long.push(e.duration))).observe({ type: "longtask", buffered: true }); } catch {}
});
await page.goto(`${BASE}/#accueil`);
await page.waitForSelector(".app.is-ready");
await page.waitForTimeout(1500);

const stats = (d) => {
  const s = [...d].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? 0;
  const budget = 1000 / 60;
  return { frames: d.length, fpsMedian: +(1000 / (q(0.5) || 1)).toFixed(1), p95ms: +q(0.95).toFixed(1), maxMs: +(s.at(-1) ?? 0).toFixed(1), janky: d.filter((x) => x > budget * 1.5).length, jankyPct: +((100 * d.filter((x) => x > budget * 1.5).length) / Math.max(1, d.length)).toFixed(1) };
};
async function measure(name, fn) {
  await page.evaluate(() => { window.__frames = []; window.__long = []; });
  await fn();
  const { f, l } = await page.evaluate(() => ({ f: window.__frames, l: window.__long }));
  const deltas = f.slice(1).map((t, i) => t - f[i]);
  const r = { scenario: name, ...stats(deltas), longTasks: l.length, longTaskMaxMs: Math.round(Math.max(0, ...l)) };
  console.log(JSON.stringify(r));
  return r;
}
async function tapLatency(selector) {
  // pointerdown → première image peinte après le traitement (double rAF)
  return page.evaluate(async (sel) => {
    const el = document.querySelector(sel);
    const out = await new Promise((res) => {
      el.addEventListener("pointerdown", () => { const t0 = performance.now(); requestAnimationFrame(() => requestAnimationFrame(() => res(performance.now() - t0))); }, { once: true, capture: true });
      el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "touch" }));
      el.click();
    });
    return Math.round(out);
  }, selector);
}

const results = [];
const tabs = ["radar", "profil", "accueil", "radar", "accueil"];
results.push(await measure("changement d'onglet ×5", async () => { for (const t of tabs) { await page.getByTestId(`nav-${t}`).click(); await page.waitForTimeout(420); } }));
const lat = [];
for (const t of ["radar", "accueil", "profil", "accueil"]) { lat.push(await tapLatency(`[data-testid="nav-${t}"]`)); await page.waitForTimeout(400); }
await page.evaluate(() => document.documentElement.setAttribute("data-glass", "off"));
results.push(await measure("changement d'onglet ×5 (verre désactivé)", async () => { for (const t of tabs) { await page.getByTestId(`nav-${t}`).click(); await page.waitForTimeout(420); } }));
await page.evaluate(() => document.documentElement.removeAttribute("data-glass"));
// fiche LEONIDA AI (ressort) : ouverture / fermeture
results.push(await measure("fiche IA : ouverture + fermeture", async () => { await page.getByTestId("ai-open").click(); await page.waitForTimeout(700); await page.keyboard.press("Escape"); await page.waitForTimeout(600); }));
// V0.7.1 : réponse du copilote (Entrée → bulle affichée) et parcours continu Accueil → IA → carte → fiche → Accueil
const answerMs = [];
await page.getByTestId("ai-open").click();
await page.waitForTimeout(700);
for (const q of ["Je suis sur le point de lancer Find Donnie's Package.", "Où trouver la Penumbra FF ?", "Et comment je la conserve ?", "Quelle arme gratuite puis-je récupérer ?"]) {
  await page.getByTestId("ai-input").fill(q);
  const n = await page.getByTestId("ai-answer").count();
  answerMs.push(await page.evaluate(async (n0) => {
    const t0 = performance.now();
    const input = document.querySelector('[data-testid="ai-input"]');
    input.form.requestSubmit();
    await new Promise((res) => { const tick = () => (document.querySelectorAll('[data-testid="ai-answer"]').length > n0 ? requestAnimationFrame(() => res()) : requestAnimationFrame(tick)); tick(); });
    return Math.round(performance.now() - t0);
  }, n));
  await page.waitForTimeout(300);
}
await page.keyboard.press("Escape");
await page.waitForTimeout(600);
results.push(await measure("parcours Accueil → Préparer → voiture → carte + fiche → Accueil", async () => {
  await page.getByTestId("prepare-mission").click();
  await page.waitForTimeout(900);
  await page.getByTestId("ai-answer").last().getByTestId("ai-reply").filter({ hasText: "voiture sympa" }).click();
  await page.waitForTimeout(700);
  await page.getByTestId("ai-answer").last().getByTestId("ai-action-focus_vehicle").first().click();
  await page.waitForTimeout(1600);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  await page.getByTestId("nav-accueil").click();
  await page.waitForTimeout(600);
}));
// carte
await page.getByTestId("nav-carte").click();
await page.waitForFunction(() => window.__leonidaMap && window.__leonidaMap.isStyleLoaded());
await page.waitForTimeout(1500);
results.push(await measure("carte : glisser (pan) 600 ms", async () => {
  await page.mouse.move(200, 450); await page.mouse.down();
  for (let i = 1; i <= 30; i++) { await page.mouse.move(200 - i * 5, 450 - i * 4); await page.waitForTimeout(20); }
  await page.mouse.up(); await page.waitForTimeout(600);
}));
if (process.env.GLASS === "off") await page.evaluate(() => document.documentElement.setAttribute("data-glass", "off"));
// fiche véhicule : ouverture, glisser plein écran, relâcher, fermer
if ((await page.getByTestId("filter-garage").getAttribute("aria-pressed")) !== "true") await page.getByTestId("filter-garage").click();
await page.waitForTimeout(500);
await page.locator('[data-testid^="vehicle-v-"]').first().click();
await page.waitForSelector('[data-testid="sheet"][data-settled="true"]');
results.push(await measure("fiche glissante : drag haut + bas + fermeture", async () => {
  const g = await page.getByTestId("sheet-grip").boundingBox();
  const x = g.x + g.width / 2;
  await page.mouse.move(x, g.y + 5); await page.mouse.down();
  for (let i = 1; i <= 20; i++) { await page.mouse.move(x, g.y + 5 - i * 15); await page.waitForTimeout(16); }
  await page.mouse.up(); await page.waitForTimeout(600);
  const g2 = await page.getByTestId("sheet-grip").boundingBox();
  await page.mouse.move(x, g2.y + 5); await page.mouse.down();
  for (let i = 1; i <= 25; i++) { await page.mouse.move(x, g2.y + 5 + i * 30); await page.waitForTimeout(16); }
  await page.mouse.up(); await page.waitForTimeout(700);
}));
// conservation d'état : la carte n'est pas recréée
const mapCount = await page.evaluate(() => window.__leonidaMapCount ?? 0);
const summary = { answerToBubbleMs: answerMs, engine, dpr: Number(process.env.DPR || 3), glass: process.env.GLASS !== "off", ua: await page.evaluate(() => navigator.userAgent), date: new Date().toISOString(), tapToFrameMs: lat, mapInstances: mapCount, results };
mkdirSync("docs/perf", { recursive: true });
writeFileSync(`docs/perf/perf-${engine}${process.env.DPR ? `-dpr${process.env.DPR}` : ""}${process.env.GLASS === "off" ? "-noglass" : ""}.json`, JSON.stringify(summary, null, 1));
console.log("tap→image (ms):", lat.join(", "), "| question→réponse (ms):", answerMs.join(", "), "| instances carte:", mapCount);
await browser.close();
