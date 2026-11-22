import type { WebHit, WebSearchFn, WebStatus } from "../copilot/types";

/**
 * Recherche web via un connecteur claude.ai de l'utilisateur (capacité `mcp` de l'Artifact).
 * Connecteur visé : Exa (`web_search_exa`). Les appels utilisent les identifiants de l'utilisateur ;
 * l'app ne voit aucun jeton. Sans connecteur branché, tout se dégrade proprement (statut explicite).
 *
 * Ce fichier et `cloud.ts` sont les seuls à connaître `window.claude` hors transports.
 */
export const WEB_SERVER = "Exa";
export const WEB_TOOL = "web_search_exa";

type McpError = { code?: string; retryable?: boolean; retryAfterMs?: number };
type CallResult = { payload?: unknown; content?: Array<{ type: string; text?: string }> };
type Mcp = {
  callTool(server: string, tool: string, input?: unknown, options?: { signal?: AbortSignal; cache?: false | { staleTime?: number; gcTime?: number } }): Promise<CallResult>;
  listTools(server?: string): Promise<{ servers: Array<{ server: string; authStatus: string; tools: Array<{ name: string }> }> }>;
};
type Runtime = { use(name: string): Promise<unknown> };

let mcpP: Promise<Mcp | null> | null = null;
function mcp(): Promise<Mcp | null> {
  const rt = (globalThis as unknown as { claude?: Runtime }).claude;
  if (!rt?.use) return Promise.resolve(null);
  if (!mcpP) mcpP = Promise.race([rt.use("mcp") as Promise<Mcp | null>, new Promise<null>((r) => setTimeout(() => r(null), 10_000))]).catch(() => null);
  return mcpP;
}

/** État du connecteur, sans rien demander à l'utilisateur (aucune fenêtre d'autorisation). */
export async function webStatus(): Promise<WebStatus> {
  const m = await mcp();
  if (!m) return "unavailable";
  try {
    const r = await m.listTools(WEB_SERVER);
    const s = r.servers.find((x) => x.server === WEB_SERVER);
    if (!s) return "not_connected";
    if (s.authStatus === "needs_reauth") return "needs_reauth";
    // jamais demandé : outils listés depuis le manifeste ; le premier appel demandera l'accord
    return "ok";
  } catch (e) {
    return mapError(e);
  }
}

function mapError(e: unknown): WebStatus {
  const c = (e as McpError)?.code;
  if (c === "server_not_connected" || c === "server_not_found" || c === "selection_required") return "not_connected";
  if (c === "needs_reauth") return "needs_reauth";
  if (c === "not_in_manifest" || c === "approval_required" || c === "blocked_by_policy" || c === "not_granted" || c === "consent_required") return "denied";
  if (c === "capability_disabled" || c === "capability_removed") return "unavailable";
  return "error";
}

/** Lit les formats de réponse connus d'Exa (objet `results`, JSON en texte, ou blocs « Title: / URL: »). */
export function parseHits(res: CallResult): WebHit[] {
  const fromArr = (arr: unknown[]): WebHit[] =>
    arr
      .map((x) => {
        const o = x as Record<string, unknown>;
        const url = String(o.url ?? o.link ?? "");
        return {
          title: String(o.title ?? "").slice(0, 160),
          url,
          text: String(o.text ?? o.summary ?? o.snippet ?? (Array.isArray(o.highlights) ? o.highlights.join(" … ") : "")).replace(/\s+/g, " ").slice(0, 12_000),
          date: [o.publishedDate, o.published_date, o.published].map((d) => (typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : null)).find(Boolean) ?? null,
        };
      })
      .filter((h) => /^https:\/\//.test(h.url));
  const p = res.payload;
  if (p && typeof p === "object") {
    const arr = Array.isArray(p) ? p : (p as { results?: unknown }).results;
    if (Array.isArray(arr)) return fromArr(arr);
  }
  const text = typeof p === "string" ? p : (res.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n");
  if (!text) return [];
  try {
    const j = JSON.parse(text);
    const arr = Array.isArray(j) ? j : j?.results;
    if (Array.isArray(arr)) return fromArr(arr);
  } catch {
    /* texte libre */
  }
  // format texte d'Exa (vérifié le 22/11/2026) : blocs « Title / URL / Published / Author / Highlights » séparés par « --- »
  const blocks = text.split(/\n(?=Title:)/);
  return fromArr(
    blocks.map((b) => ({
      title: b.match(/^Title:\s*(.*)$/m)?.[1] ?? "",
      url: b.match(/^URL:\s*(\S+)/m)?.[1] ?? "",
      publishedDate: b.match(/^Published(?: Date)?:\s*(\S+)/m)?.[1],
      text: b
        .replace(/^(Title|URL|Published Date|Published|Author|ID|Image|Favicon):.*$/gm, "")
        .replace(/^(Text|Highlights):\s*/gm, "")
        .replace(/^(-{3,}|\.{3})\s*$/gm, " "),
    })),
  );
}

/** Recherche web avec sources ; un seul nouvel essai si le connecteur le permet. */
export const exaSearch: WebSearchFn = async (query, signal, objective) => {
  const m = await mcp();
  if (!m) return { status: "unavailable", hits: [] };
  const call = () => m.callTool(WEB_SERVER, WEB_TOOL, { query, objective: (objective || `Pages about the video game GTA VI (GTA 6) answering: ${query}. Prefer recent guides; exclude GTA V and older games.`).slice(0, 4_000), numResults: 5 }, { signal, cache: { staleTime: 10 * 60_000, gcTime: 30 * 60_000 } });
  try {
    let res: CallResult;
    try {
      res = await call();
    } catch (e) {
      const err = e as McpError;
      if (!err?.retryable || signal?.aborted) throw e;
      await new Promise((r) => setTimeout(r, Math.min(4_000, err.retryAfterMs ?? 600 + Math.random() * 600)));
      res = await call();
    }
    const hits = parseHits(res);
    const rawChars = JSON.stringify(res.payload ?? res.content ?? "").length;
    return { status: hits.length ? "ok" : "empty", hits, rawChars };
  } catch (e) {
    return { status: mapError(e), hits: [] };
  }
};
