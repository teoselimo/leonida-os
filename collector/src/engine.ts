import { CONNECTORS } from "./connectors/index.ts";
import { ConnectorUnavailable } from "./connectors/base.ts";
import type { CollectedItem } from "./connectors/base.ts";
import { derive, diff, matches, newRecord, toEvidence } from "./pipeline/records.ts";
import { GTA6, NOISE, OTHER_GAMES, categorize } from "./pipeline/rules.ts";
import { enrichWithLLM } from "./pipeline/llm.ts";
import { deepReadPhase, mergeByFacts } from "./pipeline/deep.ts";
import { buildVehicles } from "./pipeline/garage.ts";
import type { VehicleOverride } from "./pipeline/garage.ts";
import type { Store } from "./store/fileStore.ts";
import type { Override, RadarFeed, RadarRecord, RawItem, RunLog, SourceConfig, SourceState } from "./types.ts";
import { canonicalUrl, sha1, shortExcerpt, stripHtml } from "./util.ts";

export interface RunOptions {
  sources: SourceConfig[];
  overrides: Record<string, Override>;
  env: Record<string, string | undefined>;
  now?: Date;
  force?: boolean;
  only?: string[];
  fetchImpl?: typeof fetch;
  log?: (msg: string) => void;
  maxAgeDays?: number;
  /** Origine du déclenchement (GITHUB_EVENT_NAME) et identifiant d'exécution, journalisés dans cycles.json. */
  trigger?: string;
  runId?: string | null;
  /** Validations humaines du Garage des légendes (point exact, retrait). */
  vehicleOverrides?: Record<string, VehicleOverride>;
  /** Désactive la lecture approfondie (tests unitaires sans réseau). */
  deep?: boolean;
}

export interface RunSummary {
  runs: RunLog[];
  newItems: number;
  updatedItems: number;
  duplicates: number;
  filtered: Record<string, number>;
  deepReads: number;
  merged: number;
  vehicles?: number;
  newVehicles?: number;
}

const initState = (): SourceState => ({ lastAttemptAt: null, lastSuccessAt: null, consecutiveFailures: 0, lastError: null, status: "never-run", statusDetail: null });

/** Une source est due si son intervalle est écoulé, avec recul exponentiel après échecs (max ×16, 6 h). */
export function isDue(src: SourceConfig, st: SourceState, now: Date): boolean {
  if (!st.lastAttemptAt) return true;
  const factor = Math.min(16, 2 ** st.consecutiveFailures);
  const wait = Math.min(src.intervalMinutes * factor, 360) * 60_000;
  return now.getTime() - Date.parse(st.lastAttemptAt) >= wait - 60_000; // tolérance d'1 min sur l'horloge du cron
}

/** Tri : hors sujet, autres jeux (GTA V / Online), bruit, contenu ancien. */
export function relevance(item: { title: string; excerpt: string; publishedAt: string | null }, src: SourceConfig, now: Date, maxAgeDays: number): string | null {
  const t = `${item.title} ${item.excerpt}`;
  const about6 = GTA6.test(t) || (src.official && /\b(vice city|leonida|jason|lucia)\b/i.test(t));
  if (!about6) return "hors sujet";
  if (OTHER_GAMES.test(item.title) && !GTA6.test(item.title)) return "autre jeu (GTA V / Online)";
  if (!src.official && NOISE.test(item.title)) return "bruit (montage, réaction, mod…)";
  if (item.publishedAt && now.getTime() - Date.parse(item.publishedAt) > maxAgeDays * 86400_000) return "contenu ancien";
  return null;
}

export async function runCollection(store: Store, opts: RunOptions): Promise<RunSummary> {
  const now = opts.now ?? new Date();
  const log = opts.log ?? (() => {});
  const sources = new Map(opts.sources.map((s) => [s.id, s]));
  const summary: RunSummary = { runs: [], newItems: 0, updatedItems: 0, duplicates: 0, filtered: {}, deepReads: 0, merged: 0 };
  const touched = new Set<string>();

  for (const src of opts.sources) {
    if (opts.only && !opts.only.includes(src.id)) continue;
    const st = (store.state[src.id] ??= initState());
    const started = new Date();
    const runLog: RunLog = { id: `${src.id}-${started.getTime()}`, sourceId: src.id, startedAt: started.toISOString(), finishedAt: "", ok: false, fetched: 0, newItems: 0, updatedItems: 0, errors: [], attempts: 0 };

    if (!src.enabled) {
      Object.assign(st, { status: "disabled", statusDetail: "Désactivée dans sources.json" });
      continue;
    }
    if (!opts.force && !isDue(src, st, now)) continue;

    try {
      const res = await CONNECTORS[src.kind]({ source: src, state: st, env: opts.env, now, fetchImpl: opts.fetchImpl });
      runLog.attempts = res.attempts;
      runLog.fetched = res.items.length;
      runLog.quotaUsed = res.quotaUsed;
      const out = ingest(store, src, res.items, sources, now, opts.maxAgeDays ?? 21, summary.filtered, touched);
      runLog.newItems = out.newItems;
      runLog.updatedItems = out.updated;
      summary.duplicates += out.duplicates;
      runLog.ok = true;
      Object.assign(st, res.statePatch ?? {}, {
        lastAttemptAt: now.toISOString(),
        lastSuccessAt: now.toISOString(),
        consecutiveFailures: 0,
        lastError: null,
        etag: res.etag ?? st.etag ?? null,
        status: "ok",
        statusDetail: res.notModified ? "Inchangé depuis la dernière collecte (304)" : `${res.items.length} éléments lus`,
      });
    } catch (e) {
      if (e instanceof ConnectorUnavailable) {
        runLog.skipped = e.reason;
        runLog.errors.push(e.message);
        Object.assign(st, { lastAttemptAt: now.toISOString(), status: e.reason === "unsupported" ? "unsupported" : e.reason === "quota" ? "degraded" : "disabled", statusDetail: e.message });
      } else {
        const msg = (e as Error).message || String(e);
        runLog.errors.push(msg);
        Object.assign(st, { lastAttemptAt: now.toISOString(), consecutiveFailures: st.consecutiveFailures + 1, lastError: msg, status: "degraded", statusDetail: `Échec : ${msg}` });
      }
    }
    runLog.finishedAt = new Date().toISOString();
    summary.runs.push(runLog);
    store.runs.push(runLog);
    summary.newItems += runLog.newItems;
    summary.updatedItems += runLog.updatedItems;
    log(`${runLog.ok ? "✓" : runLog.skipped ? "–" : "✗"} ${src.id} : ${runLog.fetched} lus, ${runLog.newItems} nouveaux, ${runLog.updatedItems} mis à jour${runLog.errors.length ? ` · ${runLog.errors.join(" | ")}` : ""}`);
  }

  // Lecture approfondie des guides (robots.txt respecté, budget par exécution) puis fusion des fiches identiques
  if (opts.deep !== false) {
    const d = await deepReadPhase(store.records, sources, touched, { env: opts.env, fetchImpl: opts.fetchImpl, now, log });
    summary.deepReads = d.ok;
  }
  const m = mergeByFacts(store.records, now);
  store.records = m.records;
  summary.merged = m.merged;
  if (m.merged) log(`✓ recoupement : ${m.merged} fiche(s) fusionnée(s) (même lieu, mêmes indices)`);

  // Analyse IA optionnelle (jamais sur les sources marquées noAI)
  await enrichWithLLM(store.records.filter((r) => touched.has(r.id)), sources, opts, log);

  // Re-dérivation de toutes les fiches (récence, overrides) — révisions seulement si changement réel
  store.records = store.records.map((r) => {
    if (!r.evidence.length) return r;
    const before = r;
    const after = derive(r, sources, now, opts.overrides[r.id]);
    const changes = diff(before, after);
    if (changes.length) {
      const last = r.revisions[r.revisions.length - 1];
      if (touched.has(r.id) && last && last.at === now.toISOString()) after.revisions = [...r.revisions.slice(0, -1), { ...last, changes: [...last.changes, ...changes] }];
      else after.revisions = [...r.revisions, { at: now.toISOString(), reason: opts.overrides[r.id] ? "Correction administrateur" : "Réévaluation", changes }];
    }
    if (changes.length) after.updatedAt = now.toISOString();
    return after;
  });
  // Garage des légendes : consolidation automatique des véhicules extraits des guides
  const before = new Set((store.vehicles ?? []).map((v) => v.id));
  store.vehicles = buildVehicles(store.records, sources, store.vehicles ?? [], opts.vehicleOverrides ?? {}, now);
  summary.vehicles = store.vehicles.length;
  summary.newVehicles = store.vehicles.filter((v) => !before.has(v.id)).length;
  if (summary.newVehicles) log(`✓ garage : ${summary.newVehicles} nouveau(x) véhicule(s)/garage(s) · ${store.vehicles.length} au catalogue`);
  store.cycles ??= [];
  store.cycles.push({
    at: now.toISOString(),
    trigger: opts.trigger ?? "local",
    runId: opts.runId ?? null,
    sourcesAttempted: summary.runs.filter((r) => !r.skipped).length,
    sourcesOk: summary.runs.filter((r) => r.ok).length,
    newItems: summary.newItems,
    updatedItems: summary.updatedItems,
    deepReads: summary.deepReads,
    merged: summary.merged,
    vehicles: summary.vehicles ?? 0,
  });
  return summary;
}

function ingest(store: Store, src: SourceConfig, items: CollectedItem[], sources: Map<string, SourceConfig>, now: Date, maxAgeDays: number, filtered: Record<string, number>, touched: Set<string>) {
  let newItems = 0;
  let updated = 0;
  let duplicates = 0;
  const t = now.toISOString();
  for (const it of items) {
    const key = `${src.id}:${it.externalId}`;
    const existing = store.raw[key];

    // Suppression signalée par la source (ex. Reddit) : la preuve est retirée
    if (it.deleted) {
      if (existing) {
        delete store.raw[key];
        for (const r of store.records) {
          if (!r.evidence.some((e) => e.rawKey === key)) continue;
          r.evidence = r.evidence.filter((e) => e.rawKey !== key);
          r.revisions.push({ at: t, reason: "Source supprimée par son auteur ou la plateforme", changes: [`preuve retirée : ${src.name}`] });
          if (!r.evidence.length) r.status = "retracted";
          r.updatedAt = t;
          updated++;
        }
      }
      continue;
    }

    const title = stripHtml(it.title);
    const excerpt = shortExcerpt(it.text);
    const why = relevance({ title, excerpt, publishedAt: it.publishedAt }, src, now, maxAgeDays);
    if (why && !existing) {
      filtered[why] = (filtered[why] ?? 0) + 1;
      continue;
    }
    const hash = sha1(`${title}|${excerpt}`);
    if (existing && existing.hash === hash) {
      existing.fetchedAt = t;
      if (it.metrics) existing.metrics = it.metrics;
      duplicates++;
      continue;
    }
    const raw: RawItem = {
      key,
      sourceId: src.id,
      externalId: it.externalId,
      url: canonicalUrl(it.url),
      title,
      excerpt,
      publishedAt: it.publishedAt,
      fetchedAt: t,
      firstSeenAt: existing?.firstSeenAt ?? t,
      hash,
      author: it.author,
      videoIds: it.videoIds,
      media: it.media,
      metrics: it.metrics,
    };
    store.raw[key] = raw;
    const ev = toEvidence(raw, src);

    if (existing) {
      // La source a changé : mise à jour de la preuve + historique
      for (const r of store.records) {
        const i = r.evidence.findIndex((e) => e.rawKey === key);
        if (i < 0) continue;
        const old = r.evidence[i];
        r.evidence[i] = ev;
        const changes = [old.title !== ev.title ? `titre source : « ${old.title} » → « ${ev.title} »` : "", old.excerpt !== ev.excerpt ? "extrait modifié" : ""].filter(Boolean);
        r.revisions.push({ at: t, reason: `Source modifiée (${src.name})`, changes });
        r.updatedAt = t;
        touched.add(r.id);
      }
      updated++;
      continue;
    }

    const cat = categorize(title, excerpt);
    const horizon = now.getTime() - 14 * 86400_000;
    const target: RadarRecord | undefined = store.records.find((r) => r.status !== "retracted" && Date.parse(r.updatedAt) > horizon && matches(r, ev, cat));
    if (target) {
      target.evidence.push(ev);
      if (raw.media && (!target.media || ev.official)) target.media = raw.media;
      target.revisions.push({ at: t, reason: "Nouvelle preuve rattachée", changes: [`${src.name} : « ${title} »`] });
      target.updatedAt = t;
      touched.add(target.id);
      updated++;
    } else {
      const rec = newRecord(ev, raw, now, cat);
      store.records.push(rec);
      touched.add(rec.id);
      newItems++;
    }
  }
  return { newItems, updated, duplicates };
}

/** Flux public : fiches non retirées, triées par pertinence, sans les données brutes. */
export function buildFeed(store: Store, sources: SourceConfig[], summary: RunSummary | null, now = new Date()): RadarFeed {
  const items = store.records
    .filter((r) => r.status !== "retracted" && r.evidence.length)
    .sort((a, b) => b.score - a.score || b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 300);
  return {
    version: 1,
    generatedAt: now.toISOString(),
    sources: sources.map((s) => {
      const st = store.state[s.id] ?? initState();
      return {
        id: s.id,
        name: s.name,
        kind: s.kind,
        official: s.official,
        status: s.kind === "unsupported" ? "unsupported" : !s.enabled ? "disabled" : st.status,
        statusDetail: s.kind === "unsupported" || !s.enabled ? s.access : st.statusDetail,
        lastSuccessAt: st.lastSuccessAt,
        lastAttemptAt: st.lastAttemptAt,
      };
    }),
    health: { cadenceMinutes: 15, cycles: (store.cycles ?? []).slice(-48) },
    vehicles: store.vehicles ?? [],
    lastRun: summary ? { at: now.toISOString(), newItems: summary.newItems, updatedItems: summary.updatedItems, errors: summary.runs.filter((r) => !r.ok && !r.skipped).length } : null,
    items,
  };
}
