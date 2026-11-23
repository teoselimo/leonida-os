"use client";

import { useEffect, useRef, useState } from "react";
import { repo, useStore } from "@/lib/store";
import { regionAt } from "@/lib/geo";
import { asPlayerRecord } from "@/lib/records";
import { fmtSize } from "@/lib/copilot/vision";
import type { Attachment, AttachPurpose, MapGuess, VisionLimits } from "@/lib/copilot/vision";
import type { CopilotAnswer } from "@/lib/copilot";
import { tick } from "@/lib/motion";
import { Icon } from "./ui/Icon";

/**
 * LEONIDA Vision — interface des pièces jointes (V0.17).
 * Le bouton « + » n'apparaît que si Claude est réellement joignable ; les entrées image seulement si cette vue peut
 * envoyer des images (limits() du runtime). Aucun accès permanent à la caméra : le sélecteur natif d'iOS est utilisé.
 */
export interface AttachmentChip {
  name: string;
  kind: Attachment["kind"];
  size: number;
  preview?: string;
  purpose?: AttachPurpose;
}

/** Rappel dans l'historique envoyé à Claude (les images des tours précédents ne sont pas renvoyées). */
export const attachmentNote = (atts?: AttachmentChip[]) =>
  atts?.length ? ` [pièce(s) jointe(s) à ce message, déjà analysée(s) : ${atts.map((a) => `${a.kind === "image" ? (a.purpose === "carte" ? "capture de carte" : "image") : "document"} « ${a.name} »`).join(", ")}]` : "";

type Pick = "photo" | "capture" | "carte" | "doc";

function Button({ limits, count, onFiles, disabled }: { limits: VisionLimits | null; count: number; onFiles: (f: File[], k: Pick) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const refs = { photo: useRef<HTMLInputElement>(null), capture: useRef<HTMLInputElement>(null), carte: useRef<HTMLInputElement>(null), doc: useRef<HTMLInputElement>(null) };
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: PointerEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("pointerdown", h);
    return () => document.removeEventListener("pointerdown", h);
  }, [open]);
  const pick = (k: Pick) => {
    tick();
    setOpen(false);
    refs[k].current?.click();
  };
  const onChange = (k: Pick) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length) onFiles(files, k);
  };
  const imageAccept = limits ? [...limits.mediaTypes, "image/heic", "image/heif"].join(",") : "";
  return (
    <div className="vatt" ref={wrap}>
      <button type="button" className={`vatt__plus press${count ? " has" : ""}`} onClick={() => (tick(), setOpen((v) => !v))} aria-haspopup="menu" aria-expanded={open} aria-label="Joindre une image ou un document" data-testid="ai-attach" disabled={disabled}>
        <span aria-hidden>+</span>
      </button>
      {open && (
        <div className="vatt__menu glass" role="menu" data-testid="ai-attach-menu">
          {limits ? (
            <>
              <button role="menuitem" onClick={() => pick("photo")} data-testid="attach-photo"><Icon name="target" size={15} /> Prendre une photo de l&apos;écran</button>
              <button role="menuitem" onClick={() => pick("capture")} data-testid="attach-capture"><Icon name="layers" size={15} /> Captures ou photos</button>
              <button role="menuitem" onClick={() => pick("carte")} data-testid="attach-map"><Icon name="map" size={15} /> Capture de carte (me situer)</button>
            </>
          ) : (
            <p className="vatt__off" data-testid="attach-noimage">Images indisponibles ici : Claude ne peut pas les recevoir dans cette vue.</p>
          )}
          <button role="menuitem" onClick={() => pick("doc")} data-testid="attach-doc"><Icon name="flag" size={15} /> Document texte (.txt, .md, .csv)</button>
          <p className="vatt__hint">Vidéos et PDF : pas encore pris en charge.</p>
        </div>
      )}
      <input ref={refs.photo} type="file" accept={imageAccept || "image/*"} capture="environment" hidden onChange={onChange("photo")} data-testid="file-photo" />
      <input ref={refs.capture} type="file" accept={imageAccept || "image/*"} multiple hidden onChange={onChange("capture")} data-testid="file-capture" />
      <input ref={refs.carte} type="file" accept={imageAccept || "image/*"} hidden onChange={onChange("carte")} data-testid="file-map" />
      <input ref={refs.doc} type="file" accept=".txt,.md,.markdown,.csv,.json,text/plain,text/markdown,text/csv,application/json" multiple hidden onChange={onChange("doc")} data-testid="file-doc" />
    </div>
  );
}

function Tray({ atts, purpose, error, onRemove }: { atts: Attachment[]; purpose: AttachPurpose; error: string | null; onRemove: (id: string) => void }) {
  if (!atts.length && !error) return null;
  return (
    <div className="vtray" data-testid="ai-attachments">
      {atts.length > 0 && (
        <ul className="vtray__list">
          {atts.map((a) => (
            <li key={a.id} className="vtray__item" data-testid="ai-attachment">
              {a.kind === "image" && a.preview ? <img src={a.preview} alt="" /> : <span className="vtray__doc" aria-hidden>TXT</span>}
              <span className="vtray__meta">
                <b>{a.name}</b>
                <small>
                  {fmtSize(a.size)}
                  {a.converted ? " · converti en JPEG" : ""}
                  {a.kind === "image" && purpose === "carte" ? " · carte" : ""}
                </small>
              </span>
              <button type="button" className="vtray__x press" onClick={() => (tick(), onRemove(a.id))} aria-label={`Retirer ${a.name}`} data-testid="ai-attachment-remove">×</button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="vtray__err" role="alert" data-testid="ai-attach-error">{error}</p>}
    </div>
  );
}

function Sent({ atts }: { atts: AttachmentChip[] }) {
  return (
    <span className="vsent" data-testid="ai-sent-atts">
      {atts.map((a, i) =>
        a.kind === "image" && a.preview ? <img key={i} src={a.preview} alt={a.name} /> : <span key={i} className="vsent__chip">{a.kind === "image" ? "Image" : "Document"} · {a.name}</span>,
      )}
    </span>
  );
}

/** Ce que Claude dit voir, ses hypothèses, et la proposition de localisation (jamais enregistrée sans confirmation). */
export function VisionAnswer({ vision, guess }: { vision?: CopilotAnswer["vision"]; guess: MapGuess | null }) {
  const { saveCustom, notify } = useStore();
  const [confirm, setConfirm] = useState(false);
  const [state, setState] = useState<"open" | "saved" | "rejected">("open");
  const certain = vision?.certain ?? [];
  const hyp = vision?.hypotheses ?? [];
  return (
    <div className="vans" data-testid="ai-vision">
      {certain.length > 0 && (
        <p className="vans__row" data-testid="vision-certain"><b>Je vois</b> {certain.join(" · ")}</p>
      )}
      {hyp.length > 0 && (
        <p className="vans__row is-hyp" data-testid="vision-hyp"><b>Hypothèse</b> {hyp.join(" · ")}</p>
      )}
      {guess && state !== "rejected" && (
        <div className="vans__map" data-testid="map-guess" data-certainty={guess.certainty}>
          <p>
            <b>Proposition de localisation</b> · {guess.certainty === "lue" ? "nom lu sur la capture" : guess.certainty === "hypothèse" ? "hypothèse" : "incertaine"}
            {guess.radiusM ? ` · zone estimée d'environ ${guess.radiusM.toLocaleString("fr-FR")} m autour des repères` : ""}
          </p>
          <p className="vans__sub">
            {guess.matched.length ? `Repères retrouvés sur la carte LEONIDA : ${guess.matched.map((m) => m.name).join(", ")}.` : guess.district ? `Quartier retrouvé : ${guess.district} (zone approximative).` : "Aucun repère retrouvé sur notre carte : je ne propose pas de position."}
            {guess.unmatched.length ? ` Non retrouvés : ${guess.unmatched.join(", ")}.` : ""}
          </p>
          {state === "saved" ? (
            <p className="vans__sub" data-testid="map-guess-saved">Enregistré comme relevé personnel estimé (corrige-le depuis la carte si besoin).</p>
          ) : guess.center ? (
            confirm ? (
              <span className="confirm" data-testid="map-guess-confirm">
                <span>Enregistrer un relevé personnel « estimé » (zone d&apos;environ {guess.radiusM ?? "?"} m, non calibrée) ? Il ne deviendra jamais une position vérifiée.</span>
                <button
                  className="btn btn--primary btn--xs"
                  onClick={() => {
                    const c = guess.center!;
                    const title = `Capture de carte · ${guess.matched[0]?.name ?? guess.district ?? guess.zone ?? "zone estimée"}`;
                    saveCustom(
                      asPlayerRecord({
                        id: `vision-${Date.now()}`,
                        title,
                        x: Math.round(c.x),
                        y: Math.round(c.y),
                        category: "secret",
                        regionId: regionAt(c.x, c.y, repo.regions()).id,
                        summary: `Position ESTIMÉE depuis une capture de carte (zone d'environ ${guess.radiusM ?? "?"} m autour des repères, non calibrée, ${guess.certainty}). Repères : ${guess.matched.map((m) => m.name).join(", ") || guess.district || "aucun"}. Non vérifiée en jeu.`,
                        reward: "—",
                      }),
                    );
                    setState("saved");
                    setConfirm(false);
                    notify("Relevé estimé enregistré", title, "check");
                  }}
                  data-testid="map-guess-save-ok"
                >
                  Confirmer
                </button>
                <button className="btn btn--ghost btn--xs" onClick={() => setConfirm(false)}>Annuler</button>
              </span>
            ) : (
              <div className="row gap8 wrap">
                <button className="btn btn--xs btn--on press" onClick={() => (tick(), setConfirm(true))} data-testid="map-guess-save">Enregistrer comme relevé</button>
                <button className="btn btn--xs btn--ghost press" onClick={() => (tick(), setState("rejected"))} data-testid="map-guess-reject">Rejeter</button>
              </div>
            )
          ) : null}
        </div>
      )}
    </div>
  );
}

export const VisionAttach = { Button, Tray, Sent };
