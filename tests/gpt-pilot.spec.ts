import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";

const prod = JSON.parse(readFileSync("tests/fixtures/radar-prod.json", "utf8"));
const phone = (page: Page) => (page.viewportSize()?.width ?? 0) < 760;

async function start(page: Page, hash = "#accueil") {
  await page.route("**/__live/radar.json*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(prod) }));
  await page.addInitScript(() => {
    if (sessionStorage.getItem("__gpt-test-init")) return;
    sessionStorage.setItem("__gpt-test-init", "1");
    localStorage.clear();
    localStorage.setItem("leonida-os/radar-url", location.origin + "/__live/radar.json");
  });
  await page.goto("/" + hash);
  await page.waitForSelector(".app.is-ready");
}

test("P0 #12 : le chat iPhone est défilable sans déclencher la fermeture par le contenu", async ({ page }) => {
  test.skip(!phone(page), "Panneau iPad séparé");
  await start(page);
  await page.getByTestId("ai-open").click();
  await expect(page.getByTestId("ai-sheet")).toHaveAttribute("data-snap", "full");
  const input = page.getByTestId("ai-input");
  for (const q of [
    "Où trouver la Penumbra FF ?", "Et comment la garder ?", "Quelle mission préparer ?",
    "Je cherche une activité", "Et un commerce ?", "Que faire dans les Keys ?", "Un secret ?",
  ]) {
    await input.fill(q);
    await input.press("Enter");
  }
  const snapshot = await page.evaluate(() => {
    const list = document.querySelector('[data-testid="ai-list"]') as HTMLElement;
    const sheet = document.querySelector('[data-testid="ai-sheet"]') as HTMLElement;
    list.scrollTop = 0;
    const before = sheet.style.transform;
    const trigger = (name: string, y: number) => {
      const ev = new Event(name, { bubbles: true, cancelable: true });
      Object.defineProperty(ev, "touches", { value: [{ clientY: y }] });
      Object.defineProperty(ev, "changedTouches", { value: [{ clientY: y }] });
      list.dispatchEvent(ev);
      return ev.defaultPrevented;
    };
    trigger("touchstart", 240);
    const prevented = trigger("touchmove", 320);
    trigger("touchend", 320);
    list.scrollTop = list.scrollHeight;
    return { before, after: sheet.style.transform, prevented, scrollHeight: list.scrollHeight, clientHeight: list.clientHeight, scrollTop: list.scrollTop };
  });
  expect(snapshot.prevented).toBe(false);
  expect(snapshot.before).toBe(snapshot.after);
  expect(snapshot.scrollHeight).toBeGreaterThan(snapshot.clientHeight);
  expect(snapshot.scrollTop).toBeGreaterThan(0);
  await expect(page.getByTestId("ai-sheet")).toBeVisible();
  await expect(page.getByRole("button", { name: "Fermer LEONIDA AI" })).toBeVisible();
});

test("P0 #13 : index de la carte, sélection commerce accessible iPhone / iPad", async ({ page }) => {
  await start(page, "#carte");
  await page.getByTestId("poi-index-btn").click();
  await expect(page.getByTestId("poi-index")).toBeVisible();
  await expect(page.getByTestId("poi-index-commerce")).toContainText("Commerces");
  await page.getByTestId("poi-index-commerce").click();
  await expect(page.getByTestId("poi-index")).toHaveCount(0);
  await expect(page.getByTestId("poi-commerce")).toHaveAttribute("aria-pressed", "true");
});
