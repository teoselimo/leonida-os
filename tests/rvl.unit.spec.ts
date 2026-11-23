import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { RARE_VEHICLES, RVL_BY_ID } from "../src/data/rareVehicles";
import { independentFor, independentTotal, trustFor, type Evidence } from "../src/lib/evidence";
import { findRare, rvlView, withRvl } from "../src/lib/rvl";
import { viewOf } from "../src/lib/garage";
import { migrate } from "../src/lib/store";
import { answer, type AiContext } from "../src/lib/ai/engine";
import { redactorFor } from "../src/lib/spoiler";

/** Rare Vehicle Locator V1 · Sprint 1 — référentiel, modèle de preuve, accessibilité, copilote. */
const prod = JSON.parse(readFileSync("tests/fixtures/radar-prod.json", "utf8"));
const profile = (p: Record<string, unknown> = {}) => ({ pseudo: "", console: "ps5", edition: "standard", preorder: "unknown", chapter: 1, lastMission: null, nextMission: null, missionsDone: [] as string[], spoilerMode: "strict", ...p }) as never;
const st = (p: Record<string, unknown> = {}) => ({ profile: profile(p), vehicles: {}, done: {} });

test("référentiel : 5 véhicules, aucune coordonnée sans justification, inconnu = sans zone", () => {
  expect(RARE_VEHICLES.map((r) => r.id)).toEqual(["v-maibatsu-penumbra-ff", "v-bf-bandito", "v-annis-hellion", "v-karin-futo", "v-declasse-vamos"]);
  for (const r of RARE_VEHICLES) {
    for (const l of r.locations) {
      expect(l.zoneBasis.length).toBeGreaterThan(20);
      if (l.precision === "inconnue") expect(l.zone).toBeNull();
      else expect(l.zone && l.zoneKind).toBeTruthy();
      expect(l.precision).not.toBe("point"); // aucun point exact relevé en jeu à ce jour
      expect(independentFor(r.evidence, l.claims.location).length).toBeGreaterThanOrEqual(2);
    }
    for (const e of r.evidence) expect(e.url ?? "").toMatch(/^https:\/\//);
  }
  // le flux plaçait le Vamos à Port Gellhorn : le référentiel retire cette zone fausse
  expect(RVL_BY_ID.get("v-declasse-vamos")!.locations[0].precision).toBe("inconnue");
});

test("preuves : un repost et deux pages du même site comptent pour une seule source", () => {
  const e = (id: string, url: string, creator: string, origin?: string): Evidence => ({ id, platform: "guide", url, creator, host: new URL(url).hostname, publishedAt: null, collectedAt: "2026-11-23", says: "", stance: "confirme", claims: ["loc:x"], origin });
  const evs = [
    e("a", "https://site-a.com/1", "A"),
    e("a2", "https://site-a.com/2", "A"),
    e("b", "https://b.com/x", "B", "vice.com"),
    e("c", "https://c.com/x", "C", "vice.com"),
  ];
  expect(independentFor(evs, "loc:x")).toHaveLength(2);
  expect(trustFor(evs, "loc:x").trust).toBe("Vérifié");
  expect(trustFor([evs[0], evs[1]], "loc:x").trust).toBe("Probable");
  const contra: Evidence = { ...evs[3], id: "d", url: "https://d.com", host: "d.com", origin: null, stance: "contredit" };
  expect(trustFor([...evs, contra], "loc:x").trust).toBe("Probable");
  const player: Evidence = { ...evs[0], id: "p", platform: "joueur", host: null, url: null, creator: "Théo" };
  expect(trustFor([player], "loc:x").trust).toBe("Non confirmé");
  // la Penumbra : BGR reprend Vice, GTA Xtreme compte une fois malgré ses pages sœurs
  const pen = RVL_BY_ID.get("v-maibatsu-penumbra-ff")!;
  expect(independentTotal(pen.evidence)).toBe(pen.evidence.length);
});

test("présence : fixe ≠ en mouvement ; le Bandito n'est jamais présenté comme garanti à un point", () => {
  expect(RVL_BY_ID.get("v-bf-bandito")!.locations[0].presence).toBe("mobile");
  expect(trustFor(RVL_BY_ID.get("v-bf-bandito")!.evidence, "presence:mobile").nuanced).toBe(true);
  for (const id of ["v-maibatsu-penumbra-ff", "v-annis-hellion", "v-karin-futo", "v-declasse-vamos"]) expect(RVL_BY_ID.get(id)!.locations[0].presence).toBe("fixe");
  const merged = withRvl(prod)!;
  expect(merged.vehicles.find((v: { id: string }) => v.id === "v-bf-bandito").kind).toBe("dynamic");
  const vamos = merged.vehicles.find((v: { id: string }) => v.id === "v-declasse-vamos");
  expect(vamos.location.zone).toBeNull();
  expect(vamos.location.precision).toBe("text");
  // conservation non documentée → plus de règle d'immatriculation déduite
  expect(vamos.keep.mode).toBe("unknown");
});

test("accessibilité : progression et mission préalable prises en compte, jamais « maintenant » par défaut", () => {
  const pen = RVL_BY_ID.get("v-maibatsu-penumbra-ff")!;
  const ban = RVL_BY_ID.get("v-bf-bandito")!;
  expect(rvlView(pen, st({ chapter: 1 })).access).toBe("now");
  expect(rvlView(ban, st({ chapter: 1 })).access).toBe("later");
  expect(rvlView(ban, st({ chapter: 2 })).access).toBe("after-mission");
  expect(rvlView(ban, st({ chapter: 2, missionsDone: ["Daily Driver"] })).access).toBe("now");
  expect(rvlView(ban, st({ chapter: 3 })).access).toBe("now");
  // le garage (carte, accueil) suit la même règle
  const merged = withRvl(prod)!;
  const v = merged.vehicles.find((x: { id: string }) => x.id === "v-annis-hellion");
  expect(viewOf(v, st({ chapter: 2 }) as never).now).toBe(false);
  expect(viewOf(v, st({ chapter: 2, missionsDone: ["Daily Driver"] }) as never).now).toBe(true);
  expect(viewOf(v, st({ chapter: 1 }) as never).hidden).toBe(true); // anti-spoiler strict
  expect(viewOf(v, st({ chapter: 1, spoilerMode: "off" }) as never).hidden).toBe(false);
});

test("anti-spoiler : avant le chapitre 2, ni la mission ni le donneur ne sont nommés", () => {
  const ban = RVL_BY_ID.get("v-bf-bandito")!;
  const ch1 = rvlView(ban, st({ chapter: 1 })).condition;
  expect(ch1).not.toMatch(/Daily Driver|Moses/);
  expect(ch1).toContain("une mission à venir");
  expect(rvlView(ban, st({ chapter: 1, spoilerMode: "off" })).condition).toContain("Daily Driver");
  // au chapitre 2, le rédacteur global masque encore la mission si elle n'est pas accessible
  const red = redactorFor(st({ chapter: 2 }) as never, prod);
  expect(typeof red(rvlView(ban, st({ chapter: 2 })).condition)).toBe("string");
});

test("sauvegarde : preuves du joueur conservées et assainies, rien d'autre n'est touché", () => {
  const saved = { schema: 1, rev: 7, vehicles: { "v-maibatsu-penumbra-ff": { state: "stolen", at: "2026-11-22T10:00:00Z" } }, profile: { chapter: 2 }, proofs: { "v-maibatsu-penumbra-ff": [{ id: "a", kind: "lien", value: "https://youtu.be/x", note: "", at: "2026-11-23T10:00:00Z" }, { id: "bad", kind: "virus", value: 1 }] } };
  const m = migrate(saved as never);
  expect(m.proofs!["v-maibatsu-penumbra-ff"]).toHaveLength(1);
  expect(m.vehicles["v-maibatsu-penumbra-ff"].state).toBe("stolen");
  expect(m.profile.chapter).toBe(2);
});

test("copilote : « la voiture de Paul Walker » → Vespucci, zone documentée, garde au chapitre 2 ; Vamos sans épingle", () => {
  const c = (p: Record<string, unknown> = {}): AiContext => ({ feed: withRvl(prod), state: st(p) as never, places: [] });
  const a = answer("où est la voiture de Paul Walker ?", c());
  expect(a.topic).toEqual({ kind: "vehicle", id: "v-maibatsu-penumbra-ff" });
  expect(a.text).toContain("Vespucci");
  expect(a.text).toMatch(/zone documentée/);
  expect(a.actions[0].label).toMatch(/carte/);
  expect(findRare("le buggy du marais")?.id).toBe("v-bf-bandito");
  const v = answer("où trouver la Declasse Vamos ?", c({ chapter: 3 }));
  expect(v.text).toContain("pas d'épingle");
  expect(v.actions[0].label).toMatch(/fiche/);
  const hidden = answer("où trouver la Declasse Vamos ?", c({ chapter: 1 }));
  expect(hidden.text).not.toMatch(/Daily Driver|Moses|Grayson|2727/);
});
