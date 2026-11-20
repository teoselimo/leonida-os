import { fetchWithRetry } from "../http.ts";
import type { Connector, CollectedItem } from "./base.ts";
import { arr, txt, xml } from "./xml.ts";

/** Flux Atom public d'une chaîne YouTube (aucune clé requise). */
export function parseYoutubeFeed(body: string, channelName: string): CollectedItem[] {
  const doc = xml.parse(body);
  return arr(doc?.feed?.entry).map((e: Record<string, any>) => {
    const videoId = txt(e["yt:videoId"]);
    const group = e["media:group"] ?? {};
    const views = Number(group?.["media:community"]?.["media:statistics"]?.["@_views"]);
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    return {
      externalId: videoId,
      url,
      title: txt(e.title),
      text: txt(group["media:description"]),
      publishedAt: txt(e.published) || null,
      author: txt(e.author?.name) || channelName,
      videoIds: [videoId],
      media: { kind: "youtube", videoId, url, thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`, credit: txt(e.author?.name) || channelName, rights: "youtube-terms" },
      metrics: Number.isFinite(views) ? { views } : undefined,
    } satisfies CollectedItem;
  });
}

export const youtubeFeed: Connector = async ({ source, state, fetchImpl }) => {
  const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${source.channelId}`;
  const r = await fetchWithRetry(url, { etag: state.etag, fetchImpl });
  if (r.notModified) return { items: [], attempts: r.attempts, notModified: true, etag: r.etag };
  return { items: parseYoutubeFeed(r.text, source.name), attempts: r.attempts, etag: r.etag };
};
