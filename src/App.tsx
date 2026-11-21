import React, { useCallback, useMemo, useState } from 'react';
import {
  Box,
  Compass,
  Globe2,
  Minus,
  Plus,
  Ruler,
  Trash2,
} from 'lucide-react';
import {
  MapStyleId,
  MarkerCategoryId,
  WORLD_DEFAULT_VIEW,
  WorldId,
} from './map/mapData';
import {
  SearchHit,
  computePolylineDistanceMeters,
  computeTacticalGridSector,
  formatGeodesicDistance,
} from './map/geoUtils';
import {
  FlyToCommand,
  LiveMapTelemetry,
  MapLibreViewport,
} from './components/MapLibreViewport';
import {
  TacticalFiltersState,
  TacticalSidebar,
} from './components/TacticalSidebar';
import {
  LocationInspector,
  SelectedMapEntity,
} from './components/LocationInspector';
import { DubaiInsetCard } from './components/DubaiInsetCard';
import { RiyadhBlock1Viewport } from './components/RiyadhBlock1Viewport';

function formatBriefCoord(val: number, pos: string, neg: string): string {
  return `${Math.abs(val).toFixed(4)}°${val >= 0 ? pos : neg}`;
}

export default function App() {
  const [active3DBlock, setActive3DBlock] = useState<'day1_block1' | null>(null);
  const [worldId, setWorldId] = useState<WorldId>('saudi_arabia');
  const [mapStyle, setMapStyle] = useState<MapStyleId>('satellite');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const [filters, setFilters] = useState<TacticalFiltersState>({
    categories: {
      capitals_urban: true,
      landmarks_towers: true,
      heritage_unesco: true,
      nature_deserts: true,
      coast_islands: true,
      megaprojects_ports: true,
    },
    highways: true,
    bordersAndGrid: true,
  });

  const [selected, setSelected] = useState<SelectedMapEntity>(null);
  const [flyTo, setFlyTo] = useState<FlyToCommand | null>(null);
  const [zoomCommand, setZoomCommand] = useState<{ delta: number; nonce: number } | null>(null);
  const [resetNonce, setResetNonce] = useState(0);

  // GTA 6 Geodesic Distance Measurement Tool state
  const [measureMode, setMeasureMode] = useState(false);
  const [measurePoints, setMeasurePoints] = useState<[number, number][]>([]);

  const [telemetry, setTelemetry] = useState<LiveMapTelemetry>(() => {
    const def = WORLD_DEFAULT_VIEW.saudi_arabia;
    return {
      lon: def.center[0],
      lat: def.center[1],
      zoom: def.zoom,
      gridSector: computeTacticalGridSector(def.center[0], def.center[1], 'saudi_arabia'),
    };
  });

  const totalMeasuredMeters = useMemo(
    () => computePolylineDistanceMeters(measurePoints),
    [measurePoints],
  );

  const handleWorldSwitch = useCallback((nextWorld: WorldId) => {
    setWorldId(nextWorld);
    setSelected(null);
    setFlyTo(null);
    setMeasurePoints([]);
  }, []);

  const triggerFlyTo = useCallback((lon: number, lat: number, zoom: number) => {
    setFlyTo({ lon, lat, zoom, nonce: Date.now() + Math.random() });
  }, []);

  const handleSelectSearchHit = useCallback(
    (hit: SearchHit) => {
      const entity: SelectedMapEntity =
        hit.kind === 'location' && hit.location
          ? { kind: 'location', location: hit.location }
          : hit.kind === 'province' && hit.province
            ? { kind: 'province', province: hit.province }
            : null;

      if (hit.worldId !== worldId) {
        setWorldId(hit.worldId);
        setMeasurePoints([]);
        window.setTimeout(() => {
          setSelected(entity);
          triggerFlyTo(hit.lon, hit.lat, hit.zoom);
        }, 60);
      } else {
        setSelected(entity);
        triggerFlyTo(hit.lon, hit.lat, hit.zoom);
      }
    },
    [worldId, triggerFlyTo],
  );

  const handleToggleCategory = useCallback((cat: MarkerCategoryId) => {
    setFilters((prev) => ({
      ...prev,
      categories: {
        ...prev.categories,
        [cat]: !prev.categories[cat],
      },
    }));
  }, []);

  const handleSetAllCategories = useCallback((enabled: boolean) => {
    setFilters((prev) => ({
      ...prev,
      categories: {
        capitals_urban: enabled,
        landmarks_towers: enabled,
        heritage_unesco: enabled,
        nature_deserts: enabled,
        coast_islands: enabled,
        megaprojects_ports: enabled,
      },
    }));
  }, []);

  const handleAddMeasurePoint = useCallback((pt: [number, number]) => {
    setMeasurePoints((prev) => [...prev, pt]);
  }, []);

  const handleToggleMeasureMode = useCallback(() => {
    setMeasureMode((prev) => {
      if (prev) setMeasurePoints([]);
      return !prev;
    });
  }, []);

  if (active3DBlock === 'day1_block1') {
    return (
      <RiyadhBlock1Viewport onReturnToMap={() => setActive3DBlock(null)} />
    );
  }

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-[#060a10] text-[#f6efe2]">
      {/* FULL-VIEWPORT MAPLIBRE GL JS ULTRA-REALISTIC HD SATELLITE & OSM MAP */}
      <MapLibreViewport
        worldId={worldId}
        mapStyle={mapStyle}
        filters={filters}
        selected={selected}
        measureMode={measureMode}
        measurePoints={measurePoints}
        flyTo={flyTo}
        zoomCommand={zoomCommand}
        resetNonce={resetNonce}
        onSelect={setSelected}
        onAddMeasurePoint={handleAddMeasurePoint}
        onTelemetryChange={setTelemetry}
      />

      {/* TOP BAR: STRICT TWO-WORLD TERRITORY SWITCHER */}
      <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-3 px-4 pt-3.5">
        <nav
          aria-label="World Territory Switcher"
          className="pointer-events-auto flex items-center rounded-md border border-[#d9a441]/40 bg-[#100e0b]/92 p-1 shadow-[0_12px_34px_rgba(0,0,0,0.65)] backdrop-blur-md"
        >
          <button
            type="button"
            onClick={() => handleWorldSwitch('saudi_arabia')}
            aria-pressed={worldId === 'saudi_arabia'}
            className={`flex items-center gap-2 rounded px-3.5 py-1.5 text-xs font-semibold tracking-wide transition-colors ${
              worldId === 'saudi_arabia'
                ? 'bg-[#d9a441]/25 text-[#fde6ac] shadow-[inset_0_0_0_1px_rgba(232,184,84,0.65)]'
                : 'text-[#c2b59e] hover:bg-[#1e1913] hover:text-[#f6efe2]'
            }`}
          >
            <Globe2 className="h-3.5 w-3.5 text-[#e6b95c]" />
            <span>World 1: Saudi Arabia</span>
          </button>

          <div className="mx-1 h-4 w-px bg-[#d9a441]/25" aria-hidden="true" />

          <button
            type="button"
            onClick={() => handleWorldSwitch('dubai')}
            aria-pressed={worldId === 'dubai'}
            className={`flex items-center gap-2 rounded px-3.5 py-1.5 text-xs font-semibold tracking-wide transition-colors ${
              worldId === 'dubai'
                ? 'bg-[#d9a441]/25 text-[#fde6ac] shadow-[inset_0_0_0_1px_rgba(232,184,84,0.65)]'
                : 'text-[#c2b59e] hover:bg-[#1e1913] hover:text-[#f6efe2]'
            }`}
          >
            <Compass className="h-3.5 w-3.5 text-[#4fd6d0]" />
            <span>World 2: Dubai (Separate)</span>
          </button>

          <div className="mx-1 h-4 w-px bg-[#d9a441]/25" aria-hidden="true" />

          <button
            type="button"
            onClick={() => setActive3DBlock('day1_block1')}
            data-testid="header-enter-block1-3d-btn"
            className="flex items-center gap-1.5 rounded bg-[#d9a441]/20 px-3 py-1.5 text-xs font-semibold tracking-wide text-[#fde6ac] shadow-[inset_0_0_0_1px_rgba(232,184,84,0.55)] transition-colors hover:bg-[#d9a441]/35"
          >
            <Box className="h-3.5 w-3.5 text-[#f4c45c]" />
            <span>Riyadh — Al-Olaya (Day 1 · 3D)</span>
          </button>
        </nav>

        {/* Active Distance Ruler Banner (only visible when measuring!) */}
        {measureMode && (
          <div
            data-testid="measure-banner"
            className="pointer-events-auto flex items-center gap-3 rounded-md border border-[#4fd6d0]/55 bg-[#09181d]/92 px-3.5 py-1.5 text-xs shadow-[0_10px_28px_rgba(0,0,0,0.68)] backdrop-blur-md"
          >
            <Ruler className="h-3.5 w-3.5 text-[#6ef2ec]" />
            <span className="font-semibold text-[#c5fbf8]">
              {measurePoints.length < 2
                ? 'Click 2+ points on map to measure geodesic distance'
                : `Total Distance: ${formatGeodesicDistance(totalMeasuredMeters)} (${measurePoints.length} pts)`}
            </span>
            {measurePoints.length > 0 && (
              <button
                type="button"
                aria-label="Clear measurement points"
                onClick={() => setMeasurePoints([])}
                className="flex items-center gap-1 rounded border border-[#4fd6d0]/35 bg-[#0f2730] px-2 py-0.5 text-[10.5px] font-medium text-[#9cf4f0] hover:bg-[#163845]"
              >
                <Trash2 className="h-3 w-3" />
                <span>Clear</span>
              </button>
            )}
          </div>
        )}

        {/* Right Floating GTA 6 Utility Toolbar (Distance Ruler + Zoom + Compass Reset) */}
        <div
          role="toolbar"
          aria-label="Map Utility Tools"
          className="pointer-events-auto flex items-center gap-1 rounded-md border border-[#d9a441]/40 bg-[#100e0b]/92 p-1 shadow-[0_12px_34px_rgba(0,0,0,0.65)] backdrop-blur-md"
        >
          <button
            type="button"
            aria-label="Distance measurement tool"
            aria-pressed={measureMode}
            onClick={handleToggleMeasureMode}
            className={`flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-semibold transition-colors ${
              measureMode
                ? 'bg-[#4fd6d0]/22 text-[#aefbf7] shadow-[inset_0_0_0_1px_rgba(110,242,236,0.7)]'
                : 'text-[#dfd3be] hover:bg-[#1d1812] hover:text-white'
            }`}
          >
            <Ruler className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Measure</span>
          </button>

          <div className="mx-0.5 h-4 w-px bg-[#d9a441]/25" aria-hidden="true" />

          <button
            type="button"
            aria-label="Zoom in"
            onClick={() => setZoomCommand({ delta: 1.15, nonce: Date.now() })}
            className="flex h-7 w-7 items-center justify-center rounded text-[#e8dcc4] transition-colors hover:bg-[#d9a441]/20 hover:text-white"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            aria-label="Zoom out"
            onClick={() => setZoomCommand({ delta: -1.15, nonce: Date.now() })}
            className="flex h-7 w-7 items-center justify-center rounded text-[#e8dcc4] transition-colors hover:bg-[#d9a441]/20 hover:text-white"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            aria-label="Compass reset north and framing"
            onClick={() => setResetNonce((n) => n + 1)}
            className="flex h-7 w-7 items-center justify-center rounded text-[#e6b95c] transition-colors hover:bg-[#d9a441]/20 hover:text-[#ffe6a3]"
          >
            <Compass className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>

      {/* GTA 6 COLLAPSIBLE LEFT TACTICAL SIDEBAR */}
      <TacticalSidebar
        worldId={worldId}
        mapStyle={mapStyle}
        filters={filters}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={() => setSidebarCollapsed((c) => !c)}
        onChangeMapStyle={setMapStyle}
        onToggleCategory={handleToggleCategory}
        onToggleHighways={() =>
          setFilters((p) => ({ ...p, highways: !p.highways }))
        }
        onToggleBordersAndGrid={() =>
          setFilters((p) => ({ ...p, bordersAndGrid: !p.bordersAndGrid }))
        }
        onSetAllCategories={handleSetAllCategories}
        onSelectSearchHit={handleSelectSearchHit}
      />

      {/* RIGHT FLOATING LOCATION / PROVINCE INSPECTOR */}
      {selected && (
        <div className="pointer-events-none absolute top-[68px] right-4 z-20">
          <LocationInspector
            selected={selected}
            onClose={() => setSelected(null)}
            onFlyCloser={(lon, lat, zoom) => triggerFlyTo(lon, lat, zoom)}
            onEnterBlock1World3D={() => setActive3DBlock('day1_block1')}
          />
        </div>
      )}

      {/* BOTTOM-RIGHT FRAMED DUBAI SEPARATE TERRITORY MINI-PORTAL (WORLD 1 ONLY) */}
      {worldId === 'saudi_arabia' && (
        <div
          className={`pointer-events-none absolute right-4 bottom-8 z-10 ${
            selected ? 'hidden xl:block' : 'block'
          }`}
        >
          <DubaiInsetCard onOpenDubai={() => handleWorldSwitch('dubai')} />
        </div>
      )}

      {/* BOTTOM-LEFT LIVE WGS84 GPS, TACTICAL GRID SECTOR (A1..Z24) & WORLD TELEMETRY BAR */}
      <footer
        data-testid="gps-telemetry-bar"
        className="pointer-events-auto absolute bottom-4 left-4 z-20 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-[#d9a441]/35 bg-[#100e0b]/92 px-3.5 py-2 text-[11px] shadow-[0_12px_32px_rgba(0,0,0,0.68)] backdrop-blur-md"
      >
        <div className="flex items-center gap-1.5 font-semibold tracking-[0.12em] text-[#f4d484] uppercase">
          <span>
            {worldId === 'saudi_arabia'
              ? 'WORLD 1: SAUDI ARABIA'
              : 'WORLD 2: DUBAI — SEPARATE TERRITORY'}
          </span>
        </div>

        <div className="h-3 w-px bg-[#d9a441]/25" aria-hidden="true" />

        <div className="flex items-center gap-1.5">
          <span className="text-[9.5px] font-semibold tracking-[0.14em] text-[#a79982] uppercase">
            GPS
          </span>
          <span className="font-mono-tabular tabular-nums text-[#f5ead4]">
            {formatBriefCoord(telemetry.lat, 'N', 'S')},{' '}
            {formatBriefCoord(telemetry.lon, 'E', 'W')}
          </span>
        </div>

        <div className="h-3 w-px bg-[#d9a441]/25" aria-hidden="true" />

        <div className="flex items-center gap-1.5">
          <span className="text-[9.5px] font-semibold tracking-[0.14em] text-[#a79982] uppercase">
            Sector
          </span>
          <span
            data-testid="grid-sector-value"
            className="font-mono-tabular tabular-nums rounded bg-[#1d1811] px-1.5 py-0.5 text-[10.5px] font-bold text-[#fde4a6]"
          >
            {telemetry.gridSector}
          </span>
        </div>

        <div className="h-3 w-px bg-[#d9a441]/25" aria-hidden="true" />

        <div className="flex items-center gap-1.5">
          <span className="text-[9.5px] font-semibold tracking-[0.14em] text-[#a79982] uppercase">
            Zoom
          </span>
          <span className="font-mono-tabular tabular-nums text-[#f6d483]">
            Z{telemetry.zoom.toFixed(1)}
          </span>
        </div>
      </footer>
    </main>
  );
}
