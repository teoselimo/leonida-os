"use client";

import { useMemo, useState } from "react";
import { CATEGORIES, CATEGORY_ORDER, CHAPTERS, DIFFICULTY } from "@/lib/meta";
import { repo, useStore } from "@/lib/store";
import { fmtCoord, regionAt } from "@/lib/geo";
import type { CategoryId, Chapter, Discovery } from "@/lib/types";
import { Icon } from "./ui/Icon";
import { Segmented } from "./ui/primitives";
import { asPlayerRecord } from "@/lib/records";

export interface EditorDraft {
  x: number;
  y: number;
  /** Relevé existant à modifier (sinon création). */
  base?: Discovery;
}

/**
 * Formulaire du mode cartographe : créer ou modifier un relevé à l'emplacement choisi sur la carte.
 * Les relevés sont enregistrés sur l'appareil et participent à la progression et aux recommandations.
 */
export function DiscoveryEditor({ draft, onSaved, onCancel }: { draft: EditorDraft; onSaved: (id: string) => void; onCancel: () => void }) {
  const { discoveries, saveCustom, deleteCustom, notify } = useStore();
  const regions = repo.regions();
  const b = draft.base;
  const [title, setTitle] = useState(b?.title ?? "");
  const [category, setCategory] = useState<CategoryId>(b?.category ?? "collectible");
  const [regionId, setRegionId] = useState<string>(b?.regionId ?? regionAt(draft.x, draft.y, regions).id);
  const [summary, setSummary] = useState(b?.summary ?? "");
  const [reward, setReward] = useState(b?.reward ?? "");
  const [duration, setDuration] = useState(String(b?.durationMin ?? 10));
  const [difficulty, setDifficulty] = useState<"1" | "2" | "3">(String(b?.difficulty ?? 1) as "1" | "2" | "3");
  const [chapter, setChapter] = useState<Chapter>(b?.spoilerChapter ?? 0);
  const [prereqs, setPrereqs] = useState<string[]>(b?.prerequisites.flatMap((p) => (p.type === "discovery" ? [p.id] : [])) ?? []);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");

  const nearby = useMemo(
    () =>
      discoveries
        .filter((d) => d.id !== b?.id)
        .map((d) => ({ d, dist: Math.hypot(d.x - draft.x, d.y - draft.y) }))
        .sort((p, q) => p.dist - q.dist)
        .slice(0, 6)
        .map((p) => p.d),
    [discoveries, draft.x, draft.y, b?.id],
  );
  const prereqOptions = [...nearby, ...discoveries.filter((d) => prereqs.includes(d.id) && !nearby.includes(d))];

  const save = () => {
    if (!title.trim()) {
      setError("Donne un nom à ce relevé.");
      return;
    }
    const id = b?.id ?? `p-${Date.now().toString(36)}`;
    const d: Discovery = asPlayerRecord({
      id,
      title: title.trim(),
      category,
      regionId,
      x: Math.round(draft.x),
      y: Math.round(draft.y),
      summary: summary.trim() || "Relevé personnel.",
      prerequisites: [...prereqs.map((p) => ({ type: "discovery" as const, id: p })), ...(chapter > 0 ? [{ type: "chapter" as const, min: chapter }] : [])],
      reward: reward.trim() || "—",
      durationMin: Math.max(1, Math.min(240, parseInt(duration, 10) || 10)),
      difficulty: Number(difficulty) as 1 | 2 | 3,
      spoilerChapter: chapter,
      contentPotential: b?.contentPotential ?? 50,
      provenance: b?.provenance,
    });
    saveCustom(d);
    notify(b ? "Relevé mis à jour" : "Relevé ajouté à la carte", `${d.title} · ${regions.find((r) => r.id === regionId)!.name}`, "flag");
    onSaved(id);
  };

  return (
    <div className="detail editor" data-testid="editor">
      <div className="detail__top">
        <span className="glyph glyph--carto"><Icon name="flag" size={22} /></span>
        <div className="detail__meta"><span className="cartotag">Mode cartographe</span><span className="dot" /><span>{fmtCoord(draft.x, draft.y)}</span></div>
        <button className="iconbtn" onClick={onCancel} aria-label="Annuler"><Icon name="close" /></button>
      </div>
      <h3 className="detail__title">{b ? "Modifier le relevé" : "Nouveau relevé"}</h3>
      <p className="muted small">Glisse le point sur la carte pour ajuster sa position.</p>

      <label className="field">
        <span>Nom</span>
        <input value={title} maxLength={60} onChange={(e) => { setTitle(e.target.value); setError(""); }} placeholder="Ex. Coffre caché sous le ponton" data-testid="editor-title" />
      </label>
      {error && <p className="formerror">{error}</p>}

      <div className="block">
        <h4>Catégorie</h4>
        <div className="catpick">
          {CATEGORY_ORDER.map((c) => (
            <button key={c} className={category === c ? "is-on" : ""} style={{ ["--c" as string]: CATEGORIES[c].color }} onClick={() => setCategory(c)} aria-pressed={category === c}>
              <Icon name={CATEGORIES[c].icon} size={16} /> {CATEGORIES[c].label}
            </button>
          ))}
        </div>
      </div>

      <label className="field">
        <span>Région</span>
        <select value={regionId} onChange={(e) => setRegionId(e.target.value)}>
          {regions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </label>

      <label className="field">
        <span>Description</span>
        <textarea rows={2} value={summary} maxLength={280} onChange={(e) => setSummary(e.target.value)} placeholder="Comment y accéder, quoi chercher…" />
      </label>

      <label className="field">
        <span>Récompense</span>
        <input value={reward} maxLength={80} onChange={(e) => setReward(e.target.value)} placeholder="Ex. 2 500 $, tenue, véhicule…" />
      </label>

      <div className="row gap8">
        <label className="field" style={{ width: 110 }}>
          <span>Durée (min)</span>
          <input inputMode="numeric" value={duration} onChange={(e) => setDuration(e.target.value.replace(/\D/g, ""))} />
        </label>
        <div className="field" style={{ flex: 1 }}>
          <span>Difficulté</span>
          <Segmented<"1" | "2" | "3"> label="Difficulté" value={difficulty} onChange={setDifficulty} options={[1, 2, 3].map((n) => ({ id: String(n) as "1" | "2" | "3", label: DIFFICULTY[n] }))} />
        </div>
      </div>

      <div className="block">
        <h4>Disponible à partir de</h4>
        <Segmented<string> label="Repère narratif" value={String(chapter)} onChange={(v) => setChapter(Number(v) as Chapter)} options={([0, 1, 2, 3] as Chapter[]).map((c) => ({ id: String(c), label: CHAPTERS[c] }))} />
        <p className="muted small" style={{ marginTop: 6 }}>Au-delà de ta progression, ce relevé sera masqué par l&apos;anti-spoiler.</p>
      </div>

      {prereqOptions.length > 0 && (
        <div className="block">
          <h4>Prérequis (découvertes proches)</h4>
          <div className="prereqpick">
            {prereqOptions.map((d) => {
              const on = prereqs.includes(d.id);
              return (
                <button key={d.id} className={on ? "is-on" : ""} onClick={() => setPrereqs((p) => (on ? p.filter((x) => x !== d.id) : [...p, d.id]))} aria-pressed={on}>
                  <Icon name={on ? "check" : "plus"} size={14} stroke={2.4} /> {d.title}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="detail__cta">
        <button className="btn btn--primary" onClick={save} data-testid="editor-save"><Icon name="check" size={18} stroke={2.6} /> {b ? "Enregistrer" : "Ajouter à la carte"}</button>
        {b && (confirmDelete ? (
          <div className="row gap8">
            <button className="btn btn--danger btn--sm" style={{ flex: 1 }} onClick={() => { deleteCustom(b.id); onCancel(); }}>Supprimer définitivement</button>
            <button className="btn btn--ghost btn--sm" onClick={() => setConfirmDelete(false)}>Non</button>
          </div>
        ) : (
          <button className="btn btn--ghost btn--sm" onClick={() => setConfirmDelete(true)}>Supprimer ce relevé</button>
        ))}
      </div>
      <p className="fineprint">Enregistré sur cet appareil. Exportable depuis Profil › Mes relevés.</p>
    </div>
  );
}
