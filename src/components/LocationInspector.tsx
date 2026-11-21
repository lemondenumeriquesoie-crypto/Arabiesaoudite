import React, { useState } from 'react';
import {
  Box,
  CalendarClock,
  Check,
  Copy,
  Crosshair,
  Layers,
  Mountain,
  X,
} from 'lucide-react';
import { MARKER_CATEGORIES, MapLocation, ProvincePolygon } from '../map/mapData';
import { isDay1Block1Location } from '../world3d/block1Config';

export type SelectedMapEntity =
  | { kind: 'location'; location: MapLocation }
  | { kind: 'province'; province: ProvincePolygon }
  | null;

interface LocationInspectorProps {
  selected: SelectedMapEntity;
  onClose: () => void;
  onFlyCloser: (lon: number, lat: number, zoom: number) => void;
  onEnterBlock1World3D?: () => void;
}

function formatCoord(value: number, pos: string, neg: string): string {
  return `${Math.abs(value).toFixed(4)}° ${value >= 0 ? pos : neg}`;
}

export const LocationInspector: React.FC<LocationInspectorProps> = ({
  selected,
  onClose,
  onFlyCloser,
  onEnterBlock1World3D,
}) => {
  const [copied, setCopied] = useState(false);

  if (!selected) return null;

  const isLocation = selected.kind === 'location';
  const title = isLocation ? selected.location.name : selected.province.name;
  const territory = isLocation
    ? selected.location.territoryLabel
    : 'Kingdom of Saudi Arabia';
  const subtitle = isLocation
    ? selected.location.provinceOrSector
    : `Capital: ${selected.province.capital} · ${selected.province.biome}`;
  const lon = isLocation ? selected.location.lon : selected.province.labelPos[0];
  const lat = isLocation ? selected.location.lat : selected.province.labelPos[1];
  const elevationDisplay = isLocation
    ? `${selected.location.elevationM.toLocaleString()} m`
    : `${selected.province.elevationRangeM[0]}–${selected.province.elevationRangeM[1]} m`;
  const description = isLocation
    ? selected.location.description
    : selected.province.summary;
  const highlights = isLocation ? selected.location.highlights : [];
  const scheduleTag = isLocation
    ? selected.location.scheduleTag
    : selected.province.scheduleTag;

  const catMeta = isLocation
    ? MARKER_CATEGORIES.find((c) => c.id === selected.location.category)
    : null;
  const categoryLabel = catMeta ? catMeta.shortLabel : 'Administrative Province';
  const categoryColor = catMeta ? catMeta.color : '#e6b95c';

  const flyZoom = isLocation
    ? selected.location.recommendedZoom ??
      (selected.location.worldId === 'dubai' ? 14.5 : 13.8)
    : 7.4;

  const handleCopyCoordinates = async () => {
    const raw = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
    try {
      await navigator.clipboard.writeText(raw);
    } catch {
      // Fallback copy if iframe restricts Clipboard API
      const ta = document.createElement('textarea');
      ta.value = raw;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <aside
      aria-label="Location Inspector"
      data-testid="location-inspector"
      className="pointer-events-auto flex w-[356px] max-w-[calc(100vw-2rem)] flex-col rounded-lg border border-[#d9a441]/40 bg-[#100e0b]/94 text-[#f6efe2] shadow-[0_20px_54px_rgba(0,0,0,0.72)] backdrop-blur-md"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 border-b border-[#d9a441]/20 px-5 pt-4 pb-3.5">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold tracking-[0.2em] text-[#e6b95c] uppercase">
            {territory}
          </div>
          <h2 className="font-display mt-1 text-[17px] leading-snug font-semibold tracking-wide text-[#fbf4e4]">
            {title}
          </h2>
          <p className="mt-0.5 text-xs text-[#c7bba6]">{subtitle}</p>
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Close inspector"
          className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded border border-[#d9a441]/25 bg-[#1b1712] text-[#d9c8a9] transition-colors hover:border-[#e6b95c]/60 hover:text-white"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Category & Production Schedule Day Tag Row */}
      <div className="flex items-center justify-between gap-2 border-b border-[#d9a441]/15 bg-[#15120d]/90 px-5 py-2">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#f3e6cc]">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: categoryColor }}
          />
          <span>{categoryLabel}</span>
        </div>
        <div className="flex items-center gap-1.5 font-mono-tabular text-[10.5px] font-medium text-[#e6c37b]">
          <CalendarClock className="h-3 w-3 text-[#d9a441]" />
          <span>{scheduleTag}</span>
        </div>
      </div>

      {/* Exact World Labs 3D Slot Readiness Status (Day 1 Block 1 Live Launch vs Locked Slots) */}
      <div className="border-b border-[#d9a441]/15 bg-[#18130c]/90 px-5 py-2.5">
        {isLocation && isDay1Block1Location(selected.location.id) && onEnterBlock1World3D ? (
          <div className="space-y-2">
            <div
              data-testid="scene-slot-badge"
              className="flex items-center gap-2 rounded border border-[#67c587]/50 bg-[#132218]/90 px-3 py-1.5 text-[11px] font-semibold tracking-wide text-[#9ce8b6]"
            >
              <Layers className="h-3.5 w-3.5 shrink-0 text-[#67c587]" />
              <span>Day 1 — Block 1 Active · World Labs .spz Ready</span>
            </div>
            <button
              type="button"
              onClick={onEnterBlock1World3D}
              data-testid="enter-block1-3d-btn"
              className="flex w-full items-center justify-center gap-2 rounded border border-[#f2c868]/85 bg-[#d9a441]/30 px-3.5 py-2 text-xs font-bold tracking-wide text-[#fff1cb] shadow-[0_6px_20px_rgba(217,164,65,0.25)] transition-colors hover:bg-[#d9a441]/45"
            >
              <Box className="h-4 w-4 text-[#fde298]" />
              <span>Enter Ultra-Realistic 3D World</span>
            </button>
          </div>
        ) : (
          <div
            data-testid="scene-slot-badge"
            className="flex items-center gap-2 rounded border border-[#d9a441]/45 bg-[#241c0e]/90 px-3 py-1.5 text-[11px] font-semibold tracking-wide text-[#f6d483]"
          >
            <Layers className="h-3.5 w-3.5 shrink-0 text-[#e8b84f]" />
            <span>3D World Slot Ready — Awaiting World Labs .spz</span>
          </div>
        )}
      </div>

      {/* Exact WGS84 GPS & Elevation Readouts */}
      <div className="grid grid-cols-3 divide-x divide-[#d9a441]/15 border-b border-[#d9a441]/15 bg-[#13100c]/80">
        <div className="px-3.5 py-2.5">
          <div className="text-[9px] font-semibold tracking-[0.16em] text-[#a79982] uppercase">
            Latitude
          </div>
          <div className="font-mono-tabular tabular-nums mt-0.5 text-xs font-medium text-[#f5ead4]">
            {formatCoord(lat, 'N', 'S')}
          </div>
        </div>
        <div className="px-3.5 py-2.5">
          <div className="text-[9px] font-semibold tracking-[0.16em] text-[#a79982] uppercase">
            Longitude
          </div>
          <div className="font-mono-tabular tabular-nums mt-0.5 text-xs font-medium text-[#f5ead4]">
            {formatCoord(lon, 'E', 'W')}
          </div>
        </div>
        <div className="px-3.5 py-2.5">
          <div className="flex items-center gap-1 text-[9px] font-semibold tracking-[0.16em] text-[#a79982] uppercase">
            <Mountain className="h-2.5 w-2.5 text-[#d9a441]" />
            <span>Elev</span>
          </div>
          <div className="font-mono-tabular tabular-nums mt-0.5 text-xs font-medium text-[#f5ead4]">
            {elevationDisplay}
          </div>
        </div>
      </div>

      {/* Summary & Highlights */}
      <div className="space-y-2.5 px-5 py-3.5">
        <p className="text-xs leading-relaxed text-[#dfd5c3]">{description}</p>

        {highlights.length > 0 && (
          <div className="border-t border-[#d9a441]/15 pt-2.5">
            <div className="text-[10px] font-semibold tracking-[0.16em] text-[#bfa77b] uppercase">
              Key Sectors &amp; Landmarks
            </div>
            <p className="mt-1 text-xs leading-relaxed text-[#e8decb]">
              {highlights.join(' · ')}
            </p>
          </div>
        )}
      </div>

      {/* Footer Actions: Fly Closer + Copy Coordinates */}
      <div className="flex items-center gap-2 border-t border-[#d9a441]/20 px-5 py-3">
        <button
          type="button"
          onClick={() => onFlyCloser(lon, lat, flyZoom)}
          className="flex flex-1 items-center justify-center gap-1.5 rounded border border-[#e3b252]/65 bg-[#d9a441]/20 px-3 py-1.5 text-xs font-semibold tracking-wide text-[#fde5a8] transition-colors hover:bg-[#d9a441]/32"
        >
          <Crosshair className="h-3.5 w-3.5" />
          <span>Fly Closer</span>
        </button>

        <button
          type="button"
          onClick={handleCopyCoordinates}
          className="flex items-center justify-center gap-1.5 rounded border border-[#d9a441]/35 bg-[#1b1712] px-3 py-1.5 text-xs font-medium text-[#e5d8c2] transition-colors hover:border-[#e6b95c]/65 hover:text-white"
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5 text-[#67c587]" />
              <span className="text-[#8be0a7]">Copied</span>
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5 text-[#d9a441]" />
              <span>Copy Coordinates</span>
            </>
          )}
        </button>
      </div>
    </aside>
  );
};
