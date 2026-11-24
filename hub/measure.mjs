// Comparaison locale de deux exports Artifact déjà servis (origines passées en arguments).
import { chromium } from "playwright";

const origins = process.argv.slice(2);
if (origins.length !== 2) throw new Error("Deux origines locales sont requises");
if (origins.some(url => !["localhost", "127.0.0.1"].includes(new URL(url).hostname))) {
  throw new Error("Utiliser deux serveurs locaux");
}
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const modules = [
  { name: "garage", hash: "radar", open: "guide-view-garage", ready: '[data-testid="garage-grid"] .gv' },
  { name: "carte", hash: "carte", ready: ".maplibregl-canvas" },
  { name: "ia", hash: "accueil", open: "ai-open", ready: '[data-testid="ai-input"]' },
];
try {
  for (let run = 1; run <= 3; run++) {
    for (const origin of origins) {
      for (const module of modules) {
        const page = await browser.newPage({ viewport: { width: 393, height: 852 }, isMobile: true, deviceScaleFactor: 3 });
        const session = await page.context().newCDPSession(page);
        await session.send("Performance.enable");
        const start = performance.now();
        await page.goto(new URL("/#" + module.hash, origin).href);
        await page.waitForSelector(".app.is-ready");
        if (module.open) await page.getByTestId(module.open).click();
        await page.locator(module.ready).first().waitFor();
        const openMs = Math.round(performance.now() - start);
        await page.waitForLoadState("networkidle");
        const resources = await page.evaluate(() => {
          const entries = performance.getEntriesByType("resource");
          return { requests: entries.length, bytes: entries.reduce((sum, entry) => sum + entry.transferSize, 0),
            hubRequests: entries.filter(entry => entry.name.includes("/hub/")).length };
        });
        const { metrics } = await session.send("Performance.getMetrics");
        const heap = metrics.find(metric => metric.name === "JSHeapUsedSize").value;
        console.log(JSON.stringify({ run, origin, module: module.name, openMs, ...resources, heap }));
        await page.close();
      }
    }
  }
} finally {
  await browser.close();
}
