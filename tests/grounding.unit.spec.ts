import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { askCopilot } from "../src/lib/copilot";
import type { AiContext, PlaceRef } from "../src/lib/ai/engine";
import type { LlmRequest, LlmTransport, WebSearchFn } from "../src/lib/copilot/types";
import type { Attachment } from "../src/lib/copilot/vision";
import type { VisualMemory } from "../src/lib/copilot/grounding";
import { isVisualFollowUp, visualQuery } from "../src/lib/copilot/grounding";
import { KNOWLEDGE } from "../src/data/knowledge";
import { PROG_BY_ID } from "../src/data/progression";
import { MAP_ZONES, entitiesForQuestion, ground, parseObservation } from "../src/lib/knowledge/engine";
import { CLUES } from "../src/lib/knowledge/model";
import { missionKind } from "../src/lib/missionKind";
import { autopilot } from "../src/lib/autopilot";
import { blocks } from "../src/components/RichText";
import { initialState, reducer } from "../src/lib/store";
import type { PersistedState, Profile } from "../src/lib/types";

/**
 * V0.19 · Knowledge Engine & Visual Grounding.
 * Tests AUTOMATISÉS avec Claude SIMULÉ : ils vérifient l'orchestration et le moteur local (ancrage, seuils, mémoire,
 * recherche, coûts), PAS la qualité de lecture d'image du vrai modèle (essais réels : sur l'Artifact, par le joueur).
 */
const feed = JSON.parse(readFileSync("tests/fixtures/radar-prod.json", "utf8"));
const LM: Array<[string, string, number, number, string, string[]]> = JSON.parse(readFileSync("public/data/landmarks.json", "utf8"));
const base = initialState();
const THEO = (p: Partial<Profile> = {}): Profile => ({ ...base.profile, chapter: 1, edition: "ultimate", lastMission: "Talk to Lucia", missionsDone: ["Swamped", "Don Gone", "Talk to Lucia"], nextMission: null, spoilerMode: "strict", ...p });
const ctx = (p: Partial<Profile> = {}): AiContext => ({ feed, places: [] as PlaceRef[], state: { ...base, profile: THEO(p) } });
const img = (n = "capture.png"): Attachment => ({ id: n, kind: "image", name: n, type: "image/png", size: 1000, blob: new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }) });
/** Claude simulé : 1re réponse = extraction (JSON), suivantes = réponse au joueur. */
function seq(...replies: string[]): LlmTransport & { calls: LlmRequest[] } {
  const calls: LlmRequest[] = [];
  return { id: "claude-artifact", label: "mock", calls, available: async () => true, generate: async (r) => (calls.push(r), { text: replies[Math.min(calls.length - 1, replies.length - 1)], model: "mock", truncated: false }) };
}
const extract = (o: Record<string, unknown>) => JSON.stringify({ type: "scène", gta6: "oui", textes: [], vehicules: [], resume: "capture de jeu", ...o });
const HOUSE = extract({ indices: ["pick_up", "vehicule_jaune", "bateau_sur_cales", "palmiers", "maison_sur_pilotis", "escalier_exterieur"], vehicules: ["pick-up jaune"], resume: "pick-up jaune devant une maison sur pilotis, bateau sur cales" });
const counter = () => {
  const q: string[] = [];
  const fn: WebSearchFn = async (x) => (q.push(x), { status: "ok", hits: [{ title: "GTA 6 Jason's house", url: "https://guide.example/house", text: "Jason's stilt house in Key Lento", date: null }] });
  return { q, fn };
};

test.describe("Corpus Knowledge : sourcé, relié à l'existant, sans coordonnée inventée", () => {
  test("17 lieux, 2 véhicules, 1 personnage ; chaque caractéristique visuelle cite une source existante ; indices du vocabulaire commun", () => {
    const places = KNOWLEDGE.filter((e) => e.type !== "véhicule" && e.type !== "personnage");
    expect(places.length).toBeGreaterThanOrEqual(15);
    for (const e of KNOWLEDGE) {
      expect(e.sources.length, e.id).toBeGreaterThan(0);
      for (const v of e.visual) {
        expect(v.src.every((i) => i >= 0 && i < e.sources.length), `${e.id}: ${v.text}`).toBe(true);
        expect(v.clues.every((c) => (CLUES as readonly string[]).includes(c))).toBe(true);
      }
    }
  });
  test("repères GTADB et missions référencés : tous existent (aucune position inventée)", () => {
    const ids = new Set(LM.map((l) => l[0]));
    for (const e of KNOWLEDGE) if (e.location.landmarkId) expect(ids.has(e.location.landmarkId), `${e.id} → ${e.location.landmarkId}`).toBe(true);
    for (const e of KNOWLEDGE) for (const r of e.relations) if (r.to.startsWith("mission:")) expect(PROG_BY_ID.has(r.to.slice(8)), `${e.id} → ${r.to}`).toBe(true);
    for (const z of MAP_ZONES) expect(ids.has(z.landmarkId)).toBe(true);
  });
  test("zones de carte mesurées : l'aéroport international est à l'intérieur des terres, Mile Zero sur une île côtière", () => {
    const vcia = MAP_ZONES.find((z) => z.name === "Vice City International Airport")!;
    const mz = MAP_ZONES.find((z) => z.name === "Mile Zero Air Station")!;
    expect(vcia.coastal).toBe(false);
    expect(mz).toMatchObject({ coastal: true, island: true });
    expect(mz.features).toContain("militaire");
  });
});

test.describe("Scénario A · maison de Jason et Lucia (Claude simulé)", () => {
  test("indices distinctifs → Jason's House, indices expliqués, chapitre 1 en appui, action carte ; pas de conseils Tourist Trap ; pas de web", async () => {
    const t = seq(HOUSE, "Ça ressemble à Jason's House, ta première planque à Key Lento.\n@@@\n{\"identification\":{\"candidat\":\"jasons-house\",\"confiance\":\"élevée\"},\"indices\":[\"maison sur pilotis\",\"Ganado jaune\"],\"action\":\"Vérifie le panier de basket au pied de l'escalier\"}");
    const web = counter();
    const c = await askCopilot({ question: "C'est quoi cette maison ?", ctx: ctx(), topic: null, history: [], transport: t, attachments: [img()], search: web.fn });
    expect(c.grounding!.identification).toMatchObject({ id: "jasons-house", name: "Jason's House", confidence: "élevée", landmarkId: "L266" });
    expect(c.grounding!.why).toEqual(["maison sur pilotis", "Ganado jaune"]);
    expect(c.actions[0]).toMatchObject({ type: "show_place", landmarkId: "L266" });
    const prompt = t.calls[1].messages.at(-1)!.content;
    expect(prompt).toContain("Candidat 1 (id jasons-house");
    expect(prompt).toContain("cohérent avec ton chapitre 1");
    expect(prompt).not.toMatch(/Family Savings|5 000 \$|point de non-retour à venir/); // contexte compact : pas de récitation Story
    expect(web.q).toHaveLength(0); // identifiée avec des preuves fiables : pas de recherche
  });
  test("moins d'indices (pick-up jaune + bateau sur cales) : confiance moyenne, jamais « élevée » même si Claude l'affirme", async () => {
    const t = seq(extract({ indices: ["pick_up", "vehicule_jaune", "bateau_sur_cales", "palmiers"] }), "Probablement chez Jason.\n@@@\n{\"identification\":{\"candidat\":\"jasons-house\",\"confiance\":\"élevée\"}}");
    const c = await askCopilot({ question: "On est où là ?", ctx: ctx(), topic: null, history: [], transport: t, attachments: [img()] });
    expect(c.grounding!.identification).toMatchObject({ id: "jasons-house", confidence: "moyenne" });
  });
});

test.describe("Scénario B · capture d'aéroport et de port", () => {
  test("formes cartographiques → zones candidates GTADB, extraits de la carte LEONIDA joints, héliport signalé non répertorié, pas de coordonnées", async () => {
    const t = seq(JSON.stringify({ type: "carte", gta6: "oui", indices: ["vue_carte", "aeroport", "piste_d_atterrissage", "littoral", "port", "quai", "heliport"], textes: [], resume: "aéroport côtier, port voisin, curseur" }), "Plusieurs aérodromes côtiers correspondent ; le plus proche des formes est celui de Port Gellhorn.\n@@@\n{\"identification\":{\"candidat\":\"zone-L1554\",\"confiance\":\"moyenne\"},\"action\":\"Compare avec la carte LEONIDA\"}");
    const rendered: string[] = [];
    const c = await askCopilot({ question: "Où est-ce sur la carte ?", ctx: ctx(), topic: null, history: [], transport: t, attachments: [img("carte.png")], purpose: "carte", renderRef: async (id) => (rendered.push(id), new Blob([new Uint8Array(8)], { type: "image/jpeg" })) });
    expect(rendered).toHaveLength(2);
    expect(t.calls[1].images).toHaveLength(3); // capture + 2 extraits de carte
    expect(t.calls[1].messages.at(-1)!.content).toContain("extraits de la CARTE LEONIDA");
    expect(c.grounding!.candidates.length).toBeGreaterThanOrEqual(2);
    expect(c.grounding!.identification).toMatchObject({ id: "zone-L1554", confidence: "moyenne" });
    expect(c.grounding!.toCheck.join(" ")).toContain("héliport");
    expect(c.message).not.toMatch(/-?\d{3,4}(\.\d+)?\s*[,;]\s*-?\d{3,4}/); // aucune paire de coordonnées
  });
});

test.describe("Scénario C · continuité de la conversation", () => {
  async function first() {
    let mem: VisualMemory | null = null;
    const t = seq(HOUSE, "Ça ressemble à Jason's House.\n@@@\n{\"identification\":{\"candidat\":\"jasons-house\",\"confiance\":\"élevée\"}}");
    await askCopilot({ question: "C'est quoi cette maison ?", ctx: ctx(), topic: null, history: [], transport: t, attachments: [img()], onVision: (m) => (mem = m) });
    return mem!;
  }
  test("« Détaille. » : un seul appel, image réutilisée, contexte visuel et reconnaissance conservés, plus long autorisé", async () => {
    const mem = await first();
    expect(mem.images).toHaveLength(1);
    const t = seq("Voici le détail…\n@@@\n{}");
    const c = await askCopilot({ question: "Détaille.", ctx: ctx(), topic: null, history: [], transport: t, memory: mem });
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0].images).toHaveLength(1);
    const p = t.calls[0].messages.at(-1)!.content;
    expect(p).toContain("question de SUIVI");
    expect(p).toContain("jusqu'à 8 lignes");
    expect(p).toContain("Candidat 1 (id jasons-house");
    expect(c.grounding!.memory).toBe("image");
  });
  test("« Et le véhicule ? » : la réponse porte sur le Ganado reconnu", async () => {
    const mem = await first();
    const t = seq("C'est le Ganado de Jason, version Retro Build.\n@@@\n{\"identification\":{\"candidat\":\"vapid-ganado\",\"confiance\":\"élevée\"}}");
    const c = await askCopilot({ question: "Et le véhicule ?", ctx: ctx(), topic: null, history: [], transport: t, memory: mem });
    expect(t.calls[0].messages.at(-1)!.content).toContain("La question porte sur le VÉHICULE : réponds sur Vapid Ganado");
    expect(c.grounding!.identification).toMatchObject({ id: "vapid-ganado" });
  });
  test("« Montre-moi le lieu. » : réponse immédiate sans appel à Claude, bouton carte sur le repère GTADB", async () => {
    const mem = await first();
    const t = seq("ne doit pas être appelé");
    const c = await askCopilot({ question: "Montre-moi le lieu.", ctx: ctx(), topic: null, history: [], transport: t, memory: mem });
    expect(t.calls).toHaveLength(0);
    expect(c.actions[0]).toMatchObject({ type: "show_place", landmarkId: "L266" });
    expect(c.grounding!.identification).toMatchObject({ name: "Jason's House", landmarkId: "L266" }); // pas « non identifié »
    expect(c.replies).toEqual(["Détaille", "Et le véhicule ?", "Montre-moi le lieu"]);
  });
  test("image expirée (plus de 20 min) : seul le résumé sert, et l'app le dit au modèle ; jamais une fausse revue de l'image", async () => {
    const mem = { ...(await first()), at: Date.now() - 30 * 60_000 };
    const t = seq("D'après ce que j'avais vu…\n@@@\n{}");
    const c = await askCopilot({ question: "Et derrière la maison ?", ctx: ctx(), topic: null, history: [], transport: t, memory: mem });
    expect(t.calls[0].images ?? []).toHaveLength(0);
    expect(t.calls[0].messages.at(-1)!.content).toContain("L'image n'est plus disponible");
    expect(c.grounding!.memory).toBe("résumé");
  });
  test("un nouveau sujet (mission, argent) n'est pas pris pour une question sur l'image", () => {
    const mem = { at: Date.now(), images: [], purpose: "capture", obs: null, grounding: null, answer: "" } as VisualMemory;
    expect(isVisualFollowUp("Je lance la mission suivante", mem)).toBe(false);
    expect(isVisualFollowUp("Combien d'argent je dois garder ?", mem)).toBe(false);
    expect(isVisualFollowUp("Et la voiture devant ?", mem)).toBe(true);
  });
});

test.describe("Scénario D · image inconnue ou sans rapport", () => {
  test("autre jeu : aucun candidat ; Claude qui affirme « Jason's House » est ignoré", async () => {
    const t = seq(extract({ gta6: "non", indices: ["maison_sur_pilotis", "palmiers"] }), "C'est Jason's House !\n@@@\n{\"identification\":{\"candidat\":\"jasons-house\",\"confiance\":\"élevée\"}}");
    const c = await askCopilot({ question: "C'est où ?", ctx: ctx(), topic: null, history: [], transport: t, attachments: [img()] });
    expect(c.grounding!.identification).toBeNull();
    expect(c.grounding!.reason).toContain("ne semble pas venir de GTA VI");
    expect(t.calls[1].messages.at(-1)!.content).toContain("Ne nomme PAS de lieu précis");
  });
  test("scène générique (palmiers, plage, eau) : aucun lieu proposé, même au chapitre 1", () => {
    const g = ground(parseObservation({ type: "scène", gta6: "oui", indices: ["palmiers", "plage", "eau_libre"] })!, { chapter: 1, edition: "ultimate" });
    expect(g.candidates).toHaveLength(0);
  });
  test("lieu non documenté mais distinctif (motel au chapitre 1, rien d'autre) : candidat faible au mieux, jamais Jason's House", () => {
    const g = ground(parseObservation({ type: "scène", gta6: "oui", indices: ["motel", "palmiers"] })!, { chapter: 1, edition: "ultimate" });
    expect(g.candidates.map((c) => c.id)).not.toContain("jasons-house");
    expect(["faible", "aucune"]).toContain(g.confidence);
  });
});

test.describe("Scénario E · recherche web sur besoin", () => {
  test("identification incertaine : requête construite depuis les indices (anglais) et les candidats", async () => {
    const t = seq(extract({ indices: ["bateau_sur_cales", "marina", "palmiers"] }), "Je ne peux pas trancher.\n@@@\n{\"identification\":{\"candidat\":\"aucun\",\"confiance\":\"aucune\"}}");
    const web = counter();
    const c = await askCopilot({ question: "C'est quoi cet endroit ?", ctx: ctx({ edition: "standard" }), topic: null, history: [], transport: t, attachments: [img()], search: web.fn });
    expect(web.q.length).toBeGreaterThan(0);
    expect(web.q[0]).toMatch(/^GTA 6 .*boat on trailer/);
    expect(c.web?.status).toBe("ok");
    expect(c.grounding!.identification).toBeNull(); // un résultat web n'est pas une identification
  });
  test("recherche indisponible : statut explicite transmis au modèle, aucune fausse confirmation", async () => {
    const t = seq(extract({ indices: ["bateau_sur_cales", "marina"] }), "Pas de certitude.\n@@@\n{}");
    const search: WebSearchFn = async () => ({ status: "not_connected", hits: [] });
    const c = await askCopilot({ question: "C'est quoi cet endroit ?", ctx: ctx(), topic: null, history: [], transport: t, attachments: [img()], search });
    expect(c.web?.status).toBe("not_connected");
    expect(t.calls[1].messages.at(-1)!.content).toContain("recherche web en échec");
  });
  test("requête visuelle : candidats et textes lus, jamais de coordonnées", () => {
    const obs = parseObservation({ type: "carte", gta6: "oui", indices: ["aeroport", "littoral", "port"], textes: ["Goose Key"] })!;
    const q = visualQuery(obs, ground(obs, { chapter: 1, edition: "ultimate" }), 1);
    expect(q).toMatch(/^GTA 6 /);
    expect(q).toContain('"Goose Key"');
    expect(q).not.toMatch(/\d{3,}/);
  });
});

test.describe("Coûts et sélection des connaissances", () => {
  test("coût par tour : image = 2 appels Claude (+ 0 à 2 Exa) ; suivi avec image = 1 ; « montre-moi » = 0", async () => {
    const t1 = seq(HOUSE, "ok\n@@@\n{}");
    let mem: VisualMemory | null = null;
    await askCopilot({ question: "C'est quoi ?", ctx: ctx(), topic: null, history: [], transport: t1, attachments: [img()], onVision: (m) => (mem = m) });
    expect(t1.calls).toHaveLength(2);
    const t2 = seq("ok\n@@@\n{}");
    await askCopilot({ question: "Détaille", ctx: ctx(), topic: null, history: [], transport: t2, memory: mem });
    expect(t2.calls).toHaveLength(1);
  });
  test("question texte sur un lieu : fiches Knowledge dans les preuves, contexte compact (pas d'alertes de mission)", async () => {
    expect(entitiesForQuestion("C'est quoi The Rusty Anchor ?").map((e) => e.id)).toContain("the-rusty-anchor");
    const t = seq("C'est le bar de Key Lento.\n@@@\n{}");
    await askCopilot({ question: "C'est quoi The Rusty Anchor ?", ctx: ctx(), topic: null, history: [], transport: t });
    const p = t.calls[0].messages.at(-1)!.content;
    expect(p).toContain("CONNAISSANCES LEONIDA");
    expect(p).toContain("moulin en bois sur le toit");
    expect(p).not.toContain("Family Savings");
  });
  test("question de mission : le contexte Story complet reste fourni", async () => {
    const t = seq("ok\n@@@\n{}");
    await askCopilot({ question: "Je risque de manquer quoi avant Tourist Trap ?", ctx: ctx(), topic: null, history: [], transport: t });
    expect(t.calls[0].messages.at(-1)!.content).toContain("Family Savings");
  });
});

test.describe("Correctifs résiduels V0.18.1", () => {
  const st = (p: Partial<Profile> = {}): PersistedState => ({ ...base, profile: THEO(p) });
  test("B · classification unique : activités et lieux des chapitres 2 à 5 refusés comme mission, absents du choix manuel", () => {
    expect(missionKind("Prepare for Vice City")).toBe("activity");
    expect(missionKind("Starlet Motel")).toBe("place");
    expect(missionKind("Mettre 5 000 $ sur Family Savings")).toBe("activity");
    expect(missionKind("Checking Out")).toBe("main");
    const s = reducer(st({ chapter: 2 }), { type: "profile", patch: { nextMission: "Prepare for Vice City", missionInProgress: false } });
    expect(s.profile.nextMission).toBeNull();
    const a = autopilot(st({ chapter: 2, lastMission: "Discharge Time", missionsDone: ["Discharge Time"] }));
    expect(a.manual).not.toContain("Prepare for Vice City");
    expect(a.manual).not.toContain("Starlet Motel");
    expect(a.manual).toContain("Checking Out");
  });
});

test("Markdown lisible : titres, listes et paragraphes reconnus (plus d'astérisques ni de dièses affichés)", () => {
  expect(blocks("### Pourquoi\n- **Pilotis**\n- *Ganado* jaune\n\nFin.")).toEqual([
    { kind: "h", text: "Pourquoi" },
    { kind: "ul", items: ["**Pilotis**", "*Ganado* jaune"] },
    { kind: "p", text: "Fin." },
  ]);
});
