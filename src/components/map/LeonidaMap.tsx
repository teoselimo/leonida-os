"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Map as MLMap, Marker, GeoJSONSource, FilterSpecification } from "maplibre-gl";
import { CATEGORIES } from "@/lib/meta";
import { assetUrl, CC_BY_URL, gameToLngLat, GTADB_URL, LAND, lngLatToGame } from "@/lib/gtadb";
import { Icon } from "@/components/ui/Icon";
import type { MapViewProps } from "./types";
import { POI_CATS, poiCategory, poiKind, poiName, poiStatus } from "@/lib/poi";
import { drawCluster, drawDistrict, drawKind } from "./icons";
import type { PoiKind } from "./icons";
import { ESTABLISHMENTS } from "@/data/establishments";
import type { PoiCat } from "@/lib/poi";
import type { Landmark } from "@/lib/gtadb";

const FOCUS_ZOOM = 4.9;
/** Zoom d'arrivée sur un lieu précis : assez près pour lire les commerces voisins. */
const POI_ZOOM = 5.8;

/**
 * Filtre des repères : zoom minimal de la catégorie (apparition progressive), catégories choisies, conditions en plus.
 * MapLibre n'accepte « zoom » qu'en tête d'un step : les autres conditions vont dans chaque palier.
 */
function zoomFilter(cats: PoiCat[] | null | undefined, extra: unknown[] = [], offset = 0): FilterSpecification {
  const base = [...(cats && cats.length ? [["in", ["get", "cat"], ["literal", cats]]] : []), ...extra];
  const at = (z: number) => ["all", ["<=", ["get", "minz"], z - offset], ...base];
  const steps = [...new Set([...Object.values(POI_CATS).map((c) => c.minZoom), 7].map((z) => z + offset))].sort((a, b) => a - b);
  return ["step", ["zoom"], at(0), ...steps.flatMap((z) => [z, at(z)])] as unknown as FilterSpecification;
}
const lmFilter = (cats: PoiCat[] | null | undefined) => zoomFilter(cats);
/** Noms : lieux identifiés, catégories utiles (pas les milliers d'« autres lieux »), un cran de zoom après l'icône. */
const labelFilter = (cats: PoiCat[] | null | undefined) => zoomFilter(cats, [["==", ["get", "named"], 1], ["!=", ["get", "cat"], "autre"]], 1);

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
/** Comparaison V0.15 : « ?carte=v014 » rend l'ancien fond (z4, 2048 px, sombre) et les anciens symboles. */
const LEGACY = typeof window !== "undefined" && /[?&]carte=v014\b/.test(window.location.search);
/** Repères gtadb qui sont la position d'un établissement confirmé (anneau blanc sur le pictogramme). */
const EST_LM = new Set(ESTABLISHMENTS.map((e) => e.position?.landmarkId).filter((x): x is string => !!x));

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
  const { regions, markers, selectedId, onSelect, focusNonce, occlusion, landmarks, showLandmarks, selectedLandmarkId, onSelectLandmark, pickMode, onPick, pickCenterNonce, draft, onDraftMove, active, zones = [], selectedZoneId = null, onSelectZone, view = null } = props;
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
          maxZoom: LEGACY ? 8.6 : 8.4,
          minZoom: 0.6,
          renderWorldCopies: false,
          maxBounds: [gameToLngLat(Math.max(-16300, LAND.minX - 6000), Math.max(-16300, LAND.minY - 6000)), gameToLngLat(Math.min(16300, LAND.maxX + 6000), Math.min(16300, LAND.maxY + 6000))],
          bounds: landBounds(),
          fitBoundsOptions: { padding: padding() },
          style: {
            version: 8,
            sources: {
              // V0.15 : niveau natif z5 (fond « day » gtadb à 2 px par unité de jeu) ; tuiles de 2048 px déclarées en 1024
              // pour que l'écran Retina reçoive le niveau de détail supérieur au lieu d'un agrandissement flou.
              leonida: { type: "raster", tiles: [assetUrl("tiles/") + "{z}/{x}/{y}.jpg"], tileSize: LEGACY ? 2048 : 1024, minzoom: 0, maxzoom: LEGACY ? 4 : 5, bounds: [-135, -74.0195, 67.5, 79.1713] },
              lmf: { type: "geojson", data: { type: "FeatureCollection", features: [] }, cluster: true, clusterMaxZoom: 5, clusterRadius: 44 },
              districts: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
              landmarks: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
              zones: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
            },
            layers: [
              { id: "bg", type: "background", paint: { "background-color": "#071019" } },
              { id: "base", type: "raster", source: "leonida", paint: LEGACY ? { "raster-brightness-max": 0.72, "raster-saturation": -0.25, "raster-contrast": 0.12, "raster-fade-duration": 120 } : { "raster-brightness-max": 0.9, "raster-saturation": -0.06, "raster-contrast": 0.05, "raster-fade-duration": 120, "raster-resampling": "linear" } },
              // Noms de quartiers (calculés depuis les repères) entre la vue d'île et la vue de rue
              { id: "dist", type: "symbol", source: "districts", minzoom: 3.2, maxzoom: 6.6, layout: { "icon-image": ["concat", "dist:", ["get", "name"]], "icon-allow-overlap": false, "symbol-sort-key": ["-", 0, ["get", "n"]] } },
              // Zones de recherche approximatives (Garage des légendes) : remplissage léger + contour pointillé
              { id: "zones-fill", type: "fill", source: "zones", filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": ["get", "color"], "fill-opacity": ["case", ["==", ["get", "sel"], 1], 0.28, 0.14] } },
              {
                id: "zones-line",
                type: "line",
                source: "zones",
                filter: ["==", ["geometry-type"], "Polygon"],
                paint: { "line-color": ["get", "color"], "line-width": ["case", ["==", ["get", "sel"], 1], 2.6, 1.4], "line-dasharray": [2, 1.5], "line-opacity": 0.9 },
              },
              // Parcours d'un véhicule mobile (référentiel vérifié) : trait plein, halo sombre
              { id: "zones-route-halo", type: "line", source: "zones", filter: ["==", ["geometry-type"], "LineString"], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#071019", "line-width": ["interpolate", ["linear"], ["zoom"], 3, 4, 7, 9], "line-opacity": 0.6 } },
              { id: "zones-route", type: "line", source: "zones", filter: ["==", ["geometry-type"], "LineString"], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["get", "color"], "line-width": ["interpolate", ["linear"], ["zoom"], 3, 2, 7, 5] } },
              // Position calibrée : pastille au centre du cercle d'incertitude (jamais une épingle « validée »)
              { id: "zones-dot", type: "circle", source: "zones", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 4, 7, 8], "circle-color": ["get", "color"], "circle-stroke-color": "#fff", "circle-stroke-width": 2 } },
              // Noms des lieux à partir d'un zoom de quartier (une image par nom, créée à la demande)
              {
                id: "lm-label",
                type: "symbol",
                source: "landmarks",
                minzoom: 4.4,
                filter: labelFilter(null),
                layout: {
                  "icon-image": ["concat", "lbl:", ["get", "id"]],
                  "icon-anchor": "left",
                  "icon-offset": LEGACY ? [16, 0] : [21, 0],
                  "icon-allow-overlap": false,
                  "symbol-sort-key": ["get", "rank"],
                },
              },
              // Repères communautaires : icônes par catégorie (images dessinées sur canvas, sans serveur de polices),
              // apparition progressive selon le zoom et l'importance, collisions gérées par MapLibre.
              {
                id: "lm",
                type: "symbol",
                source: "landmarks",
                filter: lmFilter(null),
                layout: {
                  "icon-image": LEGACY ? ["concat", "cat:", ["get", "cat"]] : ["concat", "k:", ["get", "kind"], ":", ["get", "est"]],
                  "icon-size": ["interpolate", ["linear"], ["zoom"], 2, 0.72, 5, 0.9, 7, 1.05],
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
              // Filtre actif : ses résultats visibles tout de suite, regroupés quand ils sont trop proches
              { id: "lmf-cl", type: "symbol", source: "lmf", filter: ["has", "point_count"], layout: { "icon-image": ["concat", "cl:", ["to-string", ["get", "point_count"]]], "icon-allow-overlap": true, visibility: "none" } },
              { id: "lmf-pt", type: "symbol", source: "lmf", filter: ["!", ["has", "point_count"]], layout: { "icon-image": ["concat", "k:", ["get", "kind"], ":", ["get", "est"]], "icon-size": 0.95, "icon-allow-overlap": false, "symbol-sort-key": ["get", "rank"], visibility: "none" } },
              // Le lieu sélectionné reste affiché même si ses voisins le chevauchent
              { id: "lm-sel-icon", type: "symbol", source: "landmarks", filter: ["==", ["get", "id"], ""], layout: { "icon-image": ["concat", "k:", ["get", "kind"], ":", ["get", "est"]], "icon-size": 1.25, "icon-allow-overlap": true, "icon-ignore-placement": true } },
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
          const box: [[number, number], [number, number]] = [[p.x - 14, p.y - 14], [p.x + 14, p.y + 14]];
          const cl = map!.getLayoutProperty("lmf-cl", "visibility") !== "none" ? map!.queryRenderedFeatures(box, { layers: ["lmf-cl"] }) : [];
          if (cl.length) {
            const f = cl[0];
            const src = map!.getSource("lmf") as GeoJSONSource;
            void src.getClusterExpansionZoom(Number(f.properties?.cluster_id)).then((z) => {
              map!.easeTo({ center: (f.geometry as unknown as { coordinates: [number, number] }).coordinates, zoom: Math.min(z + 0.2, 8), duration: 600 });
            });
            return;
          }
          const layersHit = ["lm", "lm-label", "lmf-pt", "lm-sel-icon"].filter((l) => map!.getLayer(l) && map!.getLayoutProperty(l, "visibility") !== "none");
          const hits = layersHit.length ? map!.queryRenderedFeatures(box, { layers: layersHit }) : [];
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
          if (id.startsWith("k:")) {
            const [, kind, est] = id.split(":");
            map!.addImage(id, drawKind(kind as PoiKind, est === "1"), { pixelRatio: 2 });
          } else if (id.startsWith("cl:")) {
            map!.addImage(id, drawCluster(Number(id.slice(3)) || 0), { pixelRatio: 2 });
          } else if (id.startsWith("dist:")) {
            map!.addImage(id, drawDistrict(id.slice(5)), { pixelRatio: 2 });
          } else if (id.startsWith("cat:")) {
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
  // V0.14 : le panneau LEONIDA iPad se range à côté de la carte → la carte suit la taille de son conteneur
  useEffect(() => {
    const el = box.current;
    if (!el || !ready || typeof ResizeObserver === "undefined") return;
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => mapRef.current?.resize());
    });
    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [ready]);

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
        const est = EST_LM.has(l.id) ? 1 : 0;
        // établissements confirmés d'abord, puis métiers précis, puis catégorie
        const rank = POI_CATS[cat].rank - est * 1.5 + (poiStatus(l) === "uncertain" ? 0.5 : 0);
        const named = l.name === "Lieu non identifié" ? 0 : 1;
        // V0.15 : les milliers de bâtiments sans nom ne couvrent plus la carte (toujours trouvables par la recherche)
        const minz = est ? Math.min(POI_CATS[cat].minZoom, 2) : cat === "autre" && !LEGACY ? (named ? 7 : 99) : POI_CATS[cat].minZoom;
        return { type: "Feature", properties: { id: l.id, cat, kind: poiKind(l), est, minz, rank, named }, geometry: { type: "Point", coordinates: gameToLngLat(l.x, l.y) } };
      }),
    });
    // quartiers : centre des repères qui partagent le même premier élément d'adresse (au moins 6)
    const groups = new Map<string, { x: number; y: number; n: number }>();
    for (const l of landmarks) {
      const d = (l.district || "").split(",")[0].trim();
      if (!d || d === "Leonida" || /county/i.test(d) || /\b(route|street|st|ave|avenue|blvd|boulevard|road|rd|highway|hwy|drive|dr|way|lane|ln)\b|\d/i.test(d)) continue;
      const g = groups.get(d) ?? { x: 0, y: 0, n: 0 };
      g.x += l.x;
      g.y += l.y;
      g.n++;
      groups.set(d, g);
    }
    (map.getSource("districts") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: LEGACY ? [] : [...groups].filter(([, g]) => g.n >= 6).map(([name, g]) => ({ type: "Feature", properties: { name, n: g.n }, geometry: { type: "Point", coordinates: gameToLngLat(g.x / g.n, g.y / g.n) } })),
    });
  }, [ready, landmarks]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    // filtre de catégorie (V0.15) : résultats visibles à tous les zooms, regroupés ; sans filtre, apparition par zoom
    const filtered = !LEGACY && showLandmarks && poiCats.length > 0;
    map.setLayoutProperty("lm", "visibility", showLandmarks && !filtered ? "visible" : "none");
    map.setLayoutProperty("lm-label", "visibility", showLandmarks ? "visible" : "none");
    map.setLayoutProperty("lmf-cl", "visibility", filtered ? "visible" : "none");
    map.setLayoutProperty("lmf-pt", "visibility", filtered ? "visible" : "none");
    (map.getSource("lmf") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: filtered
        ? landmarks.filter((l) => poiCats.includes(poiCategory(l))).map((l) => ({ type: "Feature" as const, properties: { id: l.id, kind: poiKind(l), est: EST_LM.has(l.id) ? 1 : 0, rank: EST_LM.has(l.id) ? 0 : 1 }, geometry: { type: "Point" as const, coordinates: gameToLngLat(l.x, l.y) } }))
        : [],
    });
    map.setFilter("lm", lmFilter(poiCats));
    map.setFilter("lm-label", labelFilter(poiCats));
    map.setFilter("lm-sel", ["==", ["get", "id"], selectedLandmarkId ?? ""]);
    if (!LEGACY) map.setFilter("lm-sel-icon", ["==", ["get", "id"], selectedLandmarkId ?? ""]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, showLandmarks, selectedLandmarkId, poiKey, landmarks]);

  // Zones de recherche : cercles calculés en coordonnées de jeu puis projetés
  const zoneKey = zones.map((z) => `${z.id}:${z.x}:${z.y}:${z.radius}:${z.color}:${z.kind ?? ""}:${z.path?.length ?? 0}`).join("|") + `#${selectedZoneId ?? ""}`;
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
      features: zones.flatMap((z) => {
        const props = { id: z.id, color: z.color, sel: z.id === selectedZoneId ? 1 : z.kind === "point" ? 1 : 0, r: z.radius };
        const out: GeoJSON.Feature[] = [{ type: "Feature", properties: props, geometry: { type: "Polygon", coordinates: [circle(z)] } }];
        for (const line of z.path ?? []) out.push({ type: "Feature", properties: props, geometry: { type: "LineString", coordinates: line.map(([x, y]) => gameToLngLat(x, y)) } });
        if (z.kind === "calibre") out.push({ type: "Feature", properties: props, geometry: { type: "Point", coordinates: gameToLngLat(z.x, z.y) } });
        return out;
      }),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, zoneKey]);

  // Recentrage sur une zone sélectionnée : toute la zone doit être visible
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !selectedZoneId) return;
    const z = zones.find((x) => x.id === selectedZoneId);
    if (!z) return;
        const r = Math.max(z.radius, z.kind === "point" ? 260 : z.kind === "calibre" ? 120 : 0);
    map.fitBounds([gameToLngLat(z.x - r, z.y - r), gameToLngLat(z.x + r, z.y + r)], { padding: padding(), duration: 850, maxZoom: z.kind === "calibre" || z.path ? 7 : 6.2 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, focusNonce, selectedZoneId, occlusion.bottom, occlusion.left]);

  // Cadrage d'une liste de lieux (sans dessin) : jusqu'au zoom où les icônes de commerces apparaissent
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !view) return;
    const r = Math.max(view.radius, 350);
    map.fitBounds([gameToLngLat(view.x - r, view.y - r), gameToLngLat(view.x + r, view.y + r)], { padding: padding(), duration: 850, maxZoom: 5.2 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, view?.nonce]);

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
          <Icon name="target" size={13} /> {z.kind === "point" ? (z.tag ?? "Position") : (z.tag ?? "Zone estimée")} · {z.label}
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

      <MapCredits bottom={occlusion.bottom + 10} left={occlusion.left + 10} />
      <div className="map__ctrl" style={{ bottom: occlusion.bottom + 28 }}>
        <button onClick={() => mapRef.current?.zoomIn()} aria-label="Zoomer"><Icon name="plus" /></button>
        <button onClick={() => mapRef.current?.zoomOut()} aria-label="Dézoomer"><Icon name="minus" /></button>
      </div>
    </div>
  );
}

/**
 * Attribution CC BY 4.0 compacte (V0.15.1) : un contrôle « ⓘ GTADB » toujours visible ; au toucher, la source,
 * la licence, les modifications apportées au fond et la mention « non officielle ».
 */
function MapCredits({ bottom, left }: { bottom: number; left: number }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", away);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", away);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div className="mapcred" ref={ref} style={{ bottom, left }} onClick={(e) => e.stopPropagation()}>
      {open && (
        <div className="mapcred__card" role="dialog" aria-label="Crédits de la carte" data-testid="map-credits-card">
          <div className="mapcred__head">
            <strong>Carte communautaire non officielle</strong>
            <button onClick={() => setOpen(false)} aria-label="Fermer les crédits"><Icon name="close" size={14} /></button>
          </div>
          <p>Fond de carte et lieux : <a href={GTADB_URL} target="_blank" rel="noreferrer">GTA VI Map Tiles &amp; Landmarks Data — map.gtadb.org</a> (GTADB et contributeurs).</p>
          <p>Licence : <a href={CC_BY_URL} target="_blank" rel="noreferrer">Creative Commons Attribution 4.0 (CC BY 4.0)</a>.</p>
          <p>Modifications par LEONIDA OS : tuiles réassemblées et recompressées, rendu légèrement ajusté (luminosité, couleurs), données de lieux réduites, pictogrammes et noms de quartiers ajoutés.</p>
          <p className="mapcred__muted">Projet de fans, sans lien avec Rockstar Games ni Take-Two.</p>
        </div>
      )}
      <button className="mapcred__btn" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-label="Crédits de la carte : GTADB, licence CC BY 4.0" data-testid="map-credits">
        <Icon name="info" size={12} /> GTADB
      </button>
    </div>
  );
}
