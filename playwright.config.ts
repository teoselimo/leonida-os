import { defineConfig, devices } from "@playwright/test";

/**
 * Tests LEONIDA OS — exécutés contre l'export statique (./out, ou SERVE_DIR=out-artifact).
 *   npm run test:all        typecheck + build + tous les tests
 *   npx playwright test     tests seuls (build déjà fait)
 * Navigateur : Chromium de Playwright (`npx playwright install chromium`) ou CHROME_PATH=/chemin/vers/chrome.
 */
const PORT = Number(process.env.PORT || 4321);
const SERVE_DIR = process.env.SERVE_DIR || "out";

export default defineConfig({
  testDir: "tests",
  timeout: 60_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never", outputFolder: "test-report" }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    launchOptions: {
      // WebGL logiciel : la carte MapLibre fonctionne aussi en CI sans GPU
      args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
      ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
    },
  },
  webServer: {
    command: `node scripts/serve.mjs ${SERVE_DIR} ${PORT}`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: "unit", testMatch: /unit\.spec\.ts/ },
    {
      name: "iphone",
      testMatch: /(e2e|live|v07|v071|pilote|enpartie)\.spec\.ts/,
      use: { viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: devices["iPhone 15 Pro"].userAgent },
    },
    {
      name: "ipad",
      testMatch: /(e2e|live|v07|v071|pilote|enpartie)\.spec\.ts/,
      use: { viewport: { width: 1194, height: 834 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: devices["iPad Pro 11"].userAgent },
    },
    // Moteur de Safari (WebKit) : parcours V0.7.1 au format iPhone. Ce n'est pas un iPhone réel (voir docs/V0.7.1.md).
    {
      name: "iphone-webkit",
      testMatch: /(v071|pilote|enpartie)\.spec\.ts/,
      use: { browserName: "webkit", viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: devices["iPhone 15 Pro"].userAgent, launchOptions: {} },
    },
  ],
});
