import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { answer } from "../src/lib/ai/engine";
import type { AiContext } from "../src/lib/ai/engine";
import { askCopilot, parseReply, pickTransport, visiblePart } from "../src/lib/copilot";
import { LlmError } from "../src/lib/copilot/types";
import type { LlmRequest, LlmTransport } from "../src/lib/copilot/types";
import type { Landmark } from "../src/lib/gtadb";
import { categoryFromQuery, findPoi, poiCategory, poiStatus, searchPois } from "../src/lib/poi";
import { initialState } from "../src/lib/store";

/**
 * Pilote Artifact (issue #10) et lieux de la carte (issue #9) — tests unitaires, sans navigateur.
 * Le transport Claude est simulé : on vérifie ce que l'app envoie et ce qu'elle accepte de la réponse.
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
  state: { ...base, profile: { ...base.profile, console: "ps5", edition: "standard", chapter: 1, lastMission: "Down to Earth", missionsDone: ["Down to Earth"], ...patch } },
});

/** Transport simulé : renvoie `reply` (ou lève `fail`) et garde les requêtes reçues. */
function mock(reply: string | ((r: LlmRequest) => string), fail?: LlmError): LlmTransport & { calls: LlmRequest[] } {
  const calls: LlmRequest[] = [];
  return {
    id: "claude-api",
    label: "Mock",
    calls,
    available: async () => true,
    generate: async (r) => {
      calls.push(r);
      if (fail) throw fail;
      const text = typeof reply === "function" ? reply(r) : reply;
      r.onText?.(text.slice(0, Math.ceil(text.length / 2)));
      return { text, model: "Claude (test)", truncated: false };
    },
  };
}

test.describe("Lieux gtadb : catégories et recherche", () => {
  test("les trois lieux du cahier de test sont trouvés et bien classés", () => {
    const shop = searchPois("24/7 Supermarket", landmarks, 5)[0];
    expect(shop.name).toMatch(/24\/7|247/i);
    expect(poiCategory(shop)).toBe("commerce");
    const whale = findPoi("Wonder Whale", landmarks)!;
    expect(whale).toBeTruthy();
    const anchor = findPoi("The Rusty Anchor", landmarks, "Key Lento")!;
    expect(anchor.name).toBe("The Rusty Anchor");
    expect(anchor.district).toContain("Key Lento");
    expect(poiCategory(anchor)).toBe("restaurant");
  });
  test("catégorie + quartier : « station Key Lento » ne renvoie que des stations de Key Lento", () => {
    expect(categoryFromQuery("une station essence à Key Lento")).toBe("station");
    const r = searchPois("station Key Lento", landmarks, 10);
    expect(r.length).toBeGreaterThan(0);
    for (const l of r) {
      expect(l.district).toContain("Key Lento");
      expect(poiCategory(l)).toBe("station");
    }
  });
  test("« Cell Tower » n'est pas un garage (le mot « tow » ne suffit pas)", () => {
    const tower = landmarks.find((l) => /cell tower/i.test(l.name));
    if (tower) expect(poiCategory(tower)).not.toBe("garage");
  });
  test("aucun repère gtadb n'est présenté comme interactif en jeu", () => {
    for (const l of landmarks.slice(0, 400)) expect(["community", "uncertain"]).toContain(poiStatus(l));
  });
});

test.describe("Copilote : moteur direct (sans Claude)", () => {
  test("« Où est The Rusty Anchor à Key Lento ? » → fiche du lieu, prudence communautaire, action carte", () => {
    const a = answer("Où est The Rusty Anchor à Key Lento ?", ctx(), null);
    expect(a.text).toContain("The Rusty Anchor");
    expect(a.text).toMatch(/communautaire/i);
    const act = a.actions.find((x) => x.type === "show_place");
    expect(act && "landmarkId" in act && act.landmarkId).toBeTruthy();
  });
  test("« un magasin à Key Lento » → liste sur la carte (recherche), jamais une zone couvrant tout le quartier (V0.13)", () => {
    const a = answer("Je cherche un magasin à Key Lento", ctx(), null);
    const act = a.actions.find((x) => x.type === "show_place") as { district?: string; query?: string } | undefined;
    expect(act?.query).toContain("Key Lento");
    expect(act?.district).toBeUndefined();
  });
});

test.describe("Copilote : Claude encadré", () => {
  test("format de sortie : texte, séparateur, métadonnées ; le streaming n'affiche jamais le JSON", () => {
    const raw = 'Voici la réponse.\n@@@\n{"confiance":"signalé","sources":["x"],"actions":[0]}';
    expect(parseReply(raw)).toEqual({ message: "Voici la réponse.", meta: { confiance: "signalé", sources: ["x"], actions: [0] } });
    expect(parseReply("Sans métadonnées").meta).toBeNull();
    expect(visiblePart("Bonjour @@")).toBe("Bonjour");
    expect(visiblePart('Bonjour\n@@@\n{"conf')).toBe("Bonjour");
  });

  test("la requête contient les règles, le contexte joueur et les preuves — jamais de clé ni d'URL de fournisseur", async () => {
    const t = mock('Prépare-toi bien.\n@@@\n{"confiance":"non établi","sources":[],"actions":[]}');
    const r = await askCopilot({ question: "Je suis sur le point de lancer Find Donnie's Package.", ctx: ctx(), topic: null, history: [], transport: t });
    expect(r.engine).toBe("claude");
    expect(r.model).toBe("Claude (test)");
    const msgs = t.calls[0].messages;
    expect(msgs[0].content).toContain("copilote de GTA VI");
    const turn = msgs[msgs.length - 1];
    expect(turn.role).toBe("user");
    expect(turn.content).toContain("Find Donnie's Package");
    expect(turn.content).toMatch(/PS5/);
    expect(JSON.stringify(msgs)).not.toMatch(/sk-ant|api[_-]?key|anthropic\.com/i);
  });

  test("question de suivi : l'historique est transmis (Penumbra puis « comment je la garde »)", async () => {
    const t = mock('Il faut l\'immatriculer.\n@@@\n{"confiance":"signalé","sources":[],"actions":[]}');
    const history = [
      { role: "user" as const, content: "Où trouver la Penumbra FF ?" },
      { role: "assistant" as const, content: "Vers Rialto Islands, d'après une source." },
    ];
    const first = answer("Où trouver la Penumbra FF ?", ctx(), null);
    await askCopilot({ question: "Et comment je la garde définitivement ?", ctx: ctx(), topic: first.topic ?? null, history, transport: t });
    const msgs = t.calls[0].messages;
    expect(msgs.map((m) => m.role)).toEqual(["user", "user", "assistant", "user"]);
    expect(msgs[3].content).toMatch(/Penumbra/);
  });

  test("un chiffre absent des preuves (récompense inventée) fait écarter la réponse de Claude", async () => {
    const t = mock('Tu gagnes 250000 $ et une arme gratuite.\n@@@\n{"confiance":"officiel","sources":[],"actions":[]}');
    const r = await askCopilot({ question: "Quelle arme gratuite puis-je récupérer maintenant ?", ctx: ctx(), topic: null, history: [], transport: t });
    expect(r.engine).toBe("direct");
    expect(r.note).toMatch(/écartée/);
    expect(r.message).not.toContain("250000");
  });

  test("actions et sources : seulement celles proposées par l'app (index hors liste et ids inconnus ignorés)", async () => {
    const t = mock('Le lieu est indiqué sur la carte.\n@@@\n{"confiance":"signalé","sources":["inventé","poi:L1"],"actions":[7,0]}');
    const r = await askCopilot({ question: "Où est The Rusty Anchor à Key Lento ?", ctx: ctx(), topic: null, history: [], transport: t });
    expect(r.engine).toBe("claude");
    expect(r.actions.length).toBe(1);
    expect(r.actions[0].type).toBe("show_place");
    expect(r.sources.some((s) => /inventé/.test(s.name))).toBe(false);
  });

  test("consentement refusé, quota atteint : réponse vérifiée et explication honnête", async () => {
    for (const code of ["not_granted", "rate_limited"]) {
      const r = await askCopilot({ question: "Où trouver la Penumbra FF ?", ctx: ctx(), topic: null, history: [], transport: mock("", new LlmError(code, code)) });
      expect(r.engine).toBe("direct");
      expect(r.note).toBeTruthy();
      expect(r.message).toMatch(/Penumbra/);
    }
  });

  test("sans transport disponible : mode direct, aucun appel", async () => {
    const off: LlmTransport = { id: "claude-api", label: "off", available: async () => false, generate: async () => { throw new Error("ne doit pas être appelé"); } };
    expect(await pickTransport([off])).toBeNull();
    const r = await askCopilot({ question: "Où trouver la Penumbra FF ?", ctx: ctx(), topic: null, history: [], transport: null });
    expect(r.engine).toBe("direct");
  });
});
