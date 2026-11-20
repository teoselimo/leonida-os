import { fetchWithRetry } from "../http.ts";
import type { Connector, CollectedItem } from "./base.ts";
import { ConnectorUnavailable } from "./base.ts";

const SEARCH_COST = 100; // unités de quota par appel search.list (documentation Google)

/**
 * YouTube Data API v3 — recherches incrémentales ciblées.
 * Budget quotidien : YOUTUBE_DAILY_UNITS (défaut 3000 sur les 10 000 gratuits), requêtes en rotation.
 * Seules les métadonnées sont lues : un titre ne prouve pas le contenu d'une vidéo.
 */
export const youtubeApi: Connector = async ({ source, state, env, now, fetchImpl }) => {
  const key = env.YOUTUBE_API_KEY;
  if (!key) throw new ConnectorUnavailable("missing-credentials", "YOUTUBE_API_KEY non configurée : recherches YouTube désactivées (les flux publics de chaînes restent actifs).");
  const day = now.toISOString().slice(0, 10);
  const used = state.quotaDay === day ? state.quotaUsed ?? 0 : 0;
  const budget = Number(env.YOUTUBE_DAILY_UNITS || 3000);
  const queries = source.queries ?? [];
  const perRun = Math.min(queries.length, Number(env.YOUTUBE_QUERIES_PER_RUN || 2), Math.floor((budget - used) / SEARCH_COST));
  if (perRun <= 0) throw new ConnectorUnavailable("quota", `Budget YouTube du jour atteint (${used}/${budget} unités).`);
  const cursor = Number((state as unknown as Record<string, unknown>).queryCursor ?? 0);
  const since = state.lastSuccessAt ? new Date(Date.parse(state.lastSuccessAt) - 3600_000) : new Date(now.getTime() - 3 * 86400_000);
  const items: CollectedItem[] = [];
  let attempts = 0;
  for (let i = 0; i < perRun; i++) {
    const q = queries[(cursor + i) % queries.length];
    const p = new URLSearchParams({ part: "snippet", q, type: "video", order: "date", maxResults: "25", publishedAfter: since.toISOString(), key });
    const r = await fetchWithRetry(`https://www.googleapis.com/youtube/v3/search?${p}`, { fetchImpl });
    attempts += r.attempts;
    const json = JSON.parse(r.text) as { items?: Array<{ id: { videoId: string }; snippet: { title: string; description: string; publishedAt: string; channelTitle: string; channelId: string } }> };
    for (const it of json.items ?? []) {
      const id = it.id.videoId;
      const url = `https://www.youtube.com/watch?v=${id}`;
      items.push({
        externalId: id,
        url,
        title: it.snippet.title,
        text: it.snippet.description,
        publishedAt: it.snippet.publishedAt,
        author: it.snippet.channelTitle,
        videoIds: [id],
        media: { kind: "youtube", videoId: id, url, thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, credit: it.snippet.channelTitle, rights: "youtube-terms" },
      });
    }
  }
  return {
    items,
    attempts,
    quotaUsed: perRun * SEARCH_COST,
    statePatch: { quotaDay: day, quotaUsed: used + perRun * SEARCH_COST, queryCursor: (cursor + perRun) % Math.max(1, queries.length) },
  };
};
