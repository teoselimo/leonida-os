import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Parcours essentiels LEONIDA OS, exécutés aux formats iPhone (393×852) et iPad paysage (1194×834).
 * Les captures de référence sont écrites dans captures/ (hors test-results, conservées entre exécutions).
 */

const isPhone = (page: Page) => (page.viewportSize()?.width ?? 0) < 760;

/** Parcours historiques sur les données de démonstration (désactivées par défaut depuis la V0.7). */
async function freshStart(page: Page, hash = "", profile: Record<string, unknown> = {}) {
  // amorçage avant tout script de l'app (évite qu'une sauvegarde de la première page écrase le profil de test) ;
  // une seule fois par onglet, pour que les rechargements testent bien la persistance
  await page.addInitScript((p) => {
    if (sessionStorage.getItem("__seeded")) return;
    sessionStorage.setItem("__seeded", "1");
    localStorage.clear();
    localStorage.setItem("leonida-os/progress/v1", JSON.stringify({ schema: 1, rev: 7, showDemo: true, profile: { pseudo: "Joueur", console: "ps5", edition: "standard", preorder: "unknown", chapter: 1, lastMission: null, missionsDone: [], spoilerMode: "strict", ...p } }));
  }, profile);
  await page.goto(`/${hash}`);
  await page.waitForSelector(".app.is-ready");
}

/** Change d'onglet ; sur iPhone, une fiche ouverte masque le dock (comme Plans) : on la referme d'abord. */
async function tab(page: Page, id: "accueil" | "carte" | "radar" | "profil") {
  if (isPhone(page) && (await page.getByTestId("sheet").count())) {
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("sheet")).toHaveCount(0);
  }
  await page.getByTestId(`nav-${id}`).click();
}

async function mapReady(page: Page) {
  await page.waitForFunction(() => {
    const m = (window as unknown as { __leonidaMap?: { isStyleLoaded: () => boolean; isMoving: () => boolean } }).__leonidaMap;
    return !!m && m.isStyleLoaded() && !m.isMoving();
  });
  await page.waitForTimeout(400);
}

/**
 * Carte immobile ET fiche iPhone arrivée à sa détente. La carte se recentre au-dessus de la fiche une fois
 * celle-ci immobile (hauteur connue) : mesurer avant reviendrait à tester un état intermédiaire (cause du run rouge
 * 44910940543 sur main, déjà vue en V0.6 au run 44893496972).
 */
async function mapSettled(page: Page) {
  if (isPhone(page) && (await page.locator(".sheet").count())) await expect(page.locator(".sheet")).toHaveAttribute("data-settled", "true");
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))));
  await mapReady(page);
}

async function pct(page: Page) {
  return Number((await page.getByTestId("progress-pct").innerText()).replace(/\D/g, ""));
}

async function capture(page: Page, name: string, project: string) {
  await page.waitForTimeout(500);
  await page.screenshot({ path: `captures/${project}-${name}.png` });
}

/** Zone de carte réellement visible (hors barre du haut, fiche iPhone, panneau iPad). */
async function visibleMapZone(page: Page) {
  const vp = page.viewportSize()!;
  if (isPhone(page)) {
    const top = (await page.locator(".mapphone__top").boundingBox())!;
    const sheet = await page.locator(".sheet").boundingBox();
    return { left: 0, right: vp.width, top: top.y + top.height, bottom: sheet ? sheet.y : vp.height };
  }
  const panel = (await page.locator(".panel").boundingBox())!;
  return { left: panel.x + panel.width, right: vp.width, top: 60, bottom: vp.height };
}

test.describe("Parcours essentiels", () => {
  test("1 · une recommandation ouvre son emplacement exact sur la carte", async ({ page }, info) => {
    await freshStart(page);
    const hero = page.getByTestId("next-discovery");
    const title = (await hero.locator("h2").innerText()).trim();
    await hero.click();
    await expect(page).toHaveURL(/#carte$/);
    await mapReady(page);
    await expect(page.getByTestId("detail").locator(".detail__title")).toHaveText(title);
    await mapSettled(page);
    const id = await page.evaluate(() => (document.querySelector(".mk.is-selected") as HTMLElement)?.dataset.testid);
    expect(id).toBeTruthy();
    const box = (await page.getByTestId(id!).boundingBox())!;
    const zone = await visibleMapZone(page);
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    expect(cx).toBeGreaterThan(zone.left);
    expect(cx).toBeLessThan(zone.right);
    expect(cy).toBeGreaterThan(zone.top);
    expect(cy).toBeLessThan(zone.bottom);
    await capture(page, "02-fiche-depuis-reco", info.project.name);
  });

  test("2 · la fiche montre prérequis et récompense, puis « Découverte terminée »", async ({ page }) => {
    await freshStart(page);
    await page.getByTestId("next-discovery").click();
    await mapReady(page);
    const detail = page.getByTestId("detail");
    await expect(detail.getByText("Prérequis", { exact: true })).toBeVisible();
    await expect(detail.getByText("Récompense", { exact: true })).toBeVisible();
    await page.getByTestId("complete-btn").click();
    await expect(page.getByTestId("toast")).toContainText("terminée");
    await expect(page.getByTestId("toast")).toContainText("→");
    await expect(detail.getByText(/Terminée le/)).toBeVisible();
  });

  test("3 · la progression et les recommandations se mettent à jour immédiatement", async ({ page }, info) => {
    await freshStart(page);
    const before = await pct(page);
    const countBefore = await page.getByTestId("progress-count").innerText();
    const title = (await page.getByTestId("next-discovery").locator("h2").innerText()).trim();
    await page.getByTestId("next-discovery").click();
    await mapReady(page);
    await page.getByTestId("complete-btn").click();
    await tab(page, "accueil");
    expect(await pct(page)).toBeGreaterThan(before);
    expect(await page.getByTestId("progress-count").innerText()).not.toBe(countBefore);
    await expect(page.getByTestId("next-discovery").locator("h2")).not.toHaveText(title);
    await expect(page.locator(".home .newtag").first()).toBeVisible(); // découverte débloquée signalée « Nouveau »
    await capture(page, "03-accueil-apres", info.project.name);
  });
});

test.describe("Persistance", () => {
  test("progression, réglages et relevés survivent au rechargement", async ({ page }) => {
    await freshStart(page);
    await page.getByTestId("next-discovery").click();
    await mapReady(page);
    await page.getByTestId("complete-btn").click();
    await tab(page, "accueil");
    const after = await pct(page);
    await tab(page, "profil");
    await page.getByTestId("chapter-2").click();
    await page.reload();
    await page.waitForSelector(".app.is-ready");
    await tab(page, "accueil");
    expect(await pct(page)).toBe(after);
    await tab(page, "profil");
    await expect(page.getByTestId("chapter-2")).toHaveAttribute("aria-checked", "true");
  });
});

test.describe("Anti-spoiler", () => {
  test("strict masque, modéré floute, la progression narrative révèle", async ({ page }) => {
    await freshStart(page, "#carte");
    await mapReady(page);
    await expect(page.getByTestId("marker-gr-anomaly")).toBeHidden();
    await tab(page, "radar");
    await expect(page.locator(".note", { hasText: "masqué" })).toBeVisible();
    await expect(page.getByTestId("signal-sig-5")).toHaveCount(0);
    // V0.14 : le bouclier ouvre un menu ; baisser la protection se confirme
    await page.getByTestId("shield").first().click();
    await page.getByTestId("shield-relaxed").click();
    await page.getByTestId("shield-ok").click();
    await expect(page.getByTestId("signal-sig-5").locator(".spoiler")).toBeVisible();
    await tab(page, "carte");
    await expect(page.getByTestId("marker-gr-anomaly")).toBeVisible();
    await expect(page.getByTestId("marker-gr-anomaly").locator("b")).toHaveText("?");
  });
});

test.describe("Navigation", () => {
  test("ancres et onglets", async ({ page }) => {
    await freshStart(page, "#radar");
    await expect(page.getByTestId("nav-radar")).toHaveAttribute("aria-current", "page");
    await expect(page.locator(".radar")).toBeVisible();
    for (const v of ["profil", "carte", "accueil"]) {
      await page.getByTestId(`nav-${v}`).click();
      await expect(page).toHaveURL(new RegExp(`#${v}$`));
      await expect(page.getByTestId(`nav-${v}`)).toHaveAttribute("aria-current", "page");
    }
  });
});

test.describe("Carte", () => {
  test("les tuiles gtadb se chargent", async ({ page }) => {
    const tiles: number[] = [];
    page.on("response", (r) => r.url().includes("/tiles/") && tiles.push(r.status()));
    await freshStart(page, "#carte");
    await mapReady(page);
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.every((s) => s === 200)).toBe(true);
    await expect(page.getByTestId("tile-error")).toHaveCount(0);
  });

  test("MapLibre n'est pas recréé et la caméra est conservée entre les onglets", async ({ page }) => {
    await freshStart(page, "#carte");
    await mapReady(page);
    await page.evaluate(() => (window as unknown as { __leonidaMap: { jumpTo: (o: object) => void } }).__leonidaMap.jumpTo({ center: [-12, -4], zoom: 5 }));
    for (const v of ["radar", "accueil", "profil"]) await page.getByTestId(`nav-${v}`).click();
    await tab(page, "carte");
    const cam = await page.evaluate(() => {
      const w = window as unknown as { __leonidaMap: { getZoom: () => number; getCenter: () => { lng: number } }; __leonidaMapCount: number };
      return { count: w.__leonidaMapCount, zoom: w.__leonidaMap.getZoom(), lng: w.__leonidaMap.getCenter().lng };
    });
    expect(cam.count).toBe(1);
    expect(cam.zoom).toBeCloseTo(5, 1);
    expect(cam.lng).toBeCloseTo(-12, 1);
  });

  test("recherche d'un lieu de la carte communautaire", async ({ page }, info) => {
    await freshStart(page, "#carte");
    await mapReady(page);
    await page.getByTestId("search-btn").first().click();
    await page.getByTestId("search-input").fill("sahara");
    await page.locator("[data-testid^=result-]").first().click();
    await expect(page.getByTestId("landmark")).toContainText("Sahara");
    await mapReady(page);
    await capture(page, "05-lieu", info.project.name);
  });
});

test.describe("Fiche glissante (iPhone)", () => {
  test("toucher agrandit, glisser vers le bas ferme", async ({ page }) => {
    test.skip(!isPhone(page), "Fiche glissante propre au format iPhone");
    await freshStart(page);
    await page.getByTestId("next-discovery").click();
    await mapReady(page);
    const sheet = page.getByTestId("sheet");
    await expect(sheet).toHaveAttribute("data-snap", "half");
    // V0.7 : hauteur fixe, la fiche se déplace par transform (60 fps) → on mesure la position de son bord haut
    const top1 = (await sheet.boundingBox())!.y;
    await page.getByTestId("sheet-grip").click();
    await expect(sheet).toHaveAttribute("data-snap", "full");
    await expect(sheet).toHaveAttribute("data-settled", "true");
    expect((await sheet.boundingBox())!.y).toBeLessThan(top1 - 100);
    const g = (await page.getByTestId("sheet-grip").boundingBox())!;
    await page.mouse.move(g.x + g.width / 2, g.y + 5);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) await page.mouse.move(g.x + g.width / 2, g.y + 5 + i * 110);
    await page.mouse.up();
    await expect(sheet).toHaveCount(0, { timeout: 3000 });
  });
});

test.describe("Fiabilité des relevés", () => {
  test("un relevé personnel n'apparaît jamais comme vérifié", async ({ page }, info) => {
    await freshStart(page, "#carte");
    await mapReady(page);
    if (isPhone(page)) await page.getByTestId("map-menu").click(); // V0.14 : Cartographe dans le menu « ⋯ »
    await page.getByTestId("carto-btn").first().click();
    await page.getByTestId("pick-center").click();
    await page.getByTestId("editor-title").fill("Coffre sous le ponton");
    await capture(page, "06-cartographe", info.project.name);
    await page.getByTestId("editor-save").click();
    await expect(page.getByTestId("toast")).toContainText("Relevé ajouté");
    const id = await page.evaluate(() => JSON.parse(localStorage.getItem("leonida-os/progress/v1")!).custom[0].id);
    await page.getByTestId("carto-btn").first().click();
    // Correctif CI (run 44818934585) : sur iPhone, la carte se recentre encore (fiche qui se ferme, easeTo)
    // au moment du clic ; on attend l'immobilité puis on recentre explicitement sur le relevé avant de le toucher.
    await mapReady(page);
    const marker = page.getByTestId(`marker-${id}`);
    await page.evaluate((mid) => {
      const w = window as unknown as { __leonidaMap: { getContainer: () => HTMLElement; jumpTo: (o: object) => void; unproject: (p: [number, number]) => unknown } };
      const el = document.querySelector(`[data-testid="marker-${mid}"]`)?.parentElement as HTMLElement | null;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const box = w.__leonidaMap.getContainer().getBoundingClientRect();
      const c = w.__leonidaMap.unproject([r.left + r.width / 2 - box.left, r.top + r.height / 2 - box.top]);
      w.__leonidaMap.jumpTo({ center: c });
    }, id);
    await mapReady(page);
    await expect(marker).toBeInViewport();
    await marker.click();
    const detail = page.getByTestId("detail");
    await expect(detail.getByText("MON RELEVÉ")).toBeVisible();
    await expect(detail.getByTestId("rel-personal")).toBeVisible();
    await expect(detail.locator("[data-testid=rel-confirmed], [data-testid=rel-official]")).toHaveCount(0);
  });

  test("un import qui se prétend « officiel » est ramené à « personnel »", async ({ page }) => {
    await freshStart(page, "#profil");
    const forged = { items: [{ id: "x-forge", title: "Faux officiel", x: -500, y: 800, category: "secret", regionId: "vicecity", source: { label: "Rockstar", reliability: "official" }, provenance: { kind: "official", source: "x", checkedAt: "2026" } }] };
    await page.getByTestId("advanced").locator("summary").click(); // V0.14 : Partie › Avancé
    await page.getByTestId("import-open").click();
    await page.getByTestId("import-text").fill(JSON.stringify(forged));
    await page.getByTestId("import-go").click();
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("leonida-os/progress/v1")!).custom[0]);
    expect(stored.source.reliability).toBe("personal");
    expect(stored.provenance.kind).toBe("player");
  });
});

test.describe("Responsive", () => {
  test("aucun débordement horizontal, navigation et cibles tactiles adaptées", async ({ page }, info) => {
    await freshStart(page);
    for (const v of ["accueil", "radar", "profil"]) {
      await page.getByTestId(`nav-${v}`).click();
      // la transition d'onglet (glissement de 24 px, transform seul) doit être terminée avant la mesure
      await page.waitForFunction(() => document.querySelector(".main")!.getAnimations({ subtree: true }).every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity));
      const overflow = await page.evaluate(() => document.querySelector(".main")!.scrollWidth - window.innerWidth);
      expect(overflow, `débordement sur ${v}`).toBeLessThanOrEqual(0);
    }
    const vp = page.viewportSize()!;
    const nav = (await page.locator(".nav").boundingBox())!;
    for (const id of ["nav-accueil", "nav-carte", "nav-radar", "nav-profil"]) {
      const b = (await page.getByTestId(id).boundingBox())!;
      expect(b.height, `${id} hauteur`).toBeGreaterThanOrEqual(44); // cible tactile Apple HIG
    }
    if (isPhone(page)) {
      // V0.7 : dock flottant en bas (marge de sécurité ≤ 40 px)
      expect(vp.height - (nav.y + nav.height)).toBeGreaterThanOrEqual(0);
      expect(vp.height - (nav.y + nav.height)).toBeLessThanOrEqual(40);
    } else {
      expect(nav.x).toBe(0);
      expect(nav.height).toBeGreaterThan(vp.height * 0.9); // rail latéral
      await tab(page, "carte");
      await mapReady(page);
      const panel = (await page.locator(".panel").boundingBox())!;
      const map = (await page.locator(".mapsplit__map").boundingBox())!;
      expect(panel.width).toBeGreaterThan(300);
      expect(map.x).toBeGreaterThanOrEqual(panel.x + panel.width - 1); // carte et recommandations côte à côte
    }
  });

  test("captures de référence", async ({ page }, info) => {
    await freshStart(page);
    await capture(page, "01-accueil", info.project.name);
    await tab(page, "carte");
    await mapReady(page);
    await capture(page, "04-carte", info.project.name);
    await tab(page, "radar");
    await capture(page, "07-radar", info.project.name);
    await tab(page, "profil");
    await capture(page, "08-profil", info.project.name);
  });
});
