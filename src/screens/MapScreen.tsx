"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { recommend, statusOf } from "@/lib/engine";
import { CATEGORIES, CATEGORY_ORDER } from "@/lib/meta";
import { repo, useStore } from "@/lib/store";
import { useIsTablet } from "@/lib/useMedia";
import { loadLandmarks } from "@/lib/gtadb";
import type { Landmark } from "@/lib/gtadb";
import type { CategoryId } from "@/lib/types";
import { LeonidaMap } from "@/components/map/LeonidaMap";
import type { MapMarker } from "@/components/map/types";
import { DiscoveryDetail } from "@/components/DiscoveryDetail";
import { DiscoveryEditor } from "@/components/DiscoveryEditor";
import type { EditorDraft } from "@/components/DiscoveryEditor";
import { LandmarkCard } from "@/components/LandmarkCard";
import { RecoCard } from "@/components/RecoCard";
import { ShieldChip } from "@/components/ShieldChip";
import { CategoryGlyph } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/Icon";
import { Sheet } from "@/components/Sheet";
import { VehicleSheet } from "@/components/VehicleSheet";
import { useLiveRadar } from "@/lib/live";
import { ACCESS_FR, FILTERS, matches, viewOf } from "@/lib/garage";
import type { GarageFilter, VehicleView } from "@/lib/garage";
import type { MapZone } from "@/components/map/types";
import type { Discovery } from "@/lib/types";
import { POI_CATS, POI_FILTERS, poiCategory, poiName, poiStatus, searchPois } from "@/lib/poi";
import { EST_CATS, ESTABLISHMENTS } from "@/data/establishments";
import { isPoint, placementOf, PRECISION_FR, searchEstablishments } from "@/lib/places";
import { EstablishmentCard } from "@/components/EstablishmentCard";
import type { PoiCat } from "@/lib/poi";
import { nodeByName } from "@/lib/progress";

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function MapScreen({ active = true }: { active?: boolean }) {
  const { state, selectedId, select, focusNonce, focusOnMap, discoveries: all, signals, vehicleId, selectVehicle, focusVehicle, garage: gState, setGarage: setGarageStore, placeFocus, notify, setPin } = useStore();
  const { feed } = useLiveRadar();
  const garage = gState.on;
  const gFilter = gState.filter as GarageFilter | null;
  const setGarage = (v: boolean | ((x: boolean) => boolean)) => setGarageStore({ on: typeof v === "function" ? v(garage) : v });
  const setGFilter = (f: GarageFilter | null | ((x: GarageFilter | null) => GarageFilter | null)) => setGarageStore({ on: true, filter: typeof f === "function" ? f(gFilter) : f });
  const isTablet = useIsTablet();
  const [cats, setCats] = useState<Set<CategoryId>>(new Set());
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const [hideDone, setHideDone] = useState(false);
  const [onlyNew, setOnlyNew] = useState(false);
  const [showLandmarks, setShowLandmarks] = useState(true);
  // Catégories de lieux affichées, conservées entre les visites
  const [poiCats, setPoiCatsState] = useState<PoiCat[]>([]);
  useEffect(() => {
    try {
      const v = JSON.parse(localStorage.getItem("leonida-os/poi-cats/v1") || "[]");
      if (Array.isArray(v)) setPoiCatsState(v.filter((c) => c in POI_CATS));
    } catch {
      /* préférence absente */
    }
  }, []);
  const setPoiCats = (f: PoiCat[] | ((c: PoiCat[]) => PoiCat[])) =>
    setPoiCatsState((cur) => {
      const next = typeof f === "function" ? f(cur) : f;
      try {
        localStorage.setItem("leonida-os/poi-cats/v1", JSON.stringify(next));
      } catch {
        /* stockage indisponible */
      }
      return next;
    });
  const [landmarks, setLandmarks] = useState<Landmark[]>([]);
  const [lmId, setLmId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [carto, setCarto] = useState(false);
  const [editor, setEditor] = useState<EditorDraft | null>(null);
  const [pickNonce, setPickNonce] = useState(0);
  // Établissement confirmé affiché (fiche) et établissement en cours de placement par le joueur (V0.13)
  const [estId, setEstId] = useState<string | null>(null);
  const [pinFor, setPinFor] = useState<string | null>(null);
  const [sheetH, setSheetH] = useState(420);
  const [topH, setTopH] = useState(110);
  const topRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadLandmarks().then(setLandmarks);
  }, []);
  useEffect(() => {
    const el = topRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setTopH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [isTablet]);

  // Lieu demandé par LEONIDA AI (#15) : repère gtadb exact, établissement confirmé (point / zone restreinte / fiche
  // sans position), ou recherche pré-remplie. V0.13 : plus jamais de zone couvrant un quartier entier.
  // Chaque commande est acquittée (data-place-ack) et un échec est dit au joueur.
  const [placeZone, setPlaceZone] = useState<MapZone | null>(null);
  const [placeAck, setPlaceAck] = useState("");
  const [view, setView] = useState<{ x: number; y: number; radius: number; nonce: number } | null>(null);
  const openEst = (id: string, lms = landmarks) => {
    const e = ESTABLISHMENTS.find((x) => x.id === id);
    if (!e) return false;
    const pl = placementOf(e, lms, state.pins ?? {});
    select(null);
    selectVehicle(null);
    setLmId(null);
    setEstId(id);
    setPlaceZone(
      pl.precision === "inconnue"
        ? null
        : { id: `place:est:${id}`, x: pl.x!, y: pl.y!, radius: isPoint(pl.precision) ? 45 : pl.radius!, color: isPoint(pl.precision) ? "#7CF29A" : "#2EE6D6", kind: isPoint(pl.precision) ? "point" : "zone", tag: PRECISION_FR[pl.precision], label: e.name },
    );
    return pl.precision;
  };
  useEffect(() => {
    if (!placeFocus.nonce || !landmarks.length) return;
    const n = placeFocus.nonce;
    setShowLandmarks(true);
    const cat = placeFocus.poiCat && placeFocus.poiCat in POI_CATS ? (placeFocus.poiCat as PoiCat) : null;
    if (placeFocus.estId) {
      const pr = openEst(placeFocus.estId);
      setPlaceAck(pr ? `applied:${n}:est:${pr}` : `error:${n}:est`);
      return;
    }
    if (placeFocus.landmarkId) {
      const l = landmarks.find((x) => x.id === placeFocus.landmarkId);
      if (l) {
        // le lieu choisi reste visible même si un filtre de catégorie l'aurait masqué
        const c = poiCategory(l);
        setPoiCats((cur) => (cur.length && !cur.includes(c) ? [...cur, c] : cur));
        setPlaceZone(null);
        setEstId(null);
        setLmId(l.id);
        setPlaceAck(`applied:${n}:${l.id}`);
        return;
      }
      notify("Lieu non localisable", "Ce lieu n'est pas dans notre référentiel de la carte. Essaie la recherche.");
      setPlaceAck(`error:${n}:landmark`);
      return;
    }
    // recherche pré-remplie (ou ancien format « quartier [+ catégorie] ») : la LISTE, y compris les lieux sans position
    const q = placeFocus.query ?? [cat ? POI_CATS[cat].plural : "", placeFocus.district ?? ""].join(" ").trim();
    if (q) {
      if (cat) setPoiCats([cat]);
      setPlaceZone(null);
      setLmId(null);
      setEstId(null);
      setQuery(q);
      setSearchOpen(true);
      // cadrer la caméra sur les lieux situés de la liste (établissements placés + repères de la catégorie)
      const pts: Array<{ x: number; y: number }> = [];
      for (const e of searchEstablishments(q, 20)) {
        const pl = placementOf(e, landmarks, state.pins ?? {});
        if (pl.precision !== "inconnue") pts.push({ x: pl.x!, y: pl.y! });
      }
      for (const l of searchPois(q, landmarks, 20)) if (!cat || poiCategory(l) === cat) pts.push(l);
      if (pts.length) {
        const x = pts.reduce((a, p) => a + p.x, 0) / pts.length;
        const y = pts.reduce((a, p) => a + p.y, 0) / pts.length;
        const radius = Math.min(1800, Math.max(...pts.map((p) => Math.hypot(p.x - x, p.y - y))) + 150);
        setView({ x, y, radius, nonce: n });
      }
      setPlaceAck(`applied:${n}:search`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placeFocus.nonce, landmarks.length]);

  // V0.14 — premier cadrage : le quartier documenté de la mission du joueur (une fois par mission et par session),
  // sinon la dernière vue consultée (gérée par la carte), sinon la vue d'ensemble. Jamais de position du personnage.
  useEffect(() => {
    if (!landmarks.length || placeFocus.nonce) return;
    const node = nodeByName(state.profile.nextMission);
    if (!node?.district) return;
    const key = `leonida-os/framed/${node.id}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      return;
    }
    const d = node.district.toLowerCase();
    const pts = landmarks.filter((l) => (l.district ?? "").toLowerCase().split(",")[0].trim() === d);
    if (pts.length < 5) return; // quartier mal couvert par la carte communautaire : pas de cadrage approximatif
    const x = pts.reduce((a, p) => a + p.x, 0) / pts.length;
    const y = pts.reduce((a, p) => a + p.y, 0) / pts.length;
    const ds = pts.map((p) => Math.hypot(p.x - x, p.y - y)).sort((a, b) => a - b);
    setView({ x, y, radius: Math.min(2200, ds[Math.floor(ds.length * 0.85)] + 150), nonce: -1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [landmarks.length, state.profile.nextMission]);

  const selectDiscovery = (id: string | null) => {
    if (id?.startsWith("place:est:")) {
      openEst(id.slice(10));
      return;
    }
    if (id?.startsWith("place:")) return;
    setPlaceZone(null);
    setEstId(null);
    if (id?.startsWith("veh:")) {
      setLmId(null);
      selectVehicle(id.slice(4));
      return;
    }
    if (id) {
      setLmId(null);
      selectVehicle(null);
    }
    select(id);
  };

  // ── Garage des légendes ──────────────────────────────────────────────────────
  const vehicleViews = useMemo(() => (feed?.vehicles ?? []).map((v) => viewOf(v, state)), [feed, state]);
  const shownVehicles = vehicleViews.filter((x) => !x.hidden && (!gFilter || matches(x, gFilter)));
  const hiddenVehicles = vehicleViews.filter((x) => x.hidden).length;
  const VCOLOR = (x: VehicleView) => (x.v.type === "garage" ? "#5AB8FF" : x.v.edition.exclusive === "ultimate" ? "#FFB547" : x.now ? "#2EE6D6" : x.v.reliability === "reported" ? "#B98CFF" : "#FF3D8B");
  const vehicleZones: MapZone[] = garage
    ? shownVehicles.filter((x) => x.v.location.zone && x.v.location.precision === "zone").map((x) => ({ id: `veh:${x.v.id}`, x: x.v.location.zone!.x, y: x.v.location.zone!.y, radius: x.v.location.zone!.radius, color: VCOLOR(x), label: x.v.name, widened: x.v.location.zone!.widened }))
    : [];
  // positions observées par le joueur : toujours visibles (hors mode Voitures cachées)
  const pinZones: MapZone[] = garage
    ? []
    : Object.entries(state.pins ?? {})
        .filter(([id]) => placeZone?.id !== `place:est:${id}`)
        .map(([id, p]) => ({ id: `place:est:${id}`, x: p.x, y: p.y, radius: 40, color: "#7CF29A", kind: "point" as const, label: ESTABLISHMENTS.find((e) => e.id === id)?.name ?? "Position" }));
  const zones: MapZone[] = [...vehicleZones, ...pinZones, ...(placeZone ? [placeZone] : [])];
  const vehicleMarkers: MapMarker[] = garage
    ? shownVehicles
        .filter((x) => x.v.location.point)
        .map((x) => ({
          discovery: { id: `veh:${x.v.id}`, title: x.v.name, category: "vehicle", regionId: x.v.location.regionId ?? "vicecity", x: x.v.location.point!.x, y: x.v.location.point!.y, summary: "", prerequisites: [], reward: "", durationMin: 0, difficulty: 1, spoilerChapter: 0, contentPotential: 0, source: { label: "", reliability: x.v.reliability }, provenance: { kind: "live", recordId: x.v.id, url: "", firstSeenAt: x.v.firstSeenAt } } as Discovery,
          status: x.owned && x.owned !== "spotted" ? "done" : "available",
          fresh: false,
          tracked: false,
          visible: true,
        }))
    : [];
  const guide = (id: string) => focusVehicle(id);
  const selectLandmark = (id: string | null) => {
    if (id) setPlaceZone(null);
    if (id) setEstId(null);
    if (id) {
      select(null);
      selectVehicle(null);
    }
    setLmId(id);
  };

  const recs = useMemo(() => recommend(all, state, new Date(), 6), [all, state]);
  const tracked = useMemo(() => {
    const ids = new Set<string>();
    signals.forEach((g) => g.discoveryId && state.trackedSignals.includes(g.id) && ids.add(g.discoveryId));
    return ids;
  }, [state.trackedSignals, signals]);

  const allMarkers = useMemo(
    () => all.map((d) => ({ discovery: d, status: statusOf(d, state), fresh: state.freshUnlocks.includes(d.id), tracked: tracked.has(d.id) })),
    [all, state, tracked],
  );
  const markers: MapMarker[] = [...allMarkers.map((m) => ({
    ...m,
    visible:
      m.discovery.id === selectedId ||
      (!garage &&
      (!(m.status === "hidden" && state.profile.spoilerMode === "strict") &&
        (!cats.size || cats.has(m.discovery.category)) &&
        (!onlyAvailable || m.status === "available") &&
        (!hideDone || m.status !== "done") &&
        (!onlyNew || m.discovery.provenance.kind === "live" || m.fresh))),
  })), ...vehicleMarkers];

  // ── Mode cartographe ─────────────────────────────────────────────────────────
  const onPick = (x: number, y: number) => {
    if (pinFor) {
      const e = ESTABLISHMENTS.find((z) => z.id === pinFor);
      setPin(pinFor, { x, y });
      notify("Position enregistrée", `${e?.name ?? "Établissement"} · observé par toi en jeu`, "flag");
      const id = pinFor;
      setPinFor(null);
      setEstId(id);
      setPlaceZone({ id: `place:est:${id}`, x, y, radius: 45, color: "#7CF29A", kind: "point", tag: "Placée par toi", label: e?.name ?? "" });
      setPlaceAck(`applied:pin:${id}`);
      return;
    }
    select(null);
    setLmId(null);
    setEditor((e) => (e ? { ...e, x, y } : { x, y }));
  };
  const openEdit = (id: string) => {
    const d = all.find((x) => x.id === id);
    if (!d) return;
    select(null);
    setEditor({ x: d.x, y: d.y, base: d });
  };
  const closeEditor = () => setEditor(null);
  const editorEl = editor && (
    <DiscoveryEditor key={editor.base?.id ?? "new"} draft={editor} onCancel={closeEditor} onSaved={() => setEditor(null)} />
  );
  const cartoBtn = (
    <button className={`cartobtn ${carto ? "is-on" : ""}`} onClick={() => { setCarto((v) => !v); setEditor(null); }} aria-pressed={carto} data-testid="carto-btn">
      <Icon name="flag" size={15} /> {carto ? "Terminer" : "Cartographe"}
    </button>
  );
  const cartoBar = carto && !editor && (
    <div className="cartobar" onClick={(e) => e.stopPropagation()} data-testid="carto-bar">
      <div>
        <strong>Mode cartographe</strong>
        <span>Touche la carte, ou vise avec la mire puis « Poser ici ».</span>
      </div>
      <button className="btn btn--primary btn--sm" style={{ width: "auto" }} onClick={() => setPickNonce((n) => n + 1)} data-testid="pick-center">
        <Icon name="plus" size={16} stroke={2.4} /> Poser ici
      </button>
    </div>
  );

  const lm = lmId ? landmarks.find((l) => l.id === lmId) ?? null : null;

  // ── Recherche (découvertes + lieux) ─────────────────────────────────────────
  const visibleCount = markers.filter((m) => m.visible && m.status === "available").length;
  const results = useMemo(() => {
    const q = norm(query.trim());
    if (q.length < 2) return { disc: [], lms: [] as Landmark[], ests: [] as typeof ESTABLISHMENTS };
    const disc = allMarkers.filter((m) => m.status !== "hidden" && norm(m.discovery.title).includes(q)).slice(0, 4);
    const ests = searchEstablishments(query, 12);
    // un repère déjà couvert par un établissement (même nom) n'apparaît qu'une fois
    const covered = new Set(ests.map((e) => e.position?.landmarkId).filter(Boolean));
    const lms = searchPois(query, landmarks, 10).filter((l) => !covered.has(l.id));
    return { disc, lms, ests };
  }, [query, allMarkers, landmarks]);

  const closeSearch = () => {
    setSearchOpen(false);
    setQuery("");
  };

  const actionOf = (pr: string) => (pr === "inconnue" ? "Placer" : pr === "zone" ? "Zone" : "Voir");
  const searchField = (
    <div className="search" onClick={(e) => e.stopPropagation()}>
      <div className="search__field">
        <Icon name="search" size={16} />
        <input autoFocus placeholder={`Rechercher parmi ${landmarks.length.toLocaleString("fr-FR")} lieux…`} value={query} onChange={(e) => setQuery(e.target.value)} data-testid="search-input" />
        <button onClick={closeSearch} aria-label="Fermer la recherche"><Icon name="close" size={16} /></button>
      </div>
    </div>
  );
  const searchResults = (
    <div className="search search--results" onClick={(e) => e.stopPropagation()}>
      {(results.disc.length > 0 || results.lms.length > 0 || results.ests.length > 0) && (
        <div className="search__results" data-testid="search-results">
          {results.ests.length > 0 && <p className="search__group">Établissements confirmés · {results.ests.length}</p>}
          {results.ests.map((e) => {
            const pl = placementOf(e, landmarks, state.pins ?? {});
            return (
              <button key={e.id} onClick={() => { closeSearch(); openEst(e.id); }} data-testid={`est-${e.id}`} data-precision={pl.precision}>
                <span className="glyph glyph--lm" style={{ width: 28, height: 28, color: "#7CF29A" }}><Icon name="check" size={14} /></span>
                <span><strong>{e.name}</strong><em>{e.kind ?? EST_CATS[e.cats[0]].label} · {e.district === "Mariana County" ? "comté de Mariana" : e.district}</em></span>
                <span className="search__side">
                  <span className={`search__prec search__prec--${pl.precision}`}>{PRECISION_FR[pl.precision]}</span>
                  <span className="search__act">{actionOf(pl.precision)}</span>
                </span>
              </button>
            );
          })}
          {results.lms.length > 0 && results.ests.length > 0 && <p className="search__group">Carte communautaire (gtadb)</p>}
          {results.disc.map((m) => (
            <button key={m.discovery.id} onClick={() => { closeSearch(); focusOnMap(m.discovery.id); setLmId(null); }}>
              <CategoryGlyph id={m.discovery.category} size={28} />
              <span><strong>{m.discovery.title}</strong><em>Découverte · DÉMO</em></span>
            </button>
          ))}
          {results.lms.map((l) => (
            <button key={l.id} onClick={() => { closeSearch(); selectLandmark(l.id); }} data-testid={`result-${l.id}`}>
              <span className="glyph glyph--lm" style={{ width: 28, height: 28, color: POI_CATS[poiCategory(l)].color }}><b style={{ fontSize: 13 }}>{POI_CATS[poiCategory(l)].glyph}</b></span>
              <span><strong>{poiName(l)}</strong><em>{POI_CATS[poiCategory(l)].label} · {l.district || "Leonida"}{poiStatus(l) === "uncertain" ? " · incertain" : ""}</em></span>
              <span className="search__side"><span className="search__prec search__prec--repere">Repère communautaire</span><span className="search__act">Voir</span></span>
            </button>
          ))}
        </div>
      )}
      {query.trim().length >= 2 && !results.disc.length && !results.lms.length && !results.ests.length && <div className="search__results"><p className="muted small pad">Aucun résultat.</p></div>}
    </div>
  );
  const hasResults = searchOpen && query.trim().length >= 2;
  const search = (
    <>
      {searchField}
      {searchResults}
    </>
  );
  const [more, setMore] = useState(false);
  const [menu, setMenu] = useState(false);
  const shopsOn = showLandmarks && poiCats.length === 1 && poiCats[0] === "commerce";

  const togglePoi = (c: PoiCat) => setPoiCats((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]));
  const toggleCat = (c: CategoryId) =>
    setCats((s) => {
      const n = new Set(s);
      n.has(c) ? n.delete(c) : n.add(c);
      return n;
    });

  const garageChip = (
    <button className={`fchip fchip--garage ${garage ? "is-on" : ""}`} onClick={() => { setGarageStore({ on: !garage, filter: null }); selectVehicle(null); }} aria-pressed={garage} data-testid="filter-garage">
      {garage && <span aria-hidden>🚗</span>} Voitures{garage && <b>{vehicleViews.filter((x) => !x.hidden && x.v.type === "vehicle").length}</b>}
    </button>
  );
  const filters = garage ? (
    <div className="filters" onClick={(e) => e.stopPropagation()}>
      {garageChip}
      {FILTERS.map((f) => {
        const n = vehicleViews.filter((x) => !x.hidden && matches(x, f.id)).length;
        return (
          <button key={f.id} className={`fchip ${gFilter === f.id ? "is-on" : ""}`} onClick={() => setGFilter((g) => (g === f.id ? null : f.id))} aria-pressed={gFilter === f.id} data-testid={`gfilter-${f.id}`}>
            {f.label} <b>{n}</b>
          </button>
        );
      })}
    </div>
  ) : (
    <div className="filters14" onClick={(e) => e.stopPropagation()}>
    <div className="filters">
      <button className={`fchip ${shopsOn ? "is-on" : ""}`} onClick={() => { if (shopsOn) setPoiCats([]); else { setShowLandmarks(true); setPoiCats(["commerce"]); } }} aria-pressed={shopsOn} data-testid="filter-shops">
        <i className="fchip__dot" style={{ background: POI_CATS.commerce.color }} /> Commerces
      </button>
      {garageChip}
      <button className={`fchip ${showLandmarks ? "is-on" : ""}`} onClick={() => setShowLandmarks((v) => !v)} aria-pressed={showLandmarks} data-testid="filter-landmarks">
        <i className="fchip__dot" style={{ background: "#e9f6ff" }} /> Repères
      </button>
      <button className={`fchip ${more ? "is-on" : ""}`} onClick={() => setMore((v) => !v)} aria-expanded={more} data-testid="filter-more">
        <Icon name="plus" size={14} /> Plus
      </button>
    </div>
    {more && (
    <div className="filters filters--more" data-testid="filters-more">
      <button className={`fchip ${onlyNew ? "is-on" : ""}`} onClick={() => setOnlyNew((v) => !v)} aria-pressed={onlyNew} data-testid="filter-new">
        <Icon name="sparkle" size={14} /> Nouveau
      </button>
      <button className={`fchip ${onlyAvailable ? "is-on" : ""}`} onClick={() => setOnlyAvailable((v) => !v)} aria-pressed={onlyAvailable}>
        <Icon name="target" size={14} /> Accessibles
      </button>
      <button className={`fchip ${hideDone ? "is-on" : ""}`} onClick={() => setHideDone((v) => !v)} aria-pressed={hideDone}>
        <Icon name="eyeOff" size={14} /> Masquer terminées
      </button>
      {showLandmarks && (
        <>
          <span className="filters__sep" />
          <button className={`fchip ${!poiCats.length ? "is-on" : ""}`} onClick={() => setPoiCats([])} aria-pressed={!poiCats.length} data-testid="poi-all">Tous les lieux</button>
          {POI_FILTERS.filter((c) => c !== "autre" && c !== "transport").map((c) => (
            <button key={c} className={`fchip ${poiCats.includes(c) ? "is-on" : ""}`} style={{ ["--c" as string]: POI_CATS[c].color }} onClick={() => togglePoi(c)} aria-pressed={poiCats.includes(c)} data-testid={`poi-${c}`}>
              <i className="fchip__dot" /> {POI_CATS[c].plural}
            </button>
          ))}
        </>
      )}
      {state.showDemo && <span className="filters__sep" />}
      {state.showDemo && CATEGORY_ORDER.map((c) => (
        <button key={c} className={`fchip ${cats.has(c) ? "is-on" : ""}`} style={{ ["--c" as string]: CATEGORIES[c].color }} onClick={() => toggleCat(c)} aria-pressed={cats.has(c)} data-testid={`filter-${c}`}>
          <i className="fchip__dot" /> {CATEGORIES[c].plural}
        </button>
      ))}
    </div>
    )}
    </div>
  );


  const mapEl = (occlusion: { top: number; bottom: number; left: number }) => (
    <LeonidaMap
      regions={repo.regions()}
      markers={markers}
      selectedId={selectedId}
      onSelect={selectDiscovery}
      focusNonce={focusNonce}
      occlusion={occlusion}
      landmarks={landmarks}
      showLandmarks={showLandmarks}
      poiCats={poiCats}
      selectedLandmarkId={lmId}
      onSelectLandmark={selectLandmark}
      active={active}
      pickMode={carto || Boolean(editor) || Boolean(pinFor)}
      onPick={onPick}
      pickCenterNonce={pickNonce}
      draft={editor ? { x: editor.x, y: editor.y } : null}
      onDraftMove={(x, y) => setEditor((e) => (e ? { ...e, x, y } : e))}
      zones={zones}
      selectedZoneId={vehicleId && zones.some((z) => z.id === `veh:${vehicleId}`) ? `veh:${vehicleId}` : placeZone && !vehicleId ? placeZone.id : null}
      onSelectZone={(id) => selectDiscovery(id)}
      view={view}
    />
  );

  // Liste des véhicules (panneau iPad, bandeau iPhone) : récupérables d'abord
  const sortedVehicles = [...shownVehicles].sort((a, b) => Number(b.now) - Number(a.now) || Number(b.urgent) - Number(a.urgent) || a.v.name.localeCompare(b.v.name));
  const vrow = (x: VehicleView, chip = false) => (
    <button key={x.v.id} className={chip ? "vchip" : "vrow"} onClick={() => selectDiscovery(`veh:${x.v.id}`)} data-testid={`vehicle-${x.v.id}`}>
      <span className="vrow__dot" style={{ background: VCOLOR(x) }} />
      <span className="vrow__body">
        <strong>{x.v.name}</strong>
        <em>
          {x.v.edition.exclusive === "ultimate" ? "Ultimate · " : ""}
          {x.owned && x.owned !== "spotted" ? "Possédé" : x.later ? `Chapitre ${x.need}` : x.access === "confirm" && (x.v.location.precision === "none" || x.v.location.precision === "text") ? "À localiser" : ACCESS_FR[x.access]}
        </em>
      </span>
      {x.v.location.precision === "zone" && <span className="vrow__tag">zone</span>}
    </button>
  );
  const startPin = (id: string) => {
    setEstId(null);
    setPinFor(id);
    setCarto(false);
    setEditor(null);
  };
  const est = estId && !selectedId && !vehicleId ? <EstablishmentCard id={estId} landmarks={landmarks} onClose={() => { setEstId(null); setPlaceZone(null); }} onPlace={startPin} /> : null;
  const pinBar = pinFor && (
    <div className="cartobar" onClick={(e) => e.stopPropagation()} data-testid="pin-bar">
      <div>
        <strong>Placer {ESTABLISHMENTS.find((e) => e.id === pinFor)?.name}</strong>
        <span>Touche l'endroit exact vu en jeu, ou vise avec la mire.</span>
      </div>
      <div className="row gap8">
        <button className="btn btn--ghost btn--sm" style={{ width: "auto" }} onClick={() => { const id = pinFor; setPinFor(null); setEstId(id); }}>Annuler</button>
        <button className="btn btn--primary btn--sm" style={{ width: "auto" }} onClick={() => setPickNonce((n) => n + 1)} data-testid="pin-center">Poser ici</button>
      </div>
    </div>
  );
  const vehicleEl = vehicleId && <VehicleSheet id={vehicleId} onClose={() => selectVehicle(null)} onGuide={guide} />;

  // Inspecteur iPad au repos : établissements confirmés du quartier de la mission (sinon tous), les mieux situés d'abord
  const RANK = { joueur: 0, repere: 1, zone: 2, inconnue: 3 } as const;
  const missionDistrict = nodeByName(state.profile.nextMission)?.district ?? null;
  const inDistrict = missionDistrict ? ESTABLISHMENTS.filter((e) => e.district === missionDistrict) : [];
  const usefulTitle = inDistrict.length ? `Établissements confirmés · ${missionDistrict}` : "Établissements confirmés";
  const useful = (inDistrict.length ? inDistrict : ESTABLISHMENTS)
    .map((e) => ({ e, pl: placementOf(e, landmarks, state.pins ?? {}) }))
    .sort((a, b) => RANK[a.pl.precision] - RANK[b.pl.precision] || a.e.name.localeCompare(b.e.name))
    .slice(0, 14);

  // ── Tablette : panneau + carte côte à côte ─────────────────────────────────
  if (isTablet) {
    const detailOpen = Boolean(selectedId || lm || vehicleId || est);
    return (
      <div className="mapsplit" data-place-ack={placeAck}>
        <aside className="panel">
          {editor ? (
            <div className="panel__scroll" style={{ paddingTop: "calc(var(--sat) + 18px)" }}>{editorEl}</div>
          ) : detailOpen ? (
            <>
              <button className="back" onClick={() => { select(null); setLmId(null); selectVehicle(null); setEstId(null); setPlaceZone(null); }}><Icon name="chevronLeft" size={16} /> {garage ? "Voitures cachées" : "Recommandations"}</button>
              <div className="panel__scroll">
                {vehicleId ? vehicleEl : selectedId ? <DiscoveryDetail id={selectedId} onClose={() => select(null)} onEdit={openEdit} /> : est ? est : lm && <LandmarkCard lm={lm} onClose={() => setLmId(null)} />}
              </div>
            </>
          ) : (
            <>
              <header className="panel__head">
                <div>
                  <p className="eyebrow">Lieux, voitures et repères</p>
                  <h1 className="h2">Carte</h1>
                </div>
                <ShieldChip />
              </header>
              <div className="panel__tools">{cartoBtn}</div>
              <div className="panel__search">{searchOpen ? search : <button className="searchfake" onClick={() => setSearchOpen(true)} data-testid="search-btn"><Icon name="search" size={16} /> Rechercher un lieu, une découverte…</button>}</div>
              {garage ? (
                <div className="panel__scroll list" data-testid="garage-list">
                  {sortedVehicles.map((x) => vrow(x))}
                  {!sortedVehicles.length && <p className="muted pad">Aucun véhicule pour ce filtre.</p>}
                  {hiddenVehicles > 0 && <p className="fineprint pad"><Icon name="shield" size={12} /> {hiddenVehicles} véhicule{hiddenVehicles > 1 ? "s" : ""} masqué{hiddenVehicles > 1 ? "s" : ""} (chapitre plus avancé).</p>}
                  <p className="fineprint pad">Catalogue alimenté automatiquement par la veille. Zones pointillées : emplacements approximatifs.</p>
                </div>
              ) : (
                <div className="panel__scroll list">
                  {recs.map((r) => <RecoCard key={r.discovery.id} rec={r} />)}
                  {!recs.length && (
                    <div className="search__results inspect14" data-testid="map-useful">
                      <p className="search__group">{usefulTitle}</p>
                      {useful.map(({ e, pl }) => (
                        <button key={e.id} onClick={() => openEst(e.id)} data-testid={`useful-${e.id}`} data-precision={pl.precision}>
                          <span className="glyph glyph--lm" style={{ width: 28, height: 28, color: "#7CF29A" }}><Icon name="check" size={14} /></span>
                          <span><strong>{e.name}</strong><em>{e.kind ?? EST_CATS[e.cats[0]].label} · {e.district === "Mariana County" ? "comté de Mariana" : e.district}</em></span>
                          <span className="search__side"><span className={`search__prec search__prec--${pl.precision}`}>{PRECISION_FR[pl.precision]}</span><span className="search__act">{actionOf(pl.precision)}</span></span>
                        </button>
                      ))}
                      <p className="fineprint pad">Positions inconnues : listées, jamais épinglées. LEONIDA ne connaît pas la position de Jason et Lucia.</p>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </aside>
        <div className="mapsplit__map">
          {mapEl({ top: 64, bottom: 0, left: 0 })}
          <div className="mapsplit__filters">{filters}</div>
          {cartoBar && <div className="mapsplit__carto">{cartoBar}</div>}
          {pinBar && <div className="mapsplit__carto">{pinBar}</div>}
        </div>
      </div>
    );
  }

  // ── iPhone : carte plein écran + fiche glissante ───────────────────────────
  const sheetOpen = Boolean(selectedId || lm || editor || vehicleId || est);
  return (
    <div className="mapphone" data-place-ack={placeAck}>
      {mapEl({ top: topH, bottom: sheetOpen ? sheetH : (carto ? 96 : 118) + 86, left: 0 })}
      <div className="mapphone__top" ref={topRef}>
        <div className="maptop14">
          {searchOpen ? searchField : <button className="searchfake" onClick={() => { setSearchOpen(true); setEstId(null); setPlaceZone(null); setLmId(null); select(null); }} data-testid="search-btn"><Icon name="search" size={16} /> Rechercher un commerce, un lieu…</button>}
          {carto && cartoBtn}
          <button className="iconbtn iconbtn--glass" onClick={(e) => { e.stopPropagation(); setMenu((v) => !v); }} aria-label="Plus d'options" aria-expanded={menu} data-testid="map-menu"><Icon name="more" size={18} /></button>
          {menu && (
            <div className="mapmenu" onClick={(e) => e.stopPropagation()} data-testid="map-menu-panel">
              <div onClick={() => setMenu(false)}>{!carto && cartoBtn}</div>
              <div className="mapmenu__row"><span>Anti-spoiler</span><ShieldChip /></div>
            </div>
          )}
        </div>
        {!searchOpen && filters}
      </div>
      {hasResults && !sheetOpen && <div className="mapsheet14" data-testid="map-results">{searchResults}</div>}
      {!sheetOpen && cartoBar}
      {!sheetOpen && pinBar}
      {!sheetOpen && !carto && !pinFor && !hasResults && (
        <div className="strip" onClick={(e) => e.stopPropagation()} data-testid={garage ? "garage-strip" : undefined}>
          {garage ? sortedVehicles.map((x) => vrow(x, true)) : recs.map((r) => <RecoCard key={r.discovery.id} rec={r} variant="chip" />)}
        </div>
      )}
      {!editor && vehicleId && (
        <Sheet key={`v-${vehicleId}`} onClose={() => selectVehicle(null)} onHeight={setSheetH}>
          {vehicleEl}
        </Sheet>
      )}
      {editor && (
        <Sheet key={`ed-${editor.base?.id ?? "new"}`} onClose={closeEditor} onHeight={setSheetH} tall>
          {editorEl}
        </Sheet>
      )}
      {!editor && !vehicleId && selectedId && (
        <Sheet key={selectedId} onClose={() => select(null)} onHeight={setSheetH}>
          <DiscoveryDetail id={selectedId} onClose={() => select(null)} onEdit={openEdit} />
        </Sheet>
      )}
      {!editor && !vehicleId && !selectedId && est && (
        <Sheet key={`est-${estId}`} onClose={() => { setEstId(null); setPlaceZone(null); }} onHeight={setSheetH}>
          {est}
        </Sheet>
      )}
      {!editor && !vehicleId && !selectedId && !est && lm && (
        <Sheet key={lm.id} onClose={() => setLmId(null)} onHeight={setSheetH}>
          <LandmarkCard lm={lm} onClose={() => setLmId(null)} />
        </Sheet>
      )}
    </div>
  );
}
