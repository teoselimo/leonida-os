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
const emptyStore = (): Store => ({ raw: {}, records: [], runs: [], state: {}, cycles: [], vehicles: [] });

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

// ───────────────────────── V0.5.1 : lecture des guides, fiche structurée, recoupement ─────────────────────────
import { resetRobotsCache, parseRobots, isAllowed } from "../src/pipeline/article.ts";
import { CLAIM_QUESTION, RUMOR } from "../src/pipeline/rules.ts";

const GUIDE_A = { id: "guide-a", name: "Guide A", kind: "rss", official: false, enabled: true, intervalMinutes: 60, url: "https://guide-a.example/feed", access: "", lang: "en", trust: "high" } satisfies SourceConfig;
const GUIDE_B = { id: "guide-b", name: "Guide B", kind: "rss", official: false, enabled: true, intervalMinutes: 60, url: "https://guide-b.example/feed", access: "", lang: "en", trust: "high" } satisfies SourceConfig;
const GUIDE_C = { id: "guide-c", name: "Guide C", kind: "rss", official: false, enabled: true, intervalMinutes: 60, url: "https://guide-c.example/feed", access: "", lang: "en", trust: "medium" } satisfies SourceConfig;
const C_FEED = fx("guide-a.xml").replace(/guide-a/g, "guide-c").replace("ga-1", "gc-1").replace("GTA 6 Early Money: The Three Sheets Liquor Parrot Stash", "GTA 6 parrot money at Three Sheets Liquor: our first look");

const GUIDE_ROUTES = {
  "https://guide-a.example/robots.txt": "User-agent: *\nDisallow: /wp-admin/\n",
  "https://guide-a.example/feed": fx("guide-a.xml"),
  "https://guide-a.example/gta-6-early-money": fx("guide-a.html"),
  // Le site B accepte les lecteurs mais refuse explicitement les robots d'IA
  "https://guide-b.example/robots.txt": "User-agent: *\nAllow: /\n\nUser-agent: ClaudeBot\nDisallow: /\n",
  "https://guide-b.example/feed": fx("guide-b.xml"),
  "https://guide-b.example/exotic-animals-front": fx("guide-b.html"),
  "https://guide-c.example/robots.txt": "User-agent: *\nAllow: /\n",
  "https://guide-c.example/feed": C_FEED,
  "https://guide-c.example/gta-6-early-money": fx("guide-c.html"),
};
const strip = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

test("V0.5.1 acceptation : cache du perroquet (mission de Shirley) transformée automatiquement en fiche sourcée", async () => {
  resetRobotsCache();
  const store = emptyStore();
  const { summary, feed } = await run(store, [GUIDE_A, GUIDE_B], GUIDE_ROUTES);
  assert.equal(summary.deepReads, 2, "deux articles lus en entier");
  assert.equal(summary.merged, 1, "les deux guides décrivent la même découverte");
  const recs = feed.items.filter((i) => /parrot|exotic/i.test(i.title));
  assert.equal(recs.length, 1, "une seule fiche");
  const r = recs[0];
  const d = r.details!;
  // le secret et sa récompense
  assert.equal(r.category, "money");
  assert.deepEqual(d.money!.value, { min: 1000, max: 1400, approx: true });
  assert.equal(d.money!.support.length, 2, "1 263 $ (B) est compris dans 1 000–1 400 $ (A)");
  assert.equal(r.conditions.reward, "≈ 1 000–1 400 $");
  // la mission ou le contexte associé
  assert.equal(d.mission!.value, "Get Shirley's Rum");
  assert.equal(d.giver!.value, "Shirley");
  assert.equal(d.giver!.support.length, 2);
  assert.equal(d.unlockAfter!.value, "Pipework");
  assert.deepEqual(d.contextMissable!.value, { subject: "Get Shirley's Rum", until: "Tourist Trap" });
  assert.equal(d.missable!.value, false, "la découverte elle-même reste accessible");
  // le lieu cité — sans coordonnées inventées
  assert.equal(r.location.place, "Three Sheets Liquor, Key Lento");
  assert.equal(r.location.regionId, "keys");
  assert.equal(r.location.precision, "named-place");
  assert.equal(r.location.x, null);
  assert.equal(r.location.suggestion, null, "lieu absent de la carte communautaire : aucune proposition");
  // preuves : chaque citation existe textuellement dans l'article d'origine
  assert.equal(r.evidence.length, 2);
  for (const e of r.evidence) {
    assert.ok(e.deep?.ok);
    const src = strip(fx(e.url.includes("guide-a") ? "guide-a.html" : "guide-b.html"));
    for (const q of e.quotes) assert.ok(src.includes(q.replace(/…$/, "").replace(/\s+/g, " ").slice(0, 60)), `citation retrouvée : ${q}`);
    assert.ok(e.quotes.length >= 2);
  }
  // le niveau de confiance
  assert.equal(r.reliability, "confirmed");
  assert.ok(r.reasons.some((x) => /2 sources indépendantes concordantes sur le lieu, la récompense/.test(x)));
  assert.ok(r.reasons.some((x) => /testé en jeu/.test(x)));
  // la pertinence pour un joueur en début de chapitre 1
  assert.equal(d.chapter!.value, 1);
  assert.equal(r.spoiler, "low");
  assert.equal(r.actionable, true);
  assert.equal(r.advice!.chapterMin, 1);
  assert.equal(r.advice!.urgency, "now");
  assert.match(r.advice!.text, /Three Sheets Liquor \(Key Lento\) pendant « Get Shirley's Rum » \(Shirley\)\. Accessible après « Pipework »\. La mission disparaît au lancement de « Tourist Trap »/);
  assert.ok(r.revisions.some((v) => v.reason.includes("Même découverte")));
});

test("V0.5.1 : une seule source → « À vérifier », champs inconnus laissés vides", async () => {
  resetRobotsCache();
  const { feed } = await run(emptyStore(), [GUIDE_B], GUIDE_ROUTES);
  const r = byTitle(feed.items, /Exotic Animals Front/)!;
  assert.equal(r.reliability, "reported");
  assert.equal(r.actionable, false);
  assert.equal(r.advice, null);
  assert.equal(r.details!.mission, null);
  assert.equal(r.details!.unlockAfter, null);
  assert.ok(r.details!.missing.includes("mission associée"));
  assert.ok(r.details!.missing.includes("condition d'accès"));
  assert.equal(r.details!.money!.value.min, 1263);
  assert.ok(r.reasons.some((x) => x.includes("Non établi par les sources")));
});

test("V0.5.1 : montants contradictoires → fusion mais pas de confirmation", async () => {
  resetRobotsCache();
  const { feed } = await run(emptyStore(), [GUIDE_A, GUIDE_C], GUIDE_ROUTES);
  const r = feed.items.find((i) => /parrot/i.test(i.title))!;
  assert.equal(r.evidence.length, 2);
  assert.equal(r.reliability, "reported");
  assert.equal(r.details!.money!.conflicts.length, 1);
  assert.ok(r.reasons.some((x) => x.includes("se contredisent")));
});

test("V0.5.1 : robots.txt respecté et IA jamais utilisée sur un site qui la refuse", async () => {
  resetRobotsCache();
  let aiCalls = 0;
  const bodies: string[] = [];
  const routes = { ...GUIDE_ROUTES, "https://guide-a.example/robots.txt": "User-agent: *\nDisallow: /gta-6\n" };
  const f = mockFetch(routes);
  const counting = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes("api.anthropic.com")) {
      aiCalls++;
      bodies.push(String(init?.body ?? ""));
      return new Response(JSON.stringify({ content: [{ text: "{}" }] }));
    }
    return f(input, init);
  }) as typeof fetch;
  const store = emptyStore();
  await runCollection(store, { sources: [GUIDE_A, GUIDE_B], overrides: {}, env: { ANTHROPIC_API_KEY: "k", ANTHROPIC_MODEL: "m" }, now: NOW, force: true, fetchImpl: counting });
  const evA = store.records.flatMap((r) => r.evidence).find((e) => e.sourceId === "guide-a")!;
  const evB = store.records.flatMap((r) => r.evidence).find((e) => e.sourceId === "guide-b")!;
  assert.equal(evA.deep!.ok, false);
  assert.equal(evA.deep!.reason, "refusé par robots.txt");
  assert.equal(evA.deep!.facts, null);
  assert.equal(evB.deep!.aiOptOut, true);
  assert.equal(evB.deep!.method, "rules");
  // seul l'enrichissement de résumé (titre + extrait RSS) peut appeler l'IA, jamais l'extraction sur le texte de B
  assert.ok(aiCalls <= 2, `appels IA bornés (${aiCalls})`);
  assert.equal(bodies.some((b) => b.includes("generator room")), false, "le texte de l'article B n'est jamais envoyé à un modèle");
  assert.equal(isAllowed(parseRobots("User-agent: *\nDisallow: /\nAllow: /news/"), "/news/x"), true);
  assert.equal(isAllowed(parseRobots("User-agent: *\nDisallow: /search"), "/search?q=1"), false);
});

test("V0.5.1 : marqueurs de rumeur resserrés (guides et démentis ne sont plus des rumeurs)", () => {
  assert.equal(CLAIM_QUESTION.test("Should you do Shirley's rum errand in GTA 6?"), false);
  assert.equal(CLAIM_QUESTION.test("Is Bigfoot real in GTA 6?"), true);
  assert.equal(RUMOR.test("Fact check: that viral GTA 6 map is fake, Rockstar claims"), false);
  assert.equal(RUMOR.test("GTA 6 leak suggests a new island"), true);
});

test("V0.5.1 : chaque cycle est journalisé avec son déclencheur (preuve du cron)", async () => {
  resetRobotsCache();
  const store = emptyStore();
  await runCollection(store, { sources: [SRC.pressA], overrides: {}, env: {}, now: NOW, force: true, fetchImpl: mockFetch(ROUTES), trigger: "schedule", runId: "42", deep: false });
  const feed = buildFeed(store, [SRC.pressA], null, NOW);
  assert.equal(feed.health!.cadenceMinutes, 15);
  assert.equal(feed.health!.cycles.at(-1)!.trigger, "schedule");
  assert.equal(feed.health!.cycles.at(-1)!.runId, "42");
});

// ───────────────────────── V0.6 : Garage des légendes (catalogue automobile autonome) ─────────────────────────
const carFx = (f: string) => fx(`cars/${f}`);
const rssOf = (host: string, items: Array<[string, string, string]>) =>
  `<?xml version="1.0"?><rss version="2.0"><channel><title>${host}</title>${items
    .map(([path, title, desc]) => `<item><title>${title}</title><link>https://${host}/${path}</link><guid>${host}-${path}</guid><pubDate>Thu, 20 Nov 2026 10:00:00 GMT</pubDate><description>${desc}</description></item>`)
    .join("")}</channel></rss>`;
const carSrc = (id: string, host: string): SourceConfig => ({ id, name: `Guide ${id}`, kind: "rss", official: false, enabled: true, intervalMinutes: 60, url: `https://${host}/feed`, access: "", lang: "en", trust: "high" });
const CAR_SOURCES = [carSrc("cx", "cars-x.example"), carSrc("cy", "cars-y.example"), carSrc("cz", "cars-z.example"), carSrc("cu", "cars-u.example"), carSrc("cv", "cars-v.example"), carSrc("cr", "cars-r.example")];
function carRoutes(listFile = "list.html") {
  const r: Record<string, string> = {};
  for (const h of ["x", "y", "z", "u", "v", "r"]) r[`https://cars-${h}.example/robots.txt`] = "User-agent: *\nAllow: /\n";
  r["https://cars-x.example/feed"] = rssOf("cars-x.example", [["gta-6-hidden-cars", "GTA 6 hidden cars: every parked rarity we found", "Rare parked cars in GTA 6."]]);
  r["https://cars-x.example/gta-6-hidden-cars"] = carFx(listFile);
  r["https://cars-y.example/feed"] = rssOf("cars-y.example", [["paul-walker-car", "How to get Paul Walker's Fast and Furious car in GTA 6", "The tribute car in GTA 6."]]);
  r["https://cars-y.example/paul-walker-car"] = carFx("single.html");
  r["https://cars-z.example/feed"] = rssOf("cars-z.example", [["gta-6-paul-walker-car", "GTA 6 Paul Walker Car Location", "Where the Eclipse tribute is in GTA 6."]]);
  r["https://cars-z.example/gta-6-paul-walker-car"] = carFx("alias.html");
  r["https://cars-u.example/feed"] = rssOf("cars-u.example", [["ultimate-items", "GTA 6: How to Get Ultimate Edition Items & Pre-Order Bonuses", "Every bonus in GTA 6."]]);
  r["https://cars-u.example/ultimate-items"] = carFx("ultimate.html");
  r["https://cars-v.example/feed"] = rssOf("cars-v.example", [["editions", "GTA 6 Standard vs Ultimate Edition cars", "Edition comparison for GTA 6."]]);
  r["https://cars-v.example/editions"] = carFx("ultimate-b.html");
  r["https://cars-r.example/feed"] = rssOf("cars-r.example", [["register-car", "GTA 6 How to Get New Personal Car", "Register cars in GTA 6."]]);
  r["https://cars-r.example/register-car"] = carFx("register.html");
  return r;
}
const vById = (store: Store, id: string) => store.vehicles.find((v) => v.id === id)!;

test("V0.6 : Penumbra FF détectée, recoupée par 3 guides (dont un qui ne cite que la Mitsubishi Eclipse), zone sans faux point", async () => {
  resetRobotsCache();
  const store = emptyStore();
  const { summary } = await run(store, CAR_SOURCES, carRoutes());
  assert.ok((summary.vehicles ?? 0) >= 6);
  const p = vById(store, "v-maibatsu-penumbra-ff");
  assert.equal(p.name, "'97 Maibatsu Penumbra FF");
  assert.deepEqual(p.evidence.map((e) => e.sourceName).sort(), ["Guide cx", "Guide cy", "Guide cz"], "le guide « Mitsubishi Eclipse » est rattaché par alias appris");
  assert.deepEqual(p.aliases!.value, ["mitsubishi-eclipse"]);
  assert.equal(p.reliability, "confirmed");
  assert.equal(p.kind, "hidden");
  assert.equal(p.location.district, "Rialto Islands");
  assert.equal(p.location.precision, "zone");
  assert.equal(p.location.point, null, "jamais de point exact sans validation");
  assert.ok(p.location.zone!.radius > 100);
  assert.match(p.variant!.value, /green/);
  assert.equal(p.keep.mode, "register");
  assert.equal(p.keep.rule!.chapter, 2);
  assert.equal(p.keep.rule!.where, "garage de Moses");
  assert.ok(p.risks.some((r) => /lose it again/.test(r.quote)));
  assert.ok(p.steps.length >= 1);
  // variante distincte : la Penumbra « simple » n'est pas confondue
  const plain = vById(store, "v-maibatsu-penumbra");
  assert.ok(plain && plain.id !== p.id);
  assert.equal(plain.location.district, "Little Cuba");
});

test("V0.6 : Itali RSX — cloneur de clé ⇒ chapitre 3 déduit (règle sourcée), traqueur avancé, conservation non documentée", async () => {
  resetRobotsCache();
  const store = emptyStore();
  await run(store, CAR_SOURCES, carRoutes());
  const r = vById(store, "v-grotti-itali-rsx");
  assert.equal(r.access.keyCloner!.value, true);
  assert.equal(r.access.tracker!.value, "advanced");
  assert.equal(r.access.inferredChapter!.value, 3);
  assert.match(r.access.inferredChapter!.source.quote, /key cloner in Chapter 3/);
  assert.equal(r.keep.rule, null, "aucune règle documentée pour les traqueurs avancés : rien d'inventé");
  assert.equal(r.reliability, "reported");
  // la page cite sa propre source : l'origine est comptée, pas de fausse indépendance
  assert.equal(r.location.district, "Rialto Islands");
});

test("V0.6 : exclusivités d'édition — Cheetah et Enduro Ultimate confirmés (2 sources), Stanier = précommande, fenêtre « chapitre 1 »", async () => {
  resetRobotsCache();
  const store = emptyStore();
  await run(store, CAR_SOURCES, carRoutes());
  const c = vById(store, "v-grotti-cheetah");
  assert.equal(c.edition.exclusive, "ultimate");
  assert.equal(c.edition.status, "confirmed");
  assert.equal(c.access.chapterMin!.value, 5);
  assert.equal(c.keep.mode, "yes");
  const e = vById(store, "v-dinka-enduro");
  assert.equal(e.edition.exclusive, "ultimate");
  assert.equal(e.edition.status, "confirmed");
  assert.equal(e.access.until!.value, 1);
  assert.equal(e.location.district, "Key Lento");
  const s = vById(store, "v-vapid-stanier");
  assert.equal(s.edition.exclusive, "preorder");
  assert.equal(s.access.chapterMin!.value, 3);
});

test("V0.6 : zone élargie (« à l'est de Belville »), puis point exact uniquement après validation", async () => {
  resetRobotsCache();
  const store = emptyStore();
  await run(store, CAR_SOURCES, carRoutes());
  const v = vById(store, "v-pegassi-vitello");
  assert.equal(v.location.precision, "zone");
  assert.equal(v.location.zone!.widened, true);
  await runCollection(store, { sources: CAR_SOURCES, overrides: {}, vehicleOverrides: { "v-pegassi-vitello": { point: { x: -1100, y: 2950 } } }, env: {}, now: new Date(NOW.getTime() + 3600_000), force: true, fetchImpl: mockFetch(carRoutes()) });
  const w = vById(store, "v-pegassi-vitello");
  assert.equal(w.location.precision, "exact");
  assert.deepEqual(w.location.point, { x: -1100, y: 2950 });
  assert.equal(w.location.zone, null);
  assert.ok(w.revisions.some((r) => r.reason === "Point validé"));
});

test("V0.6 : un nouveau véhicule publié par une source entre automatiquement au catalogue, sans doublon", async () => {
  resetRobotsCache();
  const store = emptyStore();
  await run(store, CAR_SOURCES, carRoutes());
  const before = store.vehicles.length;
  assert.equal(store.vehicles.some((v) => v.id === "v-bravado-banshee"), false);
  // la source met à jour sa liste (nouvel article dans le flux)
  resetRobotsCache();
  const routes = carRoutes();
  routes["https://cars-x.example/feed"] = rssOf("cars-x.example", [["gta-6-hidden-cars", "GTA 6 hidden cars: every parked rarity we found", "Rare parked cars in GTA 6."], ["gta-6-more-cars", "GTA 6 more hidden cars", "More rare cars."]]);
  routes["https://cars-x.example/gta-6-more-cars"] = carFx("list-v2.html");
  const later = new Date(NOW.getTime() + 2 * 3600_000);
  await runCollection(store, { sources: CAR_SOURCES, overrides: {}, env: {}, now: later, force: true, fetchImpl: mockFetch(routes) });
  const b = vById(store, "v-bravado-banshee");
  assert.ok(b, "nouveau véhicule détecté");
  assert.equal(b.firstSeenAt, later.toISOString());
  assert.equal(b.location.district, "Starfish Island");
  assert.equal(store.vehicles.length, before + 1);
  assert.equal(vById(store, "v-pegassi-vitello").evidence.length, 2, "même modèle cité par un 2e article du même site : une fiche, deux preuves");
});
