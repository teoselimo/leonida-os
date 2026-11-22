import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { PROG_BY_ID } from "../src/data/progression";
import { ESTABLISHMENTS } from "../src/data/establishments";
import { answer } from "../src/lib/ai/engine";
import type { AiContext } from "../src/lib/ai/engine";
import { askCopilot } from "../src/lib/copilot";
import type { LlmRequest, LlmTransport, WebSearchFn } from "../src/lib/copilot/types";
import { computeProgress, progressionContext } from "../src/lib/progress";
import { initialState } from "../src/lib/store";
import type { Profile } from "../src/lib/types";

/**
 * V0.12 « Copilote contextuel » — scénarios A à E (logique ; Claude et Exa simulés).
 * Progression de référence : Swamped terminée, Don Gone EN COURS.
 */
const feed = JSON.parse(readFileSync("tests/fixtures/radar-prod.json", "utf8"));
const base = initialState();
const prof = (patch: Partial<Profile> = {}): Profile => ({ ...base.profile, chapter: 1, lastMission: "Swamped", missionsDone: ["Swamped"], nextMission: "Don Gone", missionInProgress: true, spoilerMode: "strict", ...patch });
const ctx = (patch: Partial<Profile> = {}): AiContext => ({ feed, places: [], state: { ...base, profile: prof(patch) } });
function mock(reply: (r: LlmRequest, i: number) => string): LlmTransport & { calls: LlmRequest[] } {
  const calls: LlmRequest[] = [];
  return { id: "claude-api", label: "mock", calls, available: async () => true, generate: async (r) => (calls.push(r), { text: reply(r, calls.length - 1), model: "mock", truncated: false }) };
}

test.describe("Moteur de progression", () => {
  test("statuts : Swamped terminée (déclarée), prérequis explicites déduits, Don Gone en cours, suite verrouillée, fenêtres passées", () => {
    const v = computeProgress({ profile: prof() });
    const st = (id: string) => v.byId.get(id)!;
    expect(st("swamped")).toMatchObject({ status: "terminé", how: "déclaré" });
    for (const id of ["day-release", "clear-skies", "down-to-earth", "buck-me"]) expect(st(id)).toMatchObject({ status: "terminé", how: "déduit" });
    expect(st("don-gone").status).toBe("en cours");
    expect(st("recalibration").status).toBe("verrouillé");
    expect(st("ring-the-bell").status).toBe("plus disponible");
    expect(st("donnie-drop-off").status).toBe("plus disponible");
    expect(st("donnies-lost-drugs").status).toBe("accessible");
    // l'ordre du Story Recap ne vaut pas preuve : Pipework n'est « que » probablement faite, et ce qui en dépend reste « potentiel »
    expect(st("pipework")).toMatchObject({ status: "inconnu", likelyDone: true });
    expect(st("get-shirleys-rum").status).toBe("potentiellement accessible");
  });
  test("plusieurs missions accessibles en même temps (pas de « prochaine mission » unique supposée)", () => {
    const v = computeProgress({ profile: prof({ missionsDone: ["Down to Earth"], lastMission: "Down to Earth", nextMission: null, missionInProgress: false }) });
    expect(v.byId.get("clear-skies")!.status).not.toBe("verrouillé");
    expect(v.byId.get("day-release")!.status).not.toBe("verrouillé");
  });
  test("contexte permanent transmis à Claude, sans spoiler en mode complet", () => {
    const strict = progressionContext({ profile: prof() });
    expect(strict).toContain("EN COURS : Don Gone");
    expect(strict).toContain("Donnie's H&L .38");
    expect(strict).not.toContain("Recalibration");
    expect(strict).not.toContain("Tourist Trap");
    expect(strict).toContain("une mission principale à venir (après Don Gone)");
    expect(progressionContext({ profile: prof({ spoilerMode: "off" }) })).toContain("Recalibration (après Don Gone)");
  });
});

test.describe("Progression réelle du joueur (sauvegarde du 22/11, 04:03 UTC)", () => {
  test("Don Gone terminée, « Talk to Lucia » prévue : reconnue comme Recalibration, point de non-retour juste après, sans le nommer", () => {
    const p = prof({ missionsDone: ["Swamped", "Don Gone"], lastMission: "Don Gone", nextMission: "Talk to Lucia", missionInProgress: false });
    const v = computeProgress({ profile: p });
    expect(v.planned?.node.id).toBe("recalibration");
    expect(v.byId.get("don-gone")!.status).toBe("terminé");
    const c = progressionContext({ profile: p });
    expect(c).toContain("Prochaine mission choisie (pas lancée) : Recalibration (« Talk to Lucia » sur la carte)");
    expect(c).toContain("Point de non-retour à venir (juste après Recalibration)");
    expect(c).not.toContain("Tourist Trap");
  });
});

test.describe("Scénarios", () => {
  test("A — « Je peux faire quoi maintenant ? » sans nommer la mission : réponse ancrée sur Don Gone en cours", async () => {
    const a = answer("Je peux faire quoi maintenant ?", ctx());
    expect(a.intent).toBe("what_now");
    expect(a.text).toContain("Don Gone");
    expect(a.text).toMatch(/revolver|H&L/i);
    expect(a.text).toContain("Donnie's Lost Drugs");
    expect(a.text).not.toContain("Recalibration");
    const t = mock(() => "Ok.\n@@@\n{}");
    await askCopilot({ question: "Je peux faire quoi maintenant ?", ctx: ctx(), topic: null, history: [], transport: t });
    expect(t.calls.at(-1)!.messages.at(-1)!.content).toContain("EN COURS : Don Gone");
  });
  test("B — « J'ai terminé » : Don Gone proposée à la confirmation, puis ce qui s'ouvre réellement (pas d'ordre inventé)", () => {
    const a = answer("J'ai terminé !", ctx());
    expect(a.intent).toBe("mission_done");
    expect(a.actions[0]).toMatchObject({ type: "set_mission", name: "Don Gone" });
    expect(a.text).toContain("Recalibration");
    expect(a.text).toMatch(/point de non-retour/i);
    const n = answer("J'attaque la suivante", ctx());
    expect(n.intent).toBe("next_start");
    expect(n.actions[0]).toMatchObject({ type: "set_mission", name: "Don Gone" }); // d'abord confirmer la fin de Don Gone
  });
  test("« C'est bon je l'ai » : plusieurs objets possibles → l'app demande lequel (aucune validation supposée)", () => {
    const a = answer("C'est bon je l'ai", ctx());
    expect(a.intent).toBe("got_item");
    expect(a.actions.length).toBeGreaterThan(1);
    expect(a.actions.every((x) => x.type === "objective_done" && "confirm" in x)).toBe(true);
  });
  test("C — « Meilleurs magasins de vêtements à Key Lento » : référentiel confirmé + recherche web automatique (sans le demander), UN seul appel Claude", async () => {
    const a = answer("Meilleurs magasins de vêtements à Key Lento", ctx());
    expect(a.intent).toBe("shops");
    expect(a.text).toContain("The Wonder Whale");
    expect(a.text).toContain("position non établie"); // Billie's, Kahuna, Leroy's : aucune coordonnée inventée
    expect(a.text).toContain("Nifty Threads Island Wear"); // comté de Mariana, île non précisée : signalé à part
    expect(a.actions.some((x) => x.type === "show_place" && x.query?.includes("Key Lento"))).toBe(true);
    expect(a.actions.some((x) => x.type === "show_place" && !!x.district)).toBe(false); // plus de zone de quartier
    const queries: string[] = [];
    const search: WebSearchFn = async (q) => (queries.push(q), { status: "ok", hits: [{ title: "Clothing stores", url: "https://guide.example/clothes", text: "Billie's Key Lento Gift Shop sells tops.", date: null }] });
    const t = mock(() => "Voilà.\n@@@\n{}");
    const c = await askCopilot({ question: "Meilleurs magasins de vêtements à Key Lento", ctx: ctx(), topic: null, history: [], transport: t, search });
    expect(queries).toEqual(['GTA 6 "Key Lento" clothing stores best']); // requête anglaise construite localement
    expect(t.calls).toHaveLength(1); // plus d'appel de planification
    expect(c.web?.status).toBe("ok");
  });
  test("D — activité secondaire verrouillée : prérequis documenté expliqué, sans nommer une mission principale future en mode complet", () => {
    const a = answer("Quelles missions secondaires sont dispo ?", ctx({ missionsDone: ["Swamped", "Gear Up", "Lab Fees", "Just a Scratch", "Unwanted Attention"] }));
    expect(a.intent).toBe("side_list");
    expect(a.text).toContain("Steal the Scooter (après Get Shirley's Rum)");
    expect(a.text).not.toContain("Tourist Trap");
    expect(a.text).toContain("Ring the Bell!");
  });
  test("E — objet manquable à l'emplacement incertain : l'incertitude est conservée jusqu'au contexte de Claude", () => {
    const node = PROG_BY_ID.get("don-gone")!;
    const saved = node.missables;
    node.missables = [{ text: "Objet de test caché quelque part", when: "pendant", locationCertain: false, sources: [{ name: "Test", url: "https://t.example" }] }];
    try {
      expect(progressionContext({ profile: prof() })).toContain("Objet de test caché quelque part (emplacement incertain)");
      expect(answer("Je risque de manquer quoi ?", ctx()).text).toContain("(emplacement incertain)");
    } finally {
      node.missables = saved;
    }
  });
});

test.describe("Recherche web automatique", () => {
  const hits = [{ title: "Guide", url: "https://g.example/a", text: "Some facts.", date: null }];
  test("salutation : ni planificateur ni recherche", async () => {
    let n = 0;
    const search: WebSearchFn = async () => (n++, { status: "ok", hits });
    const t = mock(() => "Salut !\n@@@\n{}");
    await askCopilot({ question: "Salut", ctx: ctx(), topic: null, history: [], transport: t, search });
    expect(n).toBe(0);
    expect(t.calls).toHaveLength(1);
  });
  test("question factuelle sans « recherche » : Exa est lancé sans appel de planification ; une question d'avis n'en déclenche pas", async () => {
    let n = 0;
    const search: WebSearchFn = async () => (n++, { status: "ok", hits });
    const t1 = mock(() => "Ok\n@@@\n{}");
    await askCopilot({ question: "Combien coûte la coupe Caesar chez Barnacle Beauties ?", ctx: ctx(), topic: null, history: [], transport: t1, search });
    expect(n).toBe(1);
    expect(t1.calls).toHaveLength(1);
    const t2 = mock(() => "La plage !\n@@@\n{}");
    await askCopilot({ question: "Tu préfères la plage ou la ville ?", ctx: ctx(), topic: null, history: [], transport: t2, search });
    expect(n).toBe(1);
    expect(t2.calls).toHaveLength(1);
  });
  test("ancien planificateur (comparaison A/B) : toujours disponible, 2 appels Claude", async () => {
    let n = 0;
    const search: WebSearchFn = async () => (n++, { status: "ok", hits });
    const t = mock((r, i) => (i === 0 ? '{"web":true,"requetes":["GTA 6 Barnacle Beauties haircut prices"]}' : "Ok\n@@@\n{}"));
    const seen: Array<{ claudeCalls: number; router: string }> = [];
    await askCopilot({ question: "Combien coûte la coupe Caesar chez Barnacle Beauties ?", ctx: ctx(), topic: null, history: [], transport: t, search, planner: true, onMetrics: (m) => seen.push(m) });
    expect(n).toBe(1);
    expect(t.calls).toHaveLength(2);
    expect(seen[0]).toMatchObject({ router: "planner", claudeCalls: 2 });
  });
  test("aucun résultat : une reformulation avant d'abandonner, statut honnête", async () => {
    const queries: string[] = [];
    const search: WebSearchFn = async (q) => (queries.push(q), { status: "empty", hits: [] });
    const t = mock(() => "Rien trouvé.\n@@@\n{}");
    const c = await askCopilot({ question: "Où trouver le Skunk Ape la nuit ?", ctx: ctx(), topic: null, history: [], transport: t, search });
    expect(queries).toHaveLength(2);
    expect(c.web).toMatchObject({ status: "empty", tries: 2 });
    expect(t.calls.at(-1)!.messages.at(-1)!.content).toContain("ce n'est pas une preuve d'inexistence");
  });
  test("connecteur non branché : pas de reformulation inutile, Claude prévenu", async () => {
    const queries: string[] = [];
    const search: WebSearchFn = async (q) => (queries.push(q), { status: "not_connected", hits: [] });
    const t = mock(() => "Ok\n@@@\n{}");
    await askCopilot({ question: "Où trouver le Skunk Ape la nuit ?", ctx: ctx(), topic: null, history: [], transport: t, search });
    expect(queries).toHaveLength(1);
    expect(t.calls.at(-1)!.messages.at(-1)!.content).toContain("ne prétends pas avoir cherché");
  });
});

test.describe("Référentiel d'établissements", () => {
  test("chaque établissement a des sources et une vérification ; aucune position sans repère réel ou indication sourcée", () => {
    const ids = new Set((JSON.parse(readFileSync("public/data/landmarks.json", "utf8")) as [string, string][]).map((r) => r[0]));
    for (const e of ESTABLISHMENTS) {
      expect(e.sources.length).toBeGreaterThan(0);
      if (e.verification === "confirmé") expect(new Set(e.sources.map((s) => new URL(s.url).host)).size).toBeGreaterThanOrEqual(2);
      if (e.position?.landmarkId) expect(ids.has(e.position.landmarkId)).toBe(true);
    }
  });
});
