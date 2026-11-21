import { fetchWithRetry } from "../http.ts";
import type { Connector, CollectedItem } from "./base.ts";
import { arr, txt, xml } from "./xml.ts";

/**
 * Sitemap XML (protocole standard destiné aux robots d'indexation).
 * Sert aux sites de guides sans flux RSS, ou dont le flux ne garde que les 10 derniers articles.
 * On ne retient que l'URL (filtrée par motif) et sa date : le contenu est lu ensuite, si robots.txt l'autorise.
 * Index de sitemaps : seuls les sous-sitemaps les plus récents sont suivis (2 par défaut).
 */
export function humanizeSlug(url: string): string {
  let path = "";
  try {
    path = new URL(url).pathname;
  } catch {
    return url;
  }
  const parts = path.split("/").filter(Boolean);
  const slug = (parts.pop() ?? "").replace(/\.(html?|php)$/, "");
  const ctx = parts.join(" ");
  const words = slug.replace(/[-_]+/g, " ").replace(/\bgta (6|vi)\b/gi, "GTA 6").trim();
  const title = words.charAt(0).toUpperCase() + words.slice(1);
  return /\bgta[ -]?6\b/i.test(title) || !/gta-6|gta6/i.test(ctx) ? title : `GTA 6 — ${title}`;
}

export function parseSitemap(body: string): { urls: Array<{ loc: string; lastmod: string | null }>; children: Array<{ loc: string; lastmod: string | null }> } {
  const doc = xml.parse(body);
  const urls = arr(doc?.urlset?.url).map((u: Record<string, unknown>) => ({ loc: txt(u.loc), lastmod: txt(u.lastmod) || null })).filter((u) => u.loc);
  const children = arr(doc?.sitemapindex?.sitemap).map((s: Record<string, unknown>) => ({ loc: txt(s.loc), lastmod: txt(s.lastmod) || null })).filter((s) => s.loc);
  return { urls, children };
}

export const sitemap: Connector = async ({ source, fetchImpl }) => {
  const filter = new RegExp(source.urlFilter ?? "gta-?6", "i");
  let attempts = 0;
  const first = await fetchWithRetry(source.url!, { fetchImpl });
  attempts += first.attempts;
  let { urls, children } = parseSitemap(first.text);
  if (children.length) {
    const recent = [...children].sort((a, b) => (b.lastmod ?? "").localeCompare(a.lastmod ?? "")).slice(0, source.followChildren ?? 2);
    for (const c of recent) {
      const r = await fetchWithRetry(c.loc, { fetchImpl });
      attempts += r.attempts;
      urls = urls.concat(parseSitemap(r.text).urls);
    }
  }
  const max = source.maxItems ?? 40;
  const items: CollectedItem[] = urls
    .filter((u) => filter.test(u.loc))
    .sort((a, b) => (b.lastmod ?? "").localeCompare(a.lastmod ?? ""))
    .slice(0, max)
    .map((u) => ({
      externalId: u.loc,
      url: u.loc,
      title: humanizeSlug(u.loc),
      text: "",
      publishedAt: u.lastmod ? new Date(u.lastmod).toISOString() : null,
      author: null,
      videoIds: [],
      media: null,
    }));
  return { items, attempts };
};
