import type { Category } from "../types.ts";

/** Règles déterministes, bilingues EN/FR, volontairement prudentes. */

export const GTA6 = /\b(gta\s?(6|vi)\b|gta6\b|grand theft auto\s?(vi|6)\b)/i;
export const OTHER_GAMES = /\b(gta\s?online|gtao\b|gta\s?(5|v)\b|gtav\b|grand theft auto\s?v\b|red dead|rdr\s?2|bully)\b/i;
export const NOISE = /\b(compilation|montage|fan[\s-]?made|concept (art|trailer)|meme|memes|reacts?|reaction|tier list|asmr|parody|parodie|mod(ded|s)?\b|lego|minecraft|roblox|fortnite)\b/i;
export const RUMOR = /\b(rumou?rs?|leak(s|ed)?|reportedly|allegedly|theory|theories|insider|could be|might be|possibly|unconfirmed|fake|hoax|claims?|rumeurs?|fuites?|théories?|supposé|serait)\b/i;
export const SPOILER = /\b(ending|endings|final mission|last mission|epilogue|finale|twist|who dies|dies\b|death of|boss fight|credits scene|spoilers?|walkthrough|chapter\s?[2-9]|fin du jeu|mort de|dernière mission|soluce)\b/i;
/** Actualité business/industrie : jamais classée comme astuce de jeu, même si un montant est cité. */
export const BUSINESS = /\b(sales|sold|revenue|earnings|stock|shares|merch|review|reviews|interview|take-two|copies|metacritic|price|preorders?|pre-orders?|launch day|record|ventes|chiffre d'affaires|test du jeu)\b/i;
export const MISSABLE = /\b(missable|miss(ed)? forever|point of no return|limited[\s-]time|before it'?s gone|can'?t go back|manquable|temps limité|avant qu'il ne soit trop tard)\b/i;

const CATEGORY_RULES: Array<[Category, RegExp]> = [
  ["missable", MISSABLE],
  ["patch", /\b(patch|hotfix|title update|update notes|mise à jour|correctif)\b/i],
  ["easter_egg", /\b(easter eggs?|secrets?|hidden|mystery|mysteries|ufo|bigfoot|ghost|caché|cachés|mystère|œuf de pâques)\b/i],
  ["weapon", /\b(weapons?|guns?|rifles?|shotguns?|pistols?|snipers?|armes?|fusil)\b/i],
  ["vehicle", /\b(cars?|vehicles?|supercars?|bikes?|motorcycles?|boats?|planes?|helicopters?|voitures?|véhicules?|moto)\b/i],
  ["money", /\b(money|cash|stash|make money|earn|payout|heist|argent|fric|gagner|butin)\b/i],
  ["side_mission", /\b(side missions?|side quests?|strangers?|side activit(y|ies)|missions? secondaires?)\b/i],
  ["unique_item", /\b(unique|rare items?|collectibles?|outfits?|objets? rares?|collection)\b/i],
  ["guide", /\b(guide|walkthrough|all locations|locations? of|map of|emplacements?|soluce)\b/i],
  ["mechanic", /\b(tips|tricks|how to|mechanics?|feature|features|gameplay|first-person|settings|astuces?|fonctionnalités?)\b/i],
];

/** Le titre décide en priorité ; l'extrait ne sert qu'à départager quand le titre est muet. */
export function categorize(title: string, excerpt = "", fallback: Category = "news"): Category {
  if (BUSINESS.test(title)) return "news";
  for (const [cat, re] of CATEGORY_RULES) if (re.test(title)) return cat;
  for (const [cat, re] of CATEGORY_RULES) if (cat !== "money" && re.test(excerpt)) return cat;
  return fallback;
}

export const ACTIONABLE: Category[] = ["weapon", "vehicle", "money", "easter_egg", "side_mission", "unique_item", "missable"];

export const CATEGORY_FR: Record<Category, string> = {
  weapon: "Arme", vehicle: "Véhicule", money: "Argent", easter_egg: "Easter egg", side_mission: "Mission secondaire",
  unique_item: "Objet unique", mechanic: "Mécanique", missable: "Manquable", news: "Actualité", patch: "Mise à jour",
  guide: "Guide", other: "Autre",
};

/** Somme d'argent explicitement citée (« $25,000 », « 1.5 million dollars »), sinon null. */
export function extractMoney(text: string): { value: number; quote: string } | null {
  const m = text.match(/\$\s?(\d{1,3}(?:[,.\s]\d{3})+|\d+(?:\.\d+)?)\s?(k|m|million|millions)?\b/i) ?? text.match(/\b(\d+(?:[.,]\d+)?)\s?(k|m|million|millions)\s?(dollars|\$)/i);
  if (!m) return null;
  let v = Number(m[1].replace(/[,\s]/g, "").replace(/\.(?=\d{3}\b)/g, ""));
  const unit = (m[2] || "").toLowerCase();
  if (unit === "k") v *= 1_000;
  if (unit === "m" || unit.startsWith("million")) v *= 1_000_000;
  return Number.isFinite(v) && v > 0 ? { value: Math.round(v), quote: m[0].trim() } : null;
}

const STOP = new Set("gta grand theft auto vi the a an in on of and or for with to how you your this that is are was it its new all get got here from at by be has have just more most best every what why when where which who will can now out up off over into about these those there their they them our my me i we he she his her video videos full part official trailer games game gaming rockstar s t de la le les des du un une et en pour sur dans avec est".split(" "));

export function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .split(/[^a-z0-9$]+/)
      .filter((w) => w.length >= 3 && !STOP.has(w) && w !== "6"),
  );
}

export function jaccard(a: Set<string>, b: Set<string>): { score: number; shared: number } {
  let shared = 0;
  for (const x of a) if (b.has(x)) shared++;
  const union = a.size + b.size - shared;
  return { score: union ? shared / union : 0, shared };
}
