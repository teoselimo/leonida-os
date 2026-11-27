import type { Page } from "@playwright/test";

export async function openMapLayers(page: Page) {
  const toggle = page.getByTestId("map-layers");
  if (await toggle.isVisible() && await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
}

export async function openMapFilters(page: Page) {
  await openMapLayers(page);
  const toggle = page.getByTestId("filter-more");
  if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
}
