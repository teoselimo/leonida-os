/**
 * LEONIDA AI — proxy de synthèse (Cloudflare Workers). Voir docs/V0.7.1.md pour le déploiement.
 * La logique (RAG, validation, quotas, cache) est dans rag.ts, testée sans réseau.
 */
import { handle } from "./rag";
import type { Env } from "./rag";

export default {
  fetch(req: Request, env: Env): Promise<Response> {
    return handle(req, env);
  },
};
