// Vidéo de démonstration V0.7 (iPhone 393×852) : node scripts/demo-video.mjs → docs/media/leonida-v071-demo.mp4
import { chromium } from "playwright";
import { readFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";

const BASE = process.env.BASE || "http://localhost:4321";
const feed = JSON.parse(readFileSync("tests/fixtures/radar-prod.json", "utf8"));
rmSync("/tmp/leonida-video", { recursive: true, force: true });
mkdirSync("/tmp/leonida-video", { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true, recordVideo: { dir: "/tmp/leonida-video", size: { width: 786, height: 1704 } } });
const page = await ctx.newPage();
await page.route("**/__live/radar.json*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...feed, generatedAt: new Date().toISOString() }) }));
await page.addInitScript(() => {
  if (sessionStorage.getItem("s")) return;
  sessionStorage.setItem("s", "1");
  localStorage.clear();
  localStorage.setItem("leonida-os/radar-url", location.origin + "/__live/radar.json");
  localStorage.setItem("leonida-os/glass/v1", "on");
  localStorage.setItem("leonida-os/progress/v1", JSON.stringify({ schema: 1, rev: 7, profile: { pseudo: "Théo", console: "ps5", edition: "standard", preorder: "unknown", chapter: 1, lastMission: "Down to Earth", nextMission: "Clean Up After Donnie", missionsDone: ["Down to Earth"], spoilerMode: "strict" } }));
});
const wait = (ms) => page.waitForTimeout(ms);
// touche visible (le curseur n'est pas filmé)
await page.addInitScript(() => {
  addEventListener("pointerdown", (e) => {
    const d = document.createElement("div");
    d.style.cssText = `position:fixed;left:${e.clientX - 18}px;top:${e.clientY - 18}px;width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,.35);box-shadow:0 0 0 2px rgba(255,255,255,.6);pointer-events:none;z-index:99999;transition:transform .35s,opacity .35s`;
    document.body.appendChild(d);
    requestAnimationFrame(() => { d.style.transform = "scale(1.6)"; d.style.opacity = "0"; });
    setTimeout(() => d.remove(), 450);
  }, true);
});
await page.goto(`${BASE}/#accueil`);
await page.waitForSelector(".app.is-ready");
await wait(2200);
// 1. Briefing de session
await page.mouse.wheel(0, 420); await wait(1400); await page.mouse.wheel(0, -420); await wait(800);
// 2. Préparer ma mission → LEONIDA AI avec le contexte de la mission
await page.getByTestId("prepare-mission").click(); await wait(2600);
// 3. « Et si je veux une voiture sympa avant ? »
await page.getByTestId("ai-answer").last().getByTestId("ai-reply").filter({ hasText: "voiture sympa" }).click(); await wait(2400);
// 4. La carte s'ouvre sur la zone du véhicule
await page.getByTestId("ai-answer").last().getByTestId("ai-action-focus_vehicle").first().click();
await page.waitForSelector('[data-testid="sheet"][data-settled="true"]'); await wait(1800);
const g = await page.getByTestId("sheet-grip").boundingBox();
await page.mouse.move(g.x + g.width / 2, g.y + 5); await page.mouse.down();
for (let i = 1; i <= 18; i++) { await page.mouse.move(g.x + g.width / 2, g.y + 5 - i * 18); await wait(16); }
await page.mouse.up(); await wait(1200);
// 5. Découverte faite
await page.getByTestId("v-found").click(); await wait(900);
await page.getByTestId("v-found").click(); await wait(1300);
await page.keyboard.press("Escape"); await wait(900);
// 6. Retour à l'Accueil : recommandations à jour
await page.getByTestId("nav-accueil").click(); await wait(2000);
// 7. La conversation continue (« la » = la voiture choisie)
await page.getByTestId("ai-open").click(); await wait(900);
await page.getByTestId("ai-input").click();
await page.keyboard.type("Et comment je la garde ?", { delay: 40 });
await page.keyboard.press("Enter"); await wait(2400);
await page.keyboard.type("Je suis sur le point de lancer Find Donnie's Package", { delay: 30 });
await page.keyboard.press("Enter"); await wait(3200);
await ctx.close();
await browser.close();
const webm = readdirSync("/tmp/leonida-video").filter((f) => f.endsWith(".webm")).map((f) => `/tmp/leonida-video/${f}`).at(-1);
mkdirSync("docs/media", { recursive: true });
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", webm, "-vf", "scale=590:-2,fps=30", "-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "docs/media/leonida-v071-demo.mp4"]);
console.log("ok docs/media/leonida-v071-demo.mp4");
