import React, { useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Grid3x3,
  Layers,
  Map as MapIcon,
  Route,
  Satellite,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import {
  MAP_LOCATIONS,
  MARKER_CATEGORIES,
  MapStyleId,
  MarkerCategoryId,
  WorldId,
} from '../map/mapData';
import { SearchHit, searchMapEntities } from '../map/geoUtils';

export interface TacticalFiltersState {
  categories: Record<MarkerCategoryId, boolean>;
  highways: boolean;
  bordersAndGrid: boolean;
}

interface TacticalSidebarProps {
  worldId: WorldId;
  mapStyle: MapStyleId;
  filters: TacticalFiltersState;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onChangeMapStyle: (style: MapStyleId) => void;
  onToggleCategory: (cat: MarkerCategoryId) => void;
  onToggleHighways: () => void;
  onToggleBordersAndGrid: () => void;
  onSetAllCategories: (enabled: boolean) => void;
  onSelectSearchHit: (hit: SearchHit) => void;
}

const STYLE_OPTIONS: { id: MapStyleId; label: string; sub: string; icon: React.ReactNode }[] = [
  {
    id: 'satellite',
    label: 'Ultra-Realistic Satellite',
    sub: 'Esri HD Imagery',
    icon: <Satellite className="h-3.5 w-3.5" />,
  },
  {
    id: 'hybrid',
    label: 'Satellite + Roads',
    sub: 'HD + Live Streets',
    icon: <Layers className="h-3.5 w-3.5" />,
  },
  {
    id: 'atlas',
    label: 'Tactical Atlas',
    sub: 'OSM / Voyager',
    icon: <MapIcon className="h-3.5 w-3.5" />,
  },
];

export const TacticalSidebar: React.FC<TacticalSidebarProps> = ({
  worldId,
  mapStyle,
  filters,
  collapsed,
  onToggleCollapsed,
  onChangeMapStyle,
  onToggleCategory,
  onToggleHighways,
  onToggleBordersAndGrid,
  onSetAllCategories,
  onSelectSearchHit,
}) => {
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const hits = useMemo(() => searchMapEntities(query, 10), [query]);

  // Live marker counts per category for the active world
  const categoryCounts = useMemo(() => {
    const counts: Record<MarkerCategoryId, number> = {
      capitals_urban: 0,
      landmarks_towers: 0,
      heritage_unesco: 0,
      nature_deserts: 0,
      coast_islands: 0,
      megaprojects_ports: 0,
    };
    for (const loc of MAP_LOCATIONS) {
      if (loc.worldId === worldId) {
        counts[loc.category] += 1;
      }
    }
    return counts;
  }, [worldId]);

  const totalVisibleMarkers = useMemo(
    () =>
      MARKER_CATEGORIES.reduce(
        (acc, cat) => acc + (filters.categories[cat.id] ? categoryCounts[cat.id] : 0),
        0,
      ),
    [categoryCounts, filters.categories],
  );

  const allEnabled = MARKER_CATEGORIES.every((c) => filters.categories[c.id]);

  const handlePick = (hit: SearchHit) => {
    setQuery(hit.name);
    setSearchOpen(false);
    onSelectSearchHit(hit);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSearchOpen(true);
      setActiveIdx((i) => (hits.length ? (i + 1) % hits.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => (hits.length ? (i - 1 + hits.length) % hits.length : 0));
    } else if (e.key === 'Enter' && hits.length > 0) {
      e.preventDefault();
      handlePick(hits[Math.min(activeIdx, hits.length - 1)]);
    } else if (e.key === 'Escape') {
      setSearchOpen(false);
      inputRef.current?.blur();
    }
  };

  if (collapsed) {
    return (
      <div className="pointer-events-auto absolute top-[68px] left-4 z-20">
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label="Expand tactical sidebar"
          className="flex items-center gap-2 rounded-md border border-[#d9a441]/40 bg-[#100e0b]/92 px-3 py-2 text-xs font-semibold tracking-wide text-[#f6e5bc] shadow-[0_12px_32px_rgba(0,0,0,0.65)] backdrop-blur-md transition-colors hover:border-[#f0c568] hover:bg-[#19150f]"
        >
          <SlidersHorizontal className="h-3.5 w-3.5 text-[#e6b95c]" />
          <span>Map Legend</span>
          <ChevronRight className="h-3.5 w-3.5 text-[#bda983]" />
        </button>
      </div>
    );
  }

  return (
    <aside
      aria-label="Tactical Map Sidebar"
      data-testid="tactical-sidebar"
      className="pointer-events-auto absolute top-[68px] bottom-[68px] left-4 z-20 flex w-[312px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-lg border border-[#d9a441]/35 bg-[#100e0b]/92 text-[#f6efe2] shadow-[0_18px_50px_rgba(0,0,0,0.7)] backdrop-blur-md"
    >
      {/* Sidebar Header */}
      <div className="flex items-center justify-between border-b border-[#d9a441]/20 px-4 py-3">
        <div>
          <div className="text-[9.5px] font-semibold tracking-[0.2em] text-[#e6b95c] uppercase">
            {worldId === 'saudi_arabia' ? 'World 1 · Tactical Legend' : 'World 2 · Dubai Legend'}
          </div>
          <div className="font-display mt-0.5 text-sm font-semibold tracking-wide text-[#fbf4e4]">
            {worldId === 'saudi_arabia' ? 'Kingdom of Saudi Arabia' : 'Emirate of Dubai (UAE)'}
          </div>
        </div>
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label="Collapse tactical sidebar"
          className="flex h-7 w-7 items-center justify-center rounded border border-[#d9a441]/25 bg-[#19150f] text-[#d9c8a9] transition-colors hover:border-[#f0c568] hover:text-white"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      </div>

      {/* Instant Search Bar */}
      <div className="relative border-b border-[#d9a441]/15 px-3.5 py-2.5">
        <div className="flex items-center rounded border border-[#d9a441]/30 bg-[#171410] px-2.5 py-1.5 focus-within:border-[#f0c265]">
          <Search className="mr-2 h-3.5 w-3.5 shrink-0 text-[#d9a441]" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            aria-label="Search provinces, cities, highways, or landmarks"
            placeholder="Search Kingdom Centre, Hegra, Palm..."
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIdx(0);
              setSearchOpen(true);
            }}
            onFocus={() => setSearchOpen(true)}
            onBlur={() => window.setTimeout(() => setSearchOpen(false), 160)}
            onKeyDown={handleKeyDown}
            className="w-full bg-transparent text-xs text-[#f8f1e4] placeholder-[#8c7f6d] focus:outline-none"
          />
          {query && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => {
                setQuery('');
                setSearchOpen(false);
              }}
              className="ml-1 text-[#9c8e78] hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {searchOpen && query.trim().length > 0 && (
          <div
            role="listbox"
            aria-label="Map search results"
            className="blueprint-scroll absolute right-3.5 left-3.5 z-30 mt-1 max-h-[260px] overflow-y-auto rounded border border-[#d9a441]/40 bg-[#14110d]/98 py-1 shadow-[0_14px_36px_rgba(0,0,0,0.85)]"
          >
            {hits.length === 0 ? (
              <div className="px-3 py-2 text-xs text-[#9c8e78]">
                No matches found in Saudi Arabia or Dubai.
              </div>
            ) : (
              hits.map((hit, idx) => (
                <button
                  key={hit.id}
                  type="button"
                  role="option"
                  aria-selected={idx === activeIdx}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handlePick(hit);
                  }}
                  className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left transition-colors ${
                    idx === activeIdx
                      ? 'bg-[#d9a441]/25 text-[#fff6df]'
                      : 'text-[#e3d7c3] hover:bg-[#1e1913]'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold">{hit.name}</div>
                    <div className="truncate text-[10px] text-[#a79982]">{hit.subtitle}</div>
                  </div>
                  <span className="shrink-0 font-mono-tabular text-[9.5px] text-[#e6b95c]">
                    {hit.worldId === 'dubai' ? 'W2·DXB' : 'W1·KSA'}
                  </span>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* Scrollable Legend & Style Controls */}
      <div className="blueprint-scroll flex-1 space-y-4 overflow-y-auto px-3.5 py-3">
        {/* Map Style Switcher */}
        <section aria-label="Map Style Switcher">
          <div className="mb-1.5 text-[10px] font-semibold tracking-[0.16em] text-[#bda983] uppercase">
            Imagery &amp; Map Mode
          </div>
          <div className="grid grid-cols-1 gap-1.5">
            {STYLE_OPTIONS.map((opt) => {
              const active = mapStyle === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onChangeMapStyle(opt.id)}
                  className={`flex items-center justify-between rounded border px-2.5 py-2 text-left transition-colors ${
                    active
                      ? 'border-[#e6b95c]/70 bg-[#d9a441]/20 text-[#fde8b2]'
                      : 'border-[#d9a441]/15 bg-[#16130f]/80 text-[#c7bba6] hover:border-[#d9a441]/35 hover:text-[#f6efe2]'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className={active ? 'text-[#f6c85f]' : 'text-[#a3947d]'}>
                      {opt.icon}
                    </span>
                    <span className="text-xs font-semibold">{opt.label}</span>
                  </div>
                  <span className="text-[10px] text-[#a99b84]">{opt.sub}</span>
                </button>
              );
            })}
          </div>
        </section>

        {/* Categorized Marker Filters with Live Counts */}
        <section aria-label="Marker Category Filters">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[10px] font-semibold tracking-[0.16em] text-[#bda983] uppercase">
              Locations ({totalVisibleMarkers})
            </span>
            <button
              type="button"
              onClick={() => onSetAllCategories(!allEnabled)}
              className="flex items-center gap-1 text-[10px] font-medium text-[#e6b95c] hover:text-[#ffe49e]"
            >
              {allEnabled ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
              <span>{allEnabled ? 'Hide All' : 'Show All'}</span>
            </button>
          </div>

          <div className="space-y-1">
            {MARKER_CATEGORIES.map((cat) => {
              const enabled = filters.categories[cat.id];
              const count = categoryCounts[cat.id];
              return (
                <button
                  key={cat.id}
                  type="button"
                  aria-pressed={enabled}
                  onClick={() => onToggleCategory(cat.id)}
                  className={`flex w-full items-center justify-between rounded border px-2.5 py-1.5 text-left transition-colors ${
                    enabled
                      ? 'border-[#d9a441]/30 bg-[#19150f] text-[#f5ead4]'
                      : 'border-transparent bg-[#13100d]/55 text-[#837765] hover:bg-[#19150f]/75 hover:text-[#c7bba6]'
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full border border-black/50"
                      style={{
                        backgroundColor: enabled ? cat.color : '#463f35',
                      }}
                    />
                    <span className="truncate text-[11.5px] font-medium">{cat.label}</span>
                  </div>
                  <span className="font-mono-tabular tabular-nums ml-2 rounded bg-[#0c0a08]/75 px-1.5 py-0.5 text-[10px] text-[#d2c3a8]">
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {/* Infrastructure & Cartographic Overlays */}
        <section aria-label="Cartographic Overlays">
          <div className="mb-1.5 text-[10px] font-semibold tracking-[0.16em] text-[#bda983] uppercase">
            Cartographic Layers
          </div>

          <div className="space-y-1">
            <button
              type="button"
              aria-pressed={filters.highways}
              onClick={onToggleHighways}
              className={`flex w-full items-center justify-between rounded border px-2.5 py-1.5 text-left transition-colors ${
                filters.highways
                  ? 'border-[#e6b95c]/45 bg-[#20190f] text-[#fde6ac]'
                  : 'border-transparent bg-[#13100d]/55 text-[#837765] hover:text-[#c7bba6]'
              }`}
            >
              <div className="flex min-w-0 items-center gap-2">
                <Route className="h-3.5 w-3.5 shrink-0 text-[#f5b841]" />
                <span className="truncate text-[11.5px] font-medium">
                  {worldId === 'saudi_arabia'
                    ? 'National Highways (40, 15, 65, 85, 95, 10)'
                    : 'Dubai Highways (E11, E44, E611, D63)'}
                </span>
              </div>
              <span className="font-mono-tabular ml-2 text-[10px] text-[#d9a441]">
                {worldId === 'saudi_arabia' ? '6' : '4'}
              </span>
            </button>

            <button
              type="button"
              aria-pressed={filters.bordersAndGrid}
              onClick={onToggleBordersAndGrid}
              className={`flex w-full items-center justify-between rounded border px-2.5 py-1.5 text-left transition-colors ${
                filters.bordersAndGrid
                  ? 'border-[#e6b95c]/45 bg-[#20190f] text-[#fde6ac]'
                  : 'border-transparent bg-[#13100d]/55 text-[#837765] hover:text-[#c7bba6]'
              }`}
            >
              <div className="flex min-w-0 items-center gap-2">
                <Grid3x3 className="h-3.5 w-3.5 shrink-0 text-[#e6b95c]" />
                <span className="truncate text-[11.5px] font-medium">
                  {worldId === 'saudi_arabia'
                    ? 'Province Borders & Coordinate Grid'
                    : 'Territory Outline & Coordinate Grid'}
                </span>
              </div>
              <span className="font-mono-tabular ml-2 text-[10px] text-[#d9a441]">
                {worldId === 'saudi_arabia' ? '13' : 'UAE'}
              </span>
            </button>
          </div>
        </section>
      </div>
    </aside>
  );
};
