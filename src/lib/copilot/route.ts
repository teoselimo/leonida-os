/**
 * Routage des recherches (V0.13) — SANS appel Claude supplémentaire.
 *
 * Avant V0.13, chaque question passait d'abord par un « planificateur » (un appel Claude rapide qui décidait
 * s'il fallait chercher et écrivait les requêtes anglaises), puis par l'appel de réponse : deux appels, donc
 * deux fois la latence de démarrage et deux unités de quota pour chaque question factuelle.
 *
 * Ici, la décision et la requête sont calculées localement, en quelques microsecondes :
 *   1. conversation pure → réponse directe, pas de web ;
 *   2. données locales suffisantes (progression sourcée, référentiel d'établissements, fiche officielle ou
 *      recoupée) → pas de web, sauf demande explicite du joueur ;
 *   3. sinon → recherche web automatique, requête anglaise construite à partir d'un glossaire FR→EN, des noms
 *      propres de la phrase et de la mission en cours ; reformulation si rien ne sort.
 * La recherche web native de Claude n'existe pas dans un Artifact (`sample` « cannot browse ») : Exa reste
 * l'outil web.
 */
import type { AiAnswer } from "../ai/engine";
import type { RadarFeed } from "../feed";

export type WebReason = "smalltalk" | "app_action" | "local_ok" | "asked" | "insufficient" | "checklist" | "no_connector";

const nk = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’']/g, " ")
    .replace(/[^a-z0-9 -]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Demande explicite de recherche ou d'information récente. */
export const WEB_ASK = /\b(cherche|recherche|regarde|google|web|internet|en ligne|sur le net|derni[eè]res? infos?|actu|reddit|youtube|v[ée]rifie)\b/i;
/** Question d'évaluation ou de détail : les données locales listent, le web décrit. */
const EVALUATIVE = /\b(meilleure?s?|vaut|valent|int[eé]ressante?s?|conseill|recommand|vend(ent)?|trouve-t-on|qu.y a-t-il|diff[eé]rence|prix|co[uû]te?)\b/i;
/** Intentions de pure conversation. */
const SMALLTALK = new Set(["hello", "thanks"]);
/** Actions dans l'app (progression) : la réponse est locale par nature. */
const APP_ACTION = new Set(["mission_done", "got_item", "next_start"]);
/** Intentions auxquelles le modèle de progression sourcé répond entièrement. */
const PROGRESSION_LOCAL = new Set(["what_now", "unlocked", "side_list", "zone_left", "next_start", "got_item"]);
/** Une réponse locale n'est « suffisante » que si sa fiabilité est établie. */
const STRONG = new Set(["officiel", "recoupé"]);

export function decideWeb(o: { question: string; draft: AiAnswer; ids: string[]; feed: RadarFeed | null; hasSearch: boolean; checklist: boolean }): { web: boolean; reason: WebReason } {
  if (!o.hasSearch) return { web: false, reason: "no_connector" };
  if (o.checklist) return { web: true, reason: "checklist" };
  const i = o.draft.intent;
  if (SMALLTALK.has(i)) return { web: false, reason: "smalltalk" };
  if (APP_ACTION.has(i)) return { web: false, reason: "app_action" };
  if (WEB_ASK.test(o.question)) return { web: true, reason: "asked" };
  if (PROGRESSION_LOCAL.has(i)) return { web: false, reason: "local_ok" };
  // « montre-moi … sur la carte » : action dans l'app, déjà résolue localement (liste, établissement, repère)
  if (/\b(montre|affiche|sur la carte)\b/i.test(o.question) && o.draft.actions.some((a) => a.type === "show_place")) return { web: false, reason: "local_ok" };
  // établissements confirmés du référentiel (sources citées) : la liste suffit… sauf question d'évaluation
  // (« les meilleurs », « ça vaut le coup », « qu'est-ce qu'ils vendent ») où les guides apportent le contenu
  if (i === "shops" && o.draft.reliability && o.draft.sources.length && !EVALUATIVE.test(o.question)) return { web: false, reason: "local_ok" };
  // fiche RADAR officielle ou recoupée qui répond directement
  if (o.draft.reliability && STRONG.has(o.draft.reliability) && o.ids.length && o.draft.intent !== "unknown") {
    const strong = o.ids.some((id) => {
      const r = o.feed?.items.find((x) => x.id === id);
      return r && (r.reliability === "official" || r.reliability === "confirmed");
    });
    if (strong) return { web: false, reason: "local_ok" };
  }
  // conversation (« tu préfères la plage ou la ville ? », « ça vaut le coup ? », « et là ? ») : pas de fait de jeu
  // à vérifier → Claude répond avec le contexte, sans recherche
  if (OPINION.test(o.question) && !hasGameTerm(o.question)) return { web: false, reason: "smalltalk" };
  if (!FACTUAL.test(o.question) && !hasGameTerm(o.question)) return { web: false, reason: "smalltalk" };
  return { web: true, reason: "insufficient" };
}

/** Signal de question factuelle (lieu, manière, quantité, condition…). */
const FACTUAL = /\b(o[uù]|comment|combien|quand|quel(le)?s?|lequel|laquelle|est-ce qu|faut-il|r[eé]compense|manquables?|cach[ée]e?s?|trouver|d[ée]bloquer|obtenir|r[ée]cup[ée]rer|existe)\b/i;
/** Demande d'avis ou bavardage. */
const OPINION = /\b(tu pr[ée]f[eè]res|t.en penses quoi|ton avis|[aà] ta place|tu ferais quoi|[cç]a va|tu aimes|c.est cool|trop bien|haha|mdr|lol)\b/i;
/** La phrase contient un terme de jeu traduisible ou un nom propre (lieu, mission, véhicule…). */
function hasGameTerm(q: string): boolean {
  const n = ` ${nk(q)} `;
  return GLOSSARY.some(([re, en]) => en !== "how-to" && en !== "location" && en !== "best" && re.test(n)) || properNames(q).length > 0;
}

/** Glossaire FR→EN des termes de jeu (les guides sont en anglais ; une requête française ramène du bruit). */
const GLOSSARY: Array<[RegExp, string]> = [
  [/\bmagasins? de v[eê]tements?|boutiques? de v[eê]tements?|fringues\b/, "clothing stores"],
  [/\bv[eê]tements?|tenues?|habits?\b/, "clothes outfits"],
  [/\bchaussures?|baskets?\b/, "shoes footwear store"],
  [/\bsalons? de coiffure|coiffeur|coiffure|barbier\b/, "barber hair salon"],
  [/\b(salons? de )?tatou(age|eur)s?\b/, "tattoo parlor"],
  [/\barmureries?|ammu|armes? a feu|flingues?\b/, "Ammu-Nation gun store weapons"],
  [/\barmes?\b/, "weapons"],
  [/\bmunitions?\b/, "ammo"],
  [/\bgarages?|carrosserie|customs?|tuning\b/, "mod shop garage"],
  [/\bvoitures?|bagnoles?|caisses?\b/, "cars"],
  [/\bvehicules?\b/, "vehicles"],
  [/\bmotos?\b/, "motorcycles"],
  [/\bbateaux?|hors-bord\b/, "boats"],
  [/\bavions?\b/, "planes"],
  [/\bhelicos?|helicopteres?\b/, "helicopters"],
  [/\brares?|exclusi(f|ve)s?\b/, "rare"],
  [/\bcache(e|s|es)?|secrets?\b/, "hidden secret"],
  [/\bmanquables?|rater|louper|manquer\b/, "missable"],
  [/\bpoint de non retour\b/, "point of no return"],
  [/\bmissions? secondaires?|activites? annexes?|annexes?\b/, "side missions activities"],
  [/\brencontres?|inconnus?\b/, "random encounters strangers"],
  [/\bobjets? de collection|collectibles?|a collectionner\b/, "collectibles"],
  [/\bargent|thune|fric|dollars?\b/, "money"],
  [/\bbutin|tresors?|coffres?\b/, "loot treasure"],
  [/\brecompenses?\b/, "rewards"],
  [/\bbraquages?|casse\b/, "heist robbery"],
  [/\bdebloquer|deblocage|debloque\b/, "unlock"],
  [/\bacheter|achat|prix|coute\b/, "buy price"],
  [/\bmeilleur(e|s|es)?|top\b/, "best"],
  [/\bplanques?|maisons?|appart(ement)?s?\b/, "safehouse property"],
  [/\bpeche|pecher\b/, "fishing"],
  [/\bchasse|chasser\b/, "hunting"],
  [/\blunettes?\b/, "sunglasses"],
  [/\bcasquettes?|chapeaux?\b/, "hats"],
  [/\bstations?( |-)service|essence\b/, "gas station"],
  [/\bsupermarches?|superette\b/, "convenience store"],
  [/\bsouvenirs?\b/, "souvenir shop"],
  [/\bmaillots? de bain\b/, "swimwear"],
  [/\bcomment\b/, "how-to"],
  [/\bou (est|sont|se trouve|trouver)|emplacements?|localisation|ou\b/, "location"],
  [/\bcarte\b/, "map"],
];

/** Noms propres de la phrase (« Key Lento », « Don Gone », « Chuck's ») — gardés tels quels. */
function properNames(q: string): string[] {
  const out: string[] = [];
  const re = /\b([A-Z][\w'’-]*(?:\s+(?:of|the|de|du|des|&)?\s*[A-Z][\w'’-]*)*)/g;
  const skip = /^(Je|J|Tu|Il|Elle|On|Nous|Vous|Ils|Elles|Le|La|Les|Un|Une|Des|Et|Ou|Mais|Donc|Quel|Quelle|Quels|Quelles|Est|Comment|Combien|Pourquoi|Quand|Montre|Dis|Cherche|Ok|Oui|Non|Salut|Merci|Y|C|Qu|Qui|Que|Quoi|Si|Faut|Peux|Peut|Sur|Dans|Avec|Pour|Mon|Ma|Mes|Ton|Ta|Tes)$/;
  for (const m of q.matchAll(re)) {
    const n = m[1].trim();
    // la majuscule de début de phrase ne fait pas un nom propre (« Meilleurs magasins… ») — sauf nom composé
    if (m.index === q.search(/\S/) && !n.includes(" ")) continue;
    if (n.length < 3 || skip.test(n.split(/\s+/)[0])) continue;
    if (/^(GTA|VI|GTA VI)$/i.test(n)) continue;
    out.push(n.replace(/’/g, "'"));
  }
  return [...new Set(out)].slice(0, 3);
}

/**
 * Requête Exa en anglais + objectif. `mission` n'est ajoutée que si la question en dépend
 * (« dans cette mission », « ici », « là »).
 */
export function englishQuery(question: string, mission: string | null | undefined, extraNames: string[] = []): { query: string; objective: string } {
  let n = ` ${nk(question)} `;
  const terms: string[] = [];
  // chaque passage traduit est retiré : « magasins de vêtements » ne donne pas en plus « clothes »
  for (const [re, en] of GLOSSARY) {
    const g = new RegExp(re.source, "g");
    if (!g.test(n)) continue;
    n = n.replace(g, " ");
    for (const w of en.split(" ")) if (!terms.includes(w)) terms.push(w);
  }
  const names = [...new Set([...extraNames, ...properNames(question)])].slice(0, 3);
  const dependsOnMission = !!mission && /\b(cette mission|la mission|ici|l[aà]|dedans|pendant)\b/i.test(question) && !names.some((x) => x.toLowerCase() === mission.toLowerCase());
  const parts = ["GTA 6", ...(dependsOnMission ? [`"${mission}"`] : []), ...names.map((x) => (x.includes(" ") ? `"${x}"` : x)), ...terms.slice(0, 7)];
  // rien de traduisible ni de nom propre : on garde la phrase (Exa est sémantique)
  const query = (parts.length > 1 ? parts.join(" ") : `GTA 6 ${question.replace(WEB_ASK, " ")}`).replace(/\s+/g, " ").trim().slice(0, 200);
  const objective = `Pages about GTA VI (GTA 6, released November 2026) that answer this player question: "${question.slice(0, 300)}" (search: ${query})${mission ? ` (player's current mission: ${mission})` : ""}. Prefer dedicated guides, wikis and location lists; exclude GTA V, GTA Online and older games.`;
  return { query, objective };
}

/** Mesures d'une réponse (V0.13) : pour comparer avant/après sur le vrai Artifact. */
export interface TurnMetrics {
  at: string;
  /** "planner" = ancien routage (appel Claude de planification) ; "local" = routage local V0.13. */
  router: "planner" | "local";
  reason: WebReason | "planner";
  /** Appels Claude effectués (planification + réponse). */
  claudeCalls: number;
  /** Recherches Exa lancées (hors cache). */
  searches: number;
  cachedSearches: number;
  planMs: number;
  searchMs: number;
  /** Du message envoyé au premier texte affiché. */
  firstTextMs: number | null;
  totalMs: number;
  webStatus: string | null;
  hits: number;
}

/** Routage des recherches : « local » (V0.13, par défaut) ou « planner » (ancien, pour comparer). Profil › Recherche web. */
export const ROUTER_KEY = "leonida-os/router/v1";

/** Nombre de mesures conservées dans la sauvegarde (synchronisée) : assez pour une comparaison avant / après. */
export const MAX_METRICS = 30;

/** Médiane (ms) — plus robuste que la moyenne sur quelques mesures. */
export function median(xs: number[]): number | null {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return Math.round(v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2);
}
