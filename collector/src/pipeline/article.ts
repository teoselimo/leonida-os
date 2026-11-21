import { fetchWithRetry, USER_AGENT } from "../http.ts";
import { stripHtml, youtubeIds } from "../util.ts";

/**
 * Lecture approfondie d'un article de guide, uniquement si le robots.txt du site l'autorise.
 * Le texte complet n'est JAMAIS stocké : il sert seulement à extraire des champs et de courtes citations.
 */

interface RobotsRules {
  allow: string[];
  disallow: string[];
  /** Délai demandé entre deux requêtes (Crawl-delay), en secondes. */
  delay?: number;
  /** Le site refuse explicitement les robots d'IA : son contenu n'est jamais envoyé à un modèle. */
  aiOptOut: boolean;
}

const robotsCache = new Map<string, Promise<RobotsRules>>();
const AI_AGENTS = ["claudebot", "anthropic-ai", "gptbot", "ccbot", "google-extended", "mistralai"];

export function parseRobots(body: string, agentToken = "leonidaos-collector"): RobotsRules {
  type Group = { agents: string[]; allow: string[]; disallow: string[]; delay?: number };
  const groups: Group[] = [];
  let cur: Group | null = null;
  let lastWasAgent = false;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === "user-agent") {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], allow: [], disallow: [] };
        groups.push(cur);
      }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!cur) continue;
    if (key === "allow" && val) cur.allow.push(val);
    if (key === "disallow" && val) cur.disallow.push(val);
    if (key === "crawl-delay" && Number(val) > 0) cur.delay = Number(val);
  }
  const mine = groups.filter((g) => g.agents.some((a) => a !== "*" && agentToken.includes(a)));
  const star = groups.filter((g) => g.agents.includes("*"));
  const use = mine.length ? mine : star;
  const aiOptOut = groups.some((g) => g.agents.some((a) => AI_AGENTS.includes(a)) && g.disallow.includes("/"));
  const delay = Math.max(0, ...use.map((g) => g.delay ?? 0), ...star.map((g) => g.delay ?? 0));
  return { allow: use.flatMap((g) => g.allow), disallow: use.flatMap((g) => g.disallow), aiOptOut, delay: delay || undefined };
}

export function isAllowed(rules: RobotsRules, path: string): boolean {
  const match = (p: string) => {
    const re = new RegExp("^" + p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$"));
    return re.test(path) ? p.length : -1;
  };
  const a = Math.max(-1, ...rules.allow.map(match));
  const d = Math.max(-1, ...rules.disallow.map(match));
  return d < 0 || a >= d; // règle la plus longue gagne, Allow l'emporte à égalité
}

async function robotsFor(origin: string, fetchImpl?: typeof fetch): Promise<RobotsRules> {
  if (!robotsCache.has(origin)) {
    robotsCache.set(
      origin,
      fetchWithRetry(`${origin}/robots.txt`, { fetchImpl, retries: 2, timeoutMs: 10_000 })
        .then((r) => parseRobots(r.text))
        .catch((e) => {
          // robots.txt absent (404) : accès autorisé par convention ; autre erreur : prudence, on s'abstient
          return String(e).includes("404") ? { allow: [], disallow: [], aiOptOut: false } : { allow: [], disallow: ["/"], aiOptOut: true };
        }),
    );
  }
  return robotsCache.get(origin)!;
}

const lastHit = new Map<string, number>();
export function resetRobotsCache() {
  robotsCache.clear();
  lastHit.clear();
}

/** Texte principal d'un article : articleBody JSON-LD, sinon le conteneur d'article, sinon les paragraphes. */
export interface Section {
  heading: string;
  text: string;
}

/** Texte principal + sections (intertitre → paragraphes), utiles pour les listes « N voitures cachées ». */
export function mainText(html: string): { text: string; videoIds: string[]; sections: Section[]; cites: string[] } {
  const body = htmlText(html);
  let ld: string | null = null;
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const j = JSON.parse(m[1]);
      const nodes = Array.isArray(j) ? j : j["@graph"] ?? [j];
      const art = nodes.find((n: Record<string, unknown>) => typeof n?.articleBody === "string" && (n.articleBody as string).length > 400);
      if (art) ld = stripHtml(art.articleBody).slice(0, 30_000);
    } catch {
      /* JSON-LD invalide : on passe à l'heuristique */
    }
    if (ld) break;
  }
  return { text: ld && ld.length > body.text.length * 0.6 ? ld : body.text, videoIds: body.videoIds, sections: body.sections, cites: body.cites };
}

function htmlText(html: string): { text: string; videoIds: string[]; sections: Section[]; cites: string[] } {
  const markers = [/id="article-body"/i, /itemprop="articleBody"/i, /class="[^"]*\b(article-body|article__body|entry-content|post-content|c-entry-content|article-content)\b/i, /<article\b/i];
  let seg = "";
  for (const re of markers) {
    const i = html.search(re);
    if (i >= 0) {
      seg = html.slice(i, i + 150_000);
      const end = seg.search(/<\/article>|<footer\b|id="(?:comments|related-articles)"/i);
      if (end > 2000) seg = seg.slice(0, end);
      break;
    }
  }
  if (!seg) seg = html;
  seg = seg.replace(/<(button|svg|form|template)\b[\s\S]*?<\/\1>/gi, " ").replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<nav[\s\S]*?<\/nav>|<figure[\s\S]*?<\/figure>|<aside[\s\S]*?<\/aside>/gi, " ");
  const blocks = [...seg.matchAll(/<(p|li|h2|h3|h4)\b(?:[^>"']|"[^"]*"|'[^']*')*>([\s\S]*?)<\/\1>/gi)]
    .map((m) => ({ h: /^h/i.test(m[1]), t: stripHtml(m[2]) }))
    .filter((b) => (b.h ? b.t.length >= 3 && b.t.length < 140 : b.t.length > 25));
  const sections: Section[] = [];
  for (const b of blocks) {
    if (b.h) sections.push({ heading: b.t, text: "" });
    else if (sections.length) sections[sections.length - 1].text += (sections[sections.length - 1].text ? "\n" : "") + b.t;
  }
  // Sites cités comme source (« Location source », « via », « according to ») : origine non indépendante
  const cites = [...seg.matchAll(/<a\b[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]{0,80}?)<\/a>/gi)]
    .filter((m) => /\b(source|via|evidence|according|credit|originally)\b/i.test(stripHtml(m[2])))
    .map((m) => {
      try {
        return new URL(m[1]).host.replace(/^(www|images|cdn|static)\./, "");
      } catch {
        return "";
      }
    })
    .filter(Boolean);
  const embeds = [...seg.matchAll(/(?:youtube(?:-nocookie)?\.com\/embed\/|youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/g)].map((m) => m[1]);
  return {
    text: blocks.map((b) => b.t).join("\n").slice(0, 30_000),
    videoIds: [...new Set([...embeds, ...youtubeIds(seg)])].slice(0, 3),
    sections: sections.filter((x) => x.text).slice(0, 80),
    cites: [...new Set(cites)].slice(0, 10),
  };
}

export interface ArticleRead {
  ok: boolean;
  reason?: string;
  text: string;
  videoIds: string[];
  sections: Section[];
  cites: string[];
  aiOptOut: boolean;
}

export async function readArticle(url: string, fetchImpl?: typeof fetch): Promise<ArticleRead> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { ok: false, reason: "URL invalide", text: "", videoIds: [], sections: [], cites: [], aiOptOut: true };
  }
  const robots = await robotsFor(u.origin, fetchImpl);
  // Politesse : respect du Crawl-delay (plafonné à 10 s) et 1 s minimum entre deux pages du même site
  const wait = Math.min(10, robots.delay ?? 1) * 1000 - (Date.now() - (lastHit.get(u.host) ?? 0));
  if (wait > 0 && !fetchImpl) await new Promise((r) => setTimeout(r, wait));
  lastHit.set(u.host, Date.now());
  if (!isAllowed(robots, u.pathname + u.search)) return { ok: false, reason: "refusé par robots.txt", text: "", videoIds: [], sections: [], cites: [], aiOptOut: true };
  try {
    const r = await fetchWithRetry(url, { fetchImpl, retries: 2, timeoutMs: 20_000, headers: { "User-Agent": USER_AGENT, Accept: "text/html" } });
    const { text, videoIds, sections, cites } = mainText(r.text);
    const self = u.host.replace(/^www\./, "");
    if (text.length < 300) return { ok: false, reason: "contenu principal introuvable", text: "", videoIds, sections: [], cites: [], aiOptOut: robots.aiOptOut };
    return { ok: true, text, videoIds, sections, cites: cites.filter((h) => !self.endsWith(h) && !h.endsWith(self)), aiOptOut: robots.aiOptOut };
  } catch (e) {
    return { ok: false, reason: (e as Error).message, text: "", videoIds: [], sections: [], cites: [], aiOptOut: robots.aiOptOut };
  }
}
