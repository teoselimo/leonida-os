"use client";

import { useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { coverageOf, gaugeLabel, simulateLaunch } from "@/lib/story/engine";
import type { SimLine } from "@/lib/story/engine";
import { RESOURCE_FR } from "@/lib/story/model";
import type { ResourceId } from "@/lib/story/model";
import type { Gauge } from "@/lib/types";
import { tick } from "@/lib/motion";

/**
 * « Avant de lancer ma mission » (V0.17) — simulation Story Intelligence, sans changer l'Accueil :
 * ce qui disparaît, l'argent exposé, ce qui se récupère pendant, les choix, ce qui s'ouvre, la suite (sans spoiler),
 * et ce qui N'A PAS été audité. L'argent est facultatif : exact, tranche, ou inconnu.
 */
const BANDS: Array<{ id: string; label: string; g: Gauge | null }> = [
  { id: "unknown", label: "Je ne sais pas", g: null },
  { id: "0", label: "Rien", g: { mode: "exact", value: 0 } },
  { id: "lt1", label: "Moins de 1 000 $", g: { mode: "range", min: 0, max: 1000 } },
  { id: "1-5", label: "1 000 à 5 000 $", g: { mode: "range", min: 1000, max: 5000 } },
  { id: "5-15", label: "5 000 à 15 000 $", g: { mode: "range", min: 5000, max: 15000 } },
  { id: "15-50", label: "15 000 à 50 000 $", g: { mode: "range", min: 15000, max: 50000 } },
  { id: "50-200", label: "50 000 à 200 000 $", g: { mode: "range", min: 50000, max: 200000 } },
  { id: "gt200", label: "Plus de 200 000 $", g: { mode: "range", min: 200000, max: null } },
  { id: "exact", label: "Montant exact…", g: null },
];

const bandOf = (g: Gauge | undefined): string => {
  if (!g) return "unknown";
  if (g.mode === "exact") return g.value === 0 ? "0" : "exact";
  return BANDS.find((b) => b.g?.mode === "range" && b.g.min === g.min && b.g.max === g.max)?.id ?? "exact";
};

function Lines({ title, lines, testid }: { title: string; lines: SimLine[]; testid: string }) {
  if (!lines.length) return null;
  return (
    <div className="slaunch__group" data-testid={testid}>
      <h4>{title}</h4>
      <ul>
        {lines.map((l, i) => (
          <li key={i}>
            <span>{l.text}</span>
            {l.money && <small className="slaunch__money">{l.money}</small>}
            <em>
              <i className={`trust trust--${l.confidence === "Vérifié" ? "ok" : l.confidence === "Probable" ? "warn" : "low"}`}>{l.confidence}</i>
              {l.when && <span>{l.when}</span>}
              {l.sources.slice(0, 2).map((s, j) => <a key={j} href={s.url} target="_blank" rel="noreferrer">{s.name}</a>)}
            </em>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MoneyRow({ res }: { res: ResourceId }) {
  const { state, setMoney } = useStore();
  const g = state.story?.money?.[res];
  const [band, setBand] = useState(bandOf(g));
  const [exact, setExact] = useState(g?.mode === "exact" ? String(g.value) : "");
  return (
    <label className="slaunch__mrow" data-testid={`money-${res}`}>
      <span>{RESOURCE_FR[res].charAt(0).toUpperCase() + RESOURCE_FR[res].slice(1)}</span>
      <select
        value={band}
        onChange={(e) => {
          const id = e.target.value;
          setBand(id);
          if (id === "exact") return;
          tick();
          setMoney(res, BANDS.find((b) => b.id === id)?.g ?? null);
        }}
      >
        {BANDS.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
      </select>
      {band === "exact" && (
        <input
          inputMode="numeric"
          placeholder="Montant en $"
          value={exact}
          aria-label={`Montant exact : ${RESOURCE_FR[res]}`}
          onChange={(e) => setExact(e.target.value.replace(/[^\d]/g, "").slice(0, 9))}
          onBlur={() => exact && setMoney(res, { mode: "exact", value: Number(exact) })}
        />
      )}
    </label>
  );
}

export function StoryLaunch({ mission }: { mission: string }) {
  const { state } = useStore();
  const [open, setOpen] = useState(false);
  const sim = useMemo(() => simulateLaunch(state, mission), [state, mission]);
  const cov = coverageOf(state.profile.chapter);
  const live = !!state.profile.missionInProgress;
  if (!sim) {
    return (
      <p className="slaunch__cov" data-testid="coverage-line">
        « {mission} » n&apos;est pas encore dans le référentiel : aucune alerte ne veut pas dire aucun risque.
      </p>
    );
  }
  const money = state.story?.money ?? {};
  const known = (Object.keys(money) as ResourceId[]).length;
  const resources: ResourceId[] = state.profile.chapter <= 1 ? ["cash", "checking", "stash", "savings"] : ["cash", "checking", "savings"];
  return (
    <div className="slaunch" data-testid="story-launch">
      <button className="slaunch__toggle press" onClick={() => (tick(), setOpen((v) => !v))} aria-expanded={open} data-testid="story-sim-open">
        <span>{live ? `Ce que « ${sim.name} » change` : `Si je lance « ${sim.name} »`}</span>
        <small>
          Couverture : {sim.coverage}
          {sim.pointOfNoReturn ? " · point de non-retour" : ""}
        </small>
      </button>
      {open && (
        <div className="slaunch__body" data-testid="story-sim">
          {sim.pointOfNoReturn && <p className="slaunch__pnr" data-testid="story-pnr">Point de non-retour : l&apos;exploration libre ne revient qu&apos;au chapitre suivant.</p>}
          <Lines title="Ton argent" lines={sim.money} testid="sim-money" />
          <div className="slaunch__moneyedit" data-testid="money-edit">
            <p className="slaunch__hint">Facultatif — {known ? `dernière saisie : ${resources.filter((r) => money[r]).map((r) => `${RESOURCE_FR[r]} ${gaugeLabel(money[r])}`).join(", ")}` : "indique un montant ou une tranche pour calculer ce qui est exposé"}.</p>
            {resources.map((r) => <MoneyRow key={r} res={r} />)}
          </div>
          <Lines title="Disparaît" lines={sim.disappears} testid="sim-gone" />
          <Lines title="Pendant la mission" lines={sim.during} testid="sim-during" />
          <Lines title="Choix" lines={sim.choices} testid="sim-choices" />
          <Lines title="S'ouvre ensuite" lines={sim.opens} testid="sim-opens" />
          {sim.ready.length > 0 && (
            <div className="slaunch__group" data-testid="sim-ready">
              <h4>Déjà fait</h4>
              <ul>{sim.ready.map((t, i) => <li key={i}><span>{t}</span></li>)}</ul>
            </div>
          )}
          <Lines title="Plus tard" lines={sim.later} testid="sim-later" />
          <div className="slaunch__group slaunch__unknown" data-testid="sim-unknowns">
            <h4>Ce qui n&apos;est pas vérifié</h4>
            <ul>
              {sim.unknowns.map((u, i) => <li key={i}><span>{u}</span></li>)}
              <li><span>Couverture du chapitre {cov.chapter} : {cov.level}{cov.missing.length ? ` — reste à auditer : ${cov.missing.join(" ; ")}` : ""}.</span></li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
