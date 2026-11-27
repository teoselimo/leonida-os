/**
 * Modèle de preuve réutilisable (Rare Vehicle Locator V1, puis Social Discovery Engine).
 *
 * Une preuve est attachée à une ou plusieurs AFFIRMATIONS (« claims ») : emplacement, présence, accès, code…
 * Elle ne dépend d'aucune catégorie : la même publication peut soutenir une fiche véhicule, un secret ou un manquable.
 *
 * Règle d'indépendance : un repost, une traduction ou une page sœur du même site ne compte qu'une fois.
 * La clé d'indépendance est l'origine déclarée (`origin`), sinon le site (`host`), sinon le créateur.
 */

export type Platform = "guide" | "video" | "reddit" | "instagram" | "capture" | "joueur" | "officiel";

export interface Evidence {
  id: string;
  platform: Platform;
  /** Lien vers la publication d'origine (jamais un média rehébergé). */
  url: string | null;
  /** Site, chaîne ou compte qui publie. */
  creator: string;
  /** Domaine, pour regrouper les pages d'un même site. */
  host: string | null;
  publishedAt: string | null;
  collectedAt: string;
  /** Ce que la source affirme, reformulé en français (pas de longue citation). */
  says: string;
  /** confirme · contredit · nuance (précise sans contredire). */
  stance: "confirme" | "contredit" | "nuance";
  claims: string[];
  /** Découverte d'origine si la publication en reprend une autre (repost, compilation) : même origine = une seule source. */
  origin?: string | null;
}

export type Trust3 = "Vérifié" | "Probable" | "Non confirmé";

const keyOf = (e: Evidence) => (e.origin ?? e.host ?? e.creator).toLowerCase();

/** Sources indépendantes qui confirment une affirmation (reposts et pages sœurs regroupés). */
export function independentFor(evs: Evidence[], claim: string): string[] {
  return [...new Set(evs.filter((e) => e.stance === "confirme" && e.claims.includes(claim)).map(keyOf))];
}

export function contradictionsFor(evs: Evidence[], claim: string): Evidence[] {
  return evs.filter((e) => e.stance === "contredit" && e.claims.includes(claim));
}

/**
 * Niveau de confiance d'une affirmation :
 * - Vérifié : au moins deux sources indépendantes, aucune contradiction ;
 * - Probable : une source, ou plusieurs mais contredites ;
 * - Non confirmé : aucune source qui confirme (ou seulement le joueur).
 */
export function trustFor(evs: Evidence[], claim: string): { trust: Trust3; independent: number; contradicted: boolean; nuanced: boolean } {
  const ind = independentFor(evs.filter((e) => e.platform !== "joueur"), claim).length;
  const contradicted = contradictionsFor(evs, claim).length > 0;
  const nuanced = evs.some((e) => e.stance === "nuance" && e.claims.includes(claim));
  const trust: Trust3 = ind >= 2 && !contradicted ? "Vérifié" : ind >= 1 ? "Probable" : "Non confirmé";
  return { trust, independent: ind, contradicted, nuanced };
}

/** Nombre de sources indépendantes, toutes affirmations confondues (reposts regroupés). */
export function independentTotal(evs: Evidence[]): number {
  return new Set(evs.filter((e) => e.platform !== "joueur" && e.stance !== "contredit").map(keyOf)).size;
}

export const hostOf = (u: string | null): string | null => {
  if (!u) return null;
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
};

/** Preuve ajoutée par le joueur (lien ou capture) : conservée, jamais comptée comme source indépendante. */
export interface PlayerProof {
  id: string;
  kind: "lien" | "capture";
  /** Lien saisi, ou image réduite (data URL JPEG, ≤ 640 px) pour une capture. */
  value: string;
  note: string;
  at: string;
}
