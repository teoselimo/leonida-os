import type { RadarRecord } from "./feed";

/**
 * Français maîtrisé — glossaire GTA VI et titres français.
 *
 * Principe : on ne traduit JAMAIS librement. Un titre anglais n'est rendu en français que si une règle connue
 * le couvre entièrement (expressions du glossaire + noms propres protégés). Sinon on construit un titre
 * à partir des faits établis (catégorie, lieu, gain) et le titre d'origine reste dans « Sources et preuves ».
 * Les noms officiels (missions, lieux, personnages, véhicules, armes) ne sont jamais traduits.
 */

/** Alias français → nom officiel de mission (le joueur parle français, les missions gardent leur nom). */
export const MISSION_ALIASES_FR: Record<string, string> = {
  "mission du rhum": "Get Shirley's Rum",
  "rhum de shirley": "Get Shirley's Rum",
  "le rhum de shirley": "Get Shirley's Rum",
  "piege a touristes": "Tourist Trap",
  "redescendre sur terre": "Down to Earth",
};

export const CAT_FR: Record<string, string> = {
  money: "Argent",
  weapon: "Arme",
  vehicle: "Véhicule",
  easter_egg: "Secret",
  side_mission: "Mission secondaire",
  unique_item: "Objet à collectionner",
  missable: "À ne pas rater",
  mechanic: "Astuce",
  guide: "Guide",
  news: "Actualité",
  patch: "Mise à jour",
  other: "Découverte",
};

/** Expressions du glossaire (anglais → français), de la plus longue à la plus courte. */
const PHRASES: Array<[RegExp, string]> = [
  [/\bfree early weapons\b/i, "armes gratuites dès le début"],
  [/\blegendary weapons\b/i, "armes légendaires"],
  [/\bcollectible card sets?\b/i, "cartes à collectionner"],
  [/\bcollectible cards?\b/i, "cartes à collectionner"],
  [/\bhidden cars\b/i, "voitures cachées"],
  [/\bfast cars\b/i, "voitures rapides"],
  [/\bbest cars\b/i, "meilleures voitures"],
  [/\bcompany cars\b/i, "voitures de société"],
  [/\bparrot stash\b/i, "planque du perroquet"],
  [/\bsafe code\b/i, "code du coffre"],
  [/\bgarage locations\b/i, "emplacements des garages"],
  [/\bbase jump locations\b/i, "emplacements de saut en parachute"],
  [/\bsilent rifle\b/i, "fusil silencieux"],
  [/\bsniper rifle\b/i, "fusil de précision"],
  [/\bsniper\b/i, "fusil de précision"],
  [/\brandom event\b/i, "événement aléatoire"],
  [/\bsafehouses\b/i, "planques"],
  [/\bsafehouse\b/i, "planque"],
  [/\btips (?:&|and) tricks\b/i, "astuces"],
  [/\bearly money\b/i, "argent en début de partie"],
  [/\bmoney\b/i, "argent"],
  [/\bloot spot\b/i, "butin"],
  [/\beaster egg\b/i, "easter egg"],
  [/\bsecret playlists\b/i, "playlists secrètes"],
  [/\bweapons\b/i, "armes"],
  [/\bweapon\b/i, "arme"],
  [/\bcars\b/i, "voitures"],
  [/\bcar\b/i, "voiture"],
  [/\bjet\b/i, "un jet"],
  [/\bat\b/i, "à"],
];

/** Noms propres toujours conservés tels quels (complétés dynamiquement par missions, véhicules et lieux). */
const BASE_PROPER = [
  "Vice City", "Leonida", "Key Lento", "Permit Keys", "Leonida Keys", "Starfish Island", "Watson Bay", "Three Sheets Liquor", "Teddy Bear Factory", "Motel Tiger",
  "Skunk Ape", "Mr. Mangrove", "Bigfoot", "Moses", "Shirley", "Donnie", "Kirk", "Kenton", "BuckMe", "Slim Jim", "GTA+",
  "Jason", "Lucia", "Paul Walker", "Fast and Furious", "Fast & Furious", "Mitsubishi Eclipse", "Penumbra FF",
  "SM-69", "VF-G1", "W-22", "Kingfishers", "Vitello", "Itali RSX", "Dubsta", "Elegy", "Venturas Blvd",
];

const stripTitle = (t: string) =>
  t
    .replace(/^(Guide|Feature|Help):\s*/i, "")
    .replace(/\s*\b(?:in\s+)?(?:GTA\s*(?:6|VI)|Grand Theft Auto (?:6|VI))(?:'s)?\b/gi, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/[✅|]/g, "")
    .replace(/\s*[—–-]\s*$/, "")
    .replace(/^\s*[—–:-]\s*/, "")
    .replace(/\s+:/g, ":")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Traduit un fragment uniquement si tous ses mots sont couverts par le glossaire ou des noms propres protégés.
 * Retourne null sinon (le fragment n'est jamais à moitié traduit).
 */
/** Tournures figées appliquées avant la protection des noms propres (ordre des mots français). */
const SPECIAL: Array<[RegExp, string]> = [
  [/\bPaul Walker[’']s Fast and Furious car\b/i, "la voiture de Paul Walker (Fast & Furious)"],
  [/\bPaul Walker[’']s Mitsubishi Eclipse\b/i, "la Mitsubishi Eclipse de Paul Walker"],
  [/\b([A-Z]{1,4}-\d+[A-Z0-9]*) Sniper(?: Rifle)?\b/, "le fusil de précision $1"],
  [/\b([A-Z]{1,4}-\d+[A-Z0-9]*) Rifle\b/, "le fusil $1"],
  [/\bhidden ([A-Z][\w-]+) supercar\b/, "la supercar cachée $1"],
];

export function trFragment(s: string, proper: string[] = []): string | null {
  let out = s.trim();
  for (const [re, fr] of SPECIAL) out = out.replace(re, (...m) => `\u0001${fr.replace(/\$(\d)/g, (_, i) => m[+i])}\u0001`);
  const names = [...BASE_PROPER, ...proper].sort((a, b) => b.length - a.length);
  const kept: string[] = [];
  for (const n of names) {
    const re = new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
    out = out.replace(re, (m) => {
      kept.push(m);
      return `\u0000${kept.length - 1}\u0000`;
    });
  }
  for (const [re, fr] of PHRASES) out = out.replace(new RegExp(re.source, "gi"), `\u0001${fr}\u0001`);
  // tout ce qui reste hors des zones protégées/traduites doit être vide, ponctuation, nombre ou article neutre
  const leftover = out.replace(/\u0000\d+\u0000/g, "").replace(/\u0001[^\u0001]*\u0001/g, "").replace(/[\s,:&+'’()0-9$.#/-]+/g, "").replace(/\b(the|of|and|a)\b/gi, "");
  if (leftover.trim()) return null;
  return out
    .replace(/\u0000(\d+)\u0000/g, (_, i) => kept[+i])
    .replace(/\u0001([^\u0001]*)\u0001/g, "$1")
    .replace(/\bthe\b\s*/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

export interface Glossary {
  missions: string[];
  proper: string[];
}

/**
 * Titre français d'une fiche Radar. Ordre : faits établis → règles de titre couvertes → catégorie + nom propre.
 * Ne renvoie jamais le titre anglais brut.
 */
export function frHeadline(r: RadarRecord, g: Glossary = { missions: [], proper: [] }): string {
  const d = r.details;
  const cat = CAT_FR[r.category] ?? "Découverte";
  const place = d?.place?.value.name;
  if (r.category === "money" && r.conditions.reward) return `${r.conditions.reward} à récupérer${place ? ` — ${place}` : ""}`;
  const t = stripTitle(r.title);
  const proper = [...g.missions, ...g.proper];

  // guides de mission
  const mission = g.missions.find((m) => new RegExp(`(^|#\\d+ - )${m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=\\W|$)`, "i").test(t));
  if (mission && /walkthrough/i.test(r.title)) {
    const ch = t.match(/\(Chapter (\d+)\)/i);
    return `Mission « ${mission} » : guide complet${ch ? ` (chapitre ${ch[1]})` : ""}`;
  }
  const rules: Array<[RegExp, (m: RegExpMatchArray) => string | null]> = [
    [/^how to (?:get|find|unlock|obtain) (?:an? )?(.+?)(?: easily.*)?$/i, (m) => wrap("Comment obtenir ", trFragment(m[1], proper))],
    [/^where to (?:find|have) (?:an? |the )?(.+?)(?: early)?$/i, (m) => wrap("Où trouver ", trFragment(m[1], proper), /early/i.test(m[0]) ? " tôt dans le jeu" : "")],
    [/^(free )?(.+?) (?:locations?|location and stats)(?::.*)?$/i, (m) => wrap("Emplacements : ", trFragment(m[2], proper))],
    [/^(\d+) free early weapons.*$/i, (m) => `${m[1]} armes gratuites dès le début et leurs emplacements`],
    [/^free (.+?): early location in (.+)$/i, (m) => wrap("", trFragment(m[1], proper), ` gratuit tôt dans le jeu — ${m[2]}`)],
    [/^early money: (.+)$/i, (m) => wrap("Argent en début de partie : ", trFragment(m[1], proper))],
    [/^(.+?) guide: where to find (.+?) and (.+)$/i, (m) => wrap("", trFragment(m[1], proper), " : où trouver ", trFragment(m[2], proper))],
    [/^(.+?) garage: where to find (.+)$/i, (m) => wrap("Garage de ", trFragment(m[1], proper), " : ", trFragment(m[2], proper))],
    [/^(.+?) random event: location, loot and money$/i, (m) => wrap("Événement aléatoire ", trFragment(m[1], proper), " : lieu et butin")],
    [/^(.+?) safe code$/i, (m) => wrap("Code du coffre : ", trFragment(m[1], proper))],
    [/^[—–-]?\s*(.+)$/i, (m) => trFragment(m[1], proper)],
  ];
  for (const [re, f] of rules) {
    const m = t.match(re);
    if (m) {
      const out = f(m);
      if (out) return cap(out);
    }
  }
  // repli : catégorie + nom propre identifié (jamais le titre anglais)
  const noun = proper.concat(BASE_PROPER).find((p) => new RegExp(`\\b${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(r.title));
  if (place) return `${cat} — ${place}`;
  return noun ? `${cat} : ${noun}` : `${cat} — ${r.evidence[0]?.sourceName.replace(/\s*\([^)]*\)\s*$/, "") ?? "source"}`;
}

function wrap(...parts: Array<string | null>): string | null {
  return parts.some((p) => p === null) ? null : parts.join("");
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Résumé français d'une fiche à partir des faits structurés (jamais l'extrait anglais). */
export function frSummary(r: RadarRecord): string {
  const d = r.details;
  const bits: string[] = [];
  if (d?.money) bits.push(`Gain cité : ${r.conditions.reward ?? `${d.money.value.min.toLocaleString("fr-FR")} $`}`);
  if (d?.place) bits.push(`Lieu : ${d.place.value.name}${d.place.value.district ? ` (${d.place.value.district})` : ""}`);
  if (d?.mission) bits.push(`Pendant « ${d.mission.value} »`);
  if (d?.unlockAfter) bits.push(`Accessible après « ${d.unlockAfter.value} »`);
  if (d?.contextMissable?.value.until) bits.push(`Disparaît au lancement de « ${d.contextMissable.value.until} »`);
  if (d?.chapter) bits.push(`Chapitre ${d.chapter.value}`);
  if (bits.length) return bits.join(" · ") + ".";
  const n = r.evidence.length;
  return `Détails dans ${n > 1 ? `${n} sources` : "la source"} (en anglais), à consulter dans « Sources et preuves ».`;
}

const COLORS: Record<string, string> = { "bright green": "vert vif", green: "vert", red: "rouge", silver: "argent", black: "noir", white: "blanc", blue: "bleu", yellow: "jaune", orange: "orange", purple: "violet", pink: "rose", grey: "gris", gray: "gris", gold: "doré" };
/** Variante (couleur, livrée) en français ; une livrée garde son nom propre. */
export function variantFr(v: string | null | undefined): string | null {
  if (!v) return null;
  const k = v.trim().toLowerCase();
  if (COLORS[k]) return COLORS[k];
  const m = v.match(/^livrée (.+)$/i);
  if (m) return /\b(its|the|spotted)\b/i.test(m[1]) ? "livrée spéciale" : `livrée ${m[1]}`;
  return null;
}
