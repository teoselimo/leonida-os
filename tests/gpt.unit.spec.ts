import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { RULES, PROMPT_VERSION } from "../src/lib/copilot/prompt";
import { POI_CATS } from "../src/lib/poi";
import { askCopilot } from "../src/lib/copilot";
import type { LlmTransport } from "../src/lib/copilot/types";
import { initialState } from "../src/lib/store";
import type { AiContext } from "../src/lib/ai/engine";
import { gptApiEnabled, openaiApiTransport } from "../src/lib/copilot/transports/openaiApi";

const prod = JSON.parse(readFileSync("tests/fixtures/radar-prod.json", "utf8"));

test("LEONIDA BRAIN : consignes de naturel et fiabilité sans règle robotique 2–4 phrases", () => {
  expect(PROMPT_VERSION).toContain("leonida");
  expect(RULES).toContain("spontané");
  expect(RULES).toMatch(/anti-spoiler/i);
  expect(RULES).not.toMatch(/2 à 4 phrases|2–4 phrases/i);
  expect(RULES).toContain("META_MARK".replace("META_MARK", "@@@"));
});

test("Carte GTA-like : commerces visibles au zoom de quartier, repères secondaires retardés", () => {
  expect(POI_CATS.commerce.minZoom).toBeLessThanOrEqual(3);
  expect(POI_CATS.station.minZoom).toBeLessThanOrEqual(3);
  expect(POI_CATS.restaurant.minZoom).toBeLessThanOrEqual(3.5);
  expect(POI_CATS.garage.minZoom).toBeLessThanOrEqual(3.5);
  expect(POI_CATS.autre.minZoom).toBeGreaterThan(5);
});

test("GPT : réponses structurées, conversation naturelle, même garde-fou de preuves", async () => {
  const base = initialState();
  const ctx: AiContext = {
    feed: prod,
    state: { ...base, profile: { ...base.profile, chapter: 1, console: "ps5", edition: "standard", nextMission: "Find Donnie's Package" } },
  };
  const calls: string[] = [];
  const stub: LlmTransport = {
    id: "openai-api",
    label: "GPT (test)",
    available: async () => true,
    generate: async (req) => {
      calls.push(req.messages.map((m) => m.content).join("\n"));
      return {
        model: "gpt-6.1-terra (test)",
        text: "Tu pars sur Donnie ? On prépare ça proprement. Je n'ai pas de preuve fiable d'un objet manquable dans cette mission, donc je préfère ne pas t'inventer un secret. Tu veux qu'on regarde ce qui est vérifié autour de toi ?\n@@@\n{\"confiance\":\"non établi\",\"sources\":[],\"actions\":[]}",
      };
    }
  };
  const r = await askCopilot({
    question: "Je vais lancer Find Donnie's Package.",
    ctx, topic: null, history: [], transport: stub,
  });
  expect(r.engine).toBe("gpt");
  expect(r.message).toContain("Donnie");
  expect(calls[0]).toContain("Console :");
  expect(calls[0]).toContain("Find Donnie's Package");
  expect(calls[0]).not.toContain("PISTE DU MOTEUR DE RECHERCHE");
});

test("GPT : pas de connexion active ou de secret dans le build par défaut", async () => {
  expect(gptApiEnabled()).toBe(false);
  expect(await openaiApiTransport.available()).toBe(false);
  const worker = readFileSync("proxy/openai-worker.ts", "utf8");
  expect(worker).toContain("OPENAI_API_KEY");
  expect(worker).toContain("LEONIDA_ACCESS_TOKEN");
  expect(worker).toContain("transactionSync");
  expect(worker).toContain("AI_ENABLED");
  expect(worker).not.toMatch(/sk-proj-[a-zA-Z0-9]{20,}/);
  expect(worker).toContain("new_sqlite_classes".replace("new_sqlite_classes", "BudgetLedger"));
});
