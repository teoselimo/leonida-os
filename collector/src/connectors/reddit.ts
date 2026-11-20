import { fetchWithRetry } from "../http.ts";
import { youtubeIds } from "../util.ts";
import type { Connector, CollectedItem } from "./base.ts";
import { ConnectorUnavailable } from "./base.ts";

/**
 * Reddit Data API — accès OAuth « application-only » uniquement (pas de scraping de reddit.com).
 * Variables : REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USER_AGENT.
 * Les publications supprimées sont signalées (deleted) pour être retirées du Radar.
 */
export const reddit: Connector = async ({ source, env, fetchImpl }) => {
  const id = env.REDDIT_CLIENT_ID;
  const secret = env.REDDIT_CLIENT_SECRET;
  if (!id || !secret) throw new ConnectorUnavailable("missing-credentials", "Accès API Reddit non autorisé/configuré (REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET) : connecteur inactif.");
  const ua = env.REDDIT_USER_AGENT || "web:leonida-os:0.5 (by /u/unknown)";
  const f = fetchImpl ?? fetch;
  const tr = await f("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded", "User-Agent": ua },
    body: "grant_type=client_credentials",
  });
  if (!tr.ok) throw new ConnectorUnavailable("missing-credentials", `Authentification Reddit refusée (HTTP ${tr.status}).`);
  const { access_token } = (await tr.json()) as { access_token: string };
  const items: CollectedItem[] = [];
  let attempts = 1;
  for (const sub of source.subreddits ?? []) {
    const r = await fetchWithRetry(`https://oauth.reddit.com/r/${sub}/new?limit=50&raw_json=1`, { fetchImpl, headers: { Authorization: `Bearer ${access_token}`, "User-Agent": ua } });
    attempts += r.attempts;
    const json = JSON.parse(r.text) as { data: { children: Array<{ data: Record<string, any> }> } };
    for (const { data: p } of json.data.children) {
      const url = `https://www.reddit.com${p.permalink}`;
      items.push({
        externalId: p.name,
        url,
        title: p.title,
        text: p.selftext || "",
        publishedAt: new Date(p.created_utc * 1000).toISOString(),
        author: p.author,
        videoIds: youtubeIds(`${p.url} ${p.selftext}`),
        media: null,
        deleted: p.removed_by_category != null || p.author === "[deleted]" || p.selftext === "[removed]",
      });
    }
  }
  return { items, attempts };
};
