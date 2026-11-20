"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { CATEGORIES, RELIABILITY } from "@/lib/meta";
import type { CategoryId, DiscoveryStatus, Provenance, Reliability } from "@/lib/types";
import { Icon } from "./Icon";

export function ProgressRing({ value, size = 120, stroke = 10, children }: { value: number; size?: number; stroke?: number; children?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <defs>
          <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#FF3D8B" />
            <stop offset="100%" stopColor="#FFB547" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,.08)" strokeWidth={stroke} fill="none" />
        <circle
          className="ring__bar"
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="url(#ringGrad)"
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - Math.min(1, Math.max(0, value)))}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="ring__center">{children}</div>
    </div>
  );
}

export function Bar({ value, color }: { value: number; color?: string }) {
  return (
    <div className="bar">
      <div className="bar__fill" style={{ width: `${Math.round(value * 100)}%`, background: color }} />
    </div>
  );
}

export function CategoryGlyph({ id, size = 34 }: { id: CategoryId; size?: number }) {
  const c = CATEGORIES[id];
  return (
    <span className="glyph" style={{ width: size, height: size, color: c.color, background: `${c.color}1f`, boxShadow: `inset 0 0 0 1px ${c.color}40` }}>
      <Icon name={c.icon} size={Math.round(size * 0.52)} />
    </span>
  );
}

export function DemoBadge({ provenance, compact }: { provenance: Provenance; compact?: boolean }) {
  if (provenance.kind === "official")
    return (
      <span className="badge badge--official" title={`${provenance.source} — vérifié le ${provenance.checkedAt}`}>
        <Icon name="check" size={11} stroke={2.6} /> {compact ? "Officiel" : "Nom officiel"}
      </span>
    );
  if (provenance.kind === "live")
    return <span className="badge badge--live" title="Fiche issue de la veille automatique, point validé">VEILLE</span>;
  if (provenance.kind === "player")
    return <span className="badge badge--player" title="Relevé créé en mode cartographe">MON RELEVÉ</span>;
  return <span className="badge badge--demo" title="Donnée de démonstration fictive">DÉMO</span>;
}

export function ReliabilityBadge({ r, showLabel = false }: { r: Reliability; showLabel?: boolean }) {
  const m = RELIABILITY[r];
  if (r === "personal")
    return (
      <span className="rel rel--personal" title={m.label} data-testid="rel-personal">
        <Icon name="user" size={13} /> {showLabel ? m.label : m.short}
      </span>
    );
  return (
    <span className="rel" style={{ color: m.color }} title={m.label} data-testid={`rel-${r}`}>
      <span className="rel__bars">
        {[1, 2, 3, 4].map((i) => (
          <i key={i} style={{ background: i <= m.level ? m.color : "rgba(255,255,255,.12)", height: 4 + i * 2 }} />
        ))}
      </span>
      {showLabel ? m.label : m.short}
    </span>
  );
}

const STATUS: Record<DiscoveryStatus, { label: string; cls: string; icon: string }> = {
  done: { label: "Terminée", cls: "done", icon: "check" },
  available: { label: "Accessible", cls: "available", icon: "target" },
  locked: { label: "Prérequis manquant", cls: "locked", icon: "lock" },
  chapter: { label: "Plus tard dans l'histoire", cls: "chapter", icon: "clock" },
  hidden: { label: "Masqué (anti-spoiler)", cls: "hidden", icon: "eyeOff" },
};

export function StatusPill({ status }: { status: DiscoveryStatus }) {
  const s = STATUS[status];
  return (
    <span className={`pill pill--${s.cls}`}>
      <Icon name={s.icon} size={13} stroke={2.2} /> {s.label}
    </span>
  );
}

/** Texte protégé : flouté jusqu'au toucher (mode modéré) ou remplacé (mode strict). */
export function SpoilerText({ children, strict, hint }: { children: ReactNode; strict: boolean; hint: string }) {
  const [shown, setShown] = useState(false);
  if (strict) return <span className="spoiler spoiler--strict"><Icon name="shield" size={13} /> {hint}</span>;
  if (shown) return <>{children}</>;
  return (
    <button className="spoiler" onClick={(e) => { e.stopPropagation(); setShown(true); }} aria-label={`Révéler — ${hint}`}>
      <span className="spoiler__blur" aria-hidden>{children}</span>
      <span className="spoiler__hint"><Icon name="eye" size={13} /> {hint} · toucher pour révéler</span>
    </button>
  );
}

export function Segmented<T extends string>({ options, value, onChange, label }: { options: { id: T; label: string }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} role="radio" aria-checked={value === o.id} className={value === o.id ? "is-on" : ""} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function SectionHead({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="shead">
      <h2>{title}</h2>
      {action}
    </div>
  );
}
