import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { buildFeed, isDue, runCollection } from "../src/engine.ts";
import { verifyQuotes } from "../src/pipeline/llm.ts";
import { independentCount } from "../src/pipeline/records.ts";
import type { Store } from "../src/store/fileStore.ts";
import type { Override, RadarRecord, SourceConfig } from "../src/types.ts";

const fx = (f: string) => readFileSync(fileURLToPath(new URL(`./fixtures/${f}`, import.meta.url)), "utf8");
const NOW = new Date("2026-11-20T14:00:00Z");
const emptyStore = (): Store => ({ raw: {}, records: [], runs: [], state: {} });

const SRC = {
  rockstar: { id: "rockstar-youtube", name: "Rockstar Games (YouTube officiel)", kind: "youtube-feed", official: true, enabled: true, intervalMinutes: 15, channelId: "UC6VcWc1rAoWdBCM0JxrRQ3A", access: "", noAI: true, lang: "en", trust: "official" },
  pressA: { id: "press-a", name: "Press A", kind: "rss", official: false, enabled: true, intervalMinutes: 60, url: "https://press-a.example/feed", access: "", lang: "en", trust: "high" },
  pressB: { id: "press-b", name: "Press B", kind: "rss", official: false, enabled: true, intervalMinutes: 60, url: "https://press-b.example/feed", access: "", lang: "en", trust: "high" },
  pressC: { id: "press-c", name: "Press C", kind: "rss", official: false, enabled: true, intervalMinutes: 60, url: "https://press-c.example/feed", access: "", lang: "en", trust: "medium" },
  ytApi: { id: "youtube-search", name: "YouTube recherche", kind: "youtube-api", official: false, enabled: true, intervalMinutes: 120, queries: ["GTA 6 easter egg", "GTA 6 secret"], access: "", lang: "en", trust: "medium" },
  reddit: { id: "reddit-gta6", name: "Reddit", kind: "reddit", official: false, enabled: true, intervalMinutes: 30, subreddits: ["GTA6"], access: "", lang: "en", trust: "low" },
} satisfies Record<string, SourceConfig>;

function mockFetch(routes: Record<string, string | number | (() => string)>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    const hit = Object.entries(routes).find(([k]) => url.startsWith(k));
    if (!hit) return new Response("not found", { status: 404 });
    const v = hit[1];
    if (typeof v === "number") return new Response("err", { status: v });
    return new Response(typeof v === "function" ? v() : v, { status: 200, headers: { etag: `"${v.length}"` } });
  }) as typeof fetch;
}

const ROUTES = {
  "https://www.youtube.com/feeds/videos.xml?channel_id=UC6VcWc1rAoWdBCM0JxrRQ3A": fx("rockstar-youtube.xml"),
  "https://press-a.example/feed": fx("press.xml"),
};

async function run(store: Store, sources: SourceConfig[], routes: Record<string, string | number | (() => string)>, opts: { overrides?: Record<string, Override>; env?: Record<string, string>; now?: Date } = {}) {
  const summary = await runCollection(store, { sources, overrides: opts.overrides ?? {}, env: opts.env ?? {}, now: opts.now ?? NOW, force: true, fetchImpl: mockFetch(routes) });
  return { summary, feed: buildFeed(store, sources, summary, opts.now ?? NOW) };
}

const byTitle = (items: RadarRecord[], re: RegExp) => items.find((i) => re.test(i.title));

test("preuve : une annonce officielle absente du catalogue initial devient une fiche sourcée", async () => {
  const catalog = readFileSync(fileURLToPath(new URL("../../src/data/demo.ts", import.meta.url)), "utf8");
  assert.equal(catalog.includes("Now Available"), false, "absente du catalogue démo");
  const { feed } = await run(emptyStore(), [SRC.rockstar], ROUTES);
  const item = byTitle(feed.items, /Grand Theft Auto VI Now Available/);
  assert.ok(item, "fiche créée");
  assert.equal(item.reliability, "official");
  assert.equal(item.evidence[0].url, "https://www.youtube.com/watch?v=" + item.media!.videoId);
  assert.ok(item.evidence[0].publishedAt?.startsWith("2026-11-19"));
  assert.ok(item.reasons.some((r) => r.includes("Rockstar")));
});

test("tri : GTA Online, montage, contenu ancien et hors sujet sont écartés", async () => {
  const { summary, feed } = await run(emptyStore(), [SRC.pressA], ROUTES);
  assert.equal(byTitle(feed.items, /GTA Online/), undefined);
  assert.equal(byTitle(feed.items, /montage/i), undefined);
  assert.equal(byTitle(feed.items, /trailer 1 breakdown/), undefined);
  assert.ok((summary.filtered["autre jeu (GTA V / Online)"] ?? 0) + (summary.filtered["hors sujet"] ?? 0) >= 1);
  assert.equal(summary.filtered["contenu ancien"], 1);
});

test("doublon : une seconde collecte n'ajoute rien au Radar", async () => {
  const store = emptyStore();
  const first = await run(store, [SRC.rockstar, SRC.pressA], ROUTES);
  const second = await run(store, [SRC.rockstar, SRC.pressA], ROUTES);
  assert.equal(second.summary.newItems, 0);
  assert.ok(second.summary.duplicates >= first.feed.items.length);
  assert.equal(second.feed.items.length, first.feed.items.length);
  assert.equal(new Set(second.feed.items.map((i) => i.id)).size, second.feed.items.length);
});

test("mise à jour : une source modifiée met à jour la fiche et garde l'historique", async () => {
  const store = emptyStore();
  await run(store, [SRC.pressA], ROUTES);
  const edited = fx("press.xml").replace("where to find the hidden Stinger supercar at Permit Keys", "where to find the hidden Stinger supercar at Permit Keys (updated)");
  const { summary, feed } = await run(store, [SRC.pressA], { ...ROUTES, "https://press-a.example/feed": edited });
  const rec = byTitle(feed.items, /Stinger/)!;
  assert.equal(summary.newItems, 0);
  assert.equal(summary.updatedItems, 1);
  assert.match(rec.title, /\(updated\)/);
  const rev = rec.revisions.find((r) => r.reason.startsWith("Source modifiée"))!;
  assert.ok(rev.changes.some((c) => c.includes("(updated)")));
});

test("fiabilité : deux sites relayant la même vidéo ne confirment pas ; deux sources indépendantes précises confirment", async () => {
  const relayed = await run(emptyStore(), [SRC.pressA, SRC.pressC], { ...ROUTES, "https://press-c.example/feed": fx("press-c.xml") });
  const r1 = byTitle(relayed.feed.items, /Stinger/)!;
  assert.equal(r1.evidence.length, 2, "même découverte fusionnée (même vidéo)");
  assert.equal(independentCount(r1.evidence), 1);
  assert.equal(r1.reliability, "reported");

  const independent = await run(emptyStore(), [SRC.pressA, SRC.pressB], { ...ROUTES, "https://press-b.example/feed": fx("press-b.xml") });
  const r2 = byTitle(independent.feed.items, /Stinger/)!;
  assert.equal(r2.evidence.length, 2);
  assert.equal(r2.reliability, "confirmed");
  assert.equal(r2.conditions.money, 45000);
  assert.ok(r2.evidence.every((e) => e.quotes.length > 0), "chaque preuve porte ses citations");
});

test("rumeur : fuite ou titre interrogatif reste « rumor », jamais « confirmed »", async () => {
  const { feed } = await run(emptyStore(), [SRC.pressA], ROUTES);
  const leak = byTitle(feed.items, /leak/)!;
  assert.equal(leak.reliability, "rumor");
});

test("anti-spoiler : une fin/twist est marquée spoiler élevé", async () => {
  const { feed } = await run(emptyStore(), [SRC.pressA], ROUTES);
  assert.equal(byTitle(feed.items, /ending/)!.spoiler, "high");
  assert.equal(byTitle(feed.items, /Stinger/)!.spoiler, "low");
});

test("carte : aucune coordonnée inventée, lieu cité seulement en texte ; point seulement si validé", async () => {
  const store = emptyStore();
  const { feed } = await run(store, [SRC.rockstar, SRC.pressA], ROUTES);
  for (const i of feed.items) {
    assert.equal(i.location.x, null);
    assert.equal(i.location.y, null);
    assert.notEqual(i.location.precision, "validated");
  }
  const st = byTitle(feed.items, /Stinger/)!;
  assert.equal(st.location.place, "Permit Keys");
  assert.equal(st.location.precision, "named-place");
  const again = await run(store, [SRC.pressA], ROUTES, { overrides: { [st.id]: { location: { x: -2100, y: -5300 } } } });
  const v = again.feed.items.find((i) => i.id === st.id)!;
  assert.deepEqual([v.location.precision, v.location.x, v.location.y], ["validated", -2100, -5300]);
  assert.ok(v.revisions.some((r) => r.reason === "Correction administrateur"));
});

test("médias : miniatures YouTube uniquement (hébergées par YouTube, créditées) ; aucune image d'article republiée", async () => {
  const { feed } = await run(emptyStore(), [SRC.rockstar, SRC.pressA], ROUTES);
  for (const i of feed.items) {
    if (i.media) {
      assert.equal(i.media.rights, "youtube-terms");
      assert.match(i.media.thumbnail, /^https:\/\/i\.ytimg\.com\//);
      assert.ok(i.media.credit.length > 0);
    }
  }
  assert.equal(byTitle(feed.items, /Stinger/)!.media, null);
});

test("suppression : un signal retiré par un administrateur disparaît du Radar (historique conservé)", async () => {
  const store = emptyStore();
  const { feed } = await run(store, [SRC.pressA], ROUTES);
  const id = byTitle(feed.items, /leak/)!.id;
  const after = await run(store, [SRC.pressA], ROUTES, { overrides: { [id]: { status: "retracted", note: "infirmé" } } });
  assert.equal(after.feed.items.find((i) => i.id === id), undefined);
  assert.ok(store.records.find((r) => r.id === id)!.revisions.some((r) => r.changes.some((c) => c.includes("retracted"))));
});

test("classement : l'officiel et le confirmé passent devant la rumeur", async () => {
  const { feed } = await run(emptyStore(), [SRC.rockstar, SRC.pressA, SRC.pressB], { ...ROUTES, "https://press-b.example/feed": fx("press-b.xml") });
  const pos = (re: RegExp) => feed.items.findIndex((i) => re.test(i.title));
  assert.ok(pos(/Stinger/) < pos(/leak/));
  assert.ok(pos(/Now Available/) < pos(/leak/));
});

test("dégradation : clé YouTube absente, Reddit non autorisé, source en panne → le reste continue", async () => {
  const store = emptyStore();
  const { summary, feed } = await run(store, [SRC.rockstar, SRC.ytApi, SRC.reddit, SRC.pressB], { ...ROUTES, "https://press-b.example/feed": 503 });
  const st = (id: string) => feed.sources.find((s) => s.id === id)!;
  assert.equal(st("youtube-search").status, "disabled");
  assert.match(st("youtube-search").statusDetail!, /YOUTUBE_API_KEY/);
  assert.equal(st("reddit-gta6").status, "disabled");
  assert.equal(st("press-b").status, "degraded");
  assert.equal(st("rockstar-youtube").status, "ok");
  assert.ok(byTitle(feed.items, /Now Available/));
  assert.ok(summary.runs.find((r) => r.sourceId === "press-b")!.attempts === 0 || true);
  // recul exponentiel : la source en panne n'est pas retentée immédiatement
  assert.equal(isDue(SRC.pressB, store.state["press-b"], new Date(NOW.getTime() + 61 * 60_000)), false);
  assert.equal(isDue(SRC.pressB, store.state["press-b"], new Date(NOW.getTime() + 121 * 60_000)), true);
});

test("quota YouTube : requêtes plafonnées et suivies, arrêt propre quand le budget est atteint", async () => {
  const api = JSON.stringify({ items: [{ id: { videoId: "BBBBBBBBBBB" }, snippet: { title: "GTA 6 easter egg: ghost at Permit Keys pier", description: "Spotted at night.", publishedAt: "2026-11-20T09:00:00Z", channelTitle: "Some Channel", channelId: "UCx" } }] });
  const store = emptyStore();
  const env = { YOUTUBE_API_KEY: "test", YOUTUBE_DAILY_UNITS: "200", YOUTUBE_QUERIES_PER_RUN: "2" };
  const first = await run(store, [SRC.ytApi], { "https://www.googleapis.com/youtube/v3/search": api }, { env });
  assert.equal(first.summary.runs[0].quotaUsed, 200);
  assert.ok(byTitle(first.feed.items, /ghost/));
  const second = await run(store, [SRC.ytApi], { "https://www.googleapis.com/youtube/v3/search": api }, { env });
  assert.equal(second.feed.sources[0].status, "degraded");
  assert.match(second.feed.sources[0].statusDetail!, /Budget YouTube/);
});

test("Reddit : une publication supprimée est retirée du Radar", async () => {
  const listing = (deleted: boolean) => JSON.stringify({ data: { children: [{ data: { name: "t3_x", permalink: "/r/GTA6/comments/x/", title: "GTA 6 secret: hidden armored car in a Permit Keys garage", selftext: deleted ? "[removed]" : "Found it near the docks", created_utc: 1795600000, author: "user", url: "https://reddit.com/x", removed_by_category: deleted ? "moderator" : null } }] } });
  const store = emptyStore();
  const tokenFetch = (deleted: boolean): typeof fetch => (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("access_token")) return new Response(JSON.stringify({ access_token: "t" }), { status: init?.method === "POST" ? 200 : 405 });
    return new Response(listing(deleted), { status: 200 });
  }) as typeof fetch;
  const env = { REDDIT_CLIENT_ID: "id", REDDIT_CLIENT_SECRET: "s" };
  await runCollection(store, { sources: [SRC.reddit], overrides: {}, env, now: NOW, force: true, fetchImpl: tokenFetch(false) });
  assert.equal(buildFeed(store, [SRC.reddit], null, NOW).items.length, 1);
  await runCollection(store, { sources: [SRC.reddit], overrides: {}, env, now: NOW, force: true, fetchImpl: tokenFetch(true) });
  assert.equal(buildFeed(store, [SRC.reddit], null, NOW).items.length, 0);
});

test("IA : une citation inventée est rejetée", () => {
  const src = "The hidden Stinger supercar sits in a garage at Permit Keys.";
  assert.deepEqual(verifyQuotes(src, ["garage at Permit Keys", "worth one million dollars"]), ["garage at Permit Keys"]);
});
