import React from 'react';
import { ArrowUpRight } from 'lucide-react';

interface DubaiInsetCardProps {
  onOpenDubai: () => void;
}

// Authentic Esri World Imagery HD satellite tiles (z=11) framing Palm Jumeirah, The World, Burj Al Arab, Downtown Dubai & Dubai Creek
const DUBAI_TILES_Z11 = [
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/11/875/1337',
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/11/875/1338',
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/11/876/1337',
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/11/876/1338',
];

export const DubaiInsetCard: React.FC<DubaiInsetCardProps> = ({ onOpenDubai }) => {
  return (
    <button
      type="button"
      onClick={onOpenDubai}
      aria-label="Open World 2: Dubai Separate Territory"
      data-testid="dubai-inset-portal"
      className="group pointer-events-auto flex w-[274px] flex-col overflow-hidden rounded border border-[#d9a441]/55 bg-[#110f0b]/94 p-1.5 text-left shadow-[0_16px_42px_rgba(0,0,0,0.75)] backdrop-blur-md transition-all hover:border-[#f4ca70] hover:shadow-[0_18px_48px_rgba(217,164,65,0.25)]"
    >
      <div className="flex flex-col overflow-hidden border border-[#d9a441]/35 bg-[#071321]">
        <div className="flex items-center justify-between border-b border-[#d9a441]/30 bg-[#15110c] px-2.5 py-1.5">
          <div>
            <div className="font-display text-[11px] font-semibold tracking-[0.13em] text-[#f5dfb0] uppercase">
              Dubai — Separate Territory
            </div>
            <div className="text-[9.5px] tracking-wider text-[#bba888] uppercase">
              UAE · World 2 HD Satellite Map
            </div>
          </div>
          <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-[#e6b95c] transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
        </div>

        <div className="relative h-[138px] w-full overflow-hidden bg-[#061526]">
          {/* Live 2x2 z=11 HD satellite tile mosaic of Palm Jumeirah, The World & Dubai coastline */}
          <div className="grid h-[200px] w-full -translate-y-[24px] grid-cols-2 grid-rows-2 transition-transform duration-300 group-hover:scale-[1.06]">
            {DUBAI_TILES_Z11.map((src, idx) => (
              <img
                key={src}
                src={src}
                alt={`Dubai Arabian Gulf satellite quadrant ${idx + 1}`}
                className="h-full w-full object-cover brightness-95 contrast-110"
                loading="lazy"
              />
            ))}
          </div>
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#080a0d]/72 via-transparent to-[#080a0d]/18" />
          <div className="pointer-events-none absolute right-2 bottom-1.5 rounded border border-[#d9a441]/45 bg-[#100d09]/88 px-1.5 py-0.5 text-[9.5px] font-semibold tracking-wider text-[#f3d89b] uppercase">
            Enter World 2
          </div>
        </div>
      </div>
    </button>
  );
};
