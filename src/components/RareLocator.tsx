"use client";

import { useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { useRedact } from "@/lib/useRedact";
import { tick } from "@/lib/motion";
import { ACCESS_RVL_FR, PRECISION_RVL_FR, PRESENCE_FR, ZONEKIND_FR, rvlView, type RvlVehicle } from "@/lib/rvl";
import { independentFor, trustFor, type Evidence, type PlayerProof } from "@/lib/evidence";
import type { VehicleState } from "@/lib/types";
import { Icon } from "./ui/Icon";

const STEPS: Array<{ st: VehicleState; label: string; done: string; tid: string }> = [
  { st: "spotted", label: "Je l'ai trouvé", done: "Trouvé", tid: "rvl-found" },
  { st: "stolen", label: "Je l'ai récupéré", done: "Récupéré", tid: "rvl-got" },
  { st: "registered", label: "Je l'ai conservé", done: "Conservé", tid: "rvl-kept" },
];
const RANK: Record<VehicleState, number> = { spotted: 0, stolen: 1, registered: 2, stored: 3 };
const PLATFORM_FR: Record<Evidence["platform"], string> = { guide: "Guide", video: "Vidéo", reddit: "Reddit", instagram: "Instagram", capture: "Capture", joueur: "Joueur", officiel: "Officiel" };

/** Réduit une image à 640 px (JPEG) pour la sauvegarde : jamais l'original. */
async function shrink(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const k = Math.min(1, 640 / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * k);
    c.height = Math.round(img.height * k);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.6);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function RareLocator({ r, onMap, onStore }: { r: RvlVehicle; onMap: () => void; onStore: () => void }) {
  const { state, setVehicle, notify, celebrate, addProof } = useStore();
  const red = useRedact();
  const x = rvlView(r, state);
  const prog = state.vehicles[r.id];
  const [proofs, setProofs] = useState(false);
  const [adding, setAdding] = useState(false);
  const [link, setLink] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const mine = state.proofs?.[r.id] ?? [];
  const loc = r.locations[0];
  const locTrust = trustFor(r.evidence, loc.claims.location);
  const presTrust = trustFor(r.evidence, loc.claims.presence);

  const mark = (st: VehicleState) => {
    tick(12);
    setVehicle(r.id, st);
    celebrate(st === "spotted" ? "Véhicule trouvé" : st === "stolen" ? "Véhicule récupéré" : "Véhicule conservé");
    notify(`${r.name} · ${STEPS.find((s) => s.st === st)!.done}`, undefined, "car");
  };
  const saveProof = (p: Omit<PlayerProof, "id" | "at">) => {
    addProof(r.id, { ...p, id: Math.random().toString(36).slice(2, 9), at: new Date().toISOString() });
    setAdding(false);
    setLink("");
    notify("Preuve ajoutée", "Gardée dans ta partie, jamais comptée comme source.", "check");
  };

  return (
    <div className="rvl" data-testid="rvl">
      <div className={`rvl__access rvl__access--${x.access}`} data-testid="rvl-access">
        <Icon name={x.access === "now" ? "check" : "lock"} size={14} /> <strong>{ACCESS_RVL_FR[x.access]}</strong>
        <span data-testid="rvl-condition">{red(x.condition)}</span>
      </div>

      <div className="vactions">
        <button className="btn btn--primary btn--sm" onClick={onMap} disabled={loc.precision === "inconnue"} data-testid="rvl-map">
          <Icon name="map" size={16} /> Voir sur la carte
        </button>
        {STEPS.map((s) => {
          const reached = prog ? RANK[prog.state] >= RANK[s.st] : false;
          const blocked = s.st === "registered" && r.keep.possible === "non";
          return (
            <button key={s.st} className={`btn btn--sm${reached ? " is-on" : ""}`} aria-pressed={reached} disabled={reached || blocked} onClick={() => mark(s.st)} data-testid={s.tid}>
              <Icon name={reached ? "check" : "flag"} size={15} /> {reached ? s.done : s.label}
            </button>
          );
        })}
        {prog?.state === "registered" && <button className="btn btn--sm" onClick={onStore} data-testid="v-keep">Ranger au garage</button>}
        {prog && <button className="link small" onClick={() => setVehicle(r.id, null)} data-testid="rvl-reset">Réinitialiser</button>}
      </div>

      <section className="vsec" data-testid="rvl-location">
        <h4><Icon name="map" size={14} /> Où le trouver</h4>
        {r.locations.map((l) => (
          <div key={l.id} className="rvl__loc" data-testid={`rvl-loc-${l.id}`}>
            <p><strong>{l.label}</strong><br /><span className="muted small">{l.area}</span></p>
            <div className="row gap8 wrap">
              <span className={`rvl__chip rvl__chip--${l.precision}`} data-testid="rvl-precision">{PRECISION_RVL_FR[l.precision]}{l.zoneKind ? ` · ${ZONEKIND_FR[l.zoneKind]}` : ""}{l.zone ? ` (~${Math.round((l.zone.radius * 2) / 10) * 10} m)` : ""}</span>
              <span className={`rvl__chip rvl__chip--${l.presence}`} data-testid="rvl-presence">{PRESENCE_FR[l.presence]}</span>
            </div>
            <p className="small">{l.presenceNote}{presTrust.nuanced && l.presence !== "fixe" ? " Les sources ne décrivent pas toutes la même situation : vérifie sur place." : ""}</p>
            <p className="small muted" data-testid="rvl-basis"><Icon name="info" size={12} /> {l.zoneBasis}</p>
          </div>
        ))}
        <p className="small" data-testid="rvl-trust">
          Emplacement : <strong>{locTrust.trust}</strong> · {locTrust.independent} source{locTrust.independent > 1 ? "s" : ""} indépendante{locTrust.independent > 1 ? "s" : ""}
        </p>
      </section>

      <section className="vsec" data-testid="rvl-howto">
        <h4><Icon name="flag" size={14} /> Comment faire</h4>
        <ol className="vsteps">{loc.steps.map((t) => <li key={t}>{red(t)}</li>)}</ol>
        {loc.risks.length > 0 && <ul className="vlist">{loc.risks.map((t) => <li key={t} className="is-warn">{t}</li>)}</ul>}
      </section>

      <section className="vsec" data-testid="rvl-keep">
        <h4><Icon name="shieldCheck" size={14} /> Le garder</h4>
        <p>{r.keep.possible === "oui" ? `Oui, dès le chapitre ${r.keep.chapterMin}. ` : r.keep.possible === "non" ? "Non. " : "Non établi par les sources. "}{red(r.keep.how)}</p>
        {r.reward && <p className="small muted">Prime : {r.reward}</p>}
        {r.variants.length > 0 && <p className="small muted">Variante documentée : {r.variants.map((v) => v.label).join(" · ")}</p>}
      </section>

      <section className="vsec">
        <button className="vsec__toggle" onClick={() => setProofs((p) => !p)} aria-expanded={proofs} data-testid="rvl-proofs-toggle">
          <h4><Icon name="info" size={14} /> Preuves ({x.sources} source{x.sources > 1 ? "s" : ""} indépendante{x.sources > 1 ? "s" : ""}{mine.length ? ` · ${mine.length} de toi` : ""})</h4>
          <Icon name="chevronRight" size={16} />
        </button>
        {proofs && (
          <div data-testid="rvl-proofs">
            <ul className="vlist">
              {r.evidence.map((e) => (
                <li key={e.id} data-testid="rvl-ev">
                  <span className="muted small">{PLATFORM_FR[e.platform]}{e.origin ? ` · reprend ${e.origin}` : ""}{e.stance === "nuance" ? " · nuance" : e.stance === "contredit" ? " · contredit" : ""}</span><br />
                  {e.url ? <a href={e.url} target="_blank" rel="noreferrer">{e.creator}</a> : e.creator} : {red(e.says)}
                </li>
              ))}
            </ul>
            <p className="small muted">Les reposts et les pages d&apos;un même site ne comptent qu&apos;une fois ({independentFor(r.evidence, loc.claims.location).length} pour l&apos;emplacement). Relevé le 23/11/2026.</p>
            {mine.map((p) => (
              <div key={p.id} className="rvl__mine" data-testid="rvl-mine">
                {p.kind === "capture" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.value} alt="Ta capture" />
                ) : (
                  <a href={p.value} target="_blank" rel="noreferrer">{p.value}</a>
                )}
                <button className="link small" onClick={() => addProof(r.id, null, p.id)}>Retirer</button>
              </div>
            ))}
            {!adding ? (
              <button className="btn btn--sm" onClick={() => setAdding(true)} data-testid="rvl-add-proof"><Icon name="plus" size={14} /> Ajouter une preuve</button>
            ) : (
              <div className="rvl__add" data-testid="rvl-add">
                <input className="input" placeholder="Lien (vidéo, publication, guide)" value={link} onChange={(e) => setLink(e.target.value)} inputMode="url" data-testid="rvl-link" />
                <div className="row gap8 wrap">
                  <button className="btn btn--sm btn--primary" disabled={!/^https?:\/\/\S+\.\S+/.test(link.trim())} onClick={() => saveProof({ kind: "lien", value: link.trim(), note: "" })} data-testid="rvl-link-ok">Ajouter le lien</button>
                  <button className="btn btn--sm" onClick={() => fileRef.current?.click()}><Icon name="plus" size={14} /> Capture</button>
                  <button className="link small" onClick={() => setAdding(false)}>Annuler</button>
                </div>
                <input ref={fileRef} type="file" accept="image/*" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) saveProof({ kind: "capture", value: await shrink(f), note: "" }); }} />
                <p className="small muted">Gardée dans ta partie uniquement. Aucune extraction automatique : elle sert de trace, pas de source vérifiée.</p>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
