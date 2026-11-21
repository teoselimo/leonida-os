import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Section } from "./article.ts";
import { sentences } from "./facts.ts";
import type { Mechanics, VehicleFacts, VehicleMention, VFact } from "../types.ts";
export type { Mechanics, VehicleFacts, VehicleMention, VFact };

/**
 * Extraction automobile (V0.6) : véhicules réellement trouvables, garages, exclusivités d'édition,
 * et règles générales de conservation (immatriculation, cloneur de clé, traqueurs).
 * Chaque champ porte la phrase exacte qui le justifie. Rien n'est déduit d'un nom de véhicule seul.
 */

/** Voitures réelles citées par les guides (« Mitsubishi Eclipse ») : servent d'alias appris, jamais de nom de fiche. */
const REAL = "Mitsubishi|Ferrari|Lamborghini|Toyota|Nissan|Porsche|Chevrolet|Ford|Dodge|BMW|Mercedes(?:-Benz)?|Audi|Honda|Mazda|Subaru|McLaren|Bugatti|Koenigsegg|Pagani|Aston Martin|Jeep|Cadillac|Lincoln|Pontiac|Plymouth|Buick|Volkswagen|Rolls-Royce|Bentley|Maserati|Alfa Romeo|Lotus|Jaguar|Land Rover|Tesla|Kawasaki|Ducati|Harley-Davidson|Yamaha|Suzuki|Hummer|DeLorean";
export function realCars(text: string): string[] {
  return [...new Set([...text.matchAll(new RegExp(`\\b(${REAL})\\s+([A-Z0-9][\\w-]+)`, "g"))].map((m) => slug(`${m[1]} ${m[2]}`)))];
}

// Constructeurs de l'univers GTA (noms fictifs utilisés par les guides).
const MAKES = [
  "Albany", "Annis", "Ascot", "Benefactor", "BF", "Bollokan", "Bravado", "Brute", "Buckingham", "Canis", "Chariot", "Cheval", "Coil", "Crest", "Declasse",
  "Dewbauchee", "Dinka", "Dundreary", "Emperor", "Enus", "Gallivanter", "Grotti", "Hijak", "Imponte", "Invetero", "JoBuilt", "Karin", "Lampadati", "Maibatsu",
  "Mammoth", "Maxwell", "Nagasaki", "Obey", "Ocelot", "Overflod", "Pegassi", "Pfister", "Piccia", "Principe", "Progen", "Schyster", "Shitzu", "Speedophile",
  "Truffade", "Ubermacht", "Übermacht", "Vapid", "Vulcar", "Vysser", "Weeny", "Western", "Willard", "Zirconium",
];
const STOP = new Set(["Color", "Colour", "Price", "Class", "Type", "Details", "Real", "Based", "Seats", "Speed", "Top", "Residences", "Residence", "Tower", "Towers", "Dealership", "Showroom", "Building", "Hotel", "Blvd", "Street", "Location", "Locations", "In", "At", "On", "The", "And", "Or", "Garage", "Is", "Was", "GTA", "Car", "Cars", "Guide", "How", "Where", "Ultimate", "Edition", "Chapter", "Parked", "Inside", "Near", "From", "With", "To", "For", "Of", "A", "An", "You", "Your", "It", "This", "That", "Once", "Available", "Map", "Vice", "Leonida", "Spawn", "Spawns"]);
const YEAR = "['’‘`](\\d{2})";
const MAKE_RE = MAKES.join("|");
const NAME_RE = new RegExp(`(?:${YEAR}\\s+)?\\b(${MAKE_RE})\\b(?:\\s+(?:['’‘\`]?)(\\d{2})(?=\\s+[A-Z]))?((?:\\s+[A-Z0-9][A-Za-z0-9-]*){1,3})`, "g");

export const slug = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/['’‘`]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Noms de véhicules présents dans un texte (marque obligatoire). */
export function vehicleNames(text: string): Array<{ name: string; make: string; model: string; year: string | null; key: string; index: number }> {
  const out: Array<{ name: string; make: string; model: string; year: string | null; key: string; index: number }> = [];
  for (const m of text.matchAll(NAME_RE)) {
    const make = m[2] === "Übermacht" ? "Ubermacht" : m[2];
    const tokens = m[4].trim().split(/\s+/);
    // « Annis Venturas Blvd Elegy » : un nom de rue suit la marque → ce n'est pas un modèle
    if (/^(Blvd|Boulevard|Street|St|Ave|Avenue|Drive|Dr|Road|Rd)$/.test(tokens[1] ?? "")) continue;
    const kept: string[] = [];
    for (const t of tokens) {
      if (STOP.has(t)) break;
      kept.push(t);
    }
    if (!kept.length) continue;
    const model = kept.join(" ");
    const year = m[1] ?? m[3] ?? null;
    const name = `${year ? `'${year} ` : ""}${make} ${model}`;
    out.push({ name, make, model, year, key: slug(`${make} ${model}`), index: m.index ?? 0 });
  }
  return out;
}

/** Garages nommés (« Paradise Garage », « Shore Court Garage », « Moses' garage »). */
function garageNames(text: string): Array<{ name: string; key: string }> {
  const out = new Map<string, string>();
  for (const m of text.matchAll(/\b((?:[A-Z][\w'’]+\s){1,3})(?:[Pp]ersonal\s)?[Gg]arage\b/g)) {
    const base = m[1].trim().replace(/^(The|Your|A|His|Her)\s+/, "");
    if (!base || STOP.has(base) || /^(Parking|Garage|Moses['’]?|Jason['’]?s|Lucia['’]?s|Street|Private|Personal|Underground|Multistorey|Station|Every|Each|First|New|Free|Safehouse)$/.test(base) || /^(Villa|Mansion|House|Residential)\b/.test(base) || /\b(Street|St|Ave|Avenue|Drive)$/.test(base)) continue;
    out.set(slug(`garage ${base}`), `${base} Garage`);
  }
  return [...out.entries()].map(([key, name]) => ({ key, name }));
}

// ── Référentiel des quartiers de la carte communautaire (gtadb) ──────────────────
interface District { name: string; x: number; y: number; radius: number; regionId: string; count: number }
let districts: Map<string, District> | null = null;
const REGIONS: Array<[string, number, number]> = [["vicecity", -500, 800], ["keys", -2900, -6200], ["grassrivers", -3800, -3600], ["gellhorn", -6500, 3400], ["ambrosia", -2800, 3900], ["kalaga", -3700, 6700]];

export function districtIndex(): Map<string, District> {
  if (districts) return districts;
  districts = new Map();
  const p = fileURLToPath(new URL("../../../public/data/landmarks.json", import.meta.url));
  if (!existsSync(p)) return districts;
  const pts = new Map<string, Array<[number, number]>>();
  for (const [, full, x, y] of JSON.parse(readFileSync(p, "utf8")) as [string, string, number, number][]) {
    for (const part of full.split(",").slice(1).map((s) => s.trim())) {
      if (part.length < 5 || /^\d/.test(part) || /^(N|S|E|W|NE|NW|SE|SW)\s/.test(part)) continue;
      if (!pts.has(part)) pts.set(part, []);
      pts.get(part)!.push([x, y]);
    }
  }
  for (const [name, list] of pts) {
    if (list.length < 3) continue;
    const cx = list.reduce((a, p) => a + p[0], 0) / list.length;
    const cy = list.reduce((a, p) => a + p[1], 0) / list.length;
    const d = list.map((p) => Math.hypot(p[0] - cx, p[1] - cy)).sort((a, b) => a - b);
    const r = d[Math.floor(d.length * 0.85)] ?? 300;
    const region = REGIONS.reduce((b, q) => (Math.hypot(q[1] - cx, q[2] - cy) < Math.hypot(b[1] - cx, b[2] - cy) ? q : b))[0];
    districts.set(name, { name, x: Math.round(cx), y: Math.round(cy), radius: Math.round(Math.min(2500, Math.max(150, r))), regionId: region, count: list.length });
  }
  return districts;
}

/** Quartier le plus précis cité dans une phrase (le plus petit en surface). */
export function findDistrict(text: string): { name: string; relative: boolean } | null {
  let best: District | null = null;
  for (const d of districtIndex().values()) {
    const re = new RegExp(`\\b${d.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
    if (re.test(text) && (!best || d.radius < best.radius)) best = d;
  }
  if (!best) return null;
  const relative = new RegExp(`\\b(east|west|north|south|near|off|outside|beyond|past)\\s+(of\\s+)?(the\\s+)?${best.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(text);
  return { name: best.name, relative };
}

const LOC_CUE = /\b(garage|villa|mansion|house|parked|parking|structure|junkyard|lot|outside|inside|located|docked|sits|sitting|found|spawns?|driveway|street|st\b|drive|ave\b|avenue|parkway|pkwy|lane|hwy|highway|road|rd\b|blvd|boulevard|island|residences|marina|dock)\b/i;
const CAP = (s: string) => (s.length > 220 ? s.slice(0, 217).trim() + "…" : s);

function factsFor(name: ReturnType<typeof vehicleNames>[number] | { name: string; key: string; make: string; model: string; year: null }, type: "vehicle" | "garage", text: string, context: string, url: string, shared = false): VehicleMention {
  const all0 = sentences(text);
  // Section partagée par plusieurs véhicules : les faits propres (lieu, livrée, type d'apparition) viennent des phrases qui le nomment
  const token = name.model.split(" ")[0];
  const own = all0.filter((s) => s.includes(token));
  const ss = shared ? own : all0;
  const f = <T>(fn: (s: string) => T | null): VFact<T> | null => {
    for (const s of ss) {
      const v = fn(s);
      if (v != null) return { value: v, quote: CAP(s), url };
    }
    return null;
  };
  const fAll = <T>(fn: (s: string) => T | null): VFact<T> | null => {
    for (const s of all0) {
      const v = fn(s);
      if (v != null) return { value: v, quote: CAP(s), url };
    }
    return null;
  };
  const all = <T>(fn: (s: string) => T | null, max = 5): VFact<T>[] => {
    const out: VFact<T>[] = [];
    for (const s of ss) {
      const v = fn(s);
      if (v != null) out.push({ value: v, quote: CAP(s), url });
      if (out.length >= max) break;
    }
    return out;
  };

  // Lieu : la phrase la plus « spatiale » (garage, villa, garé, amarré…) l'emporte sur une simple indication de trajet
  const STRONG = /\b(garage|villa|mansion|parked|inside|docked|driveway|junkyard|parking structure|sits|located)\b/i;
  const locCands = (shared ? own : all0).filter((s) => (LOC_CUE.test(s) || findDistrict(s)) && !/\b(map coverage|marker shows|source map|scale|we have not|not plotted|position matched|looks like this)\b/i.test(s));
  const score = (s: string) => (STRONG.test(s) ? 2 : 0) + (findDistrict(s) ? 2 : 0) + (/\b[A-Z][a-z]+ (Residences|House|Hotel|Street|St|Drive|Ave|Avenue|Parkway|Lane|Island|Beach|Inn|Bar|Garage)\b/.test(s) ? 3 : 0) - (/^(Go|Head|Use|Take|Follow)\b/.test(s) ? 1 : 0);
  const locS = [...locCands].sort((a, b) => score(b) - score(a))[0];
  const locD = locS ? findDistrict(locS) ?? findDistrict(text) : null;
  const location: VFact<{ text: string; district: string | null; relative: boolean }> | null = locS ? { value: { text: CAP(locS), district: locD?.name ?? null, relative: locD?.relative ?? false }, quote: CAP(locS), url } : null;
  // Édition : phrase de la section, puis intertitre, puis titre de l'article (un article « Ultimate & précommande » ne rend pas tout « précommande »)
  const [artTitle, , heading = ""] = context.split("\n");
  const PRE = /\b(pre-?order(?:ed)?|vintage vice city pack)\b/i;
  const ULT = /\bultimate edition\b/i;
  const edition: VFact<"ultimate" | "preorder"> | null =
    fAll((s) => (PRE.test(s) ? "preorder" : ULT.test(s) && !/\bupgrade\b/i.test(s) ? "ultimate" : null)) ??
    (PRE.test(heading) ? { value: "preorder", quote: CAP(heading), url } : ULT.test(heading) ? { value: "ultimate", quote: CAP(heading), url } : ULT.test(artTitle) ? { value: "ultimate", quote: CAP(artTitle), url } : null);
  const spawn = f((s) =>
    /\b(random|traffic|repossession|encounter|sighting|reported (?:late-night|evening|afternoon|morning)|roams?|drives? around)\b/i.test(s) ? "dynamic"
    : /\b(during|mission target|target during|mission vehicle|for the mission)\b/i.test(s) ? "mission"
    : /\b(notification|collect (?:it|your)|delivered to you|waypoint|available to collect|added to your)\b/i.test(s) ? "delivery"
    : /\b(garage|parked|sits|inside|driveway|docked)\b/i.test(s) ? "fixed" : null);
  // Chapitre d'accès : phrase de disponibilité d'abord ; jamais un outil facultatif (« waiting until… Snap Gun in Chapter 3 ») ni une règle d'immatriculation
  const chOf = (s: string) => Number(s.match(/\bChapter\s(\d{1,2})\b/)?.[1] ?? NaN);
  const OPTIONAL = /\b(wait(?:ing)? until|optional|don'?t (?:really )?need|easier|register|registration|respray|sell)\b/i;
  const chS = all0.find((s) => /\bChapter\s\d/.test(s) && /\b(available|from chapter|starting (?:from|in) chapter|beginning(?: in)? chapter|unlocks? (?:in|during|at)|collect|notification|only (?:in|during) chapter|requires? chapter)\b/i.test(s) && !OPTIONAL.test(s));
  const chapter: VFact<number> | null = chS ? { value: chOf(chS), quote: CAP(chS), url } : null;
  const mission = f((s) => {
    const m = s.match(/\b(?:during|completing|complete|after)\s+(?:the\s+)?(?:mission\s+)?["“]?((?:[¡¿]?[A-Z][\w'’!¡]*)(?:\s(?:[A-Z][\w'’!¡]*|a|the|of|to|in)){0,4})/);
    if (!m) return null;
    const v = m[1].replace(/\s+in\s+Chapter.*$/, "").replace(/\s+(in|of|to|the|a)$/, "").trim();
    return /^(Chapter|Moses|You|The|It)\b/.test(v) || v.length < 4 ? null : v;
  });
  const early = f((s) => (/\b(early|as soon as|once free roam|free (?:roam|exploration)|from the start|right away|opening sequences?)\b/i.test(s) && !/\bnot early\b/i.test(s) ? true : null));
  const keyCloner = f((s) => (/\bkey cloner|clone (?:its|the|a) key|keyless\b/i.test(s) ? !/\b(no|without|doesn'?t need|don'?t need)\b[^.]{0,20}(key cloner|clone)/i.test(s) : /\brequires its key\b/i.test(s) ? true : null));
  const tracker = f((s) => (/\badvanced tracker/i.test(s) ? "advanced" : /\b(no tracker|tracker-free|without a tracker|doesn'?t have a tracker)\b/i.test(s) ? "none" : /\bstandard tracker/i.test(s) ? "standard" : null));
  const alarm = f((s) => (/\balarm\b/i.test(s) ? !/\bno alarm\b/i.test(s) : null));
  const keep = f((s) => (/\b(register|registration|keep (?:it|the car|the vehicle)|personal vehicle|respray|store it|garage slot)\b/i.test(s) ? s : null));
  const price = f((s) => {
    if (!/\b(worth|sells? for|resale|price|costs?|buy (?:it )?for|value)\b/i.test(s)) return null;
    const m = s.match(/\$\s?(\d{1,3}(?:,\d{3})+|\d+)/);
    return m ? Number(m[1].replace(/,/g, "")) : null;
  });
  const variant = f((s) => {
    const m = s.match(/\b((?:bright |dark |matte |metallic )?(?:green|blue|red|yellow|orange|purple|pink|white|black|silver|gold|teal)(?:\s(?:and|with)\s(?:[a-z]+\s){0,2}(?:graphics|stripes|livery|vinyls))?)\b/i);
    const liv = s.match(/\b([A-Z][\w&' ]{2,30}) livery\b/);
    if (liv) return `livrée ${liv[1].trim()}`;
    return m && /\b(car|paint|body|tribute|livery|colou?r|eclipse)\b/i.test(s) ? m[1].toLowerCase() : null;
  });
  const steps = all((s) => (/^(Take|Drive|Head|Go|Enter|Break|Steal|Open|Use|Respray|Register|Park|Cross|Continue|Follow|Get in|Smash|Scan|Bring|Return|Place)\b/.test(s) ? s : null), 5);
  const risks = [
    ...all0.filter((s) => /\bonly available (?:in|during) Chapter \d+\b|\bmissable\b|\bpermanently miss/i.test(s)).slice(0, 1).map((s) => ({ value: s, quote: CAP(s), url })),
    ...all((s) => (!/\b(other guides|guide shows you|my .{0,30} guide|check out our|read more)\b/i.test(s) && /\b(lose|lost|disappears?|destroyed|can'?t (?:keep|register|change)|not automatically|does not automatically|police|wanted|tracker|delivered to a buyer|only your personal vehicle is kept|sell (?:it|your vehicle) to make room)\b/i.test(s)) ? s : null, 3),
  ];
  const missable = all0.find((s) => /\bonly available (?:in|during) Chapter (\d+)\b/i.test(s));
  const until = missable ? { value: Number(missable.match(/Chapter (\d+)/)![1]), quote: CAP(missable), url } : null;
  return { name: name.name, make: name.make, model: name.model, year: name.year, key: name.key, type, variant, location, spawn, edition, chapter, mission, early, keyCloner, tracker, alarm, keep, price, steps, risks, until };
}

const inHeadOf = (h: string) => vehicleNames(h).length > 0;

/** Règles générales tirées d'un guide (immatriculation, cloneur de clé, achat de garages). */
export function extractMechanics(text: string, url: string): Mechanics {
  const ss = sentences(text);
  const register: Mechanics["register"] = [];
  let keyCloner: Mechanics["keyCloner"] = null;
  let garages: Mechanics["garages"] = null;
  // Les phrases sans chapitre héritent du chapitre de la phrase précédente (intertitres « Chapter 2 – … »)
  // Le chapitre doit figurer dans la phrase, ou dans l'intertitre court qui la précède immédiatement
  let lastChapter: number | null = null;
  for (let i = 0; i < ss.length; i++) {
    const s = ss[i];
    const ch = s.match(/\bChapter\s(\d{1,2})\b/);
    const prev = ss[i - 1] ?? "";
    lastChapter = prev.length < 90 && /\bChapter\s(\d{1,2})\b/.test(prev) ? Number(prev.match(/\bChapter\s(\d{1,2})\b/)![1]) : null;
    if (/\?\s*$/.test(s)) continue;
    if (/\bregister\b/i.test(s) && /\b(Moses|Pay ['’]?n['’]? Spray|garage)\b/i.test(s) && (ch || lastChapter != null) && !/\bcan'?t\b/i.test(s)) {
      const tracker = /\bstandard tracker/i.test(s) ? "standard" : /\badvanced tracker/i.test(s) ? "advanced" : /\b(doesn'?t have a tracker|no tracker|tracker-free|without (?:a )?tracker)\b/i.test(s) ? "none" : null;
      const where = /\bPay ['’]?n['’]? Spray\b/i.test(s) ? "Pay 'n' Spray" : /\bMoses\b/.test(s) ? "garage de Moses" : null;
      const same = register.findIndex((r) => r.value.where === where && r.value.chapter === (ch ? Number(ch[1]) : lastChapter));
      if (same >= 0 && register[same].value.tracker == null && tracker) register.splice(same, 1);
      else if (same >= 0) continue;
      register.push({ value: { chapter: ch ? Number(ch[1]) : lastChapter!, where, tracker }, quote: CAP(s), url });
    }
    if (!keyCloner && /\bkey cloner\b/i.test(s) && /\b(get|unlock|obtain|receive|automatically get)\b/i.test(s)) {
      const mission = s.match(/["“]([^"”]{4,50})["”]/)?.[1] ?? null;
      if (ch || mission) keyCloner = { value: { chapter: ch ? Number(ch[1]) : null, mission }, quote: CAP(s), url };
    }
    if (!garages && /\b(buy|purchase)\b[^.]{0,40}\bgarages?\b/i.test(s)) {
      const app = s.match(/["“]([^"”]{4,40})["”]/)?.[1];
      garages = { value: { chapter: ch ? Number(ch[1]) : lastChapter, how: app ? `application « ${app} »` : "achat de garages" }, quote: CAP(s), url };
    }
  }
  return { register, keyCloner, garages };
}

/**
 * Véhicules d'un article. Deux modes :
 *  - liste (≥ 2 intertitres nommant un véhicule) : chaque véhicule ne reçoit que les faits de SA section ;
 *  - article dédié : le véhicule dominant (titre ou ≥ 2 mentions) reçoit les faits du texte entier.
 */
export function extractVehicles(text: string, sections: Section[], title: string, url: string): VehicleFacts {
  const mechanics = extractMechanics(text, url);
  const byKey = new Map<string, VehicleMention>();
  const add = (m: VehicleMention) => {
    const prev = byKey.get(m.key);
    if (!prev) return byKey.set(m.key, m);
    // même véhicule cité deux fois : on complète les champs vides, sans écraser
    for (const k of Object.keys(m) as (keyof VehicleMention)[]) if ((prev[k] == null || (Array.isArray(prev[k]) && !(prev[k] as unknown[]).length)) && m[k] != null) (prev as unknown as Record<string, unknown>)[k] = m[k];
  };
  const headed = sections
    .map((s) => {
      const inHead = vehicleNames(s.heading);
      // « Jason's Safehouse Vehicles » : l'intertitre annonce des véhicules nommés dans le corps
      const names = inHead.length ? inHead.slice(0, 1) : /\b(vehicles?|cars?|bikes?|boats?|motorcycles?|pack|bonus)\b/i.test(s.heading) || /\b(ultimate|pre-?order)\b/i.test(title) ? vehicleNames(s.text).filter((n, i, a) => a.findIndex((x) => x.key === n.key) === i) : [];
      return { s, names, garages: garageNames(s.heading) };
    })
    .filter((x) => x.names.length || x.garages.length);
  const articleCtx = `${title}\n${sections[0]?.heading ?? ""}`;
  if (headed.length >= 2) {
    for (const { s, names, garages } of headed) {
      const ctx = `${articleCtx}\n${s.heading}`;
      for (const n of names) {
        const m = factsFor(n, "vehicle", s.text, ctx, url, names.length > 1 || !inHeadOf(s.heading));
        // « Maibatsu ’97 Penumbra FF (Paul Walker’s Eclipse) » : l'alias vient de l'intertitre
        const par = s.heading.match(/\(([^)]{3,60})\)/)?.[1];
        const al = [...realCars(s.heading), ...(par ? realCars(`${par}`).concat(/\b(Eclipse|Supra|Skyline|Charger|Mustang|Testarossa|Countach|Diablo)\b/.test(par) ? [slug(par.match(/\b(Eclipse|Supra|Skyline|Charger|Mustang|Testarossa|Countach|Diablo)\b/)![1])] : []) : [])];
        if (al.length) m.aliases = { value: [...new Set(al)], quote: s.heading, url };
        add(m);
      }
      for (const g of garages) add(factsFor({ name: g.name, key: g.key, make: "", model: g.name, year: null }, "garage", s.text, ctx, url));
      // garages cités dans le corps d'une section véhicule (« Paradise Garage ») : fiche garage minimale
      for (const g of garageNames(s.text)) if (!byKey.has(g.key)) add(factsFor({ name: g.name, key: g.key, make: "", model: g.name, year: null }, "garage", s.text.split("\n").filter((l) => l.includes(g.name.split(" ")[0])).join("\n") || s.text, ctx, url));
    }
  } else {
    const names = vehicleNames(`${title}\n${text}`);
    const counts = new Map<string, number>();
    for (const n of names) counts.set(n.key, (counts.get(n.key) ?? 0) + 1);
    const inTitle = vehicleNames(title)[0];
    // Article dédié : véhicule du titre, sinon nommé au moins deux fois, sinon l'unique véhicule cité d'un guide « voiture »
    const distinct = [...new Set(names.map((n) => n.key))];
    const top = inTitle ?? names.find((n) => (counts.get(n.key) ?? 0) >= 2) ?? (distinct.length === 1 && /\b(car|cars|vehicle|ride|eclipse|supercar)\b/i.test(title) ? names[0] : undefined);
    const reals = realCars(`${title}\n${text}`);
    if (top) {
      const full = names.find((n) => n.key === top.key && n.year) ?? top;
      const m = factsFor(full, "vehicle", text, articleCtx, url);
      // Article dédié qui nomme aussi la voiture réelle : alias appris, justifié par la phrase qui les relie
      if (reals.length) {
        const q = sentences(`${title}\n${text}`).find((x) => realCars(x).length) ?? title;
        m.aliases = { value: reals, quote: CAP(q), url };
      }
      add(m);
    } else if (reals.length && /\b(car|cars|vehicle|ride)\b/i.test(title)) {
      // L'article ne donne que le nom réel : mention en attente de résolution par un alias appris ailleurs
      const k = reals[0];
      const m = factsFor({ name: k, key: `alias:${k}`, make: "", model: k, year: null }, "vehicle", text, articleCtx, url);
      m.unresolved = true;
      m.aliases = { value: reals, quote: CAP(title), url };
      add(m);
    }
  }
  return { vehicles: [...byKey.values()], mechanics };
}
