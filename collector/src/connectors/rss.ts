import { fetchWithRetry } from "../http.ts";
import { youtubeIds } from "../util.ts";
import type { Connector, CollectedItem } from "./base.ts";
import { arr, txt, xml } from "./xml.ts";

/** RSS 2.0 ou Atom. Seuls titre, lien, date, auteur et description courte sont retenus. */
export function parseFeed(body: string): CollectedItem[] {
  const doc = xml.parse(body);
  const rssItems = arr(doc?.rss?.channel?.item);
  if (rssItems.length) {
    return rssItems.map((i: Record<string, any>) => {
      const link = txt(i.link) || txt(i.guid);
      const full = `${txt(i.description)} ${txt(i["content:encoded"])}`;
      return {
        externalId: txt(i.guid) || link,
        url: link,
        title: txt(i.title),
        text: txt(i.description),
        publishedAt: txt(i.pubDate) ? new Date(txt(i.pubDate)).toISOString() : null,
        author: txt(i["dc:creator"]) || txt(i.author) || null,
        videoIds: youtubeIds(full),
        media: null, // images d'articles : droits non établis → jamais republiées
      };
    });
  }
  return arr(doc?.feed?.entry).map((e: Record<string, any>) => {
    const link = arr(e.link).map((l: any) => l?.["@_href"]).find(Boolean) ?? "";
    const full = `${txt(e.summary)} ${txt(e.content)}`;
    return {
      externalId: txt(e.id) || link,
      url: link,
      title: txt(e.title),
      text: txt(e.summary) || txt(e.content),
      publishedAt: txt(e.published) || txt(e.updated) || null,
      author: txt(e.author?.name) || null,
      videoIds: youtubeIds(full),
      media: null,
    };
  });
}

export const rss: Connector = async ({ source, state, fetchImpl }) => {
  const r = await fetchWithRetry(source.url!, { etag: state.etag, fetchImpl });
  if (r.notModified) return { items: [], attempts: r.attempts, notModified: true, etag: r.etag };
  return { items: parseFeed(r.text), attempts: r.attempts, etag: r.etag };
};
