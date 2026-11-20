import { createHash } from "node:crypto";

export const sha1 = (s: string) => createHash("sha1").update(s).digest("hex");

const TRACKING = /^(utm_|fbclid|gclid|mc_|ref$|ref_src|cmpid|taid|si$|feature$)/i;

/** URL canonique : https, sans fragment ni paramètres de suivi, sans slash final superflu. */
export function canonicalUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    u.protocol = "https:";
    u.hash = "";
    u.hostname = u.hostname.replace(/^m\./, "www.");
    for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
    if (/(^|\.)youtube\.com$/.test(u.hostname) && u.searchParams.get("v")) return `https://www.youtube.com/watch?v=${u.searchParams.get("v")}`;
    if (u.hostname === "youtu.be") return `https://www.youtube.com/watch?v=${u.pathname.slice(1)}`;
    let s = u.toString();
    if (s.endsWith("/") && u.pathname !== "/") s = s.slice(0, -1);
    return s;
  } catch {
    return raw.trim();
  }
}

export function stripHtml(s: string): string {
  return s
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&#8217;|&rsquo;/g, "'")
    .replace(/&#8216;|&lsquo;/g, "'")
    .replace(/&#822[01];|&[lr]dquo;/g, '"')
    .replace(/&#8211;|&ndash;/g, "–")
    .replace(/&#8212;|&mdash;/g, "—")
    .replace(/&#8230;|&hellip;/g, "…")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

/** Extrait court : on ne conserve jamais l'article entier. */
export function shortExcerpt(s: string, max = 280): string {
  const t = stripHtml(s);
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  return cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 30)).trim() + "…";
}

export function youtubeIds(text: string): string[] {
  const ids = new Set<string>();
  const re = /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) ids.add(m[1]);
  return [...ids];
}

export const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

export const nowIso = () => new Date().toISOString();
