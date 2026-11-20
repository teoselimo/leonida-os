/** Requêtes HTTP avec délai maximal, nouvelles tentatives à recul exponentiel et en-têtes honnêtes. */
export const USER_AGENT = "LeonidaOS-Collector/0.5.1 (+https://github.com/teoselimo/leonida-os; veille GTA VI personnelle)";

export class HttpError extends Error {
  constructor(public status: number, public url: string, msg?: string) {
    super(msg ?? `HTTP ${status} sur ${url}`);
  }
}

export interface FetchResult {
  status: number;
  text: string;
  etag: string | null;
  attempts: number;
  notModified: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchWithRetry(
  url: string,
  opts: { headers?: Record<string, string>; etag?: string | null; retries?: number; timeoutMs?: number; baseDelayMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<FetchResult> {
  const retries = opts.retries ?? 3;
  const f = opts.fetchImpl ?? fetch;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 20_000);
    try {
      const res = await f(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/rss+xml, application/atom+xml, application/xml, application/json;q=0.9, */*;q=0.5", ...(opts.etag ? { "If-None-Match": opts.etag } : {}), ...opts.headers },
        signal: ctrl.signal,
        redirect: "follow",
      });
      clearTimeout(t);
      if (res.status === 304) return { status: 304, text: "", etag: opts.etag ?? null, attempts: attempt, notModified: true };
      // 4xx (hors 408/429) : inutile d'insister
      if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) throw new HttpError(res.status, url);
      if (!res.ok) throw new HttpError(res.status, url);
      return { status: res.status, text: await res.text(), etag: res.headers.get("etag"), attempts: attempt, notModified: false };
    } catch (e) {
      clearTimeout(t);
      lastErr = e;
      if (e instanceof HttpError && e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429) break;
      if (attempt < retries) await sleep((opts.baseDelayMs ?? 1000) * 4 ** (attempt - 1) * (0.75 + Math.random() * 0.5));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
