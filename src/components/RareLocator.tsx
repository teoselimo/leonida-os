"use client";

import { useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { useRedact } from "@/lib/useRedact";
import { tick } from "@/lib/motion";
import { ACCESS_RVL_FR, orderKey, rvlView, v016Check, type RvlVehicle } from "@/lib/rvl";
import { independentFor, type Evidence, type PlayerProof } from "@/lib/evidence";
import type { VehicleState } from "@/lib/types";
import { Icon } from "./ui/Icon";

const STEPS: Array<{ st: VehicleState; label: string; done: string; tid: string }> = [
  { st: "spotted", label: "Je l'ai trouvé", done: "Trouvé", tid: "rvl-found" },
  { st: "stolen", label: "Je l'ai récupéré", done: "Récupéré", tid: "rvl-got" },
  { st: "registered", label: "Je l'ai conservé", done: "Conservé", tid: "rvl-kept" },
];
const RANK: Record<VehicleState, number> = { spotted: 0, stolen: 1, registered: 2, stored: 3 };
const PLATFORM_FR: Record<Evidence["platform"], string> = { guide: "Guide", video: "Vidéo", reddit: "Reddit", instagram: "Instagram", capture: "Capture de carte", joueur: "Joueur", officiel: "Officiel" };
const SWATCH: Record<string, string> = { "variant:vert": "#5BE03A", "variant:rouge": "#E0332E", "variant:clair": "#ECEAE4", "variant:argent": "#C4C8CF" };

/** Réduit une image (JPEG) pour la sauvegarde : jamais l'original. */
async function shrink(file: File, max = 960): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const k = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * k);
    c.height = Math.round(img.height * k);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.62);
  } finally {
    URL.revokeObjectURL(url);
  }
}

const newProof = (p: Omit<PlayerProof, "id" | "at">): PlayerProof => ({ ...p, id: Math.random().toString(36).slice(2, 9), at: new Date().toISOString() });

/** Visuel principal : capture du joueur si elle existe ; sinon la vidéo qui montre la voiture exacte (lien), jamais une illustration inventée. */
export function RvlHero({ r, onClose }: { r: RvlVehicle; onClose: () => void }) {
  const { state, addProof, notify } = useStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const mine = (state.proofs?.[r.id] ?? []).filter((p) => p.kind === "capture");
  const shot = mine[mine.length - 1];
  const v = r.visual;
  const col = SWATCH[r.variants[0]?.claim ?? ""] ?? "#ff3d8b";
  return (
    <div className={`rvlhero${shot ? " has-shot" : ""}`} data-testid="rvl-hero" style={{ ["--c" as string]: col }}>
      {shot ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={shot.value} alt={`${r.name} : ta capture`} data-testid="rvl-hero-img" />
      ) : (
        <div className="rvlhero__ph">
          <i className="rvlhero__swatch" aria-hidden />
          <strong>{r.variants[0]?.label ?? r.name}</strong>
          <span>{v.video.shows}</span>
        </div>
      )}
      <div className="rvlhero__bar">
        {shot ? (
          <span className="rvlhero__credit">Ta capture · GTA VI</span>
        ) : (
          <a className="rvlhero__video" href={v.video.url} target="_blank" rel="noreferrer" data-testid="rvl-video">
            <Icon name="arrow" size={13} /> Voir la voiture · {v.video.creator}
          </a>
        )}
        <button className="rvlhero__add" onClick={() => fileRef.current?.click()} data-testid="rvl-hero-add">
          <Icon name="plus" size={13} /> {shot ? "Changer" : "Ma capture"}
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        data-testid="rvl-hero-file"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          addProof(r.id, newProof({ kind: "capture", value: await shrink(f), note: "visuel" }));
          notify("Capture ajoutée", "Elle sert d'image à la fiche, gardée dans ta partie uniquement.", "check");
          e.target.value = "";
        }}
      />
      <button className="iconbtn vmedia__close" onClick={onClose} aria-label="Fermer"><Icon name="close" /></button>
    </div>
  );
}

export function RareLocator({ r, onMap, onStore }: { r: RvlVehicle; onMap: () => void; onStore: () => void }) {
  const { state, setVehicle, setDone, notify, celebrate, addProof } = useStore();
  const red = useRedact();
  const x = rvlView(r, state);
  const prog = state.vehicles[r.id];
  const [proofs, setProofs] = useState(false);
  const [method, setMethod] = useState(false);
  const [adding, setAdding] = useState(false);
  const [link, setLink] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const mine = state.proofs?.[r.id] ?? [];
  const loc = r.locations[0];
  const cmp = v016Check(loc);
  const series = r.condition.series;

  const mark = (st: VehicleState) => {
    tick(12);
    setVehicle(r.id, st);
    celebrate(st === "spotted" ? "Véhicule trouvé" : st === "stolen" ? "Véhicule récupéré" : "Véhicule conservé");
    notify(`${r.name} · ${STEPS.find((s) => s.st === st)!.done}`, undefined, "car");
  };
  const saveProof = (p: Omit<PlayerProof, "id" | "at">) => {
    addProof(r.id, newProof(p));
    setAdding(false);
    setLink("");
    notify("Preuve ajoutée", "Gardée dans ta partie, jamais comptée comme source.", "check");
  };

  return (
    <div className="rvl" data-testid="rvl">
      <div className={`rvl__access rvl__access--${x.access}`} data-testid="rvl-access">
        <Icon name={x.access === "now" ? "check" : "lock"} size={14} /> <strong>{ACCESS_RVL_FR[x.access]}</strong>
        <span data-testid="rvl-condition">{red(x.condition)}</span>
        {series && x.access !== "later" && (
          <span className="rvl__place" data-testid="rvl-place">
            {x.place} {x.mission && red(x.mission)}
          </span>
        )}
        {series && (x.access === "order-pending" || x.orderReceived) && (
          <button className={`btn btn--sm${x.orderReceived ? " is-on" : ""}`} onClick={() => setDone(orderKey(r.id), !x.orderReceived)} aria-pressed={x.orderReceived} data-testid="rvl-order">
            <Icon name={x.orderReceived ? "check" : "flag"} size={14} /> {x.orderReceived ? "Commande reçue" : "Moses m'a envoyé cette commande"}
          </button>
        )}
      </div>

      <div className="rvl__trust" data-testid="rvl-trust">
        <div><span>Existence</span><strong>{x.existence.trust}</strong><em>{x.existence.sources} sources indép.</em></div>
        <div><span>Emplacement</span><strong data-testid="rvl-loc-trust">{x.location.short}</strong><em>{x.location.tested ? "relevé en jeu" : "pas encore testé en jeu"}</em></div>
        <div><span>Présence</span><strong data-testid="rvl-presence">{x.presence.guaranteed ? "Garantie" : "Non garantie"}</strong><em>{x.presence.label}</em></div>
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
        <h4><Icon name="map" size={14} /> Où aller</h4>
        <p><strong>{loc.label}</strong><br /><span className="muted small">{loc.area}</span></p>
        <div className="row gap8 wrap">
          <span className={`rvl__chip rvl__chip--${loc.precision}`} data-testid="rvl-precision">{x.location.label}</span>
        </div>
        <p className="small">{loc.presenceNote}</p>
        {cmp && (
          <p className="small muted" data-testid="rvl-v016">
            V0.16 : zone de {Math.round(loc.v016!.radius * 2)} m {cmp.contained ? `qui contenait bien la voiture (centre à ${cmp.offM} m)` : `qui ne contenait pas la voiture (décalée de ${cmp.offM} m)`}.
          </p>
        )}
        {!loc.v016 && <p className="small muted" data-testid="rvl-v016">V0.16 : aucune position (lieu non trouvé sur notre carte).</p>}
        <button className="vsec__toggle" onClick={() => setMethod((m) => !m)} aria-expanded={method} data-testid="rvl-method-toggle">
          <span className="small">Comment cette position a été établie</span>
          <Icon name="chevronRight" size={14} />
        </button>
        {method && (
          <div className="small" data-testid="rvl-method">
            {loc.route && <p>{loc.route.note}</p>}
            {loc.point && (
              <>
                <p>{loc.point.methodNote}</p>
                <p className="muted">Contrôle : {loc.point.check}</p>
                <p className="muted">Relevé du {loc.point.date.split("-").reverse().join("/")} · statut : {loc.point.status === "teste-en-jeu" ? "testé en jeu" : "calibré depuis des captures, à confirmer en jeu"}.</p>
              </>
            )}
            <p className="muted">{loc.zoneBasis}</p>
          </div>
        )}
      </section>

      <section className="vsec" data-testid="rvl-howto">
        <h4><Icon name="flag" size={14} /> Comment faire</h4>
        <ol className="vsteps">{loc.steps.map((t) => <li key={t}>{red(t)}</li>)}</ol>
        {loc.risks.length > 0 && <ul className="vlist">{loc.risks.map((t) => <li key={t} className="is-warn">{t}</li>)}</ul>}
        {series && x.access !== "later" && !x.masked && <p className="small muted" data-testid="rvl-order-note">{series.orderNote}</p>}
      </section>

      <section className="vsec" data-testid="rvl-keep">
        <h4><Icon name="shieldCheck" size={14} /> Le garder</h4>
        <p>{r.keep.possible === "oui" ? `Oui, dès le chapitre ${r.keep.chapterMin}. ` : r.keep.possible === "non" ? "Non. " : "Non établi par les sources. "}{red(r.keep.how)}</p>
        {r.reward && <p className="small muted">Prime : {r.reward}</p>}
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
                  <span className="muted small">{PLATFORM_FR[e.platform]}{e.origin ? ` · même origine : ${e.origin}` : ""}{e.stance === "nuance" ? " · nuance" : e.stance === "contredit" ? " · contredit" : ""}</span><br />
                  {e.url ? <a href={e.url} target="_blank" rel="noreferrer">{e.creator}</a> : e.creator} : {red(e.says)}
                </li>
              ))}
            </ul>
            <p className="small muted">Les reposts et les pages d&apos;une même origine ne comptent qu&apos;une fois ({independentFor(r.evidence, loc.claims.location).length} pour l&apos;emplacement). Relevé le 23/11/2026.</p>
            <p className="small muted" data-testid="rvl-rights">Image : {r.visual.rightsNote}</p>
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
                <input ref={fileRef} type="file" accept="image/*" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) saveProof({ kind: "capture", value: await shrink(f, 640), note: "" }); }} />
                <p className="small muted">Gardée dans ta partie uniquement. Aucune extraction automatique : elle sert de trace, pas de source vérifiée.</p>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
