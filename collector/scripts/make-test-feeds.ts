/**
 * Génère les flux de test de l'interface (tests/fixtures/radar-v*.json) avec le VRAI moteur,
 * à partir des fixtures du collecteur (aucune donnée écrite à la main dans les flux).
 *   v1 : chaîne Rockstar + presse A
 *   v2 : + presse B (confirme la découverte « Stinger ») ; la rumeur « leak » est retirée par un admin
 *   v3 : v2 + point validé par un admin sur « Stinger »
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildFeed, runCollection } from "../src/engine.ts";
import type { Store } from "../src/store/fileStore.ts";
import type { SourceConfig } from "../src/types.ts";

const fx = (f: string) => readFileSync(fileURLToPath(new URL(`../tests/fixtures/${f}`, import.meta.url)), "utf8");
const out = fileURLToPath(new URL("../../tests/fixtures/", import.meta.url));
mkdirSync(out, { recursive: true });
const NOW = new Date(process.env.FEED_NOW || Date.now());
const sources: SourceConfig[] = [
  { id: "rockstar-youtube", name: "Rockstar Games (YouTube officiel)", kind: "youtube-feed", official: true, enabled: true, intervalMinutes: 15, channelId: "UC6VcWc1rAoWdBCM0JxrRQ3A", access: "", noAI: true, lang: "en", trust: "official" },
  { id: "press-a", name: "Presse A (test)", kind: "rss", official: false, enabled: true, intervalMinutes: 60, url: "https://press-a.example/feed", access: "", lang: "en", trust: "high" },
  { id: "press-b", name: "Presse B (test)", kind: "rss", official: false, enabled: true, intervalMinutes: 60, url: "https://press-b.example/feed", access: "", lang: "en", trust: "high" },
];
const routes: Record<string, string> = {
  "https://www.youtube.com/feeds/videos.xml?channel_id=UC6VcWc1rAoWdBCM0JxrRQ3A": fx("rockstar-youtube.xml"),
  "https://press-a.example/feed": fx("press.xml").replace(/Thu, 20 Nov 2026 \d\d:00:00 GMT/g, NOW.toUTCString()),
  "https://press-b.example/feed": fx("press-b.xml").replace(/Thu, 20 Nov 2026 \d\d:00:00 GMT/g, NOW.toUTCString()),
};
const fetchImpl = (async (u: RequestInfo | URL) => {
  const k = Object.keys(routes).find((r) => String(u).startsWith(r));
  return k ? new Response(routes[k], { status: 200 }) : new Response("", { status: 404 });
}) as typeof fetch;

const store: Store = { raw: {}, records: [], runs: [], state: {} };
const run = async (only: string[], overrides = {}) => {
  const s = await runCollection(store, { sources, overrides, env: {}, now: NOW, force: true, only, fetchImpl, maxAgeDays: 3650 });
  return buildFeed(store, sources, s, NOW);
};
const v1 = await run(["rockstar-youtube", "press-a"]);
writeFileSync(out + "radar-v1.json", JSON.stringify(v1, null, 1));
const leak = v1.items.find((i) => /leak/.test(i.title))!;
const v2 = await run(["press-b"], { [leak.id]: { status: "retracted", note: "infirmé (test)" } });
writeFileSync(out + "radar-v2.json", JSON.stringify(v2, null, 1));
const stinger = v2.items.find((i) => /Stinger/.test(i.title))!;
const v3 = await run([], { [leak.id]: { status: "retracted" }, [stinger.id]: { location: { regionId: "keys", place: "Permit Keys", x: -2100, y: -5300 } } });
writeFileSync(out + "radar-v3.json", JSON.stringify(v3, null, 1));
console.log(`v1 ${v1.items.length} fiches · v2 ${v2.items.length} (Stinger : ${stinger.reliability}) · v3 point validé : ${v3.items.find((i) => i.id === stinger.id)!.location.precision}`);
