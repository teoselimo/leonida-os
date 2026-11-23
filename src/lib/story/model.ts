/**
 * LEONIDA STORY INTELLIGENCE — modèle commun (V0.17).
 *
 * Un seul référentiel pour Story Intelligence, Vehicle Discovery et LEONIDA Vision :
 *   - des NŒUDS (missions, activités, lieux, ressources) à identifiant STABLE, avec noms et alias ;
 *   - des RÈGLES « condition → effet → moment », chacune avec ses preuves, contradictions, confiance, date et statut ;
 *   - une COUVERTURE explicite par nœud et par chapitre (auditée / partielle / non auditée / à revérifier).
 *
 * Principes :
 *   - l'absence de règle n'est JAMAIS l'absence de risque : un nœud non audité le dit ;
 *   - un conseil (`advice`) est séparé de son explication narrative (`explain`) : l'anti-spoiler masque l'explication,
 *     jamais le conseil utile ;
 *   - aucune règle ne devient « critique » si elle est contestée ;
 *   - une information trouvée en direct (web, capture) ne devient jamais une règle : elle reste une réponse sourcée.
 */

export type Coverage = "auditée" | "partielle" | "non auditée" | "à revérifier";
export const COVERAGE_ORDER: Coverage[] = ["auditée", "partielle", "à revérifier", "non auditée"];

/** Hiérarchie produit (la liste de l'Accueil n'en montre que trois). */
export type Tier = "Critique" | "Fortement recommandé" | "Intéressant" | "À explorer";
export const TIER_ORDER: Tier[] = ["Critique", "Fortement recommandé", "Intéressant", "À explorer"];

/** Confiance calculée à partir des preuves (Contesté dès qu'une preuve contredit ou nuance l'effet). */
export type Confidence = "Vérifié" | "Probable" | "Non confirmé" | "Contesté";

/** Ressources économiques suivies (toutes facultatives pour le joueur). */
export type ResourceId = "cash" | "checking" | "stash" | "savings";
export const RESOURCE_FR: Record<ResourceId, string> = {
  cash: "argent liquide",
  checking: "compte courant BuckMe",
  stash: "planque de la maison",
  savings: "Family Savings",
};

export interface StoryEvidence {
  name: string;
  url: string;
  /** Ce que la source affirme, en français, sans citation longue. */
  says: string;
  stance: "confirme" | "contredit" | "nuance";
  /** Date de consultation (AAAA-MM-JJ). */
  checkedAt: string;
}

/** Nœud de progression hors graphe du chapitre 1 (chapitres 2 à 5) : inventaire, pas encore un graphe complet. */
export interface StoryNode {
  id: string;
  name: string;
  aliases?: string[];
  kind: "main" | "side" | "activity" | "place";
  chapter: number;
  coverage: Coverage;
  /** Ce qu'on sait ne pas savoir. */
  unknowns?: string[];
}

/** Condition évaluée contre l'état DÉCLARÉ (jamais une détection automatique). */
export type Cond =
  | { k: "done"; node: string }
  | { k: "started"; node: string }
  | { k: "notStarted"; node: string }
  | { k: "chapterAtLeast"; n: number }
  | { k: "chapterAtMost"; n: number }
  | { k: "edition"; v: "ultimate" | "standard" }
  | { k: "ticked"; key: string }
  | { k: "savingsAtLeast"; amount: number }
  | { k: "all"; of: Cond[] }
  | { k: "any"; of: Cond[] }
  | { k: "not"; c: Cond };

export type Effect =
  | { k: "lose"; what: string; resource?: ResourceId }
  | { k: "keep"; what: string; resource?: ResourceId; upTo?: number }
  | { k: "gain"; what: string; amount?: number; resource?: ResourceId }
  | { k: "unlock"; what: string; node?: string }
  | { k: "close"; what: string; node?: string }
  | { k: "freeze"; what: string; resource: ResourceId; until?: string }
  | { k: "threshold"; what: string; resource: ResourceId; min: number }
  | { k: "choice"; what: string; options: Array<{ id: string; label: string; outcome: string }> }
  | { k: "note"; what: string };

export type RuleKind = "perte" | "fenêtre" | "récompense" | "choix" | "seuil" | "opportunité" | "manquable" | "irréversible" | "inconnu";

export interface StoryRule {
  id: string;
  kind: RuleKind;
  chapter: number;
  /** Ce qui déclenche l'effet : début ou fin d'un nœud, ou fin d'un chapitre. null = permanent / à tout moment. */
  trigger: { node: string; at: "start" | "end" } | { chapterEnd: number } | null;
  /** La règle ne concerne le joueur que si… (ex. édition Ultimate). */
  appliesIf?: Cond;
  /** Le joueur a déjà neutralisé le risque / saisi l'opportunité. */
  resolvedIf?: Cond;
  /** Conseil actionnable, SANS spoiler narratif (noms de missions futures masqués automatiquement). */
  advice: string;
  /** Explication narrative (pourquoi) — masquée en anti-spoiler strict pour un chapitre non atteint. */
  explain: string;
  effects: Effect[];
  /** Moment, en clair (« au début de Tourist Trap », « fenêtre non établie »). */
  timing: string;
  reversible: boolean;
  tier: Tier;
  evidence: StoryEvidence[];
  /** Désaccords entre sources, en clair. */
  contradictions?: string[];
  status: "active" | "contestée" | "obsolète";
  verifiedAt: string;
  /** Mots-clés pour éviter les doublons avec les autres listes (graphe, veille, analyses). */
  match?: string[];
}
