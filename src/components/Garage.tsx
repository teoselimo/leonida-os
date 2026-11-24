"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useStore } from "@/lib/store";
import { useLiveRadar } from "@/lib/live";
import { loadHubVehicles } from "@/lib/hub/data";
import { loadVehicleMedia, mediaOf, shrinkPhoto } from "@/lib/hub/media";
import type { VehicleMediaManifest } from "@/lib/hub/media";
import { buildGarage, family, filterGarage, STAT_FR, TIER_FR } from "@/lib/hub/garage";
import type { GarageItem, GarageQuery } from "@/lib/hub/garage";
import type { HubVehicle } from "@/lib/hub/model";
import { Icon } from "./ui/Icon";

/**
 * Garage A+ (V0.20) — galerie intégrée au Guide (pas de sixième onglet).
 * Vignettes générées (silhouette + couleur de catégorie) : aucune photo GTABase n'est reprise (droits réservés),
 * le lien « Photos sur GTABase » ouvre la fiche d'origine.
 */
const HUE: Record<string, number> = { car: 330, moto: 28, boat: 195, plane: 210, heli: 260, bike: 140, truck: 45 };

function Silhouette({ fam }: { fam: ReturnType<typeof family> }) {
  const P: Record<typeof fam, string> = {
    car: "M8 34h4a6 6 0 0 0 12 0h16a6 6 0 0 0 12 0h4v-8l-6-2-8-8H22l-8 8-6 2z",
    truck: "M6 34h4a6 6 0 0 0 12 0h18a6 6 0 0 0 12 0h4V18H40v-6H6z",
    moto: "M14 36a6 6 0 1 1 0-.1zM50 36a6 6 0 1 1 0-.1zM14 36l10-14h10l6 8h10M30 22l-4-6h-6",
    bike: "M14 36a7 7 0 1 1 0-.1zM50 36a7 7 0 1 1 0-.1zM14 36l12-14h14l10 14M26 22l-3-6",
    boat: "M4 30h56l-8 10H12zM18 30V18h20l8 12M26 18v-6",
    plane: "M4 28l24-4 6-16h4l-2 16 20 4v4l-20 2 2 8h-6l-4-8-24-2z",
    heli: "M10 12h44M32 12v6M18 26a14 8 0 0 0 28 0 14 8 0 0 0-28 0zM46 26h14M22 38h20",
  };
  const stroke = fam === "moto" || fam === "bike" || fam === "heli";
  return (
    <svg viewBox="0 0 64 48" className="gv__sil" aria-hidden="true">
      <path d={P[fam]} fill={stroke ? "none" : "currentColor"} stroke="currentColor" strokeWidth={stroke ? 3 : 0} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** Case d'une planche d'images : fond CSS positionné ; une planche absente retombe sur la silhouette. */
function SpriteImg({ sprite, onError }: { sprite: import("@/lib/hub/media").Sprite; onError: () => void }) {
  useEffect(() => {
    // détection d'échec (un fond CSS n'a pas d'événement « error ») ; la planche est en cache navigateur ensuite
    const i = new Image();
    i.onerror = onError;
    i.src = sprite.src;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sprite.src]);
  return <i className="gv__sprite" role="img" aria-hidden="true" data-atlas={sprite.src.split("/").pop()} style={{ backgroundImage: `url("${sprite.src}")`, backgroundPosition: sprite.pos, backgroundSize: sprite.size }} />;
}

function Plate({ it, big, media }: { it: GarageItem; big?: boolean; media?: ReturnType<typeof mediaOf> }) {
  const fam = family(it.cls);
  const [broken, setBroken] = useState(false);
  const photo = media && media.kind !== "none" && !broken ? media : null;
  return (
    <div className={`gv__plate${big ? " gv__plate--big" : ""}${photo ? " has-photo" : ""}`} style={{ ["--h" as string]: HUE[fam] }} data-media={photo ? photo.kind : "none"}>
      {photo?.kind === "capture" ? (
        <img src={photo.src} alt="" decoding="async" onError={() => setBroken(true)} />
      ) : photo?.kind === "reference" ? (
        <SpriteImg sprite={photo.sprite} onError={() => setBroken(true)} />
      ) : (
        <Silhouette fam={fam} />
      )}
      {photo?.kind === "capture" && <span className="gv__mine">Ta photo</span>}
      {it.manufacturer && !big && <span className="gv__mk">{it.manufacturer}</span>}
    </div>
  );
}

/** Nom sans le constructeur répété (« Emperor Sultan » → « Sultan », le constructeur est affiché à part). */
export const shortName = (it: GarageItem) => (it.manufacturer && it.name.startsWith(it.manufacturer + " ") ? it.name.slice(it.manufacturer.length + 1) : it.name);
const CLS_FR: Record<string, string> = { Motorcycles: "Motos", Muscle: "Muscle", Boats: "Bateaux", Sedans: "Berlines", SUVs: "SUV", Coupes: "Coupés", Pickups: "Pick-up", Emergency: "Urgence", Vans: "Fourgons", Super: "Supercars", Planes: "Avions", Service: "Service", Sports: "Sportives", Utility: "Utilitaires", Commercial: "Commerciaux", "Off-Road": "Tout-terrain", Helicopters: "Hélicoptères", Cycles: "Vélos", Industrial: "Industriels", Compacts: "Compactes", "Sports Classics": "Sportives classiques", Military: "Militaires", Trailers: "Remorques", Trains: "Trains" };
export const clsFr = (c?: string | null) => (c ? c.split(/\s*,\s*/).map((x) => CLS_FR[x] ?? x).join(", ") : null);
const fmt$ = (n?: number) => (n == null ? null : `${n.toLocaleString("fr-FR")} $`);

function HubSheet({ it, all, onPick, onClose, manifest }: { it: GarageItem; all: Map<string, GarageItem>; onPick: (k: string) => void; onClose: () => void; manifest: VehicleMediaManifest | null }) {
  const { state, setVehicle, toggleWanted, focusVehicle, addProof } = useStore();
  const media = mediaOf(it.key, it.hub?.id, state, manifest);
  const panel = useRef<HTMLDivElement>(null);
  // une nouvelle fiche s'ouvre en haut (image visible), y compris en passant d'un modèle à sa variante
  useEffect(() => {
    panel.current?.scrollTo({ top: 0 });
  }, [it.key]);
  const mine = (state.proofs?.[it.key] ?? []).filter((p) => p.kind === "capture");
  const addPhoto = async (f: File | undefined) => {
    if (!f) return;
    const value = await shrinkPhoto(f).catch(() => null);
    if (value) addProof(it.key, { id: Math.random().toString(36).slice(2, 9), kind: "capture", value, note: "visuel", at: new Date().toISOString() });
  };
  const h = it.hub;
  const owned = state.vehicles[it.key] && state.vehicles[it.key].state !== "spotted";
  const wanted = (state.wanted ?? []).includes(it.key);
  const byHub = (id: string) => [...all.values()].find((x) => x.hub?.id === id);
  const specs: Array<[string, string | number | undefined | null]> = h
    ? [
        ["Catégorie", clsFr(h.c)], ["Style", h.st], ["Spécialité", h.sp], ["Époque", h.e], ["Places", h.seats], ["Transmission", h.dt], ["Rapports", h.g],
        ["Masse", h.kg ? `${h.kg.toLocaleString("fr-FR")} kg` : null], ["Coffre", h.sto], ["Inspiré de", h.b], ["Série", h.set], ["État de carrosserie", h.cond], ["Traqueur", h.tr], ["Édition", h.ed],
      ]
    : [];
  const money: Array<[string, string | null]> = h ? [["Prix (mode histoire)", fmt$(h.p)], ["Immatriculation", fmt$(h.reg)], ["Revente (volé)", fmt$(h.sell)]] : [];
  // portail : la fiche couvre tout l'écran (y compris la barre d'onglets), quel que soit le conteneur animé du Guide
  return createPortal(
    <div ref={panel} className="gvpanel" role="dialog" aria-modal="true" aria-label={it.name} data-testid="garage-sheet" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="gvs" data-testid={`garage-sheet-${it.key}`}>
        <button className="gvs__close" onClick={onClose} aria-label="Fermer la fiche" data-testid="garage-close"><Icon name="close" size={18} /></button>
        <Plate it={it} big media={media} />
        <p className="gvs__credit" data-testid="garage-media">
          {media.kind === "capture" ? "Ta photo (enregistrée sur cet appareil)" : media.kind === "reference" ? <>Image : <a href={media.source} target="_blank" rel="noreferrer">{media.credit}</a> (même fiche)</> : "Pas d'image exacte pour cette fiche : visuel de remplacement."}
          {" · "}
          <label className="gvs__add">{mine.length ? "Remplacer ma photo" : "Ajouter ma photo"}<input type="file" accept="image/*" onChange={(e) => addPhoto(e.target.files?.[0])} data-testid="garage-photo-input" hidden /></label>
          {mine.length > 0 && <> · <button className="link small" onClick={() => mine.forEach((p) => addProof(it.key, null, p.id))} data-testid="garage-photo-remove">Retirer ma photo</button></>}
        </p>
        <h2 className="gvs__name">{it.manufacturer ? <small>{it.manufacturer}</small> : null}{shortName(it)}</h2>
        <p className="gvs__tags">
          <span className={`gvchip gvchip--${it.tier}`}>{TIER_FR[it.tier]}</span>
          <span className={`gvchip gvchip--a-${it.access.tone}`} data-testid="garage-access">{it.access.label}</span>
          {it.onMap && <span className="gvchip gvchip--map">Sur la carte</span>}
        </p>
        <div className="gvs__actions">
          <button className={`btn btn--sm ${wanted ? "btn--on" : "btn--ghost"}`} onClick={() => toggleWanted(it.key)} aria-pressed={wanted} data-testid="garage-want"><Icon name="bookmark" size={15} /> {wanted ? "Recherché" : "Je le recherche"}</button>
          <button className={`btn btn--sm ${owned ? "btn--on" : "btn--ghost"}`} onClick={() => setVehicle(it.key, owned ? null : "registered")} aria-pressed={owned} data-testid="garage-own"><Icon name="check" size={15} /> {owned ? "Possédé" : "Je l'ai"}</button>
          {it.onMap && <button className="btn btn--sm" onClick={() => { onClose(); focusVehicle(it.key); }} data-testid="garage-map"><Icon name="map" size={15} /> Voir sur la carte</button>}
        </div>
        {!it.onMap && <p className="fineprint" data-testid="garage-nomap">Aucune position connue : LEONIDA n&apos;affiche un point que s&apos;il est calibré (Rare Vehicle Locator) ou signalé par la veille.</p>}
        {h?.s && (
          <section className="gvs__stats" data-testid="garage-stats">
            <h3>Statistiques <em>(échelle GTABase sur 10)</em></h3>
            {Object.entries(h.s).map(([k, v]) => (
              <div key={k} className="gvstat"><span>{STAT_FR[k] ?? k}</span><i><b style={{ width: `${Math.min(100, (v ?? 0) * 10)}%` }} /></i><strong>{v}</strong></div>
            ))}
            {h.r != null && <p className="fineprint">Note globale GTABase : {h.r}</p>}
          </section>
        )}
        {h?.how && <p className="gvs__how"><strong>Comment l&apos;obtenir :</strong> {h.how}</p>}
        {(h?.base || h?.vars?.length || h?.own?.length) && (
          <section className="gvs__fam" data-testid="garage-family">
            <h3>Modèle et variantes</h3>
            {h.base && byHub(h.base) && <button className="gvlink" onClick={() => onPick(byHub(h.base!)!.key)}>Modèle de base : {byHub(h.base)!.name}</button>}
            {h.own?.length ? <p className="muted small">Exemplaire de : {h.own.join(", ")}</p> : null}
            {(h.vars ?? []).map((id) => byHub(id)).filter(Boolean).map((x) => (
              <button key={x!.key} className="gvlink" onClick={() => onPick(x!.key)}>{TIER_FR[x!.tier]} : {x!.name}</button>
            ))}
          </section>
        )}
        {specs.some(([, v]) => v != null && v !== "") && (
          <dl className="gvs__specs">
            {specs.filter(([, v]) => v != null && v !== "").map(([k, v]) => (<div key={k}><dt>{k}</dt><dd>{v}</dd></div>))}
            {money.filter(([, v]) => v).map(([k, v]) => (<div key={k}><dt>{k}</dt><dd>{v}</dd></div>))}
          </dl>
        )}
        <section className="gvs__src" data-testid="garage-sources">
          <h3>Sources</h3>
          {h && <p><a href={h.u} target="_blank" rel="noreferrer">GTABase</a>{h.mod ? ` · fiche modifiée le ${new Date(h.mod).toLocaleDateString("fr-FR")}` : ""}</p>}
          {it.rvl && <p>Rare Vehicle Locator (position calibrée LEONIDA)</p>}
          {it.radar && !it.rvl && <p>Veille LEONIDA ({it.radar.evidence.length} preuve{it.radar.evidence.length > 1 ? "s" : ""})</p>}
          {!h && <p className="muted small">Absent du catalogue GTABase importé : fiche issue du suivi LEONIDA.</p>}
          <p className="fineprint">Données GTABase : faits, liens et image principale de la fiche (réduite, créditée) ; aucun texte rédigé n&apos;est repris.</p>
        </section>
      </div>
    </div>,
    document.body,
  );
}

export function Garage() {
  const { state } = useStore();
  const { feed } = useLiveRadar();
  const [hub, setHub] = useState<HubVehicle[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [f, setF] = useState<GarageQuery>({ q: "", maker: null, cls: null, tier: "all", only: "all" });
  const [open, setOpen] = useState<string | null>(null);
  const [limit, setLimit] = useState(48);
  const [manifest, setManifest] = useState<VehicleMediaManifest | null>(null);
  useEffect(() => {
    loadVehicleMedia().then(setManifest);
  }, []);
  useEffect(() => {
    let alive = true;
    loadHubVehicles().then((r) => {
      if (!alive) return;
      setHub(r.data);
      setFailed(!r.ok);
    });
    return () => {
      alive = false;
    };
  }, []);
  const items = useMemo(() => (hub ? buildGarage(hub, feed?.vehicles ?? [], state) : []), [hub, feed, state]);
  const byKey = useMemo(() => new Map(items.map((i) => [i.key, i])), [items]);
  const makers = useMemo(() => [...new Set(items.map((i) => i.manufacturer).filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b)), [items]);
  const classes = useMemo(() => {
    const c = new Map<string, number>();
    for (const i of items) for (const k of (i.cls ?? "").split(/\s*,\s*/).filter(Boolean)) c.set(k, (c.get(k) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  }, [items]);
  const list = useMemo(() => filterGarage(items, f, state.wanted ?? [], state.vehicles), [items, f, state.wanted, state.vehicles]);
  useEffect(() => setLimit(48), [f]);
  const set = (p: Partial<GarageQuery>) => setF((x) => ({ ...x, ...p }));
  const counts = { model: items.filter((i) => i.tier === "model").length, variant: items.filter((i) => i.tier === "variant").length, unique: items.filter((i) => i.tier === "unique").length, map: items.filter((i) => i.onMap).length };
  const cur = open ? byKey.get(open) : null;

  return (
    <div className="garagev" data-testid="garage">
      {hub == null ? (
        <p className="card empty">Chargement du Garage…</p>
      ) : (
        <>
          <p className="guide__fresh" data-testid="garage-count">
            <Icon name="car" size={13} /> {items.length} véhicules · {counts.model} modèles, {counts.variant} variantes, {counts.unique} exemplaires uniques · {counts.map} sur la carte
          </p>
          {failed && <p className="note" data-testid="garage-failed"><Icon name="alert" size={15} /> Catalogue GTABase indisponible : seuls les véhicules suivis par LEONIDA sont affichés.</p>}
          <div className="guide__search">
            <Icon name="search" size={16} />
            <input value={f.q} onChange={(e) => set({ q: e.target.value })} placeholder="Nom, constructeur, modèle réel…" aria-label="Rechercher un véhicule" data-testid="garage-search" />
            {f.q && <button onClick={() => set({ q: "" })} aria-label="Effacer"><Icon name="close" size={14} /></button>}
          </div>
          <div className="garagev__row">
            <select value={f.maker ?? ""} onChange={(e) => set({ maker: e.target.value || null })} aria-label="Constructeur" data-testid="garage-maker">
              <option value="">Tous les constructeurs</option>
              {makers.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <select value={f.tier} onChange={(e) => set({ tier: e.target.value as GarageQuery["tier"] })} aria-label="Type de fiche" data-testid="garage-tier">
              <option value="all">Modèles et variantes</option>
              <option value="model">Modèles de base</option>
              <option value="variant">Variantes</option>
              <option value="unique">Exemplaires uniques</option>
              <option value="rare">Véhicules rares suivis</option>
            </select>
          </div>
          <div className="guide__cats" role="tablist" aria-label="Catégorie">
            <button className={`fchip${!f.cls ? " is-on" : ""}`} onClick={() => set({ cls: null })}>Toutes</button>
            {classes.map((c) => <button key={c} className={`fchip${f.cls === c ? " is-on" : ""}`} onClick={() => set({ cls: f.cls === c ? null : c })} data-testid={`garage-cls-${c}`}>{clsFr(c)}</button>)}
          </div>
          <div className="guide__cats" role="tablist" aria-label="Filtre rapide">
            {([["all", "Tout"], ["now", "Accessibles maintenant"], ["map", "Sur la carte"], ["wanted", `Recherchés (${(state.wanted ?? []).length})`], ["owned", "Possédés"]] as const).map(([id, l]) => (
              <button key={id} className={`fchip${f.only === id ? " is-on" : ""}`} onClick={() => set({ only: id })} data-testid={`garage-only-${id}`}>{l}</button>
            ))}
          </div>
          <p className="fineprint" data-testid="garage-results">{list.length} résultat{list.length > 1 ? "s" : ""}</p>
          <ul className="gvgrid" data-testid="garage-grid">
            {list.length === 0 && <li className="card empty">Aucun véhicule pour ces filtres.</li>}
            {list.slice(0, limit).map((it) => {
              const owned = state.vehicles[it.key] && state.vehicles[it.key].state !== "spotted";
              const wanted = (state.wanted ?? []).includes(it.key);
              return (
                <li key={it.key + (it.hub?.id ?? "")}>
                  <button className="gv" onClick={() => setOpen(it.key)} data-testid={`garage-card-${it.key}`}>
                    <Plate it={it} media={mediaOf(it.key, it.hub?.id, state, manifest)} />
                    <span className="gv__n">{shortName(it)}</span>
                    <span className="gv__s">{[clsFr(it.cls), it.tier !== "model" ? TIER_FR[it.tier] : null].filter(Boolean).join(" · ")}</span>
                    <span className="gv__marks">
                      {it.onMap && <i className="gv__m gv__m--map" title="Sur la carte"><Icon name="map" size={11} /></i>}
                      {it.access.tone === "ok" && <i className="gv__m gv__m--ok" title={it.access.label}><Icon name="check" size={11} /></i>}
                      {wanted && <i className="gv__m gv__m--want" title="Recherché"><Icon name="bookmark" size={11} /></i>}
                      {owned && <i className="gv__m gv__m--own" title="Possédé"><Icon name="trophy" size={11} /></i>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {list.length > limit && <button className="btn btn--ghost btn--sm garagev__more" onClick={() => setLimit((l) => l + 96)} data-testid="garage-more">Afficher {Math.min(96, list.length - limit)} de plus</button>}
          <p className="fineprint" data-testid="garage-coverage">Catalogue : GTABase (faits, liens, images exactes{manifest ? ` : ${Object.keys(manifest.refs).length} fiches illustrées` : ""}) · tes photos priment · positions : Rare Vehicle Locator et veille LEONIDA uniquement.</p>
        </>
      )}
      {cur && <HubSheet it={cur} all={byKey} onPick={setOpen} onClose={() => setOpen(null)} manifest={manifest} />}
    </div>
  );
}
