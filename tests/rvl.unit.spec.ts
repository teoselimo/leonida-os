import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { RARE_VEHICLES, RVL_BY_ID } from "../src/data/rareVehicles";
import { independentFor, independentTotal, trustFor, type Evidence } from "../src/lib/evidence";
import { findRare, orderKey, rvlView, v016Check, withRvl } from "../src/lib/rvl";
import { viewOf } from "../src/lib/garage";
import { migrate } from "../src/lib/store";
import { answer, type AiContext } from "../src/lib/ai/engine";
import { buildJournal } from "../src/lib/journal";
import { execFileSync } from "node:child_process";

/** Rare Vehicle Locator V0.16.1 — positions calibrées, trois fiabilités, ordre des commandes de Moses, visuels. */
const prod = JSON.parse(readFileSync("tests/fixtures/radar-prod.json", "utf8"));
const profile = (p: Record<string, unknown> = {}) => ({ pseudo: "", console: "ps5", edition: "standard", preorder: "unknown", chapter: 1, lastMission: null, nextMission: null, missionsDone: [] as string[], spoilerMode: "strict", ...p }) as never;
const st = (p: Record<string, unknown> = {}, done: Record<string, string> = {}) => ({ profile: profile(p), vehicles: {}, done });
const AT = "2026-11-23T10:00:00Z";

test("référentiel : 5 véhicules localisés au bâtiment ou au parcours, chaque position avec méthode, marge, sources, date et statut", () => {
  expect(RARE_VEHICLES.map((r) => r.id)).toEqual(["v-maibatsu-penumbra-ff", "v-karin-futo", "v-annis-hellion", "v-bf-bandito", "v-declasse-vamos"]);
  for (const r of RARE_VEHICLES) {
    const l = r.locations[0];
    expect(["point", "parcours"]).toContain(l.precision);
    const p = l.point!;
    expect(p.errorM).toBeGreaterThan(0);
    expect(p.errorM).toBeLessThanOrEqual(40);
    expect(p.methodNote.length).toBeGreaterThan(60);
    expect(p.check.length).toBeGreaterThan(30);
    expect(p.date).toBe("2026-11-23");
    expect(p.status).toBe("calibre"); // aucune position n'est déclarée testée en jeu
    for (const id of p.sources) expect(r.evidence.some((e) => e.id === id)).toBe(true);
    expect(independentFor(r.evidence, l.claims.location).length).toBeGreaterThanOrEqual(2);
    for (const e of r.evidence) expect(e.url ?? "").toMatch(/^https:\/\//);
  }
  // le Bandito est un parcours, pas un point d'apparition
  const b = RVL_BY_ID.get("v-bf-bandito")!.locations[0];
  expect(b.precision).toBe("parcours");
  expect(b.route!.lines.length).toBeGreaterThanOrEqual(3);
  expect(b.presence).toBe("mobile");
});

test("calibrations rejouables : les fichiers du dépôt redonnent les positions annoncées", () => {
  const run = (f: string) => JSON.parse(execFileSync("python3", ["scripts/rvl_calibrate.py", `docs/rvl-calibration/${f}`], { encoding: "utf8" }));
  const futo = run("futo-gtaboom.json");
  const [fx, fy] = futo.queries["pointe du marqueur"];
  expect(Math.hypot(fx - -7640, fy - 4681)).toBeLessThan(12); // contrôle GTA6GPS
  expect(Math.abs(futo.queries["bâtiment extrémité ouest"][0] - -7671)).toBeLessThan(5); // contrôle fond GTADB
  const band = run("bandito-gtaboom.json");
  const [bx, by] = band.queries["pointe du marqueur Bandito"];
  expect(Math.hypot(bx - -3566, by - 1707)).toBeLessThan(10);
  expect(band.rms_loo).toBeLessThan(30);
  const vamos = run("vamos-pushsquare.json");
  expect(vamos.rms_loo).toBeLessThan(25);
  const [vx, vy] = vamos.queries["marqueur Vamos"];
  expect(Math.hypot(vx - RVL_BY_ID.get("v-declasse-vamos")!.locations[0].point!.x, vy - RVL_BY_ID.get("v-declasse-vamos")!.locations[0].point!.y)).toBeLessThan(35);
});

test("comparaison V0.16 : seule la zone de la Penumbra contenait la voiture", () => {
  const c = Object.fromEntries(RARE_VEHICLES.map((r) => [r.id, v016Check(r.locations[0])]));
  expect(c["v-maibatsu-penumbra-ff"]!.contained).toBe(true);
  expect(c["v-karin-futo"]!.contained).toBe(false);
  expect(c["v-annis-hellion"]!.contained).toBe(false);
  expect(c["v-bf-bandito"]!.contained).toBe(false);
  expect(c["v-declasse-vamos"]).toBeNull();
});

test("preuves : un repost et deux pages d'une même origine comptent pour une seule source", () => {
  const e = (id: string, url: string, creator: string, origin?: string): Evidence => ({ id, platform: "guide", url, creator, host: new URL(url).hostname, publishedAt: null, collectedAt: "2026-11-23", says: "", stance: "confirme", claims: ["loc:x"], origin });
  const evs = [e("a", "https://site-a.com/1", "A"), e("a2", "https://site-a.com/2", "A"), e("b", "https://b.com/x", "B", "vice.com"), e("c", "https://c.com/x", "C", "vice.com")];
  expect(independentFor(evs, "loc:x")).toHaveLength(2);
  expect(trustFor(evs, "loc:x").trust).toBe("Vérifié");
  const player: Evidence = { ...evs[0], id: "p", platform: "joueur", host: null, url: null, creator: "Théo" };
  expect(trustFor([player], "loc:x").trust).toBe("Non confirmé");
  // Penumbra : GTA Culture et la vidéo Maka91 ont la même origine, GamesHorizon et FandomWire aussi
  const pen = RVL_BY_ID.get("v-maibatsu-penumbra-ff")!;
  expect(independentTotal(pen.evidence)).toBeLessThan(pen.evidence.length);
});

test("trois fiabilités distinctes : l'existence vérifiée ne rend pas l'emplacement « Vérifié »", () => {
  const v = rvlView(RVL_BY_ID.get("v-maibatsu-penumbra-ff")!, st());
  expect(v.existence.trust).toBe("Vérifié");
  expect(v.location.label).toBe("Calibré à ±35 m, non testé en jeu");
  expect(v.location.tested).toBe(false);
  expect(v.presence.guaranteed).toBe(true);
  const b = rvlView(RVL_BY_ID.get("v-bf-bandito")!, st({ chapter: 2 }));
  expect(b.presence.guaranteed).toBe(false);
  expect(b.location.label).toMatch(/^Parcours tracé/);
});

test("ordre des commandes de Moses : jamais « maintenant » sans commande reçue, même après la mission d'introduction", () => {
  const ban = RVL_BY_ID.get("v-bf-bandito")!;
  const futo = RVL_BY_ID.get("v-karin-futo")!;
  expect(rvlView(ban, st({ chapter: 1 })).access).toBe("later");
  expect(rvlView(ban, st({ chapter: 2 })).access).toBe("after-mission");
  expect(rvlView(ban, st({ chapter: 2, missionsDone: ["Daily Driver"] })).access).toBe("order-pending");
  expect(rvlView(ban, st({ chapter: 3 })).access).toBe("order-pending"); // chapitre 3 : la mission est faite, la commande pas forcément
  expect(rvlView(ban, st({ chapter: 2, missionsDone: ["Daily Driver"] }, { [orderKey(ban.id)]: AT })).access).toBe("now");
  // lot 1 (Futo) vs lot 2 (Bandito) : l'ordre documenté est affiché
  expect(rvlView(futo, st({ chapter: 2, missionsDone: ["Daily Driver"] })).condition).toContain("premières commandes");
  expect(rvlView(ban, st({ chapter: 2, missionsDone: ["Daily Driver"] })).condition).toContain("Declasse Yosemite 1500 et Karin Futo");
  // lieu et commande distingués
  const v = rvlView(ban, st({ chapter: 2, missionsDone: ["Daily Driver"] }));
  expect(v.place).toContain("Lieu accessible");
  expect(v.mission).toContain("pas encore reçue");
  // le garage (carte, accueil) suit la même règle
  const merged = withRvl(prod)!;
  const h = merged.vehicles.find((x: { id: string }) => x.id === "v-annis-hellion");
  expect(viewOf(h, st({ chapter: 2, missionsDone: ["Daily Driver"] }) as never).now).toBe(false);
  expect(viewOf(h, st({ chapter: 2, missionsDone: ["Daily Driver"] }, { [orderKey("v-annis-hellion")]: AT }) as never).now).toBe(true);
  expect(viewOf(h, st({ chapter: 1 }) as never).hidden).toBe(true);
  // la commande reçue apparaît dans le journal, annulable
  const j = buildJournal({ ...st({ chapter: 2 }, { [orderKey("v-annis-hellion")]: AT }), pins: {} } as never, merged);
  expect(j.find((e) => e.id === orderKey("v-annis-hellion"))?.name).toContain("Commande reçue");
});

test("anti-spoiler : avant le chapitre 2, ni la mission, ni le donneur, ni les véhicules du lot ne sont nommés", () => {
  const ban = RVL_BY_ID.get("v-bf-bandito")!;
  const ch1 = rvlView(ban, st({ chapter: 1 })).condition;
  expect(ch1).not.toMatch(/Daily Driver|Moses|Yosemite|Futo/);
  expect(ch1).toContain("une mission à venir");
  expect(rvlView(ban, st({ chapter: 1, spoilerMode: "off" })).condition).toContain("Daily Driver");
});

test("withRvl : le point validé du flux est conservé, la position calibrée ne devient jamais une épingle « validée »", () => {
  const feed = { vehicles: prod.vehicles.map((v: { id: string; location: object }) => (v.id === "v-karin-futo" ? { ...v, location: { ...v.location, point: { x: 1, y: 2 } } } : v)) };
  const m = withRvl(feed)!;
  const futo = m.vehicles.find((v: { id: string }) => v.id === "v-karin-futo")!;
  expect(futo.location.point).toEqual({ x: 1, y: 2 });
  const pen = withRvl(prod)!.vehicles.find((v: { id: string }) => v.id === "v-maibatsu-penumbra-ff")!;
  expect(pen.location.point).toBeNull();
  expect(pen.location.zone!.radius).toBe(35);
  const vamos = withRvl(prod)!.vehicles.find((v: { id: string }) => v.id === "v-declasse-vamos")!;
  expect(vamos.location.precision).toBe("zone");
  expect(vamos.keep.mode).toBe("unknown");
});

test("visuels : aucune image sans droits établis, toujours une vidéo de référence et la possibilité d'une capture", () => {
  for (const r of RARE_VEHICLES) {
    expect(r.visual.image).toBeNull();
    expect(r.visual.video.url).toMatch(/^https:\/\/www\.youtube\.com\/watch\?v=[\w-]{11}$/);
    expect(r.visual.rightsNote).toContain("capture");
  }
});

test("sauvegarde : preuves et commandes du joueur conservées et assainies, rien d'autre n'est touché", () => {
  const saved = { schema: 1, rev: 7, done: { [orderKey("v-karin-futo")]: AT, "prog:x": AT }, vehicles: { "v-maibatsu-penumbra-ff": { state: "stolen", at: AT } }, profile: { chapter: 2 }, proofs: { "v-maibatsu-penumbra-ff": [{ id: "a", kind: "capture", value: "data:image/jpeg;base64,xx", note: "visuel", at: AT }, { id: "bad", kind: "virus", value: 1 }] } };
  const m = migrate(saved as never);
  expect(m.proofs!["v-maibatsu-penumbra-ff"]).toHaveLength(1);
  expect(m.done[orderKey("v-karin-futo")]).toBe(AT);
  expect(m.done["prog:x"]).toBe(AT);
  expect(m.vehicles["v-maibatsu-penumbra-ff"].state).toBe("stolen");
});

test("copilote : position calibrée annoncée comme telle, commande de Moses prise en compte, anti-spoiler", () => {
  const c = (p: Record<string, unknown> = {}, done: Record<string, string> = {}): AiContext => ({ feed: withRvl(prod), state: st(p, done) as never, places: [] });
  const a = answer("où est la voiture de Paul Walker ?", c());
  expect(a.topic).toEqual({ kind: "vehicle", id: "v-maibatsu-penumbra-ff" });
  expect(a.text).toContain("Vespucci");
  expect(a.text).toMatch(/calibré à ±35 m, non testé en jeu/);
  expect(findRare("le buggy du marais")?.id).toBe("v-bf-bandito");
  const v = answer("où trouver la Declasse Vamos ?", c({ chapter: 2, missionsDone: ["Daily Driver"] }));
  expect(v.text).toMatch(/commande de Moses n'est pas encore confirmée/);
  expect(v.text).toMatch(/Grayson/);
  const hidden = answer("où trouver la Declasse Vamos ?", c({ chapter: 1 }));
  expect(hidden.text).not.toMatch(/Daily Driver|Moses|Grayson|2727/);
});
