"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Map as MLMap, Marker, GeoJSONSource, FilterSpecification } from "maplibre-gl";
import { CATEGORIES } from "@/lib/meta";
import { assetUrl, CC_BY_URL, gameToLngLat, GTADB_URL, LAND, lngLatToGame } from "@/lib/gtadb";
import { Icon } from "@/components/ui/Icon";
import type { MapViewProps } from "./types";
import { POI_CATS, poiCategory, poiName, poiStatus } from "@/lib/poi";
import type { PoiCat } from "@/lib/poi";
import type { Landmark } from "@/lib/gtadb";

const FOCUS_ZOOM = 4.9;
/** Zoom d'arrivée sur un lieu précis : assez près pour lire les commerces voisins. */
const POI_ZOOM = 6.6;

/**
 * Filtre des repères : zoom minimal de la catégorie (apparition progressive), catégories choisies, conditions en plus.
 * MapLibre n'accepte « zoom » qu'en tête d'un step : les autres conditions vont dans chaque palier.
 */
function zoomFilter(cats: PoiCat[] | null | undefined, extra: unknown[] = []): FilterSpecification {
  const base = [...(cats && cats.length ? [["in", ["get", "cat"], ["literal", cats]]] : []), ...extra];
  const at = (z: number) => ["all", ["<=", ["get", "minz"], z], ...base];
  const steps = [...new Set(Object.values(POI_CATS).map((c) => c.minZoom))].sort((a, b) => a - b);
  return ["step", ["zoom"], at(0), ...steps.flatMap((z) => [z, at(z)])] as unknown as FilterSpecification;
}
const lmFilter = (cats: PoiCat[] | null | undefined) => zoomFilter(cats);
/** Noms : lieux identifiés, catégories utiles (pas les milliers d'« autres lieux »). */
const labelFilter = (cats: PoiCat[] | null | undefined) => zoomFilter(cats, [["==", ["get", "named"], 1], ["!=", ["get", "cat"], "autre"]]);

/** Pastille de catégorie (canvas, 2×). */
function drawPin(color: string, glyph: string): ImageData {
  const S = 44;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  g.beginPath();
  g.arc(S / 2, S / 2, S / 2 - 3, 0, Math.PI * 2);
  g.fillStyle = "rgba(10,7,20,0.9)";
  g.fill();
  g.lineWidth = 4;
  g.strokeStyle = color;
  g.stroke();
  g.fillStyle = color;
  g.font = "700 22px -apple-system, system-ui, 'Segoe UI', sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(glyph, S / 2, S / 2 + 1);
  return g.getImageData(0, 0, S, S);
}

/** Étiquette de nom (canvas, 2×) : texte clair sur fond nuit, lisible sur la carte. */
function drawLabel(text: string): ImageData {
  const t = text.length > 28 ? text.slice(0, 27) + "…" : text;
  const c = document.createElement("canvas");
  const g0 = c.getContext("2d")!;
  const font = "600 24px -apple-system, system-ui, 'Segoe UI', sans-serif";
  g0.font = font;
  const w = Math.ceil(g0.measureText(t).width) + 20;
  c.width = w;
  c.height = 36;
  const g = c.getContext("2d")!;
  g.fillStyle = "rgba(10,7,20,0.78)";
  g.beginPath();
  g.roundRect(0, 0, w, 36, 12);
  g.fill();
  g.font = font;
  g.fillStyle = "#f4f0fb";
  g.textBaseline = "middle";
  g.fillText(t, 10, 19);
  return g.getImageData(0, 0, w, 36);
}
const CAMERA_KEY = "leonida-os/map-camera/v1";

type Camera = { center: [number, number]; zoom: number };
function loadCamera(): Camera | null {
  try {
    const c = JSON.parse(localStorage.getItem(CAMERA_KEY) || "null");
    return c && Array.isArray(c.center) && Number.isFinite(c.zoom) ? c : null;
  } catch {
    return null;
  }
}
function saveCamera(c: Camera) {
  try {
    localStorage.setItem(CAMERA_KEY, JSON.stringify(c));
  } catch {
    /* stockage indisponible */
  }
}

/** Vérifie qu'une tuile de base est servie (build sans public/tiles, hébergement incomplet…). */
async function tilesReachable(): Promise<boolean> {
  try {
    const r = await fetch(assetUrl("tiles/0/0/0.jpg"), { cache: "no-store" });
    return r.ok && (r.headers.get("content-type") || "").includes("image");
  } catch {
    return false;
  }
}

/**
 * Carte de Leonida : MapLibre GL (moteur de carte open source, rendu GPU, gestes natifs iOS)
 * affichant les tuiles de la carte communautaire gtadb.org, préparées par scripts/build_gtadb_assets.py.
 */
export function LeonidaMap(props: MapViewProps) {
  const { poiCats = [] } = props;
  const poiKey = poiCats.join(",");
  const lmIndex = useRef(new Map<string, Landmark>());
  lmIndex.current = new Map(props.landmarks.map((l) => [l.id, l]));
  const { regions, markers, selectedId, onSelect, focusNonce, occlusion, landmarks, showLandmarks, selectedLandmarkId, onSelectLandmark, pickMode, onPick, pickCenterNonce, draft, onDraftMove, active, zones = [], selectedZoneId = null, onSelectZone } = props;
  const [tileError, setTileError] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(3);
  const [els, setEls] = useState<Record<string, HTMLElement>>({});
  const markerObjs = useRef<Record<string, Marker>>({});
  const mlRef = useRef<typeof import("maplibre-gl") | null>(null);
  const draftMarker = useRef<Marker | null>(null);
  const cb = useRef({ onSelect, onSelectLandmark, onPick, onDraftMove, pickMode, onSelectZone });
  cb.current = { onSelect, onSelectLandmark, onPick, onDraftMove, pickMode, onSelectZone };
  const occ = useRef(occlusion);
  occ.current = occlusion;

  const padding = () => ({ top: occ.current.top + 12, bottom: occ.current.bottom + 12, left: occ.current.left + 12, right: 12 });
  const landBounds = (): [[number, number], [number, number]] => [gameToLngLat(LAND.minX, LAND.minY), gameToLngLat(LAND.maxX, LAND.maxY)];

  // ── Création de la carte ──────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    let map: MLMap | null = null;
    (async () => {
      try {
        const ml = (await import("maplibre-gl")).default;
        mlRef.current = ml;
        if (cancelled || !box.current) return;
        map = new ml.Map({
          container: box.current,
          attributionControl: false,
          dragRotate: false,
          pitchWithRotate: false,
          touchPitch: false,
          maxZoom: 8.6,
          minZoom: 0.6,
          renderWorldCopies: false,
          maxBounds: [gameToLngLat(Math.max(-16300, LAND.minX - 6000), Math.max(-16300, LAND.minY - 6000)), gameToLngLat(Math.min(16300, LAND.maxX + 6000), Math.min(16300, LAND.maxY + 6000))],
          bounds: landBounds(),
          fitBoundsOptions: { padding: padding() },
          style: {
            version: 8,
            sources: {
              leonida: { type: "raster", tiles: [assetUrl("tiles/") + "{z}/{x}/{y}.jpg"], tileSize: 2048, minzoom: 0, maxzoom: 4, bounds: [-135, -74.0195, 67.5, 79.1713] },
              landmarks: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
              zones: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
            },
            layers: [
              { id: "bg", type: "background", paint: { "background-color": "#071019" } },
              { id: "base", type: "raster", source: "leonida", paint: { "raster-brightness-max": 0.72, "raster-saturation": -0.25, "raster-contrast": 0.12, "raster-fade-duration": 120 } },
              // Zones de recherche approximatives (Garage des légendes) : remplissage léger + contour pointillé
              { id: "zones-fill", type: "fill", source: "zones", paint: { "fill-color": ["get", "color"], "fill-opacity": ["case", ["==", ["get", "sel"], 1], 0.28, 0.14] } },
              {
                id: "zones-line",
                type: "line",
                source: "zones",
                paint: { "line-color": ["get", "color"], "line-width": ["case", ["==", ["get", "sel"], 1], 2.6, 1.4], "line-dasharray": [2, 1.5], "line-opacity": 0.9 },
              },
              // Repères communautaires : icônes par catégorie (images dessinées sur canvas, sans serveur de polices),
              // apparition progressive selon le zoom et l'importance, collisions gérées par MapLibre.
              {
                id: "lm",
                type: "symbol",
                source: "landmarks",
                filter: lmFilter(null),
                layout: {
                  "icon-image": ["concat", "cat:", ["get", "cat"]],
                  "icon-size": ["interpolate", ["linear"], ["zoom"], 2, 0.62, 5, 0.85, 7, 1.05],
                  "icon-allow-overlap": false,
                  "symbol-sort-key": ["get", "rank"],
                },
              },
              // Noms des lieux à partir d'un zoom de quartier (une image par nom, créée à la demande)
              {
                id: "lm-label",
                type: "symbol",
                source: "landmarks",
                minzoom: 5.6,
                filter: labelFilter(null),
                layout: {
                  "icon-image": ["concat", "lbl:", ["get", "id"]],
                  "icon-anchor": "left",
                  "icon-offset": [16, 0],
                  "icon-allow-overlap": false,
                  "symbol-sort-key": ["get", "rank"],
                },
              },
              {
                id: "lm-sel",
                type: "circle",
                source: "landmarks",
                filter: ["==", ["get", "id"], ""],
                paint: { "circle-radius": 9, "circle-color": "#2EE6D6", "circle-stroke-color": "#ffffff", "circle-stroke-width": 3 },
              },
            ],
          },
        });
        mapRef.current = map;
        const w = window as unknown as { __leonidaMap?: MLMap; __leonidaMapCount?: number };
        w.__leonidaMap = map;
        w.__leonidaMapCount = (w.__leonidaMapCount ?? 0) + 1;
        map.touchZoomRotate.disableRotation();
        map.keyboard.disableRotation();
        map.on("moveend", () => {
          const c = map!.getCenter();
          saveCamera({ center: [c.lng, c.lat], zoom: map!.getZoom() });
        });
        let tileOk = false;
        map.on("data", (e) => {
          if ((e as { sourceId?: string; tile?: unknown }).sourceId === "leonida" && (e as { tile?: unknown }).tile) {
            tileOk = true;
            setTileError(false);
          }
        });
        tilesReachable().then((ok) => {
          if (!cancelled && !ok && !tileOk) setTileError(true);
        });
        map.on("zoom", () => setZoom(map!.getZoom()));
        map.on("click", (e) => {
          // Les clics sur les marqueurs HTML sont gérés par les marqueurs eux-mêmes.
          if ((e.originalEvent?.target as HTMLElement | null)?.tagName !== "CANVAS") return;
          if (cb.current.pickMode) {
            const [x, y] = lngLatToGame(e.lngLat.lng, e.lngLat.lat);
            cb.current.onPick(x, y);
            return;
          }
          const p = e.point;
          const zHits = map!.getLayer("zones-fill") ? map!.queryRenderedFeatures([[p.x - 4, p.y - 4], [p.x + 4, p.y + 4]], { layers: ["zones-fill"] }) : [];
          if (zHits.length && cb.current.onSelectZone) {
            // la plus petite zone l'emporte quand elles se chevauchent
            const z = [...zHits].sort((a, b) => Number(a.properties?.r) - Number(b.properties?.r))[0];
            cb.current.onSelect(null);
            cb.current.onSelectLandmark(null);
            cb.current.onSelectZone(String(z.properties?.id));
            return;
          }
          const hits = map!.getLayer("lm") && map!.getLayoutProperty("lm", "visibility") !== "none"
            ? map!.queryRenderedFeatures([[p.x - 14, p.y - 14], [p.x + 14, p.y + 14]], { layers: ["lm", "lm-label"] })
            : [];
          if (hits.length) {
            cb.current.onSelect(null);
            cb.current.onSelectLandmark(String(hits[0].properties?.id));
          } else {
            cb.current.onSelect(null);
            cb.current.onSelectLandmark(null);
          }
        });
        // Pictogrammes des catégories et étiquettes de noms, dessinés à la demande
        map.on("styleimagemissing", (e: { id: string }) => {
          const id = e.id;
          if (map!.hasImage(id)) return;
          if (id.startsWith("cat:")) {
            const meta = POI_CATS[id.slice(4) as PoiCat];
            if (meta) map!.addImage(id, drawPin(meta.color, meta.glyph), { pixelRatio: 2 });
          } else if (id.startsWith("lbl:")) {
            const l = lmIndex.current.get(id.slice(4));
            if (l) map!.addImage(id, drawLabel(poiName(l)), { pixelRatio: 2 });
          }
        });
        map.on("load", () => {
          if (cancelled) return;
          // Le conteneur peut avoir été mesuré avant la mise en page finale : recadrage propre,
          // ou reprise de la dernière position consultée.
          map!.resize();
          const cam = loadCamera();
          if (cam) map!.jumpTo({ center: cam.center, zoom: cam.zoom });
          else map!.fitBounds(landBounds(), { padding: padding(), duration: 0 });
          setZoom(map!.getZoom());
          setReady(true);
        });
        map.on("error", (e) => {
          if ((e as { sourceId?: string }).sourceId === "leonida") setTileError(true);
        });

        // Étiquettes de régions (marqueurs HTML)
        for (const r of regions) {
          const el = document.createElement("div");
          el.className = "mlr";
          el.textContent = r.name;
          el.style.color = r.hue;
          new ml.Marker({ element: el, anchor: "center" }).setLngLat(gameToLngLat(r.label[0], r.label[1])).addTo(map);
        }
      } catch (err) {
        console.error(err);
        setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
      markerObjs.current = {};
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Marqueurs de découvertes : création / suppression / déplacement au fil des données
  const markerKey = markers.map((m) => `${m.discovery.id}:${m.discovery.x}:${m.discovery.y}`).join("|");
  useEffect(() => {
    const map = mapRef.current;
    const ml = mlRef.current;
    if (!ready || !map || !ml) return;
    const next: Record<string, HTMLElement> = { ...els };
    const ids = new Set(markers.map((m) => m.discovery.id));
    let changed = false;
    for (const id of Object.keys(markerObjs.current)) {
      if (!ids.has(id)) {
        markerObjs.current[id].remove();
        delete markerObjs.current[id];
        delete next[id];
        changed = true;
      }
    }
    for (const m of markers) {
      const id = m.discovery.id;
      const ll = gameToLngLat(m.discovery.x, m.discovery.y);
      if (markerObjs.current[id]) {
        markerObjs.current[id].setLngLat(ll);
        continue;
      }
      const el = document.createElement("div");
      el.className = "mlm";
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (cb.current.pickMode) return;
        cb.current.onSelectLandmark(null);
        cb.current.onSelect(id);
      });
      markerObjs.current[id] = new ml.Marker({ element: el, anchor: "center" }).setLngLat(ll).addTo(map);
      next[id] = el;
      changed = true;
    }
    if (changed) setEls(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, markerKey]);

  // Point en cours de relevé : marqueur déplaçable
  useEffect(() => {
    const map = mapRef.current;
    const ml = mlRef.current;
    if (!ready || !map || !ml) return;
    if (!draft) {
      draftMarker.current?.remove();
      draftMarker.current = null;
      return;
    }
    if (!draftMarker.current) {
      const el = document.createElement("div");
      el.className = "draftpin";
      el.setAttribute("data-testid", "draft-pin");
      el.innerHTML = '<span class="draftpin__dot"></span><span class="draftpin__hint">Glisse pour ajuster</span>';
      draftMarker.current = new ml.Marker({ element: el, anchor: "center", draggable: true }).setLngLat(gameToLngLat(draft.x, draft.y)).addTo(map);
      draftMarker.current.on("dragend", () => {
        const ll = draftMarker.current!.getLngLat();
        const [x, y] = lngLatToGame(ll.lng, ll.lat);
        cb.current.onDraftMove(x, y);
      });
    } else {
      draftMarker.current.setLngLat(gameToLngLat(draft.x, draft.y));
    }
  }, [ready, draft]);

  // « Poser au centre » : coordonnées du centre de la zone visible
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !pickCenterNonce) return;
    const c = map.getContainer();
    const o = occ.current;
    const px: [number, number] = [o.left + (c.clientWidth - o.left) / 2, o.top + (c.clientHeight - o.top - o.bottom) / 2];
    const ll = map.unproject(px);
    const [x, y] = lngLatToGame(ll.lng, ll.lat);
    cb.current.onPick(x, y);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickCenterNonce]);

  // Retour sur l'onglet : la carte n'est pas recréée, on s'assure seulement de sa taille.
  useEffect(() => {
    if (active && ready) mapRef.current?.resize();
  }, [active, ready]);

  const retryTiles = async () => {
    const map = mapRef.current;
    if (!map) return;
    if (await tilesReachable()) {
      setTileError(false);
      (map.getSource("leonida") as unknown as { setTiles: (t: string[]) => void }).setTiles([assetUrl("tiles/") + "{z}/{x}/{y}.jpg?r=" + Date.now()]);
    }
  };

  // Données des lieux gtadb
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource("landmarks") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: landmarks.map((l) => {
        const cat = poiCategory(l);
        return { type: "Feature", properties: { id: l.id, cat, minz: POI_CATS[cat].minZoom, rank: POI_CATS[cat].rank + (poiStatus(l) === "uncertain" ? 0.5 : 0), named: l.name === "Lieu non identifié" ? 0 : 1 }, geometry: { type: "Point", coordinates: gameToLngLat(l.x, l.y) } };
      }),
    });
  }, [ready, landmarks]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    map.setLayoutProperty("lm", "visibility", showLandmarks ? "visible" : "none");
    map.setLayoutProperty("lm-label", "visibility", showLandmarks ? "visible" : "none");
    map.setFilter("lm", lmFilter(poiCats));
    map.setFilter("lm-label", labelFilter(poiCats));
    map.setFilter("lm-sel", ["==", ["get", "id"], selectedLandmarkId ?? ""]);
  }, [ready, showLandmarks, selectedLandmarkId, poiKey]);

  // Zones de recherche : cercles calculés en coordonnées de jeu puis projetés
  const zoneKey = zones.map((z) => `${z.id}:${z.x}:${z.y}:${z.radius}:${z.color}`).join("|") + `#${selectedZoneId ?? ""}`;
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const circle = (z: { x: number; y: number; radius: number }) => {
      const ring: [number, number][] = [];
      for (let i = 0; i <= 48; i++) {
        const a = (i / 48) * Math.PI * 2;
        ring.push(gameToLngLat(z.x + Math.cos(a) * z.radius, z.y + Math.sin(a) * z.radius));
      }
      return ring;
    };
    (map.getSource("zones") as GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: zones.map((z) => ({ type: "Feature", properties: { id: z.id, color: z.color, sel: z.id === selectedZoneId ? 1 : 0, r: z.radius }, geometry: { type: "Polygon", coordinates: [circle(z)] } })),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, zoneKey]);

  // Recentrage sur une zone sélectionnée : toute la zone doit être visible
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !selectedZoneId) return;
    const z = zones.find((x) => x.id === selectedZoneId);
    if (!z) return;
    map.fitBounds([gameToLngLat(z.x - z.radius, z.y - z.radius), gameToLngLat(z.x + z.radius, z.y + z.radius)], { padding: padding(), duration: 850, maxZoom: 6.2 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, focusNonce, selectedZoneId, occlusion.bottom, occlusion.left]);

  // Recentrage sur la sélection (découverte ou lieu)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    let target: [number, number] | null = null;
    if (selectedId) {
      const m = markers.find((x) => x.discovery.id === selectedId);
      if (m) target = [m.discovery.x, m.discovery.y];
    } else if (draft) {
      target = [draft.x, draft.y];
    } else if (selectedLandmarkId) {
      const l = landmarks.find((x) => x.id === selectedLandmarkId);
      if (l) target = [l.x, l.y];
    }
    if (!target) return;
    const z = selectedLandmarkId && !selectedId && !draft ? POI_ZOOM : FOCUS_ZOOM;
    const go = () => map.easeTo({ center: gameToLngLat(target![0], target![1]), zoom: Math.max(map.getZoom(), z), padding: padding(), duration: 850 });
    go();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, focusNonce, selectedId, selectedLandmarkId, occlusion.bottom, occlusion.left, draft ? "d" : ""]);

  // Visibilité des marqueurs selon les filtres
  const visible = new Set(markers.filter((m) => m.visible).map((m) => m.discovery.id));
  useEffect(() => {
    for (const [id, el] of Object.entries(els)) el.style.display = visible.has(id) ? "" : "none";
  });

  const fit = () => mapRef.current?.fitBounds(landBounds(), { padding: padding(), duration: 700 });
  const showRegionLabels = zoom < 4.3;

  if (failed) {
    return (
      <div className="map map--failed">
        <p>La carte n&apos;a pas pu démarrer sur cet appareil (WebGL indisponible).</p>
      </div>
    );
  }

  return (
    <div className={`map ${showRegionLabels ? "" : "map--deep"}${pickMode ? " map--pick" : ""}`} style={{ ["--ms" as string]: Math.min(1, Math.max(0.6, 0.6 + (zoom - 1.5) * 0.12)) }}>
      <div ref={box} className="map__gl" />
      {pickMode && !draft && (
        <div className="reticle" style={{ left: occlusion.left + (0) , top: occlusion.top, bottom: occlusion.bottom }} aria-hidden>
          <span />
        </div>
      )}
      {tileError && (
        <div className="maperr" role="alert" data-testid="tile-error">
          <Icon name="alert" size={16} />
          <span>Fond de carte indisponible. Les repères restent utilisables.</span>
          <button onClick={retryTiles}>Réessayer</button>
        </div>
      )}
      {!ready && <div className="map__loading"><span className="spinner" /> Chargement de Leonida…</div>}

      {zones.filter((z) => z.id === selectedZoneId).map((z) => (
        <div key={z.id} className="zonetag" style={{ top: occlusion.top + 10, left: occlusion.left + 12 }} data-testid="zone-tag">
          <Icon name="target" size={13} /> Zone approximative · {z.label}
        </div>
      ))}
      {markers.map(({ discovery: d, status, fresh, tracked }) => {
        const el = els[d.id];
        if (!el) return null;
        const c = CATEGORIES[d.category];
        const selected = d.id === selectedId;
        const hidden = status === "hidden";
        return createPortal(
          <div
            className={`mk mk--${status}${selected ? " is-selected" : ""}${fresh ? " is-fresh" : ""}`}
            style={{ ["--c" as string]: hidden ? "#8a8fa8" : c.color }}
            role="button"
            aria-label={hidden ? "Découverte masquée (anti-spoiler)" : `${d.title} — ${c.label}`}
            data-testid={`marker-${d.id}`}
          >
            <span className="mk__pin">
              {hidden ? <b>?</b> : <Icon name={status === "done" ? "check" : status === "locked" ? "lock" : status === "chapter" ? "clock" : c.icon} size={15} stroke={2.2} />}
            </span>
            {tracked && <span className="mk__tracked"><Icon name="bookmark" size={9} stroke={3} /></span>}
            {(selected || fresh) && !hidden && <span className="mk__label">{d.title}</span>}
          </div>,
          el,
          d.id,
        );
      })}

      <div className="map__legend" style={{ bottom: occlusion.bottom + 8, left: occlusion.left + 10 }}>
        Carte communautaire <a href={GTADB_URL} target="_blank" rel="noreferrer">gtadb.org</a> · <a href={CC_BY_URL} target="_blank" rel="noreferrer">CC BY 4.0</a> · non officielle
      </div>
      <div className="map__ctrl" style={{ bottom: occlusion.bottom + 28 }}>
        <button onClick={() => mapRef.current?.zoomIn()} aria-label="Zoomer"><Icon name="plus" /></button>
        <button onClick={() => mapRef.current?.zoomOut()} aria-label="Dézoomer"><Icon name="minus" /></button>
        <button onClick={fit} aria-label="Vue d'ensemble"><Icon name="locate" /></button>
      </div>
    </div>
  );
}
