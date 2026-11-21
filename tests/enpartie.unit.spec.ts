import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import type { AiContext } from "../src/lib/ai/engine";
import { askCopilot } from "../src/lib/copilot";
import { playerContext } from "../src/lib/copilot/context";
import type { LlmRequest, LlmTransport, WebSearchFn } from "../src/lib/copilot/types";
import { spoilerVisibility } from "../src/lib/feed";
import type { Landmark } from "../src/lib/gtadb";
import { missionVisible } from "../src/lib/missions";
import { POI_CATS } from "../src/lib/poi";
import { parseHits } from "../src/lib/runtime/web";
import { initialState, migrate } from "../src/lib/store";

/**
 * V0.8 « En partie » — anti-spoiler 3 niveaux, mission en cours, « Rien à manquer », recherche web (connecteur simulé).
 */
const feed = JSON.parse(readFileSync("tests/fixtures/radar-prod.json", "utf8"));
const rows: [string, string, number, number, string, string[]][] = JSON.parse(readFileSync("public/data/landmarks.json", "utf8"));
const landmarks: Landmark[] = rows.map(([id, full, x, y, real, tags]) => {
  const parts = full.split(",").map((p) => p.trim());
  return { id, name: parts[0] === "?" ? "Lieu non identifié" : parts[0].replace(/"/g, ""), district: parts.slice(1).join(", "), x, y, real, tags };
});
const base = initialState();
const ctx = (patch: Record<string, unknown> = {}): AiContext => ({
  feed,
  places: landmarks,
  state: { ...base, profile: { ...base.profile, console: "ps5", edition: "standard", chapter: 1, nextMission: "Swamped", missionInProgress: true, missionsDone: [], ...patch } },
});
function mock(reply: string | ((r: LlmRequest) => string)): LlmTransport & { calls: LlmRequest[] } {
  const calls: LlmRequest[] = [];
  return {
    id: "claude-api",
    label: "Mock",
    calls,
    available: async () => true,
    generate: async (r) => {
      calls.push(r);
      return { text: typeof reply === "function" ? reply(r) : reply, model: "Claude (test)", truncated: false };
    },
  };
}

test.describe("Anti-spoiler : complet, léger, aucun", () => {
  const ahead = feed.items.find((r: { details?: { chapter?: { value: number } } }) => (r.details?.chapter?.value ?? 0) > 1);
  test("une fiche d'un chapitre plus avancé : masquée, floutée, puis visible", () => {
    expect(ahead).toBeTruthy();
    expect(spoilerVisibility(ahead, "strict", 1)).toBe("hidden");
    expect(spoilerVisibility(ahead, "relaxed", 1)).toBe("blurred");
    expect(spoilerVisibility(ahead, "off", 1)).toBe("visible");
  });
  test("missions futures : visibles seulement hors mode complet", () => {
    const m = { name: "X", key: "x", aliases: [], chapter: 5, order: [], guideIds: [], people: [] };
    expect(missionVisible(m, 1, "strict")).toBe(false);
    expect(missionVisible(m, 1, "relaxed")).toBe(true);
    expect(missionVisible(m, 1, "off")).toBe(true);
  });
  test("une ancienne sauvegarde garde un mode valide ; un mode inconnu revient à « complet »", () => {
    const s = migrate({ ...base, profile: { ...base.profile, spoilerMode: "bizarre" as never } });
    expect(s.profile.spoilerMode).toBe("strict");
    expect(migrate({ ...base, profile: { ...base.profile, spoilerMode: "off" } }).profile.spoilerMode).toBe("off");
  });
  test("le niveau choisi est transmis à Claude", () => {
    expect(playerContext(ctx({ spoilerMode: "off" }).state, feed)).toMatch(/Anti-spoiler : aucun/);
    expect(playerContext(ctx({ spoilerMode: "relaxed" }).state, feed)).toMatch(/Anti-spoiler : léger/);
  });
});

test.describe("Missions : en cours ≠ terminée", () => {
  test("« Swamped » en cours est annoncée comme lancée et PAS terminée", () => {
    const pc = playerContext(ctx().state, feed);
    expect(pc).toContain("Mission EN COURS");
    expect(pc).toContain("PAS terminée");
    expect(pc).toContain("Swamped");
  });
  test("objectifs facultatifs transmis avec leur niveau de preuve", () => {
    const pc = playerContext(ctx({ objectives: [{ id: "o1", mission: "Swamped", text: "Garder le bateau intact", done: false, basis: "perso", at: "" }] }).state, feed);
    expect(pc).toContain("Garder le bateau intact (perso)");
  });
  test("migration : « en cours » sans mission est remis à faux, objectifs mal formés ignorés", () => {
    const s = migrate({ ...base, profile: { ...base.profile, nextMission: null, missionInProgress: true, objectives: [{ bad: 1 } as never] } });
    expect(s.profile.missionInProgress).toBe(false);
    expect(s.profile.objectives).toEqual([]);
  });
});

test.describe("« Rien à manquer »", () => {
  test("éléments sans preuve écartés ; « vérifié » rétrogradé si la fiche n'est pas officielle ou recoupée", async () => {
    let ids: string[] = [];
    const t = mock((r) => {
      const last = r.messages[r.messages.length - 1].content;
      ids = [...last.matchAll(/"id":"([^"]+)"/g)].map((m) => m[1]);
      return `On regarde ça.\n@@@\n{"confiance":"signalé","sources":[],"actions":[],"verifie":[{"texte":"Objectif A","source":"${ids[0]}"},{"texte":"Inventé","source":"nulle-part"}],"incertain":[{"texte":"Objectif B","source":"${ids[0]}"}]}`;
    });
    const r = await askCopilot({ question: "Rien à manquer dans Swamped ?", ctx: ctx(), topic: null, history: [], transport: t, mode: "checklist", mission: "Swamped" });
    expect(t.calls[0].messages.at(-1)!.content).toContain("RIEN À MANQUER");
    expect(ids.length).toBeGreaterThan(0);
    const all = [...r.checklist!.verified, ...r.checklist!.uncertain].map((x) => x.text);
    expect(all).toContain("Objectif A");
    expect(all).toContain("Objectif B");
    expect(all).not.toContain("Inventé");
    const rel = feed.items.find((x: { id: string }) => x.id === ids[0])?.reliability;
    if (rel !== "official" && rel !== "confirmed") expect(r.checklist!.verified.map((x) => x.text)).not.toContain("Objectif A");
    expect(r.intent).toBe("checklist");
  });
});

test.describe("Recherche web (connecteur simulé)", () => {
  const hits = [{ title: "Swamped mission guide", url: "https://example.com/swamped", text: "Pick up the shotgun in the shack before the boat chase.", date: "2026-11-21" }];
  test("analyse de mission : le web est interrogé, ses résultats arrivent comme preuves « web non vérifié » et sont cités", async () => {
    const queries: string[] = [];
    const search: WebSearchFn = async (q) => {
      queries.push(q);
      return { status: "ok", hits };
    };
    const t = mock('Prends le fusil dans la cabane, d\'après un guide.\n@@@\n{"confiance":"officiel","sources":["web:1"],"actions":[],"verifie":[{"texte":"Fusil dans la cabane","source":"web:1"}],"incertain":[]}');
    const r = await askCopilot({ question: "Rien à manquer dans Swamped ?", ctx: ctx(), topic: null, history: [], transport: t, mode: "checklist", mission: "Swamped", search });
    expect(queries[0]).toContain('"Swamped"');
    expect(t.calls[0].messages.at(-1)!.content).toContain("web non vérifié");
    expect(r.web).toEqual({ status: "ok", count: 1 });
    expect(r.trust).toBe("signalé"); // un fait issu du seul web n'est jamais « officiel »
    expect(r.checklist!.verified).toHaveLength(0); // le web ne suffit pas pour « vérifié »
    expect(r.checklist!.uncertain[0].source?.url).toBe("https://example.com/swamped");
    expect(r.sources.some((s) => s.url === "https://example.com/swamped")).toBe(true);
  });
  test("bavardage : aucune recherche web", async () => {
    let n = 0;
    const search: WebSearchFn = async () => {
      n++;
      return { status: "ok", hits };
    };
    await askCopilot({ question: "Merci !", ctx: ctx(), topic: null, history: [], transport: mock("De rien !\n@@@\n{}"), search });
    expect(n).toBe(0);
  });
  test("connecteur non branché : statut honnête, Claude prévenu de ne pas prétendre avoir cherché", async () => {
    const search: WebSearchFn = async () => ({ status: "not_connected", hits: [] });
    const t = mock("Je n'ai pas pu chercher sur le web.\n@@@\n{}");
    const r = await askCopilot({ question: "Cherche sur le web les récompenses de Swamped", ctx: ctx(), topic: null, history: [], transport: t, search });
    expect(r.web?.status).toBe("not_connected");
    expect(t.calls[0].messages.at(-1)!.content).toContain("ne prétends pas avoir cherché");
  });
  test("formats de réponse d'Exa reconnus (objet results, blocs texte)", () => {
    expect(parseHits({ payload: { results: [{ title: "A", url: "https://a.com", text: "x", publishedDate: "2026-11-20T00:00:00Z" }] } })[0]).toMatchObject({ title: "A", url: "https://a.com", date: "2026-11-20" });
    const txt = "Title: B\nURL: https://b.com/x\nPublished Date: 2026-11-19\nText: hello world\n\nTitle: C\nURL: http://insecure.com\nText: no";
    const h = parseHits({ content: [{ type: "text", text: txt }] });
    expect(h).toHaveLength(1); // les liens non https sont ignorés
    expect(h[0]).toMatchObject({ title: "B", url: "https://b.com/x", date: "2026-11-19" });
  });
});

test.describe("Conversation naturelle", () => {
  test("historique long (16 tours) et messages courts acceptés ; petits nombres de conversation non bloqués", async () => {
    const history = Array.from({ length: 20 }, (_, i) => ({ role: (i % 2 ? "assistant" : "user") as "user" | "assistant", content: `tour ${i}` }));
    const t = mock("Deux options : la discrète ou la bourrine. Tu préfères laquelle ?\n@@@\n{}");
    const r = await askCopilot({ question: "et là ?", ctx: ctx(), topic: null, history, transport: t });
    expect(t.calls[0].messages.length).toBe(1 + 16 + 1);
    expect(r.engine).toBe("claude");
  });
  test("les seuils de zoom des lieux sont entiers (filtres MapLibre évalués au zoom de tuile)", () => {
    for (const c of Object.values(POI_CATS)) expect(Number.isInteger(c.minZoom)).toBe(true);
    expect(POI_CATS.commerce.minZoom).toBeLessThanOrEqual(3);
  });
});
