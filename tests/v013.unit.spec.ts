import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { ESTABLISHMENTS } from "../src/data/establishments";
import { answer } from "../src/lib/ai/engine";
import type { AiContext } from "../src/lib/ai/engine";
import { askCopilot } from "../src/lib/copilot";
import { decideWeb, englishQuery } from "../src/lib/copilot/route";
import type { TurnMetrics } from "../src/lib/copilot/route";
import type { LlmRequest, LlmTransport, WebSearchFn } from "../src/lib/copilot/types";
import { discoverNow } from "../src/lib/discover";
import type { Landmark } from "../src/lib/gtadb";
import { NEAR_RADIUS, placementOf, searchEstablishments } from "../src/lib/places";
import { computeProgress, progDoneKey } from "../src/lib/progress";
import { initialState } from "../src/lib/store";
import type { Profile } from "../src/lib/types";

/**
 * V0.13 — routage local des recherches, établissements à trois niveaux de précision, « À découvrir maintenant ».
 * Progression de référence : la sauvegarde réelle du 22/11 (Swamped et Don Gone terminées, « Talk to Lucia » prévue).
 */
const feed = JSON.parse(readFileSync("tests/fixtures/radar-prod.json", "utf8"));
const rows = JSON.parse(readFileSync("public/data/landmarks.json", "utf8")) as Array<[string, string, number, number, string, string[]]>;
const landmarks: Landmark[] = rows.map(([id, full, x, y, real, tags]) => {
  const parts = full.split(",").map((p) => p.trim());
  return { id, name: parts[0] === "?" ? "Lieu non identifié" : parts[0], district: parts.slice(1).join(", "), x, y, real, tags };
});
const base = initialState();
const real = (patch: Partial<Profile> = {}): Profile => ({ ...base.profile, chapter: 1, edition: "ultimate", preorder: "yes", lastMission: "Don Gone", missionsDone: ["Swamped", "Don Gone"], nextMission: "Talk to Lucia", missionInProgress: false, spoilerMode: "strict", ...patch });
const ctx = (patch: Partial<Profile> = {}, done: Record<string, string> = {}): AiContext => ({ feed, places: landmarks, state: { ...base, profile: real(patch), done } });
function mock(reply = "Ok\n@@@\n{}"): LlmTransport & { calls: LlmRequest[] } {
  const calls: LlmRequest[] = [];
  return { id: "claude-api", label: "mock", calls, available: async () => true, generate: async (r) => (calls.push(r), { text: reply, model: "mock", truncated: false }) };
}
const route = (q: string, c = ctx()) => {
  const draft = answer(q, c);
  return decideWeb({ question: q, draft, ids: draft.evidence ?? [], feed, hasSearch: true, checklist: false });
};

test.describe("Routage des recherches sans appel de planification", () => {
  test("conversation et actions dans l'app : pas de web", () => {
    expect(route("Salut").web).toBe(false);
    expect(route("Merci !").web).toBe(false);
    expect(route("Tu préfères la plage ou la ville ?").web).toBe(false);
    expect(route("J'ai fini Talk to Lucia").web).toBe(false);
  });
  test("données locales sourcées suffisantes : pas de web ; demande explicite : web", () => {
    expect(route("Quelles missions secondaires sont dispo ?")).toMatchObject({ web: false, reason: "local_ok" });
    expect(route("Où est le coiffeur à Key Lento ?")).toMatchObject({ web: false, reason: "local_ok" });
    expect(route("Vérifie sur le web les missions secondaires dispo")).toMatchObject({ web: true, reason: "asked" });
  });
  test("A — « Quels sont les meilleurs magasins de vêtements à Key Lento ? » : recherche automatique (question d'évaluation)", () => {
    expect(route("Quels sont les meilleurs magasins de vêtements à Key Lento ?")).toMatchObject({ web: true, reason: "insufficient" });
  });
  test("question factuelle hors données locales : web", () => {
    expect(route("Où trouver le Skunk Ape la nuit ?").web).toBe(true);
    expect(route("Comment débloquer le salon de tatouage The Inked Mermaid ?").web).toBe(true);
  });
  test("requêtes anglaises : glossaire + noms propres + mission seulement si la question en dépend", () => {
    expect(englishQuery("Quels sont les meilleurs magasins de vêtements à Key Lento ?", "Talk to Lucia").query).toBe('GTA 6 "Key Lento" clothing stores best');
    expect(englishQuery("Dans cette mission, il y a une arme manquable ?", "Talk to Lucia").query).toBe('GTA 6 "Talk to Lucia" weapons missable');
    expect(englishQuery("Comment débloquer le salon de tatouage The Inked Mermaid ?", null).query).toBe('GTA 6 "The Inked Mermaid" tattoo parlor unlock how-to');
    const o = englishQuery("Où trouver une voiture rare cachée ?", "Talk to Lucia");
    expect(o.query).not.toContain("Talk to Lucia");
    expect(o.objective).toMatch(/exclude GTA V/i);
  });
  test("mesure : un seul appel Claude par question avec recherche (contre deux avec l'ancien planificateur)", async () => {
    const search: WebSearchFn = async () => ({ status: "ok", hits: [{ title: "Guide", url: "https://g.example/a", text: "Some facts about clothing stores in Key Lento.", date: null }] });
    const local: TurnMetrics[] = [];
    const old: TurnMetrics[] = [];
    const q = "Quels sont les meilleurs magasins de vêtements à Key Lento ?";
    await askCopilot({ question: q, ctx: ctx(), topic: null, history: [], transport: mock(), search, onMetrics: (m) => local.push(m) });
    await askCopilot({ question: q, ctx: ctx(), topic: null, history: [], transport: { ...mock(), generate: async (r) => ({ text: r.messages.length === 1 ? '{"web":true,"requetes":["GTA 6 Key Lento clothing stores"]}' : "Ok\n@@@\n{}", model: "mock", truncated: false }) }, search, planner: true, onMetrics: (m) => old.push(m) });
    expect(local[0]).toMatchObject({ router: "local", claudeCalls: 1, searches: 1, reason: "insufficient" });
    expect(old[0]).toMatchObject({ router: "planner", claudeCalls: 2 });
  });
  test("G — qualité préservée : la réponse reçoit les preuves locales ET web, la ligne d'état exacte et la progression", async () => {
    const search: WebSearchFn = async () => ({ status: "ok", hits: [{ title: "GTA 6 clothing stores", url: "https://g.example/clothes", text: "Billie's Key Lento Gift Shop and The Wonder Whale sell souvenirs and swimwear.", date: null }] });
    const t = mock();
    await askCopilot({ question: "Quels sont les meilleurs magasins de vêtements à Key Lento ?", ctx: ctx(), topic: null, history: [], transport: t, search });
    const turn = t.calls[0].messages.at(-1)!.content;
    expect(turn).toContain("web:1");
    expect(turn).toContain("The Wonder Whale");
    expect(turn).toContain("1 résultat(s) web");
    expect(turn).toContain("PROGRESSION");
    expect(t.calls[0].messages[0].content).toContain("Jamais une formule vague");
  });
});

test.describe("Établissements : trois niveaux de précision, jamais une zone de quartier", () => {
  const est = (id: string) => ESTABLISHMENTS.find((e) => e.id === id)!;
  test("point (repère du même nom), zone restreinte (voisin cité ou type gtadb unique), inconnue (description seule)", () => {
    expect(placementOf(est("wonder-whale"), landmarks)).toMatchObject({ precision: "repere", landmarkId: "L332" });
    const chuck = placementOf(est("chucks-tackle-shot"), landmarks);
    expect(chuck).toMatchObject({ precision: "zone", radius: NEAR_RADIUS });
    expect(chuck.provenance).toContain("Jason");
    const barnacle = placementOf(est("barnacle-beauties"), landmarks);
    expect(barnacle.precision).toBe("zone");
    expect(barnacle.provenance).toMatch(/type .*non nommé/);
    for (const id of ["billies-gift-shop", "key-lento-kahuna", "leroys", "nifty-threads"]) {
      const p = placementOf(est(id), landmarks);
      expect(p.precision).toBe("inconnue");
      expect(p.x).toBeUndefined();
    }
  });
  test("C — aucune zone ne couvre Key Lento : rayon toujours < 600 unités (l'île en mesure ~2 000)", () => {
    for (const e of ESTABLISHMENTS) {
      const p = placementOf(e, landmarks);
      if (p.precision === "zone") expect(p.radius!).toBeLessThan(600);
    }
  });
  test("une position placée par le joueur passe avant toute estimation (point, provenance datée)", () => {
    const p = placementOf(est("billies-gift-shop"), landmarks, { "billies-gift-shop": { x: -3170, y: -6660, at: "2026-11-22T14:00:00Z", by: "joueur" } });
    expect(p).toMatchObject({ precision: "joueur", x: -3170, y: -6660 });
    expect(p.provenance).toContain("placé par toi");
  });
  test("B — « magasins de vêtements Key Lento » : tous les établissements connus sont trouvables, y compris sans position", () => {
    const r = searchEstablishments("Magasins de vêtements Key Lento").map((e) => e.id);
    for (const id of ["billies-gift-shop", "wonder-whale", "key-lento-kahuna", "leroys", "chucks-tackle-shot"]) expect(r).toContain(id);
    expect(r).not.toContain("rusty-anchor");
    expect(searchEstablishments("Kahuna").map((e) => e.id)).toEqual(["key-lento-kahuna"]);
    expect(searchEstablishments("Magasins Key Lento").length).toBeGreaterThanOrEqual(10);
  });
  test("réponse « magasins » : bouton vers la liste de la carte + l'établissement le mieux situé, jamais de zone de quartier", () => {
    const a = answer("Montre-moi les magasins de vêtements de Key Lento sur la carte", ctx());
    expect(a.actions.some((x) => x.type === "show_place" && x.query === "Magasins de vêtements Key Lento")).toBe(true);
    expect(a.actions.some((x) => x.type === "show_place" && x.estId === "wonder-whale")).toBe(true);
    expect(a.actions.some((x) => x.type === "show_place" && !!x.district)).toBe(false);
    expect(a.text).toMatch(/Billie's Key Lento Gift Shop[^\n]*position non établie/);
    expect(a.text).toMatch(/The Wonder Whale[^\n]*sur la carte/);
  });
});

test.describe("À découvrir maintenant (sauvegarde réelle du 22/11)", () => {
  const s = (done: Record<string, string> = {}) => ({ ...base, profile: real(), done });
  test("D — priorités : pertes définitives vérifiées d'abord ; statut, point de non-retour sans spoiler, sources", () => {
    const items = discoverNow(feed, s());
    expect(items.length).toBeGreaterThanOrEqual(3);
    expect(items[0]).toMatchObject({ cat: "perte", status: "vérifié", importance: "haute" });
    const top = items.slice(0, 4);
    expect(top.every((x) => x.sources.length > 0)).toBe(true);
    for (const x of items) expect(x.noReturn ?? "").not.toContain("Tourist Trap"); // anti-spoiler strict
    expect(items.some((x) => x.name === "Get Shirley's Rum")).toBe(true);
    // une arme ou un véhicule rare n'est pas « haute » importance sans risque de perte documenté
    expect(items.filter((x) => x.cat === "unique" || x.cat === "vehicule").every((x) => x.importance === "normale")).toBe(true);
  });
  test("aucun doublon avec « Rien à manquer » (manquables de la mission) ni avec les éléments déjà affichés", () => {
    const p = real({ nextMission: "Don Gone", missionsDone: ["Swamped"], lastMission: "Swamped", missionInProgress: true });
    const items = discoverNow(feed, { ...base, profile: p, done: {} });
    expect(items.some((x) => /H&L|\.38/.test(x.name))).toBe(false);
    const first = discoverNow(feed, s())[0];
    expect(discoverNow(feed, s(), { exclude: new Set([first.key]) }).some((x) => x.key === first.key)).toBe(false);
  });
  test("E — « Fait » : l'élément sort des suggestions, sa date reste ; une activité cochée ouvre sa suite sans déclarer de mission principale", () => {
    const at = "2026-11-22T14:00:00Z";
    const done = { [progDoneKey("get-shirleys-rum")]: at };
    expect(discoverNow(feed, s(done)).some((x) => x.name === "Get Shirley's Rum")).toBe(false);
    const v = computeProgress({ profile: real(), done });
    expect(v.byId.get("get-shirleys-rum")).toMatchObject({ status: "terminé", how: "déclaré" });
    expect(["accessible", "potentiellement accessible"]).toContain(v.byId.get("steal-the-scooter")!.status);
    // pas de fermeture sur les prérequis : Gear Up & co ne deviennent pas « terminées » par déduction
    expect(v.byId.get("gear-up")!.status).not.toBe("terminé");
    expect(done[progDoneKey("get-shirleys-rum")]).toBe(at);
  });
});
