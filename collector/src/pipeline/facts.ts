import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Extraction de faits structurés depuis le texte d'un guide.
 * Chaque champ porte la phrase exacte qui le justifie ; un champ non trouvé reste null.
 * Règles volontairement conservatrices : mieux vaut « non établi » qu'un champ inventé.
 */

export interface Fact<T> {
  value: T;
  quote: string;
  url: string;
}

export interface Facts {
  chapter: Fact<number> | null;
  money: Fact<{ amount: number; max: number | null; approx: boolean }> | null;
  mission: Fact<string> | null; // mission associée (nom propre)
  giver: Fact<string> | null; // personnage qui donne la mission
  unlockAfter: Fact<string> | null; // mission à terminer avant
  place: Fact<{ name: string; district: string | null; regionId: string | null }> | null;
  /** Manquable : pour la découverte elle-même (null = non établi). */
  missable: Fact<boolean> | null;
  /** La mission de contexte est manquable, avec sa limite si citée. */
  contextMissable: Fact<{ subject: string | null; until: string | null }> | null;
  handsOn: Fact<boolean> | null;
  keywords: string[];
}

const cap = (s: string) => s.length > 220 ? s.slice(0, 217).trim() + "…" : s;

export function sentences(text: string): string[] {
  return text
    .split(/\n+|(?<=[.!?])\s+(?=[A-Z"“(])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 15);
}

// Nom propre : 1 à 5 mots capitalisés (avec apostrophes), tolère « of/the/a » au milieu
const NAME = "[A-Z][\\w'’]*(?:\\s(?:of|the|a|to|and|N'|[A-Z][\\w'’]*)){0,4}";

/** Districts et lieux connus de la carte communautaire (noms d'au moins deux mots). */
let known: { districts: Map<string, string>; places: Set<string> } | null = null;
function knownPlaces() {
  if (known) return known;
  known = { districts: new Map(), places: new Set() };
  const p = fileURLToPath(new URL("../../../public/data/landmarks.json", import.meta.url));
  if (!existsSync(p)) return known;
  const REG: Array<[string, number, number]> = [["vicecity", -500, 800], ["keys", -2900, -6200], ["grassrivers", -3800, -3600], ["gellhorn", -6500, 3400], ["ambrosia", -2800, 3900], ["kalaga", -3700, 6700]];
  const near = (x: number, y: number) => REG.reduce((b, r) => (Math.hypot(r[1] - x, r[2] - y) < Math.hypot(b[1] - x, b[2] - y) ? r : b))[0];
  for (const [, full, x, y] of JSON.parse(readFileSync(p, "utf8")) as [string, string, number, number][]) {
    const parts = full.split(",").map((s) => s.trim());
    const district = parts[parts.length - 1];
    if (district.split(/\s+/).length >= 2 && !known.districts.has(district)) known.districts.set(district, near(x, y));
    if (parts[0].split(/\s+/).length >= 2 && parts[0] !== "?") known.places.add(parts[0].replace(/"/g, ""));
  }
  return known;
}

const PLACE_NOUN = /\b(Liquor|Store|Shop|Motel|Hotel|Inn|Bar|Club|Lounge|Garage|Diner|Cafe|Café|Restaurant|Grill|Marina|Lake|River|House|Mansion|Station|Park|Mall|Plaza|Market|Aggregates|Lot|Yard|Warehouse|Docks?|Pier|Beach|Bank|Church|Hospital|Airport|Airfield|Farm|Ranch|Trailer|Factory|Plant|Tower|Bridge|Island|Keys?|Point|Bay|Cent(?:er|re)|Gym|Arena|Stadium|Casino|Pawn|Salon|Studio|Lab|Office|Building|Apartments?|Motors|Autos|Supply|Depot|Camp|Ruins|Fort|Lighthouse|Swamp|Canal|Boulevard|Blvd|Street|Avenue|Road|Highway|Trail|Springs?|Gardens?|Court|Square|Terminal|Port|Harbou?r|Quarry|Mine|Junkyard|Scrapyard|Hangar|Range|Pool|Spa|Theat(?:er|re)|Cinema|Museum|Library|School|College|University|Prison|Jail|Plaza|Ammu-Nation)\b/;
const STOP_NAMES = /^(The|This|That|These|Those|Once|If|When|Then|After|Before|Grand Theft Auto|GTA|Rockstar|Chapter|Jason|Lucia|Leonida|You|Your|We|Our|It|In|On|At)$/;

export function extractFacts(text: string, url: string, title = ""): Facts {
  const all = [title, ...sentences(text)].filter(Boolean);
  const find = <T>(fn: (s: string) => T | null): Fact<T> | null => {
    for (const s of all) {
      const v = fn(s);
      if (v != null) return { value: v, quote: cap(s), url };
    }
    return null;
  };

  // Chapitre : le plus cité, avec la phrase de sa première occurrence
  const counts = new Map<number, number>();
  for (const s of all) for (const m of s.matchAll(/\bChapter\s(\d{1,2})\b/g)) counts.set(Number(m[1]), (counts.get(Number(m[1])) ?? 0) + 1);
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0];
  const chapter = best != null ? find((s) => (new RegExp(`\\bChapter\\s${best}\\b`).test(s) ? best : null)) : null;

  // Argent : montant cité dans une phrase qui parle d'argent liquide / butin
  const money = find((s) => {
    // Une somme n'est une récompense que si la phrase parle de butin (pas un prix d'abonnement ou de vente du jeu)
    if (!/\b(cash|money|stash|payout|haul|earn(?:s|ed)?|loot(?:ed)?|reward(?:s|ed)?|worth|resell|sells? for|pays?|bounty|dollars|bucks)\b/i.test(s)) return null;
    if (/\b(subscription|per month|a month|pre-?order|edition|costs? \$|priced|retail|MSRP|GTA\+)\b/i.test(s)) return null;
    const AMT = "\\$\\s?(\\d{1,3}(?:,\\d{3})+|\\d+(?:\\.\\d+)?)\\s?(k|K|million)?";
    const m = s.match(new RegExp(`\\b(around|about|roughly|approximately|nearly|up to|over)?\\s?${AMT}(?:\\s?(?:to|-|–|and)\\s?${AMT})?`));
    if (!m) return null;
    const num = (d?: string, u?: string) => (d ? Number(d.replace(/,/g, "")) * (u === "k" || u === "K" ? 1000 : u === "million" ? 1e6 : 1) : null);
    const n = num(m[2], m[3])!;
    const max = num(m[4], m[5]);
    return n > 0 && n < 1e9 ? { amount: n, max: max && max > n ? max : null, approx: !!m[1] || !!max } : null;
  });

  // Mission associée : « X is a … mission » ou « the (side) mission X »
  const mission = find((s) => {
    const a = s.match(new RegExp(`(${NAME})\\s+is\\s+an?\\s+(?:[\\w-]+\\s){0,2}(?:side\\s|optional\\s|story\\s)?(?:mission|errand|quest)\\b`));
    if (a && !STOP_NAMES.test(a[1]) && a[1].split(/\s+/).length >= 2) return a[1];
    const b = s.match(new RegExp(`\\b(?:side mission|optional mission|errand)\\s+(?:called|named)\\s+["“]?(${NAME})`));
    return b && !STOP_NAMES.test(b[1]) ? b[1] : null;
  });

  // Donneur : « side mission / errand for (Jason's neighbor) Shirley », « your neighbor Shirley »
  const giver = find((s) => {
    const m = s.match(/\b(?:side mission|errand|mission|favou?r)\s+for\s+(?:Jason's\s+|Lucia's\s+)?(?:neighbou?r|friend|cousin|boss)?\s*([A-Z][a-z]+)\b/) ?? s.match(/\b(?:your|Jason's|Lucia's)\s+neighbou?r\s+([A-Z][a-z]+)\b/);
    return m && !STOP_NAMES.test(m[1]) ? m[1] : null;
  });

  // Prérequis : « unlock Pipework », « after completing X »
  const unlockAfter = find((s) => {
    const m = s.match(new RegExp(`\\b(?:and|once you|after you)?\\s*unlock\\s+(${NAME})`)) ?? s.match(new RegExp(`\\bafter\\s+(?:completing|finishing)\\s+(?:the\\s+)?(?:mission\\s+)?["“]?(${NAME})`));
    // « unlock Shirley's errand » désigne une activité, pas une mission prérequise nommée
    return m && !STOP_NAMES.test(m[1].split(/\s+/)[0]) && !/['’]s$/.test(m[1]) ? m[1].replace(/\s+(?:and|the|of)$/, "") : null;
  });

  // Lieu : « X in <district> », lieux connus de la carte communautaire
  const kp = knownPlaces();
  const place = find((s) => {
    for (const [district, regionId] of kp.districts) {
      const m = s.match(new RegExp(`(?:the\\s+)?(${NAME}?)\\s+(?:Store\\s+|store\\s+)?in\\s+${district.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`));
      const nm = m?.[1]
        ?.replace(/^(?:Get to|Go to|Head to|Head over to|Travel to|Drive to|Visit|Find|Reach|Behind|Near|Inside|Outside|Next to|Beside|At|Around|Out the back of|Back of)\s+/, "")
        .replace(/^the\s+/i, "")
        .replace(/\s+Store$/, "");
      // Un nom suivi de « in <quartier> » n'est un lieu que s'il en a la forme (commerce, bâtiment, site) ou s'il figure sur la carte
      if (nm && !STOP_NAMES.test(nm) && nm.split(/\s+/).length >= 2 && (PLACE_NOUN.test(nm) || kp.places.has(nm))) return { name: nm, district, regionId };
    }
    for (const p of kp.places) if (s.includes(p)) return { name: p, district: null, regionId: null };
    return null;
  });
  if (place && !place.value.district) {
    const d = [...kp.districts.keys()].find((k) => all.some((s) => s.includes(k)));
    if (d) place.value = { ...place.value, district: d, regionId: kp.districts.get(d)! };
  }

  // Manquable : distinguer la mission de contexte et la découverte elle-même
  const MISS = /\b(time-sensitive|disappears? for good|missable|can be missed|permanently miss|no longer available|point of no return|miss (?:it|this) forever)\b/i;
  const NOT_MISS = /\b(don'?t (?:necessarily )?miss|won'?t miss|can still|not missable|isn'?t missable|still (?:be )?available|any time|anytime)\b/i;
  const contextMissable = find((s) => {
    if (!MISS.test(s)) return null;
    const subj = s.match(new RegExp(`(${NAME})\\s+is\\s+an?\\s+time-sensitive`))?.[1] ?? mission?.value ?? null;
    const until = s.match(new RegExp(`\\b(?:start|begin|complete|finish)\\s+the\\s+(?:Chapter\\s\\d+\\s+)?mission\\s+(${NAME})`))?.[1] ?? null;
    return { subject: subj, until };
  });
  const notMissable = find((s) => (NOT_MISS.test(s) && /\b(miss|skip|still|later|any ?time)\b/i.test(s) ? false : null));
  const missable = notMissable ?? (contextMissable && !contextMissable.value.subject ? { value: true, quote: contextMissable.quote, url } : null);

  const handsOn = find((s) => (/\b(hands-on guide|we (?:cleared|tested|looted|found|did) (?:it|this|the)|played by|I (?:tested|cleared|looted))\b/i.test(s) ? true : null));

  const keywords = [...new Set((title + " " + text.slice(0, 2000)).toLowerCase().match(/\b(parrot|stash|safe|vent|exotic|tiger|motel|rum|liquor|drugs|cash|gold|armou?r|sniper|supercar|ufo|bigfoot|ghost)\b/g) ?? [])];

  return { chapter, money, mission, giver, unlockAfter, place, missable, contextMissable, handsOn, keywords };
}
