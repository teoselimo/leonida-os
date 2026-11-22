/**
 * Banc V0.13 — compare le routage local et l'ancien planificateur sur une série de questions de session.
 * Claude et Exa SIMULÉS : compte les appels Claude, les recherches et les décisions (déterministes).
 * Latence : modèle de délai paramétrable (QUICK_MS par appel « quick », SEARCH_MS par recherche) — une
 * estimation, pas une mesure. La mesure réelle se lit dans Profil › Recherche web de l'Artifact publié.
 *   npx tsx scripts/bench-router.ts
 */
import { readFileSync } from "node:fs";
import { askCopilot } from "../src/lib/copilot";
import type { TurnMetrics } from "../src/lib/copilot/route";
import type { AiContext } from "../src/lib/ai/engine";
import type { LlmTransport, WebSearchFn } from "../src/lib/copilot/types";
import { initialState } from "../src/lib/store";

const QUICK_MS = Number(process.env.QUICK_MS ?? 1500);
const SEARCH_MS = Number(process.env.SEARCH_MS ?? 2500);
const feed = JSON.parse(readFileSync("tests/fixtures/radar-prod.json", "utf8"));
const rows = JSON.parse(readFileSync("public/data/landmarks.json", "utf8")) as Array<[string, string, number, number, string, string[]]>;
const places = rows.map(([id, full, x, y, real, tags]) => ({ id, name: full.split(",")[0], district: full.split(",").slice(1).join(",").trim(), x, y, real, tags }));
const base = initialState();
const ctx = { feed, places, state: { ...base, profile: { ...base.profile, chapter: 1, edition: "ultimate" as const, lastMission: "Don Gone", missionsDone: ["Swamped", "Don Gone"], nextMission: "Talk to Lucia", missionInProgress: false } } } as unknown as AiContext;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const QUESTIONS = [
  "Salut !",
  "Quels sont les meilleurs magasins de vêtements à Key Lento ?",
  "Montre-moi les magasins sur la carte",
  "Je peux faire quoi maintenant ?",
  "Quelles missions secondaires sont dispo ?",
  "Où trouver le Skunk Ape la nuit ?",
  "Comment débloquer le salon de tatouage The Inked Mermaid ?",
  "Il y a une voiture rare cachée près de Key Lento ?",
  "Tu préfères la plage ou la ville ?",
  "Combien coûte une coupe chez Barnacle Beauties ?",
];
async function run(planner: boolean) {
  const out: TurnMetrics[] = [];
  const transport: LlmTransport = {
    id: "claude-api", label: "sim", available: async () => true,
    generate: async (r) => {
      await sleep(QUICK_MS);
      const plan = r.messages.length === 1 && /Tu prépares les recherches/.test(r.messages[0].content);
      return { text: plan ? '{"web":true,"requetes":["GTA 6 test"]}' : "Ok\n@@@\n{}", model: "sim", truncated: false };
    },
  };
  const search: WebSearchFn = async () => (await sleep(SEARCH_MS), { status: "ok", hits: [{ title: "Guide", url: "https://g.example", text: "facts", date: null }] });
  for (const q of QUESTIONS) await askCopilot({ question: q, ctx, topic: null, history: [], transport, search, planner, onMetrics: (m) => out.push({ ...m, at: q }) });
  return out;
}
async function main() {
const local = await run(false);
const old = await run(true);
console.log(`Modèle de délai : ${QUICK_MS} ms / appel Claude, ${SEARCH_MS} ms / recherche\n`);
console.log("Question | local : appels, recherches, raison, total ms | planificateur : appels, recherches, total ms");
for (let i = 0; i < QUESTIONS.length; i++) {
  const a = local[i], b = old[i];
  console.log(`${QUESTIONS[i]} | ${a.claudeCalls}, ${a.searches}, ${a.reason}, ${a.totalMs} | ${b.claudeCalls}, ${b.searches}, ${b.totalMs}`);
}
const sum = (xs: TurnMetrics[], k: "claudeCalls" | "searches" | "totalMs") => xs.reduce((s, m) => s + m[k], 0);
console.log(`\nTOTAL local : ${sum(local, "claudeCalls")} appels Claude, ${sum(local, "searches")} recherches, ${sum(local, "totalMs")} ms`);
console.log(`TOTAL planificateur : ${sum(old, "claudeCalls")} appels Claude, ${sum(old, "searches")} recherches, ${sum(old, "totalMs")} ms`);
}
void main();
