import type { AiAction, Topic } from "./engine";
import type { Profile } from "../types";

/**
 * Client de la synthèse IA serveur (facultative). Aucune clé dans l'app : seule l'URL publique du proxy est
 * configurée au build (NEXT_PUBLIC_AI_PROXY_URL). Le serveur refait lui-même la recherche dans LEONIDA RADAR :
 * l'app n'envoie que la question, la progression (sans pseudo) et le sujet de la conversation.
 */
const URL_ = process.env.NEXT_PUBLIC_AI_PROXY_URL || "";
const USER_KEY = "leonida-os/ai-user/v1";

export const proxyEnabled = () => URL_.startsWith("https://");

/** Identifiant anonyme aléatoire (quotas par utilisateur), jamais lié à une identité. */
function userId(): string {
  try {
    let id = localStorage.getItem(USER_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(USER_KEY, id);
    }
    return id;
  } catch {
    return "anonymous-device";
  }
}

export type ProxyStatus = "generated" | "cached" | "skipped" | "rejected" | "unavailable" | "disabled" | "quota" | "error";

export async function askProxy(question: string, profile: Profile, topic: Topic | null): Promise<{ text: string; actions: AiAction[]; status: ProxyStatus } | { status: ProxyStatus }> {
  if (!proxyEnabled()) return { status: "disabled" };
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 11_000);
  try {
    const { pseudo: _pseudo, ...anon } = profile;
    const res = await fetch(URL_, {
      method: "POST",
      signal: ctl.signal,
      headers: { "content-type": "application/json", "x-leonida-user": userId() },
      body: JSON.stringify({ question: question.slice(0, 300), profile: anon, topic }),
    });
    if (res.status === 503) return { status: "disabled" };
    if (res.status === 429) return { status: "quota" };
    if (!res.ok) return { status: "error" };
    const j = (await res.json()) as { text?: unknown; actions?: unknown; llm?: ProxyStatus };
    if (typeof j.text !== "string") return { status: "error" };
    return { text: j.text.slice(0, 900), actions: Array.isArray(j.actions) ? (j.actions as AiAction[]) : [], status: j.llm ?? "generated" };
  } catch {
    return { status: "error" };
  } finally {
    clearTimeout(t);
  }
}
