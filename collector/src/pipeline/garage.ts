import type { Evidence, MediaRef, RadarRecord, Reliability, SourceConfig, SourceRef, VehicleRecord, VField } from "../types.ts";
import { independentCount } from "./records.ts";
import { districtIndex, slug } from "./vehicles.ts";
import type { Mechanics, VehicleMention, VFact } from "./vehicles.ts";

/**
 * Consolidation du Garage des légendes : toutes les mentions de véhicules trouvées dans les articles lus
 * deviennent des fiches uniques (une par modèle), avec preuves par champ, contradictions et règles de conservation.
 * Aucune donnée n'est saisie à la main : seules les validations de point (overrides) viennent d'un humain.
 */

export interface VehicleOverride {
  point?: { x: number; y: number };
  status?: "retracted";
  note?: string;
  capture?: { src: string; credit: string; alt?: string };
}

type M = { m: VehicleMention; ev: Evidence };
const ref = (x: { ev: Evidence; f: VFact<unknown> }): SourceRef => ({ sourceName: x.ev.sourceName, url: x.f.url, quote: x.f.quote });
const norm = (v: unknown) => (typeof v === "string" ? v.toLowerCase().replace(/['’]/g, "'").trim() : JSON.stringify(v));

function field<T>(list: M[], get: (m: VehicleMention) => VFact<T> | null, key: (v: T) => string = norm): VField<T> | null {
  const refs = list.map((x) => ({ ev: x.ev, f: get(x.m) })).filter((x): x is { ev: Evidence; f: VFact<T> } => !!x.f);
  if (!refs.length) return null;
  const counts = new Map<string, number>();
  for (const r of refs) counts.set(key(r.f.value), (counts.get(key(r.f.value)) ?? 0) + 1);
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const chosen = refs.find((r) => key(r.f.value) === best)!;
  return { value: chosen.f.value, support: refs.filter((r) => key(r.f.value) === best).map(ref), conflicts: refs.filter((r) => key(r.f.value) !== best).map(ref) };
}

function dedupeRefs(list: SourceRef[], max: number): SourceRef[] {
  const seen = new Set<string>();
  return list.filter((r) => (seen.has(r.quote) ? false : (seen.add(r.quote), true))).slice(0, max);
}

/** Règles générales : immatriculation par niveau de traqueur, cloneur de clé. */
export function collectMechanics(evs: Evidence[]) {
  const register: Array<{ chapter: number; where: string | null; tracker: string | null; source: SourceRef }> = [];
  let keyCloner: { chapter: number; mission: string | null; source: SourceRef } | null = null;
  for (const ev of evs) {
    const mech: Mechanics | undefined = ev.deep?.mechanics;
    if (!mech) continue;
    for (const r of mech.register) register.push({ chapter: r.value.chapter, where: r.value.where, tracker: r.value.tracker, source: { sourceName: ev.sourceName, url: r.url, quote: r.quote } });
    if (mech.keyCloner?.value.chapter != null && (!keyCloner || mech.keyCloner.value.chapter < keyCloner.chapter))
      keyCloner = { chapter: mech.keyCloner.value.chapter, mission: mech.keyCloner.value.mission, source: { sourceName: ev.sourceName, url: mech.keyCloner.url, quote: mech.keyCloner.quote } };
  }
  // Règle retenue : la combinaison (chapitre, lieu) la plus souvent documentée pour ce niveau de traqueur
  const ruleFor = (tracker: string | null) => {
    const t = tracker ?? "none";
    const cands = register.filter((r) => r.tracker === t || (t === "none" && r.tracker == null && r.where === "garage de Moses"));
    if (!cands.length) return null;
    const count = new Map<string, number>();
    for (const c of cands) count.set(`${c.chapter}|${c.where}`, (count.get(`${c.chapter}|${c.where}`) ?? 0) + (c.tracker === t ? 2 : 1));
    const best = [...count.entries()].sort((a, b) => b[1] - a[1])[0][0];
    return cands.find((c) => `${c.chapter}|${c.where}` === best) ?? null;
  };
  return { register, keyCloner, ruleFor };
}

export function buildVehicles(records: RadarRecord[], sources: Map<string, SourceConfig>, prev: VehicleRecord[], overrides: Record<string, VehicleOverride>, now: Date): VehicleRecord[] {
  const live = records.filter((r) => r.status !== "retracted");
  const evs = live.flatMap((r) => r.evidence);
  const mech = collectMechanics(evs);
  const groups = new Map<string, M[]>();
  const pending: M[] = [];
  for (const ev of evs) for (const m of ev.deep?.vehicles ?? []) {
    if (m.unresolved) {
      pending.push({ m, ev });
      continue;
    }
    if (!groups.has(m.key)) groups.set(m.key, []);
    groups.get(m.key)!.push({ m, ev });
  }
  // Résolution des articles qui ne citent que la voiture réelle, via les alias appris (un seul candidat, sinon on s'abstient)
  const aliasOwner = new Map<string, Set<string>>();
  // Un alias « mitsubishi-eclipse » est aussi indexé par son modèle seul (« eclipse »), comme dans « Paul Walker’s Eclipse »
  const forms = (a: string) => [a, a.split("-").slice(1).join("-")].filter(Boolean);
  for (const [key, list] of groups) for (const x of list) for (const a of x.m.aliases?.value ?? []) for (const f of forms(a)) {
    if (!aliasOwner.has(f)) aliasOwner.set(f, new Set());
    aliasOwner.get(f)!.add(key);
  }
  for (const p of pending) {
    const owners = new Set((p.m.aliases?.value ?? []).flatMap((a) => forms(a).flatMap((f) => [...(aliasOwner.get(f) ?? [])])));
    if (owners.size === 1) groups.get([...owners][0])!.push(p);
  }
  // Vidéos YouTube collectées qui nomment le modèle : média autorisé (miniature hébergée par YouTube)
  const videos = live.flatMap((r) => r.evidence.filter((e) => (sources.get(e.sourceId)?.kind ?? "").startsWith("youtube")).map((e) => ({ e, media: r.media })));
  const prevById = new Map(prev.map((v) => [v.id, v]));
  const out: VehicleRecord[] = [];
  const t = now.toISOString();

  for (const [key, list] of groups) {
    const first = list.find((x) => !x.m.unresolved)!.m;
    const type = list.some((x) => x.m.type === "garage") ? "garage" : "vehicle";
    const id = `v-${key}`;
    const ov = overrides[id];
    if (ov?.status === "retracted") continue;
    const withYear = list.find((x) => x.m.year)?.m;
    const name = withYear?.name ?? first.name;

    // Preuves : une par article, origines enrichies des sites que l'article cite comme source
    const evMap = new Map<string, Evidence>();
    for (const x of list) evMap.set(x.ev.rawKey, { ...x.ev, origins: [...x.ev.origins, ...(x.ev.deep?.cites ?? []).map((h) => `site:${h}`)] });
    const evidence = [...evMap.values()];
    const independent = independentCount(evidence.filter((e) => !e.official));
    const official = evidence.some((e) => e.official);

    // Quartier retenu : le plus précis parmi les plus cités ; un quartier qui contient l'autre (« Vice City » ⊃ « Rialto Islands ») n'est pas une contradiction
    const loc0 = field(list.filter((x) => x.m.location?.value.district), (m) => m.location && { ...m.location, value: m.location.value.district ?? "" } as VFact<string>);
    const di = districtIndex();
    const compatibleD = (a: string, b: string) => {
      if (a === b) return true;
      const A = di.get(a), B = di.get(b);
      if (!A || !B) return false;
      return Math.hypot(A.x - B.x, A.y - B.y) <= Math.max(A.radius, B.radius) * 1.1 || A.radius > 1500 || B.radius > 1500;
    };
    let loc = loc0;
    if (loc0) {
      const all = [...loc0.support, ...loc0.conflicts];
      const ds = list.filter((x) => x.m.location?.value.district).map((x) => ({ d: x.m.location!.value.district!, r: { sourceName: x.ev.sourceName, url: x.m.location!.url, quote: x.m.location!.quote } }));
      // le plus précis (plus petit rayon) parmi ceux compatibles avec la majorité
      const best = [...new Set(ds.map((x) => x.d))].sort((a, b) => ds.filter((x) => compatibleD(x.d, b)).length - ds.filter((x) => compatibleD(x.d, a)).length || (di.get(a)?.radius ?? 9e9) - (di.get(b)?.radius ?? 9e9))[0];
      loc = { value: best, support: ds.filter((x) => compatibleD(x.d, best)).map((x) => x.r), conflicts: ds.filter((x) => !compatibleD(x.d, best)).map((x) => x.r) };
      void all;
    }
    const locText = field(list, (m) => m.location && { ...m.location, value: m.location.value.text } as VFact<string>, (v) => v);
    const district = loc?.value || null;
    const relative = list.some((x) => x.m.location?.value.district === district && x.m.location?.value.relative);
    // Un quartier trop vaste (ville entière) ne donne pas de zone de recherche utile : texte seulement
    const d0 = district ? districtIndex().get(district) ?? null : null;
    const d = d0 && d0.radius <= 1500 ? d0 : null;
    const alternatives = list
      .filter((x) => x.m.location && x.m.location.value.district && !compatibleD(x.m.location.value.district, district ?? ""))
      .map((x) => ({ district: x.m.location!.value.district, text: x.m.location!.value.text, sourceName: x.ev.sourceName, url: x.m.location!.url }));

    const edition = field(list, (m) => m.edition);
    const editionSupportCount = edition ? independentCount(evidence.filter((e) => edition.support.some((s) => s.url === e.url))) : 0;
    const spawn = field(list, (m) => m.spawn);
    const kind: VehicleRecord["kind"] = spawn?.value === "fixed" ? "hidden" : spawn?.value === "dynamic" ? "dynamic" : spawn?.value === "mission" ? "mission" : spawn?.value === "delivery" ? "delivery" : loc || locText ? "hidden" : "news";

    const chapterMin = field(list, (m) => m.chapter, String);
    const keyCloner = field(list, (m) => m.keyCloner);
    const tracker = field(list, (m) => m.tracker);
    const inferredChapter =
      keyCloner?.value && mech.keyCloner && (chapterMin?.value ?? 0) < mech.keyCloner.chapter
        ? { value: mech.keyCloner.chapter, why: "cloneur de clé nécessaire", source: mech.keyCloner.source }
        : null;
    const exclusive = edition?.value ?? null;
    const keepMode: VehicleRecord["keep"]["mode"] = exclusive || kind === "delivery" ? "yes" : type === "garage" ? "unknown" : "register";
    const rule = keepMode === "register" ? mech.ruleFor(tracker?.value ?? null) : null;

    const point = ov?.point ?? null;
    const precision: VehicleRecord["location"]["precision"] = point ? "exact" : d ? "zone" : locText ? "text" : "none";
    const steps = dedupeRefs(list.flatMap((x) => x.m.steps.map((s) => ({ sourceName: x.ev.sourceName, url: s.url, quote: s.quote }))), 5);
    const risks = dedupeRefs(list.flatMap((x) => x.m.risks.map((s) => ({ sourceName: x.ev.sourceName, url: s.url, quote: s.quote }))), 4);

    let media: MediaRef | null = list.map((x) => live.find((r) => r.evidence.includes(x.ev))?.media).find(Boolean) ?? null;
    if (!media) {
      const needle = new RegExp(`\\b${first.model.split(" ")[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      media = first.model.length >= 4 ? videos.find((v) => v.media && needle.test(v.e.title) && new RegExp(first.make, "i").test(v.e.title))?.media ?? null : null;
    }

    // Fiabilité : l'emplacement (ou l'exclusivité pour un bonus) doit être recoupé par deux origines indépendantes
    const locAgree = loc ? independentCount(evidence.filter((e) => loc.support.some((s) => s.url === e.url))) : 0;
    const conflicting = !!(loc?.conflicts.length || edition?.conflicts.length);
    let reliability: Reliability;
    const reasons: string[] = [];
    if (official) {
      reliability = "official";
      reasons.push("Annoncé par Rockstar Games.");
    } else if (!conflicting && (locAgree >= 2 || (exclusive && editionSupportCount >= 2))) {
      reliability = "confirmed";
      reasons.push(`${Math.max(locAgree, editionSupportCount)} sources indépendantes concordantes sur ${locAgree >= 2 ? "l'emplacement" : "l'exclusivité d'édition"}.`);
    } else {
      reliability = "reported";
      reasons.push(conflicting ? "Les sources divergent sur l'emplacement ou l'édition : à vérifier." : independent >= 2 ? `${independent} sources, mais sans accord vérifiable sur l'emplacement.` : "Une seule source : à vérifier en jeu.");
    }
    if (evidence.length > independent && !official) reasons.push("Certaines sources reprennent la même origine : comptées une seule fois.");
    if (exclusive === "ultimate") reasons.push(edition!.support.length >= 1 && reliability !== "reported" ? "Exclusivité Ultimate recoupée." : "Exclusivité Ultimate signalée : compatibilité à vérifier.");
    if (inferredChapter) reasons.push(`Accès estimé au chapitre ${inferredChapter.value} : ${inferredChapter.why} (règle générale, ${inferredChapter.source.sourceName}).`);
    if (precision === "zone") reasons.push(`Zone de recherche ${relative ? "élargie " : ""}autour de ${district} (repères de la carte communautaire), pas un point exact.`);

    const missing = [
      !locText && type === "vehicle" && "emplacement",
      !chapterMin && !inferredChapter && "chapitre",
      keepMode === "register" && !rule && "méthode de conservation",
      !list.some((x) => x.m.keyCloner || x.m.tracker || x.m.alarm) && kind === "hidden" && "sécurité (traqueur, alarme, clé)",
    ].filter(Boolean) as string[];

    const rec: VehicleRecord = {
      id,
      type,
      name,
      make: first.make,
      model: first.model,
      year: withYear?.year ?? null,
      aliases: (() => {
        // union des alias appris ; un alias contenu dans un autre (« eclipse » ⊂ « mitsubishi-eclipse ») est absorbé
        const withA = list.filter((x) => x.m.aliases && !x.m.unresolved);
        if (!withA.length) return null;
        const all = [...new Set(withA.flatMap((x) => x.m.aliases!.value))];
        const value = all.filter((a) => !all.some((b) => b !== a && b.endsWith(`-${a}`)));
        return { value, support: withA.map((x) => ({ sourceName: x.ev.sourceName, url: x.m.aliases!.url, quote: x.m.aliases!.quote })), conflicts: [] };
      })(),
      kind,
      variant: field(list, (m) => m.variant),
      edition: { exclusive, status: !exclusive ? "none" : reliability === "reported" && editionSupportCount < 2 && !official ? "reported" : "confirmed", support: edition?.support ?? [] },
      location: {
        text: locText,
        district,
        regionId: d0?.regionId ?? null,
        precision,
        zone: d && !point ? { x: d.x, y: d.y, radius: Math.round(d.radius * (relative ? 1.6 : 1)), widened: relative } : null,
        point,
        alternatives: alternatives.slice(0, 3),
      },
      access: {
        chapterMin,
        inferredChapter,
        until: field(list, (m) => m.until, String),
        mission: field(list, (m) => m.mission),
        early: list.some((x) => x.m.early?.value),
        keyCloner,
        tracker,
        alarm: field(list, (m) => m.alarm),
      },
      keep: { text: field(list, (m) => m.keep, (v) => v), rule, mode: keepMode },
      steps,
      risks,
      price: field(list, (m) => m.price, String),
      media,
      evidence: evidence.map((e) => ({ sourceName: e.sourceName, url: e.url, title: e.title, official: e.official, readAt: e.deep?.at ?? null })),
      reliability,
      reasons,
      missing,
      firstSeenAt: prevById.get(id)?.firstSeenAt ?? t,
      updatedAt: prevById.get(id)?.updatedAt ?? t,
      revisions: prevById.get(id)?.revisions ?? [{ at: t, reason: "Détection automatique", changes: evidence.map((e) => `source : ${e.sourceName}`) }],
    };
    if (ov?.capture && /^gameplay\/[\w.-]+\.(jpe?g|png|webp)$/.test(ov.capture.src)) (rec as VehicleRecord & { capture?: unknown }).capture = ov.capture;

    // Historique : seulement les changements visibles
    const p = prevById.get(id);
    if (p) {
      const ch: string[] = [];
      if (p.reliability !== rec.reliability) ch.push(`fiabilité : ${p.reliability} → ${rec.reliability}`);
      if (p.evidence.length !== rec.evidence.length) ch.push(`preuves : ${p.evidence.length} → ${rec.evidence.length}`);
      if (p.location.precision !== rec.location.precision) ch.push(`localisation : ${p.location.precision} → ${rec.location.precision}`);
      if (p.edition.exclusive !== rec.edition.exclusive || p.edition.status !== rec.edition.status) ch.push(`édition : ${p.edition.exclusive ?? "aucune"} (${p.edition.status}) → ${rec.edition.exclusive ?? "aucune"} (${rec.edition.status})`);
      if (ch.length) {
        rec.revisions = [...p.revisions, { at: t, reason: ov?.point && !p.location.point ? "Point validé" : "Réévaluation", changes: ch }];
        rec.updatedAt = t;
      }
    }
    out.push(rec);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export { slug };
