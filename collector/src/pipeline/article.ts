import { fetchWithRetry, USER_AGENT } from "../http.ts";
import { stripHtml, youtubeIds } from "../util.ts";

/**
 * Lecture approfondie d'un article de guide, uniquement si le robots.txt du site l'autorise.
 * Le texte complet n'est JAMAIS stocké : il sert seulement à extraire des champs et de courtes citations.
 */

interface RobotsRules {
  allow: string[];
  disallow: string[];
  /** Le site refuse explicitement les robots d'IA : son contenu n'est jamais envoyé à un modèle. */
  aiOptOut: boolean;
}

const robotsCache = new Map<string, Promise<RobotsRules>>();
const AI_AGENTS = ["claudebot", "anthropic-ai", "gptbot", "ccbot", "google-extended", "mistralai"];

export function parseRobots(body: string, agentToken = "leonidaos-collector"): RobotsRules {
  type Group = { agents: string[]; allow: string[]; disallow: string[] };
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
  }
  const mine = groups.filter((g) => g.agents.some((a) => a !== "*" && agentToken.includes(a)));
  const star = groups.filter((g) => g.agents.includes("*"));
  const use = mine.length ? mine : star;
  const aiOptOut = groups.some((g) => g.agents.some((a) => AI_AGENTS.includes(a)) && g.disallow.includes("/"));
  return { allow: use.flatMap((g) => g.allow), disallow: use.flatMap((g) => g.disallow), aiOptOut };
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

export function resetRobotsCache() {
  robotsCache.clear();
}

/** Texte principal d'un article : articleBody JSON-LD, sinon le conteneur d'article, sinon les paragraphes. */
export function mainText(html: string): { text: string; videoIds: string[] } {
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const j = JSON.parse(m[1]);
      const nodes = Array.isArray(j) ? j : j["@graph"] ?? [j];
      const art = nodes.find((n: Record<string, unknown>) => typeof n?.articleBody === "string" && (n.articleBody as string).length > 400);
      if (art) return { text: stripHtml(art.articleBody).slice(0, 30_000), videoIds: [] };
    } catch {
      /* JSON-LD invalide : on passe à l'heuristique */
    }
  }
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
  const blocks = [...seg.matchAll(/<(p|li|h2|h3)\b(?:[^>"']|"[^"]*"|'[^']*')*>([\s\S]*?)<\/\1>/gi)].map((m) => stripHtml(m[2])).filter((t) => t.length > 25);
  const embeds = [...seg.matchAll(/(?:youtube(?:-nocookie)?\.com\/embed\/|youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/g)].map((m) => m[1]);
  return { text: blocks.join("\n").slice(0, 30_000), videoIds: [...new Set([...embeds, ...youtubeIds(seg)])].slice(0, 3) };
}

export interface ArticleRead {
  ok: boolean;
  reason?: string;
  text: string;
  videoIds: string[];
  aiOptOut: boolean;
}

export async function readArticle(url: string, fetchImpl?: typeof fetch): Promise<ArticleRead> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { ok: false, reason: "URL invalide", text: "", videoIds: [], aiOptOut: true };
  }
  const robots = await robotsFor(u.origin, fetchImpl);
  if (!isAllowed(robots, u.pathname)) return { ok: false, reason: "refusé par robots.txt", text: "", videoIds: [], aiOptOut: true };
  try {
    const r = await fetchWithRetry(url, { fetchImpl, retries: 2, timeoutMs: 20_000, headers: { "User-Agent": USER_AGENT, Accept: "text/html" } });
    const { text, videoIds } = mainText(r.text);
    if (text.length < 300) return { ok: false, reason: "contenu principal introuvable", text: "", videoIds, aiOptOut: robots.aiOptOut };
    return { ok: true, text, videoIds, aiOptOut: robots.aiOptOut };
  } catch (e) {
    return { ok: false, reason: (e as Error).message, text: "", videoIds: [], aiOptOut: robots.aiOptOut };
  }
}
