import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import type { AiContext } from "../src/lib/ai/engine";
import { briefKey, runMissionBrief } from "../src/lib/copilot/brief";
import { focusExcerpt, validateBrief } from "../src/lib/copilot/engine";
import type { LlmRequest, LlmTransport, WebHit, WebSearchFn } from "../src/lib/copilot/types";
import { initialState, migrate } from "../src/lib/store";

/**
 * V0.9 « Rien à manquer » préventif : statut calculé par l'app, extrait ciblé, deux recherches web, une analyse par mission.
 * Les pages web sont des textes de test (format Exa réel, contenu inventé) ; aucun appel réseau.
 */
const feed = JSON.parse(readFileSync("tests/fixtures/radar-prod.json", "utf8"));
const base = initialState();
const ctx: AiContext = { feed, places: [], state: { ...base, profile: { ...base.profile, chapter: 1, nextMission: "Don Gone", missionsDone: ["Swamped"], lastMission: "Swamped" } } };
const hits: WebHit[] = [
  { title: "Guide A", url: "https://guide-a.example/don-gone", text: "Walkthrough. Open the trunk before destroying the car to get the unique revolver.", date: "2026-11-18" },
  { title: "Wiki B", url: "https://wiki-b.example/don-gone", text: "Missables: the revolver in the trunk, take it before you destroy the car.", date: null },
  { title: "Guide A, autre page", url: "https://guide-a.example/missables", text: "Missable revolver in the trunk.", date: null },
];
const ids = ["web:1", "web:2", "web:3"];
const el = (o: Record<string, unknown>) => ({ quand: "pendant", type: "objet_unique", priorite: "haute", ...o });

test.describe("Statut de recoupement calculé par l'app", () => {
  test("deux sites différents → confirmé ; deux pages du même site → une source ; sans preuve → écarté", () => {
    const out = validateBrief(
      {
        elements: [
          el({ texte: "Ouvre le coffre avant de détruire la voiture", sources: ["web:1", "web:2"] }),
          el({ texte: "Même site deux fois", sources: ["web:1", "web:3"] }),
          el({ texte: "Inventé sans source", sources: ["web:9"] }),
          el({ texte: "Sans champ sources" }),
        ],
      },
      ctx,
      ids,
      hits,
    );
    expect(out.map((x) => [x.text, x.status])).toEqual([
      ["Ouvre le coffre avant de détruire la voiture", "confirmé"],
      ["Même site deux fois", "une source"],
    ]);
    expect(out[0].sources.map((s) => s.url)).toEqual(["https://guide-a.example/don-gone", "https://wiki-b.example/don-gone"]);
  });
  test("le modèle ne peut pas s'auto-déclarer « confirmé » ; une divergence signalée → contradictoire avec explication", () => {
    const out = validateBrief({ elements: [el({ texte: "Récompense", type: "manquable", sources: ["web:1"], statut: "confirmé" }), el({ texte: "Manquable ?", sources: ["web:1", "web:2"], contradiction: "A dit manquable, B non" })] }, ctx, ids, hits);
    expect(out.find((x) => x.text === "Récompense")!.status).toBe("une source");
    const c = out.find((x) => x.text === "Manquable ?")!;
    expect(c.status).toBe("contradictoire");
    expect(c.note).toContain("B non");
  });
  test("une fiche LEONIDA RADAR officielle ou recoupée suffit à confirmer", () => {
    const strong = feed.items.find((r: { reliability: string }) => r.reliability === "confirmed" || r.reliability === "official");
    test.skip(!strong, "pas de fiche fiable dans le jeu de test");
    const out = validateBrief({ elements: [el({ texte: "Fait fiable", sources: [strong.id] })] }, ctx, [strong.id], []);
    expect(out[0].status).toBe("confirmé");
  });
  test("priorité : ce qui se perd définitivement passe d'abord, « avant de lancer » avant « pendant »", () => {
    const out = validateBrief(
      { elements: [el({ texte: "Préparation", priorite: "normale", quand: "avant", type: "preparation", sources: ["web:1"] }), el({ texte: "Pendant, haute", quand: "pendant", sources: ["web:1"] }), el({ texte: "Avant, haute", quand: "avant", sources: ["web:2"] })] },
      ctx,
      ids,
      hits,
    );
    expect(out.map((x) => x.text)).toEqual(["Avant, haute", "Pendant, haute", "Préparation"]);
  });
});

test.describe("Extrait web ciblé", () => {
  test("une information clé loin dans une page longue est conservée", () => {
    const filler = "The trailer is in Key Lento and the mission is short. ".repeat(80);
    const page = `${filler}Open the trunk before you destroy the car: the unique revolver is missable. ${filler}`;
    const ex = focusExcerpt(page, ["missable", "unique", "trunk"]);
    expect(page.indexOf("unique revolver")).toBeGreaterThan(3000);
    expect(ex).toContain("unique revolver is missable");
    expect(ex.length).toBeLessThanOrEqual(1_500);
  });
});

test.describe("Analyse de mission", () => {
  test("deux recherches (déroulé + manquables), résultats dédoublonnés, analyse rattachée à LA mission demandée", async () => {
    const queries: string[] = [];
    const search: WebSearchFn = async (q, _s, objective) => {
      queries.push(`${q} || ${objective}`);
      return { status: "ok", hits: hits.slice(0, 2) };
    };
    const t: LlmTransport & { calls: LlmRequest[] } = {
      id: "claude-api",
      label: "mock",
      calls: [],
      available: async () => true,
      async generate(r) {
        this.calls.push(r);
        return { text: `Un point critique.\n@@@\n{"confiance":"recoupé","sources":["web:1","web:2"],"actions":[],"elements":[{"texte":"Prends le revolver dans le coffre avant de détruire la voiture","quand":"pendant","type":"objet_unique","priorite":"haute","sources":["web:1","web:2"]}]}`, model: "mock", truncated: false };
      },
    };
    const b = await runMissionBrief({ mission: "Don Gone", ctx, transport: t, search });
    expect(queries).toHaveLength(2);
    expect(queries.every((q) => q.includes('"Don Gone"'))).toBe(true);
    expect(queries[1]).toMatch(/missable/i);
    const turn = t.calls[0].messages.at(-1)!.content;
    expect(turn).toContain("Uniquement cette mission");
    expect(turn.match(/"id":"web:\d"/g)).toHaveLength(2); // dédoublonné par URL
    expect(b.mission).toBe("Don Gone");
    expect(b.web).toEqual({ status: "ok", count: 2 });
    expect(b.items[0]).toMatchObject({ status: "confirmé", priority: "haute", kind: "objet_unique" });
    expect(briefKey("Don Gone")).not.toBe(briefKey("Swamped"));
  });
  test("sans Claude : aucune liste inventée, analyse marquée « direct »", async () => {
    const b = await runMissionBrief({ mission: "Don Gone", ctx, transport: null, search: null });
    expect(b.engine).toBe("direct");
    expect(b.items).toEqual([]);
  });
  test("les analyses sont conservées par mission et survivent à la migration", () => {
    const s = migrate({ ...base, briefs: { dongone: { mission: "Don Gone", at: "2026-11-22T00:00:00Z", summary: "", items: [], web: null, engine: "claude" }, bad: { nope: 1 } as never } });
    expect(Object.keys(s.briefs!)).toEqual(["dongone"]);
  });
});
