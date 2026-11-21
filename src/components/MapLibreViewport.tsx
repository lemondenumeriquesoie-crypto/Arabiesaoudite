import React, { useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';

// Ensure MapLibre GL JS v6 loads its Web Worker reliably under Vite pre-bundling & production builds
maplibregl.setWorkerUrl(maplibreWorkerUrl);
import {
  DUBAI_HATTA_CUTOUT,
  DUBAI_MAIN_CUTOUT,
  DUBAI_MAX_BOUNDS,
  KSA_ILLUMINATED_CUTOUT,
  KSA_SOVEREIGN_BORDER,
  MAP_LOCATIONS,
  MARKER_CATEGORIES,
  MASTER_HIGHWAYS,
  MapLocation,
  MapStyleId,
  SAUDI_MAX_BOUNDS,
  SAUDI_PROVINCES,
  WORLD_DEFAULT_VIEW,
  WorldId,
} from '../map/mapData';
import {
  buildCoordinateGridGeoJSON,
  buildHighwaysGeoJSON,
  buildInvertedMaskGeoJSON,
  buildProvincesGeoJSON,
  computeTacticalGridSector,
  findProvinceAtGeo,
  formatGeodesicDistance,
  haversineDistanceMeters,
} from '../map/geoUtils';
import { TacticalFiltersState } from './TacticalSidebar';
import { SelectedMapEntity } from './LocationInspector';

export interface FlyToCommand {
  lon: number;
  lat: number;
  zoom: number;
  nonce: number;
}

export interface LiveMapTelemetry {
  lon: number;
  lat: number;
  zoom: number;
  gridSector: string;
}

interface MapLibreViewportProps {
  worldId: WorldId;
  mapStyle: MapStyleId;
  filters: TacticalFiltersState;
  selected: SelectedMapEntity;
  measureMode: boolean;
  measurePoints: [number, number][];
  flyTo: FlyToCommand | null;
  zoomCommand: { delta: number; nonce: number } | null;
  resetNonce: number;
  onSelect: (entity: SelectedMapEntity) => void;
  onAddMeasurePoint: (pt: [number, number]) => void;
  onTelemetryChange: (t: LiveMapTelemetry) => void;
}

const CATEGORY_COLOR_MAP: Record<string, string> = Object.fromEntries(
  MARKER_CATEGORIES.map((c) => [c.id, c.color]),
);

function buildPerimeterGeoJSON(worldId: WorldId) {
  if (worldId === 'saudi_arabia') {
    return {
      type: 'FeatureCollection' as const,
      features: [
        {
          type: 'Feature' as const,
          properties: { role: 'sovereign_perimeter' },
          geometry: {
            type: 'LineString' as const,
            coordinates: KSA_SOVEREIGN_BORDER,
          },
        },
      ],
    };
  }
  return {
    type: 'FeatureCollection' as const,
    features: [
      {
        type: 'Feature' as const,
        properties: { role: 'dubai_main_perimeter' },
        geometry: {
          type: 'LineString' as const,
          coordinates: DUBAI_MAIN_CUTOUT,
        },
      },
      {
        type: 'Feature' as const,
        properties: { role: 'dubai_hatta_perimeter' },
        geometry: {
          type: 'LineString' as const,
          coordinates: DUBAI_HATTA_CUTOUT,
        },
      },
    ],
  };
}

function buildMeasureGeoJSON(points: [number, number][]) {
  return {
    line: {
      type: 'FeatureCollection' as const,
      features:
        points.length >= 2
          ? [
              {
                type: 'Feature' as const,
                properties: {},
                geometry: {
                  type: 'LineString' as const,
                  coordinates: points,
                },
              },
            ]
          : [],
    },
    nodes: {
      type: 'FeatureCollection' as const,
      features: points.map((coord, idx) => ({
        type: 'Feature' as const,
        properties: { index: idx },
        geometry: {
          type: 'Point' as const,
          coordinates: coord,
        },
      })),
    },
  };
}

export const MapLibreViewport: React.FC<MapLibreViewportProps> = ({
  worldId,
  mapStyle,
  filters,
  selected,
  measureMode,
  measurePoints,
  flyTo,
  zoomCommand,
  resetNonce,
  onSelect,
  onAddMeasurePoint,
  onTelemetryChange,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const mapLoadedRef = useRef<boolean>(false);

  // Refs for fresh state inside MapLibre DOM/event callbacks
  const worldIdRef = useRef(worldId);
  const filtersRef = useRef(filters);
  const selectedRef = useRef(selected);
  const measureModeRef = useRef(measureMode);
  const onSelectRef = useRef(onSelect);
  const onAddMeasurePointRef = useRef(onAddMeasurePoint);
  const onTelemetryRef = useRef(onTelemetryChange);

  // Managed HTML markers (destroyed/recreated cleanly only when world/filter/zoom-tier changes)
  const locationMarkersRef = useRef<Map<string, { marker: maplibregl.Marker; el: HTMLElement; loc: MapLocation }>>(new Map());
  const provinceMarkersRef = useRef<maplibregl.Marker[]>([]);
  const shieldMarkersRef = useRef<maplibregl.Marker[]>([]);
  const measureMarkersRef = useRef<maplibregl.Marker[]>([]);
  const lastTelemetryMsRef = useRef<number>(0);

  worldIdRef.current = worldId;
  filtersRef.current = filters;
  selectedRef.current = selected;
  measureModeRef.current = measureMode;
  onSelectRef.current = onSelect;
  onAddMeasurePointRef.current = onAddMeasurePoint;
  onTelemetryRef.current = onTelemetryChange;

  // Helper: sync marker visibility & selected reticle state without tearing down DOM unnecessarily
  const syncMarkersRef = useRef<() => void>(() => {});

  // 1. Mount single persistent MapLibre GL JS instance once
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const initView = WORLD_DEFAULT_VIEW[worldIdRef.current];
    const initBounds =
      worldIdRef.current === 'saudi_arabia' ? SAUDI_MAX_BOUNDS : DUBAI_MAX_BOUNDS;

    const initialStyle: maplibregl.StyleSpecification = {
      version: 8,
      sources: {
        'esri-satellite': {
          type: 'raster',
          tiles: [
            'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          ],
          tileSize: 256,
          maxzoom: 18,
          attribution: 'Esri, Maxar, Earthstar Geographics',
        },
        'esri-roads': {
          type: 'raster',
          tiles: [
            'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}',
          ],
          tileSize: 256,
          maxzoom: 18,
        },
        'esri-places': {
          type: 'raster',
          tiles: [
            'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
          ],
          tileSize: 256,
          maxzoom: 18,
        },
        'carto-voyager': {
          type: 'raster',
          tiles: [
            'https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png',
            'https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png',
            'https://c.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png',
          ],
          tileSize: 256,
          maxzoom: 19,
          attribution: '© OpenStreetMap contributors, © CARTO',
        },
      },
      layers: [
        {
          id: 'bg-ocean',
          type: 'background',
          paint: { 'background-color': '#060d18' },
        },
        {
          id: 'layer-satellite',
          type: 'raster',
          source: 'esri-satellite',
          layout: { visibility: 'visible' },
          paint: {
            'raster-contrast': 0.08,
            'raster-saturation': 0.08,
            'raster-brightness-min': 0.02,
            'raster-fade-duration': 180,
          },
        },
        {
          id: 'layer-hybrid-roads',
          type: 'raster',
          source: 'esri-roads',
          layout: { visibility: 'none' },
          paint: {
            'raster-opacity': 0.92,
            'raster-fade-duration': 150,
          },
        },
        {
          id: 'layer-hybrid-places',
          type: 'raster',
          source: 'esri-places',
          layout: { visibility: 'none' },
          paint: {
            'raster-opacity': 0.85,
            'raster-fade-duration': 150,
          },
        },
        {
          id: 'layer-atlas',
          type: 'raster',
          source: 'carto-voyager',
          layout: { visibility: 'none' },
          paint: {
            'raster-contrast': 0.06,
            'raster-saturation': -0.1,
            'raster-fade-duration': 150,
          },
        },
      ],
    };

    const map = new maplibregl.Map({
      container,
      style: initialStyle,
      center: initView.center,
      zoom: initView.zoom,
      minZoom: initView.minZoom,
      maxZoom: initView.maxZoom,
      maxBounds: [initBounds.sw, initBounds.ne],
      pitch: 0,
      maxPitch: 0,
      bearing: 0,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      attributionControl: false,
      canvasContextAttributes: {
        antialias: true,
        preserveDrawingBuffer: true,
      },
    });

    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
    mapRef.current = map;

    const rebuildWorldOverlayMarkers = () => {
      // Clear existing location, province & highway shield markers
      locationMarkersRef.current.forEach((v) => v.marker.remove());
      locationMarkersRef.current.clear();
      provinceMarkersRef.current.forEach((m) => m.remove());
      provinceMarkersRef.current = [];
      shieldMarkersRef.current.forEach((m) => m.remove());
      shieldMarkersRef.current = [];

      const wid = worldIdRef.current;

      // 1. All 13 Saudi Province uppercase serif labels (World 1 only)
      if (wid === 'saudi_arabia') {
        for (const prov of SAUDI_PROVINCES) {
          const el = document.createElement('div');
          el.className = 'pointer-events-none select-none';
          el.style.cssText =
            'font-family: "Cinzel", Georgia, serif; font-size: 11px; font-weight: 600; letter-spacing: 0.16em; color: rgba(250, 236, 200, 0.82); text-shadow: 0 1px 6px rgba(0,0,0,0.95), 0 0 14px rgba(0,0,0,0.85); white-space: nowrap; text-transform: uppercase;';
          el.textContent = prov.name
            .replace(' Province', '')
            .replace(' (Ash-Sharqiyah)', '');

          const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
            .setLngLat(prov.labelPos)
            .addTo(map);
          provinceMarkersRef.current.push(marker);
        }
      }

      // 2. Glowing Highway Route Shields (Routes 40, 15, 65, 85, 95, 10 / E11, E44, E611, D63)
      const drawnCodes = new Set<string>();
      for (const hw of MASTER_HIGHWAYS) {
        if (hw.worldId !== wid) continue;
        if (drawnCodes.has(hw.code)) continue;
        drawnCodes.add(hw.code);

        const el = document.createElement('div');
        el.className = 'pointer-events-none select-none';
        el.style.cssText =
          'font-family: "JetBrains Mono", monospace; font-size: 10px; font-weight: 700; color: #fde4a6; background: rgba(16, 13, 9, 0.92); border: 1px solid rgba(240, 192, 98, 0.9); border-radius: 3px; padding: 1px 5px; box-shadow: 0 2px 8px rgba(0,0,0,0.65); line-height: 1.3;';
        el.textContent = hw.code;

        const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
          .setLngLat(hw.shieldPos)
          .addTo(map);
        shieldMarkersRef.current.push(marker);
      }

      // 3. Categorized Real-GPS Location Markers
      const worldLocs = MAP_LOCATIONS.filter((l) => l.worldId === wid);
      for (const loc of worldLocs) {
        const color = CATEGORY_COLOR_MAP[loc.category] ?? '#f6c85f';

        // CRITICAL: Never set `position: relative` on the Marker root element — MapLibre positions it via `position: absolute; transform: translate(...)`.
        const wrapper = document.createElement('button');
        wrapper.type = 'button';
        wrapper.setAttribute('aria-label', `${loc.name} (${loc.provinceOrSector})`);
        wrapper.dataset.locId = loc.id;
        wrapper.dataset.tier = String(loc.tier);
        wrapper.dataset.category = loc.category;
        wrapper.style.cssText =
          'width: 0; height: 0; overflow: visible; padding: 0; margin: 0; border: none; background: transparent; cursor: pointer; outline: none;';

        // Precision architectural pin node centered at exact WGS84 (0,0)
        const dotSize = loc.tier === 1 ? 11 : loc.tier === 2 ? 9 : 8;
        const dot = document.createElement('span');
        dot.className = 'tactical-pin-dot';
        dot.style.cssText = `position: absolute; left: 0; top: 0; transform: translate(-50%, -50%); display: block; width: ${dotSize}px; height: ${dotSize}px; border-radius: 9999px; background: ${color}; border: 1.8px solid #120f0b; box-shadow: 0 0 0 1.5px rgba(255,255,255,0.22), 0 2px 8px rgba(0,0,0,0.85); transition: transform 140ms ease, box-shadow 140ms ease;`;

        // Crisp dark-glass label chip cleanly offset to the right without affecting dot anchor
        const label = document.createElement('span');
        label.className = 'tactical-pin-label';
        label.style.cssText =
          'position: absolute; left: 9px; top: 0; transform: translateY(-50%); font-family: "Plus Jakarta Sans", sans-serif; font-size: 11px; font-weight: 600; color: #fbf4e4; background: rgba(14, 12, 9, 0.84); border: 1px solid rgba(217, 164, 65, 0.36); border-radius: 3px; padding: 1.5px 6px; white-space: nowrap; text-shadow: 0 1px 3px rgba(0,0,0,0.9); box-shadow: 0 2px 10px rgba(0,0,0,0.55); pointer-events: none; transition: opacity 140ms ease, border-color 140ms ease;';
        // Compact label on map (full official name appears in Inspector!)
        const shortName = loc.name.length > 26 ? loc.name.split(' (')[0] : loc.name;
        label.textContent = shortName;

        wrapper.appendChild(dot);
        wrapper.appendChild(label);

        wrapper.addEventListener('mouseenter', () => {
          dot.style.transform = 'translate(-50%, -50%) scale(1.32)';
          label.style.opacity = '1';
          label.style.display = 'inline-block';
          label.style.borderColor = 'rgba(246, 200, 95, 0.85)';
          wrapper.style.zIndex = '40';
        });
        wrapper.addEventListener('mouseleave', () => {
          dot.style.transform = 'translate(-50%, -50%) scale(1)';
          wrapper.style.zIndex = '';
          syncMarkersRef.current();
        });
        wrapper.addEventListener('click', (e) => {
          e.stopPropagation();
          if (measureModeRef.current) {
            onAddMeasurePointRef.current([loc.lon, loc.lat]);
            return;
          }
          onSelectRef.current({ kind: 'location', location: loc });
        });

        const marker = new maplibregl.Marker({ element: wrapper, anchor: 'center' })
          .setLngLat([loc.lon, loc.lat])
          .addTo(map);
        locationMarkersRef.current.set(loc.id, { marker, el: wrapper, loc });
      }
    };

    const syncMarkers = () => {
      if (!mapRef.current) return;
      const z = mapRef.current.getZoom();
      const wid = worldIdRef.current;
      const flt = filtersRef.current;
      const sel = selectedRef.current;
      const selLocId = sel?.kind === 'location' ? sel.location.id : null;

      // Province label visibility
      const showProvLabels = wid === 'saudi_arabia' && flt.bordersAndGrid && z < 7.6;
      for (const pm of provinceMarkersRef.current) {
        pm.getElement().style.display = showProvLabels ? 'block' : 'none';
      }

      // Highway shield visibility
      for (const sm of shieldMarkersRef.current) {
        sm.getElement().style.display = flt.highways ? 'block' : 'none';
      }

      // Dynamic zoom-tier visibility for categorized markers
      const maxTier =
        wid === 'saudi_arabia'
          ? z >= 9.0
            ? 3
            : z >= 6.1
              ? 2
              : 1
          : z >= 12.1
            ? 3
            : z >= 10.6
              ? 2
              : 1;

      const showDetailedLabels = wid === 'saudi_arabia' ? z >= 7.6 : z >= 11.4;

      locationMarkersRef.current.forEach(({ el, loc }) => {
        const catEnabled = flt.categories[loc.category];
        const isSelected = loc.id === selLocId;
        const visible = isSelected || (catEnabled && loc.tier <= maxTier);

        el.style.display = visible ? 'block' : 'none';
        if (!visible) return;

        const dot = el.querySelector('.tactical-pin-dot') as HTMLElement | null;
        const label = el.querySelector('.tactical-pin-label') as HTMLElement | null;

        if (dot) {
          dot.style.boxShadow = isSelected
            ? '0 0 0 3px rgba(255, 218, 120, 0.95), 0 0 14px rgba(246, 200, 95, 0.85)'
            : '0 0 0 1.5px rgba(255,255,255,0.22), 0 2px 8px rgba(0,0,0,0.85)';
        }
        if (label) {
          const keepLabel = isSelected || loc.tier === 1 || showDetailedLabels;
          label.style.display = keepLabel ? 'inline-block' : 'none';
          label.style.borderColor = isSelected
            ? 'rgba(255, 216, 118, 0.95)'
            : 'rgba(217, 164, 65, 0.34)';
          label.style.color = isSelected ? '#ffe7a6' : '#fbf4e4';
        }
        el.style.zIndex = isSelected ? '35' : loc.tier === 1 ? '15' : '10';
      });
    };

    syncMarkersRef.current = syncMarkers;

    map.on('load', () => {
      mapLoadedRef.current = true;
      const wid = worldIdRef.current;

      // Add GeoJSON sources
      map.addSource('mask-source', {
        type: 'geojson',
        data: buildInvertedMaskGeoJSON(
          wid === 'saudi_arabia'
            ? [KSA_ILLUMINATED_CUTOUT]
            : [DUBAI_MAIN_CUTOUT, DUBAI_HATTA_CUTOUT],
        ),
      });

      map.addSource('perimeter-source', {
        type: 'geojson',
        data: buildPerimeterGeoJSON(wid),
      });

      map.addSource('grid-source', {
        type: 'geojson',
        data: buildCoordinateGridGeoJSON(wid),
      });

      map.addSource('provinces-source', {
        type: 'geojson',
        data: buildProvincesGeoJSON(),
      });

      map.addSource('highways-source', {
        type: 'geojson',
        data: buildHighwaysGeoJSON(wid),
      });

      const initMeasure = buildMeasureGeoJSON([]);
      map.addSource('measure-line-source', {
        type: 'geojson',
        data: initMeasure.line,
      });
      map.addSource('measure-points-source', {
        type: 'geojson',
        data: initMeasure.nodes,
      });

      // Layer 1: Dark AAA Geopolitical Inverted Fog-of-War Mask outside KSA / Dubai
      map.addLayer({
        id: 'mask-fill',
        type: 'fill',
        source: 'mask-source',
        paint: {
          'fill-color': '#060a11',
          'fill-opacity': 0.80,
        },
      });

      // Layer 2: Coordinate Grid
      map.addLayer({
        id: 'grid-lines',
        type: 'line',
        source: 'grid-source',
        layout: {
          visibility: filtersRef.current.bordersAndGrid ? 'visible' : 'none',
        },
        paint: {
          'line-color': 'rgba(235, 198, 122, 0.22)',
          'line-width': 0.85,
          'line-dasharray': [3, 3],
        },
      });

      // Layer 3: All 13 Saudi Provinces (World 1)
      map.addLayer({
        id: 'provinces-fill',
        type: 'fill',
        source: 'provinces-source',
        layout: {
          visibility:
            wid === 'saudi_arabia' && filtersRef.current.bordersAndGrid ? 'visible' : 'none',
        },
        paint: {
          'fill-color': '#e8b954',
          'fill-opacity': 0.0,
        },
      });

      map.addLayer({
        id: 'provinces-outline',
        type: 'line',
        source: 'provinces-source',
        layout: {
          visibility:
            wid === 'saudi_arabia' && filtersRef.current.bordersAndGrid ? 'visible' : 'none',
        },
        paint: {
          'line-color': 'rgba(242, 200, 112, 0.62)',
          'line-width': ['interpolate', ['linear'], ['zoom'], 4.5, 1.0, 9, 1.8],
        },
      });

      // Layer 4: Illuminated Territorial Perimeter Glow + Crisp Gold Border
      map.addLayer({
        id: 'perimeter-glow',
        type: 'line',
        source: 'perimeter-source',
        paint: {
          'line-color': 'rgba(245, 194, 88, 0.34)',
          'line-width': 6,
          'line-blur': 3,
        },
      });

      map.addLayer({
        id: 'perimeter-line',
        type: 'line',
        source: 'perimeter-source',
        paint: {
          'line-color': '#f9d88b',
          'line-width': 1.8,
        },
      });

      // Layer 5: Glowing Amber National Highways (Routes 40, 15, 65, 85, 95, 10 / Dubai E11, E44, E611, D63)
      map.addLayer({
        id: 'highways-glow',
        type: 'line',
        source: 'highways-source',
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
          visibility: filtersRef.current.highways ? 'visible' : 'none',
        },
        paint: {
          'line-color': 'rgba(245, 166, 48, 0.32)',
          'line-width': ['interpolate', ['linear'], ['zoom'], 4.5, 4.5, 12, 8],
          'line-blur': 2,
        },
      });

      map.addLayer({
        id: 'highways-core',
        type: 'line',
        source: 'highways-source',
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
          visibility: filtersRef.current.highways ? 'visible' : 'none',
        },
        paint: {
          'line-color': '#ffd77d',
          'line-width': ['interpolate', ['linear'], ['zoom'], 4.5, 1.6, 12, 2.8],
        },
      });

      // Layer 6: GTA 6 Distance Measurement Ruler Line & Vertex Nodes
      map.addLayer({
        id: 'measure-line-glow',
        type: 'line',
        source: 'measure-line-source',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': 'rgba(79, 214, 208, 0.42)',
          'line-width': 7,
          'line-blur': 2,
        },
      });

      map.addLayer({
        id: 'measure-line-core',
        type: 'line',
        source: 'measure-line-source',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#6ef2ec',
          'line-width': 2.4,
          'line-dasharray': [2.5, 1.8],
        },
      });

      map.addLayer({
        id: 'measure-points',
        type: 'circle',
        source: 'measure-points-source',
        paint: {
          'circle-radius': 5.5,
          'circle-color': '#6ef2ec',
          'circle-stroke-color': '#0e1116',
          'circle-stroke-width': 2,
        },
      });

      rebuildWorldOverlayMarkers();
      syncMarkers();

      // Emit initial telemetry
      onTelemetryRef.current({
        lon: initView.center[0],
        lat: initView.center[1],
        zoom: map.getZoom(),
        gridSector: computeTacticalGridSector(
          initView.center[0],
          initView.center[1],
          wid,
        ),
      });
    });

    // Live cursor WGS84 GPS + Tactical Grid Sector telemetry
    map.on('mousemove', (e) => {
      const now = performance.now();
      if (now - lastTelemetryMsRef.current < 70) return;
      lastTelemetryMsRef.current = now;
      const lon = e.lngLat.lng;
      const lat = e.lngLat.lat;
      onTelemetryRef.current({
        lon,
        lat,
        zoom: map.getZoom(),
        gridSector: computeTacticalGridSector(lon, lat, worldIdRef.current),
      });
    });

    map.on('zoom', () => {
      syncMarkers();
      const c = map.getCenter();
      onTelemetryRef.current({
        lon: c.lng,
        lat: c.lat,
        zoom: map.getZoom(),
        gridSector: computeTacticalGridSector(c.lng, c.lat, worldIdRef.current),
      });
    });

    map.on('click', (e) => {
      const lon = e.lngLat.lng;
      const lat = e.lngLat.lat;

      if (measureModeRef.current) {
        onAddMeasurePointRef.current([lon, lat]);
        return;
      }

      if (worldIdRef.current === 'saudi_arabia') {
        const prov = findProvinceAtGeo(lon, lat);
        onSelectRef.current(prov ? { kind: 'province', province: prov } : null);
      } else {
        onSelectRef.current(null);
      }
    });

    // Store helper on map instance so world switch can rebuild markers cleanly
    (map as unknown as { __rebuildMarkers?: () => void }).__rebuildMarkers =
      rebuildWorldOverlayMarkers;

    return () => {
      locationMarkersRef.current.forEach((v) => v.marker.remove());
      locationMarkersRef.current.clear();
      provinceMarkersRef.current.forEach((m) => m.remove());
      shieldMarkersRef.current.forEach((m) => m.remove());
      measureMarkersRef.current.forEach((m) => m.remove());
      map.remove();
      mapRef.current = null;
      mapLoadedRef.current = false;
    };
  }, []);

  // 2. Switch between World 1 (Saudi Arabia) & World 2 (Dubai — Separate Territory)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current) return;

    const view = WORLD_DEFAULT_VIEW[worldId];
    const bounds = worldId === 'saudi_arabia' ? SAUDI_MAX_BOUNDS : DUBAI_MAX_BOUNDS;

    // Update inverted fog-of-war mask, territorial outline, highways, and grid sources
    const maskSrc = map.getSource('mask-source') as maplibregl.GeoJSONSource | undefined;
    maskSrc?.setData(
      buildInvertedMaskGeoJSON(
        worldId === 'saudi_arabia'
          ? [KSA_ILLUMINATED_CUTOUT]
          : [DUBAI_MAIN_CUTOUT, DUBAI_HATTA_CUTOUT],
      ),
    );

    const perimSrc = map.getSource('perimeter-source') as maplibregl.GeoJSONSource | undefined;
    perimSrc?.setData(buildPerimeterGeoJSON(worldId));

    const gridSrc = map.getSource('grid-source') as maplibregl.GeoJSONSource | undefined;
    gridSrc?.setData(buildCoordinateGridGeoJSON(worldId));

    const hwSrc = map.getSource('highways-source') as maplibregl.GeoJSONSource | undefined;
    hwSrc?.setData(buildHighwaysGeoJSON(worldId));

    // Toggle Saudi province layers off when in World 2: Dubai
    const showKsaProvs =
      worldId === 'saudi_arabia' && filtersRef.current.bordersAndGrid ? 'visible' : 'none';
    map.setLayoutProperty('provinces-fill', 'visibility', showKsaProvs);
    map.setLayoutProperty('provinces-outline', 'visibility', showKsaProvs);

    // Temporarily release maxBounds -> jump to new territory -> re-lock strict maxBounds!
    map.setMaxBounds(null);
    map.setMinZoom(view.minZoom);
    map.setMaxZoom(view.maxZoom);
    map.jumpTo({ center: view.center, zoom: view.zoom, bearing: 0, pitch: 0 });
    map.setMaxBounds([bounds.sw, bounds.ne]);

    const rebuild = (map as unknown as { __rebuildMarkers?: () => void }).__rebuildMarkers;
    rebuild?.();
    syncMarkersRef.current();

    onTelemetryRef.current({
      lon: view.center[0],
      lat: view.center[1],
      zoom: view.zoom,
      gridSector: computeTacticalGridSector(view.center[0], view.center[1], worldId),
    });
  }, [worldId]);

  // 3. Instant Zero-Flicker Map Style Switching (Satellite HD | Satellite + Roads | Tactical Atlas)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current) return;

    map.setLayoutProperty(
      'layer-satellite',
      'visibility',
      mapStyle === 'satellite' || mapStyle === 'hybrid' ? 'visible' : 'none',
    );
    map.setLayoutProperty(
      'layer-hybrid-roads',
      'visibility',
      mapStyle === 'hybrid' ? 'visible' : 'none',
    );
    map.setLayoutProperty(
      'layer-hybrid-places',
      'visibility',
      mapStyle === 'hybrid' ? 'visible' : 'none',
    );
    map.setLayoutProperty(
      'layer-atlas',
      'visibility',
      mapStyle === 'atlas' ? 'visible' : 'none',
    );
  }, [mapStyle]);

  // 4. Live Category & Cartographic Layer Toggles
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current) return;

    const hwVis = filters.highways ? 'visible' : 'none';
    map.setLayoutProperty('highways-glow', 'visibility', hwVis);
    map.setLayoutProperty('highways-core', 'visibility', hwVis);

    const gridVis = filters.bordersAndGrid ? 'visible' : 'none';
    map.setLayoutProperty('grid-lines', 'visibility', gridVis);

    const ksaProvVis =
      worldId === 'saudi_arabia' && filters.bordersAndGrid ? 'visible' : 'none';
    map.setLayoutProperty('provinces-fill', 'visibility', ksaProvVis);
    map.setLayoutProperty('provinces-outline', 'visibility', ksaProvVis);

    syncMarkersRef.current();
  }, [filters, worldId]);

  // 5. Highlight Selected Province or Marker
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current) return;

    const selProvId = selected?.kind === 'province' ? selected.province.id : '';
    map.setPaintProperty('provinces-fill', 'fill-opacity', [
      'case',
      ['==', ['get', 'id'], selProvId],
      0.16,
      0.0,
    ]);
    syncMarkersRef.current();
  }, [selected]);

  // 6. Measure Mode Cursor & Distance Polyline + Floating Geodesic Labels
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.getCanvas().style.cursor = measureMode ? 'crosshair' : '';

    if (!mapLoadedRef.current) return;
    const data = buildMeasureGeoJSON(measurePoints);
    const lineSrc = map.getSource('measure-line-source') as maplibregl.GeoJSONSource | undefined;
    const ptsSrc = map.getSource('measure-points-source') as maplibregl.GeoJSONSource | undefined;
    lineSrc?.setData(data.line);
    ptsSrc?.setData(data.nodes);

    // Refresh vertex distance badges
    measureMarkersRef.current.forEach((m) => m.remove());
    measureMarkersRef.current = [];

    let cumulative = 0;
    for (let i = 0; i < measurePoints.length; i++) {
      if (i > 0) {
        cumulative += haversineDistanceMeters(measurePoints[i - 1], measurePoints[i]);
      }
      const badge = document.createElement('div');
      badge.className = 'pointer-events-none select-none';
      badge.style.cssText =
        'font-family: "JetBrains Mono", monospace; font-size: 10.5px; font-weight: 700; color: #aefbf7; background: rgba(8, 16, 22, 0.92); border: 1px solid rgba(110, 242, 236, 0.78); border-radius: 4px; padding: 2px 6px; box-shadow: 0 3px 10px rgba(0,0,0,0.75); white-space: nowrap;';
      badge.textContent =
        i === 0 ? 'START' : formatGeodesicDistance(cumulative);

      const m = new maplibregl.Marker({ element: badge, offset: [0, -18] })
        .setLngLat(measurePoints[i])
        .addTo(map);
      measureMarkersRef.current.push(m);
    }
  }, [measureMode, measurePoints]);

  // 7. Smooth Animated Fly-To Command
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !flyTo) return;
    map.flyTo({
      center: [flyTo.lon, flyTo.lat],
      zoom: flyTo.zoom,
      duration: 950,
      essential: true,
    });
  }, [flyTo]);

  // 8. Zoom +/- & Compass Reset North Commands
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !zoomCommand) return;
    map.easeTo({
      zoom: Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), map.getZoom() + zoomCommand.delta)),
      duration: 280,
    });
  }, [zoomCommand]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || resetNonce === 0) return;
    const view = WORLD_DEFAULT_VIEW[worldId];
    map.flyTo({
      center: view.center,
      zoom: view.zoom,
      bearing: 0,
      pitch: 0,
      duration: 650,
    });
  }, [resetNonce, worldId]);

  return (
    <div
      className="relative isolate z-0 h-full w-full overflow-hidden bg-[#060a10]"
      data-testid="maplibre-viewport"
      data-world={worldId}
      data-style={mapStyle}
    >
      <div ref={containerRef} className="h-full w-full" />
      {/* Subtle AAA cinematic edge vignette framing the HUD without dimming map center */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse at center, rgba(0,0,0,0) 58%, rgba(4,7,12,0.46) 100%)',
        }}
      />
    </div>
  );
};
