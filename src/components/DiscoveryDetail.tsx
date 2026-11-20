"use client";

import { CATEGORIES, CHAPTERS, DIFFICULTY } from "@/lib/meta";
import { statusOf, wouldUnlock } from "@/lib/engine";
import { repo, useStore } from "@/lib/store";
import { Icon } from "./ui/Icon";
import { CategoryGlyph, DemoBadge, ReliabilityBadge, SpoilerText, StatusPill } from "./ui/primitives";

export function DiscoveryDetail({ id, onClose, onEdit }: { id: string; onClose: () => void; onEdit?: (id: string) => void }) {
  const { state, complete, undo, focusOnMap, discoveries: all } = useStore();
  const d = all.find((x) => x.id === id);
  if (!d) return null;
  const region = repo.regions().find((r) => r.id === d.regionId)!;
  const status = statusOf(d, state);
  const cat = CATEGORIES[d.category];
  const strict = state.profile.spoilerMode === "strict";
  const unlocks = status === "available" ? wouldUnlock(d.id, all, state) : [];

  if (status === "hidden") {
    return (
      <div className="detail">
        <div className="detail__top">
          <span className="glyph glyph--fog">?</span>
          <button className="iconbtn" onClick={onClose} aria-label="Fermer"><Icon name="close" /></button>
        </div>
        <h3 className="detail__title">
          <SpoilerText strict={strict} hint="Découverte masquée">{d.title}</SpoilerText>
        </h3>
        <p className="muted">
          {region.name} · Liée à « {CHAPTERS[d.spoilerChapter]} ». Le contenu reste masqué tant que ta progression narrative n&apos;a pas atteint ce repère.
        </p>
        <div className="note"><Icon name="shield" size={16} /> Anti-spoiler {strict ? "strict" : "modéré"} actif — réglable dans Profil.</div>
      </div>
    );
  }

  return (
    <div className="detail" data-testid="detail">
      <div className="detail__top">
        <CategoryGlyph id={d.category} size={44} />
        <div className="detail__meta">
          <span style={{ color: cat.color }}>{cat.label}</span>
          <span className="dot" />
          <span>{region.name}</span>
        </div>
        <button className="iconbtn" onClick={onClose} aria-label="Fermer"><Icon name="close" /></button>
      </div>

      <h3 className="detail__title">{d.title}</h3>
      <div className="row gap8 wrap">
        <StatusPill status={status} />
        <DemoBadge provenance={d.provenance} />
      </div>
      <p className="detail__summary">{d.summary}</p>

      <div className="facts">
        <div><Icon name="clock" size={16} /><span>~{d.durationMin} min</span></div>
        <div><Icon name="signal" size={16} /><span>{DIFFICULTY[d.difficulty]}</span></div>
        <div><ReliabilityBadge r={d.source.reliability} /></div>
      </div>

      <div className="block">
        <h4>Prérequis</h4>
        {d.prerequisites.length === 0 && <p className="ok"><Icon name="check" size={15} stroke={2.4} /> Aucun — accessible tout de suite</p>}
        <ul className="prereq">
          {d.prerequisites.map((p, i) => {
            if (p.type === "chapter") {
              const met = state.profile.chapter >= p.min;
              return (
                <li key={i} className={met ? "is-met" : ""}>
                  <span className="prereq__icon"><Icon name={met ? "check" : "clock"} size={14} stroke={2.4} /></span>
                  Progression narrative : {CHAPTERS[p.min]}
                </li>
              );
            }
            const pd = all.find((x) => x.id === p.id)!;
            const met = Boolean(state.completed[p.id]);
            return (
              <li key={i} className={met ? "is-met" : ""}>
                <button onClick={() => focusOnMap(pd.id)} data-testid={`prereq-${pd.id}`}>
                  <span className="prereq__icon"><Icon name={met ? "check" : "lock"} size={14} stroke={2.4} /></span>
                  {pd.title}
                  {!met && <span className="prereq__go">Voir <Icon name="chevronRight" size={14} /></span>}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="block reward">
        <h4>Récompense</h4>
        <p><Icon name="trophy" size={16} /> {d.reward}</p>
        {unlocks.length > 0 && (
          <p className="unlockhint"><Icon name="sparkle" size={15} /> Débloque : {unlocks.map((u) => u.title).join(", ")}</p>
        )}
      </div>

      <div className="detail__cta">
        {status === "done" ? (
          <>
            <div className="donebanner"><Icon name="check" size={18} stroke={2.6} /> Terminée le {new Date(state.completed[d.id]).toLocaleDateString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</div>
            <button className="btn btn--ghost" onClick={() => undo(d.id)}><Icon name="undo" size={16} /> Annuler</button>
          </>
        ) : (
          <button className="btn btn--primary" disabled={status !== "available"} onClick={() => complete(d.id)} data-testid="complete-btn">
            <Icon name="check" size={18} stroke={2.6} />
            {status === "available" ? "Découverte terminée" : "Prérequis manquants"}
          </button>
        )}
      </div>
      {d.provenance.kind === "live" ? (
        <p className="fineprint">
          Fiche de veille automatique · {d.source.label} · <a href={d.provenance.url} target="_blank" rel="noreferrer">Ouvrir la preuve</a> · point vérifié par un administrateur.
        </p>
      ) : d.provenance.kind === "player" ? (
        <div className="row between">
          <p className="fineprint">Relevé personnel · créé le {new Date(d.provenance.createdAt).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}</p>
          {onEdit && <button className="link" onClick={() => onEdit(d.id)} data-testid="edit-btn"><Icon name="flag" size={14} /> Modifier</button>}
        </div>
      ) : (
        <p className="fineprint">Source : {d.source.label}. Contenu fictif de démonstration.</p>
      )}
    </div>
  );
}
