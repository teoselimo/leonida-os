"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import { useLiveRadar } from "@/lib/live";
import { assetUrl } from "@/lib/gtadb";
import { COMPAT_FR, KIND_FR, keepText, STATE_FR, STATE_ORDER, viewOf } from "@/lib/garage";
import type { VehicleRecord } from "@/lib/garage";
import type { VehicleState } from "@/lib/types";
import { CHAPTERS } from "@/lib/meta";
import { Icon } from "./ui/Icon";
import { ReliabilityBadge, SpoilerText } from "./ui/primitives";

const COLORS: Record<string, string> = { green: "#3ddc6b", blue: "#4d8dff", red: "#ff4d5e", yellow: "#ffd23f", orange: "#ff8a3d", purple: "#a96bff", pink: "#ff5fb0", white: "#f2f2f7", black: "#222", silver: "#c0c4cc", gold: "#d8b14a", teal: "#2ee6d6" };
const swatch = (variant: string | undefined) => COLORS[Object.keys(COLORS).find((c) => variant?.includes(c)) ?? ""] ?? null;

function Quote({ r }: { r: { sourceName: string; url: string; quote: string } }) {
  return (
    <q className="vq">
      « {r.quote} » <a href={r.url} target="_blank" rel="noreferrer">{r.sourceName}</a>
    </q>
  );
}

/** URL de demande de validation d'un point (aucune épingle exacte sans validation humaine). */
export function validatePointUrl(v: VehicleRecord): string {
  const body = [
    `Véhicule : ${v.name} (${v.id})`,
    `Emplacement cité : ${v.location.text?.value ?? "—"}`,
    v.location.zone ? `Zone actuelle : ${v.location.district}, centre x=${v.location.zone.x} y=${v.location.zone.y}, rayon ${v.location.zone.radius}` : "Aucune zone : indiquer le point relevé en jeu.",
    "",
    "Preuves :",
    ...v.evidence.map((e) => `- ${e.sourceName} : ${e.url}`),
    "",
    "Remplacez x et y par le point relevé en jeu, puis ajoutez l'étiquette « validé » : le point est appliqué automatiquement.",
    "```json",
    JSON.stringify({ vehicle: v.id, point: { x: v.location.zone?.x ?? 0, y: v.location.zone?.y ?? 0 } }),
    "```",
  ].join("\n");
  return `https://github.com/teoselimo/leonida-os/issues/new?labels=validation-point&title=${encodeURIComponent(`Point à valider : ${v.name}`)}&body=${encodeURIComponent(body)}`;
}

export function VehicleSheet({ id, onClose, onGuide }: { id: string; onClose: () => void; onGuide: (id: string) => void }) {
  const { state, setVehicle, notify } = useStore();
  const { feed } = useLiveRadar();
  const [proofs, setProofs] = useState(false);
  const [storing, setStoring] = useState(false);
  const v = feed?.vehicles?.find((x) => x.id === id);
  if (!v) return null;
  const x = viewOf(v, state);
  const prog = state.vehicles[v.id];
  const capture = (v as VehicleRecord & { capture?: { src: string; credit: string; alt?: string } }).capture;
  const variant = v.variant?.value;
  const sw = swatch(variant);
  const ownedGarages = (feed?.vehicles ?? []).filter((g) => g.type === "garage" && state.vehicles[g.id] && state.vehicles[g.id].state !== "spotted");

  const go = (st: VehicleState, storage?: string) => {
    setVehicle(v.id, st, storage);
    notify(`${v.name} · ${STATE_FR[st]}`, st === "stolen" && v.keep.mode === "register" ? keepText(v) : st === "stored" && storage ? `Rangé : ${storage}` : undefined, "car");
  };

  if (x.hidden) {
    return (
      <div className="vsheet" data-testid="vehicle-sheet">
        <div className="vsheet__top"><span className="glyph glyph--fog">?</span><button className="iconbtn" onClick={onClose} aria-label="Fermer"><Icon name="close" /></button></div>
        <h3 className="detail__title"><SpoilerText strict hint="Véhicule masqué">{v.name}</SpoilerText></h3>
        <p className="muted">Disponible à partir du {CHAPTERS[Math.min(6, x.need) as 0]}. Masqué par l&apos;anti-spoiler tant que tu n&apos;y es pas.</p>
      </div>
    );
  }

  return (
    <div className="vsheet" data-testid="vehicle-sheet">
      <div className="vmedia">
        {capture ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={assetUrl(capture.src)} alt={capture.alt ?? v.name} />
        ) : v.media ? (
          <a href={v.media.url} target="_blank" rel="noreferrer" aria-label="Voir la vidéo sur YouTube">
            {/* Miniature hébergée par YouTube, créditée, jamais recopiée */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={v.media.thumbnail} alt="" loading="lazy" />
            <span className="live-thumb__play"><Icon name="arrow" size={18} /></span>
          </a>
        ) : (
          <div className="vmedia__ph" style={{ ["--c" as string]: sw ?? "#ff3d8b" }}>
            <Icon name="car" size={44} stroke={1.6} />
            <span>Aucune capture autorisée pour l&apos;instant</span>
          </div>
        )}
        <span className="vmedia__credit">{capture ? `Capture © ${capture.credit}` : v.media ? `© ${v.media.credit} · YouTube` : "Ajoute ta capture : public/gameplay/"}</span>
        <button className="iconbtn vmedia__close" onClick={onClose} aria-label="Fermer"><Icon name="close" /></button>
      </div>

      <div className="vhead">
        <div className="row gap8 wrap">
          <ReliabilityBadge r={v.reliability} />
          {v.edition.exclusive === "ultimate" && <span className={`edtag${v.edition.status === "confirmed" ? "" : " is-check"}`} data-testid="ultimate-tag">ULTIMATE{v.edition.status === "confirmed" ? "" : " ?"}</span>}
          {v.edition.exclusive === "preorder" && <span className="edtag edtag--pre">PRÉCOMMANDE</span>}
          <span className="small muted">{v.type === "garage" ? "Garage" : KIND_FR[v.kind]}</span>
        </div>
        <h3 className="detail__title" data-testid="vehicle-name">{v.name}</h3>
        <p className="muted small">
          {variant && <><i className="vswatch" style={{ background: sw ?? "transparent" }} /> {variant} · </>}
          {v.aliases ? <>Inspiré de {v.aliases.value.map((a) => a.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")).join(", ")} (selon {v.aliases.support[0].sourceName})</> : v.make}
        </p>
        <div className={`compat compat--${x.compat}`} data-testid="compat">
          <Icon name={x.compat === "ok" ? "check" : x.compat === "ultimate-only" ? "lock" : "info"} size={14} /> {COMPAT_FR[x.compat]}
          {x.compat === "check" && state.profile.edition === "unknown" && " · renseigne ton édition dans Profil"}
        </div>
      </div>

      <div className="vstate" role="group" aria-label="Progression du véhicule" data-testid="vehicle-state">
        {(["none", ...STATE_ORDER] as const).map((st, i) => {
          const cur = prog ? STATE_ORDER.indexOf(prog.state) + 1 : 0;
          return (
            <span key={st} className={`${i <= cur ? "is-on" : ""}${i === cur ? " is-cur" : ""}`}>
              <i />
              <em>{STATE_FR[st]}</em>
            </span>
          );
        })}
      </div>

      <div className="vactions">
        <button className="btn btn--primary btn--sm" onClick={() => onGuide(v.id)} disabled={v.location.precision === "none" || v.location.precision === "text"} data-testid="v-guide">
          <Icon name="locate" size={16} /> Me guider
        </button>
        {(!prog || prog.state === "spotted") && v.type === "vehicle" && (
          <button className="btn btn--sm" onClick={() => go(prog ? "stolen" : "spotted")} data-testid="v-found" disabled={x.compat === "ultimate-only"}>
            <Icon name="flag" size={15} /> {prog ? "Je l'ai volé" : "Je l'ai trouvé"}
          </button>
        )}
        {v.type === "vehicle" && prog && prog.state !== "stored" && (
          <button className="btn btn--sm" onClick={() => (prog.state === "registered" ? setStoring(true) : go("registered"))} data-testid="v-keep">
            <Icon name="check" size={15} /> {prog.state === "registered" ? "Ranger au garage" : "Je l'ai conservé"}
          </button>
        )}
        {v.type === "garage" && (!prog || prog.state === "spotted") && (
          <button className="btn btn--sm" onClick={() => go("registered")} data-testid="v-own-garage"><Icon name="check" size={15} /> Je possède ce garage</button>
        )}
        {v.media && <a className="btn btn--sm" href={v.media.url} target="_blank" rel="noreferrer"><Icon name="arrow" size={15} /> Voir la vidéo</a>}
        {prog && <button className="link small" onClick={() => setVehicle(v.id, null)}>Réinitialiser</button>}
      </div>
      {v.location.precision === "zone" && <p className="fineprint"><Icon name="target" size={12} /> « Me guider » mène à une zone de recherche de ~{Math.round((v.location.zone!.radius * 2) / 10) * 10} m, pas à un point exact.</p>}

      {storing && (
        <div className="vstore" data-testid="v-store">
          <strong>Où l&apos;as-tu rangé ?</strong>
          <div className="row gap8 wrap">
            {ownedGarages.map((g) => <button key={g.id} className="fchip" onClick={() => { go("stored", g.name); setStoring(false); }}>{g.name}</button>)}
            <button className="fchip" onClick={() => { go("stored", "Garage personnel"); setStoring(false); }}>Garage personnel</button>
            <button className="fchip" onClick={() => { go("stored", "Planque"); setStoring(false); }}>Planque</button>
          </div>
        </div>
      )}
      {prog?.storage && <p className="small muted"><Icon name="bookmark" size={12} /> Rangé : {prog.storage}</p>}

      <section className="vsec">
        <h4><Icon name="map" size={14} /> Emplacement</h4>
        <p data-testid="v-location">
          {v.location.precision === "exact" ? "Point vérifié" : v.location.precision === "zone" ? `Zone de recherche : ${v.location.district}${v.location.zone?.widened ? " (élargie)" : ""}` : v.location.precision === "text" ? "Adresse seulement (non placée sur la carte)" : "Emplacement non établi"}
        </p>
        {v.location.text && <Quote r={v.location.text.support[0]} />}
        {v.location.alternatives.length > 0 && <p className="small muted">Autres emplacements signalés : {v.location.alternatives.map((a) => `${a.district ?? a.text} (${a.sourceName})`).join(" · ")}</p>}
        {v.location.precision !== "exact" && v.type === "vehicle" && (
          <a className="link small" href={validatePointUrl(v)} target="_blank" rel="noreferrer" data-testid="v-validate">Proposer le point exact (validation)</a>
        )}
      </section>

      <section className="vsec">
        <h4><Icon name="lock" size={14} /> Conditions</h4>
        <ul className="vlist">
          <li>{v.access.chapterMin ? `${CHAPTERS[Math.min(6, v.access.chapterMin.value) as 0]} minimum` : v.access.inferredChapter ? `Chapitre ${v.access.inferredChapter.value} estimé (${v.access.inferredChapter.why})` : v.access.early ? "Accessible tôt, dès l'exploration libre (selon la source)" : "Chapitre non établi"}</li>
          {v.access.mission && <li>Mission : « {v.access.mission.value} »</li>}
          {v.access.keyCloner && <li>{v.access.keyCloner.value ? "Cloneur de clé nécessaire" : "Pas de cloneur de clé"}</li>}
          {v.access.tracker && <li>Traqueur : {v.access.tracker.value === "none" ? "aucun" : v.access.tracker.value === "advanced" ? "avancé" : "standard"}</li>}
          {v.access.alarm?.value && <li>Alarme à neutraliser</li>}
          {v.access.until && <li className="is-warn">Seulement jusqu&apos;au chapitre {v.access.until.value}</li>}
        </ul>
      </section>

      {v.steps.length > 0 && (
        <section className="vsec">
          <h4><Icon name="flag" size={14} /> Étapes citées par les sources</h4>
          <ol className="vsteps">{v.steps.map((s) => <li key={s.quote}>{s.quote} <a href={s.url} target="_blank" rel="noreferrer">{s.sourceName}</a></li>)}</ol>
        </section>
      )}

      <section className="vsec">
        <h4><Icon name="shieldCheck" size={14} /> Le conserver</h4>
        <p data-testid="v-keep-text">{keepText(v)}</p>
        {v.keep.rule && <Quote r={v.keep.rule.source} />}
        {v.risks.length > 0 && (
          <div className="vrisks">
            <strong><Icon name="alert" size={13} /> Risques de perte</strong>
            {v.risks.map((r) => <Quote key={r.quote} r={r} />)}
          </div>
        )}
      </section>

      <section className="vsec">
        <button className="vsec__toggle" onClick={() => setProofs((p) => !p)} aria-expanded={proofs}>
          <h4><Icon name="info" size={14} /> Sources et fiabilité ({v.evidence.length})</h4>
          <Icon name="chevronRight" size={16} />
        </button>
        {proofs && (
          <div data-testid="v-sources">
            <ul className="vlist">{v.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
            {v.missing.length > 0 && <p className="small muted">Non établi : {v.missing.join(", ")}.</p>}
            <ul className="vlist">{v.evidence.map((e) => <li key={e.url}><a href={e.url} target="_blank" rel="noreferrer">{e.sourceName}</a> · {e.title}</li>)}</ul>
            {v.edition.support.length > 0 && <><p className="small muted">Édition :</p>{v.edition.support.map((r) => <Quote key={r.url + r.quote} r={r} />)}</>}
          </div>
        )}
      </section>
    </div>
  );
}
