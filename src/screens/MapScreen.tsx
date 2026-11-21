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
import type { PoiCat } from "@/lib/poi";

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function MapScreen({ active = true }: { active?: boolean }) {
  const { state, selectedId, select, focusNonce, focusOnMap, discoveries: all, signals, vehicleId, selectVehicle, focusVehicle, garage: gState, setGarage: setGarageStore, placeFocus } = useStore();
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
  const [indexOpen, setIndexOpen] = useState(false);
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

  // Lieu demandé par LEONIDA AI : repère gtadb exact, ou quartier → zone approximative (jamais un point inventé)
  const [placeZone, setPlaceZone] = useState<MapZone | null>(null);
  useEffect(() => {
    if (!placeFocus.nonce || !landmarks.length) return;
    setShowLandmarks(true);
    if (placeFocus.poiCat && placeFocus.poiCat in POI_CATS) setPoiCats([placeFocus.poiCat as PoiCat]);
    if (placeFocus.landmarkId && landmarks.some((l) => l.id === placeFocus.landmarkId)) {
      setPlaceZone(null);
      setLmId(placeFocus.landmarkId);
      return;
    }
    const d = placeFocus.district ? norm(placeFocus.district) : "";
    const region = d ? landmarks.filter((l) => norm(l.district.split(",")[0] ?? "") === d) : [];
    const inCategory = placeFocus.poiCat ? region.filter((l) => poiCategory(l) === placeFocus.poiCat) : [];
    const pts = inCategory.length ? inCategory : region;
    if (!pts.length) return;
    const x = pts.reduce((a, l) => a + l.x, 0) / pts.length;
    const y = pts.reduce((a, l) => a + l.y, 0) / pts.length;
    const dist = pts.map((l) => Math.hypot(l.x - x, l.y - y)).sort((a, b) => a - b);
    const radius = Math.min(2500, Math.max(350, dist[Math.floor(dist.length * 0.8)] ?? 350));
    setLmId(null);
    setPlaceZone({ id: `place:${placeFocus.district}`, x, y, radius, color: "#2EE6D6", label: placeFocus.district! });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placeFocus.nonce, landmarks.length]);

  const selectDiscovery = (id: string | null) => {
    if (id?.startsWith("place:")) return;
    setPlaceZone(null);
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
  const zones: MapZone[] = placeZone ? [...vehicleZones, placeZone] : vehicleZones;
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
    if (q.length < 2) return { disc: [], lms: [] as Landmark[] };
    const disc = allMarkers.filter((m) => m.status !== "hidden" && norm(m.discovery.title).includes(q)).slice(0, 4);
    const lms = searchPois(query, landmarks, 10);
    return { disc, lms };
  }, [query, allMarkers, landmarks]);

  const closeSearch = () => {
    setSearchOpen(false);
    setQuery("");
  };

  const search = (
    <div className="search" onClick={(e) => e.stopPropagation()}>
      <div className="search__field">
        <Icon name="search" size={16} />
        <input autoFocus placeholder={`Rechercher parmi ${landmarks.length.toLocaleString("fr-FR")} lieux…`} value={query} onChange={(e) => setQuery(e.target.value)} data-testid="search-input" />
        <button onClick={closeSearch} aria-label="Fermer la recherche"><Icon name="close" size={16} /></button>
      </div>
      {(results.disc.length > 0 || results.lms.length > 0) && (
        <div className="search__results">
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
            </button>
          ))}
        </div>
      )}
      {query.trim().length >= 2 && !results.disc.length && !results.lms.length && <div className="search__results"><p className="muted small pad">Aucun résultat.</p></div>}
    </div>
  );

  const poiCounts = useMemo(() => {
    const counts = {} as Record<PoiCat, number>;
    for (const cat of POI_FILTERS) counts[cat] = 0;
    for (const item of landmarks) counts[poiCategory(item)]++;
    return counts;
  }, [landmarks]);
  const togglePoi = (c: PoiCat) => setPoiCats((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]));
  const toggleCat = (c: CategoryId) =>
    setCats((s) => {
      const n = new Set(s);
      n.has(c) ? n.delete(c) : n.add(c);
      return n;
    });

  const garageChip = (
    <button className={`fchip fchip--garage ${garage ? "is-on" : ""}`} onClick={() => { setGarageStore({ on: !garage, filter: null }); selectVehicle(null); }} aria-pressed={garage} data-testid="filter-garage">
      <span aria-hidden>🚗</span> Voitures cachées <b>{vehicleViews.filter((x) => !x.hidden && x.v.type === "vehicle").length}</b>
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
    <div className="filters" onClick={(e) => e.stopPropagation()}>
      {garageChip}
      <button className={`fchip ${showLandmarks ? "is-on" : ""}`} onClick={() => setShowLandmarks((v) => !v)} aria-pressed={showLandmarks} data-testid="filter-landmarks">
        <i className="fchip__dot" style={{ background: "#e9f6ff" }} /> Lieux
      </button>
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
  );

  const indexPanel = indexOpen && (
    <aside className="poiindex glass" data-testid="poi-index" aria-label="Index des lieux de Leonida" onClick={(e) => e.stopPropagation()}>
      <div className="poiindex__head">
        <div><strong>Index de Leonida</strong><small>Repères communautaires, non nécessairement interactifs en jeu</small></div>
        <button className="iconbtn" type="button" aria-label="Fermer l'index" onClick={() => setIndexOpen(false)}><Icon name="close" size={17}/></button>
      </div>
      <div className="poiindex__items">
        <button type="button" className={!poiCats.length && !garage ? "is-on" : ""} onClick={() => { setGarage(false); setShowLandmarks(true); setPoiCats([]); setIndexOpen(false); }}><span>◎</span><strong>Tous les lieux</strong><em>{landmarks.length}</em></button>
        {POI_FILTERS.map((cat) => (
          <button type="button" key={cat} data-testid={`poi-index-${cat}`} className={!garage && poiCats.length === 1 && poiCats[0] === cat ? "is-on" : ""} onClick={() => { setGarage(false); setShowLandmarks(true); setPoiCats([cat]); setIndexOpen(false); }}>
            <span style={{ color: POI_CATS[cat].color }}>{POI_CATS[cat].glyph}</span><strong>{POI_CATS[cat].plural}</strong><em>{poiCounts[cat]}</em>
          </button>
        ))}
      </div>
    </aside>
  );
  const indexBtn = (
    <button className="iconbtn iconbtn--glass" type="button" onClick={() => setIndexOpen((v) => !v)} aria-label="Index des lieux" aria-expanded={indexOpen} data-testid="poi-index-btn"><Icon name="layers" size={18} /></button>
  );
  const searchBtn = (
    <button className="iconbtn iconbtn--glass" onClick={() => setSearchOpen(true)} aria-label="Rechercher un lieu" data-testid="search-btn">
      <Icon name="search" size={18} />
    </button>
  );

  const mapEl = (occlusion: { top: number; bottom: number; left: number }) => (
    <LeonidaMap
      regions={repo.regions()}
      markers={markers}
      selectedId={selectedId}
      onSelect={selectDiscovery}
      focusNonce={focusNonce + placeFocus.nonce}
      occlusion={occlusion}
      landmarks={landmarks}
      showLandmarks={showLandmarks}
      poiCats={poiCats}
      selectedLandmarkId={lmId}
      onSelectLandmark={selectLandmark}
      active={active}
      pickMode={carto || Boolean(editor)}
      onPick={onPick}
      pickCenterNonce={pickNonce}
      draft={editor ? { x: editor.x, y: editor.y } : null}
      onDraftMove={(x, y) => setEditor((e) => (e ? { ...e, x, y } : e))}
      zones={zones}
      selectedZoneId={vehicleId && zones.some((z) => z.id === `veh:${vehicleId}`) ? `veh:${vehicleId}` : placeZone && !vehicleId ? placeZone.id : null}
      onSelectZone={(id) => selectDiscovery(id)}
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
  const vehicleEl = vehicleId && <VehicleSheet id={vehicleId} onClose={() => selectVehicle(null)} onGuide={guide} />;

  // ── Tablette : panneau + carte côte à côte ─────────────────────────────────
  if (isTablet) {
    const detailOpen = Boolean(selectedId || lm || vehicleId);
    return (
      <div className="mapsplit">
        <aside className="panel">
          {editor ? (
            <div className="panel__scroll" style={{ paddingTop: "calc(var(--sat) + 18px)" }}>{editorEl}</div>
          ) : detailOpen ? (
            <>
              <button className="back" onClick={() => { select(null); setLmId(null); selectVehicle(null); }}><Icon name="chevronLeft" size={16} /> {garage ? "Voitures cachées" : "Recommandations"}</button>
              <div className="panel__scroll">
                {vehicleId ? vehicleEl : selectedId ? <DiscoveryDetail id={selectedId} onClose={() => select(null)} onEdit={openEdit} /> : lm && <LandmarkCard lm={lm} onClose={() => setLmId(null)} />}
              </div>
            </>
          ) : (
            <>
              <header className="panel__head">
                <div>
                  <p className="eyebrow">Carte · {visibleCount} accessibles</p>
                  <h1 className="h2">Recommandations</h1>
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
                  <p className="fineprint pad">Les recommandations se recalculent à chaque découverte terminée.</p>
                </div>
              )}
            </>
          )}
        </aside>
        <div className="mapsplit__map">
          <div className="poiindex__ipadbutton">{indexBtn}</div>
          {mapEl({ top: 64, bottom: 0, left: 0 })}
          <div className="mapsplit__filters">{filters}</div>
          {indexPanel}
          {cartoBar && <div className="mapsplit__carto">{cartoBar}</div>}
        </div>
      </div>
    );
  }

  // ── iPhone : carte plein écran + fiche glissante ───────────────────────────
  const sheetOpen = Boolean(selectedId || lm || editor || vehicleId);
  return (
    <div className="mapphone">
      {mapEl({ top: topH, bottom: sheetOpen ? sheetH : (carto ? 96 : 118) + 86, left: 0 })}
      <div className="mapphone__top" ref={topRef}>
        <div className="row between">
          <h1 className="h2 shadowtxt">Carte</h1>
          <div className="row gap8">{cartoBtn}{indexBtn}{searchBtn}<ShieldChip /></div>
        </div>
        {searchOpen ? search : filters}
      </div>
      {indexPanel}
      {!sheetOpen && cartoBar}
      {!sheetOpen && !carto && (
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
      {!editor && !vehicleId && !selectedId && lm && (
        <Sheet key={lm.id} onClose={() => setLmId(null)} onHeight={setSheetH}>
          <LandmarkCard lm={lm} onClose={() => setLmId(null)} />
        </Sheet>
      )}
    </div>
  );
}
