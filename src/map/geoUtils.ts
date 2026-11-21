import {
  DUBAI_MAX_BOUNDS,
  MAP_LOCATIONS,
  MASTER_HIGHWAYS,
  MapLocation,
  ProvincePolygon,
  SAUDI_MAX_BOUNDS,
  SAUDI_PROVINCES,
  WorldId,
} from './mapData';

// ---------------------------------------------------------------------------
// GEODESIC DISTANCE (HAVERSINE) FOR GTA 6 DISTANCE MEASUREMENT RULER TOOL
// ---------------------------------------------------------------------------

const EARTH_RADIUS_M = 6371008.8;

export function haversineDistanceMeters(
  p1: [number, number],
  p2: [number, number],
): number {
  const [lon1, lat1] = p1;
  const [lon2, lat2] = p2;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
}

export function computePolylineDistanceMeters(points: [number, number][]): number {
  if (points.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversineDistanceMeters(points[i - 1], points[i]);
  }
  return total;
}

export function formatGeodesicDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters <= 0) return '0 m';
  if (meters < 1000) return `${Math.round(meters)} m`;
  if (meters < 100000) return `${(meters / 1000).toFixed(2)} km`;
  return `${(meters / 1000).toFixed(1)} km`;
}

// ---------------------------------------------------------------------------
// TACTICAL GRID SECTOR (A1..Z24) FOR LIVE GTA 6 / LEONIDA TELEMETRY BAR
// ---------------------------------------------------------------------------

export function computeTacticalGridSector(
  lon: number,
  lat: number,
  worldId: WorldId,
): string {
  const b = worldId === 'saudi_arabia' ? SAUDI_MAX_BOUNDS : DUBAI_MAX_BOUNDS;
  const u = Math.max(0, Math.min(0.9999, (lon - b.sw[0]) / (b.ne[0] - b.sw[0])));
  const v = Math.max(0, Math.min(0.9999, (b.ne[1] - lat) / (b.ne[1] - b.sw[1])));

  const colIdx = Math.floor(u * 26); // A..Z
  const rowIdx = Math.floor(v * 24) + 1; // 1..24
  const colChar = String.fromCharCode(65 + Math.max(0, Math.min(25, colIdx)));
  return `${colChar}${Math.max(1, Math.min(24, rowIdx))}`;
}

// ---------------------------------------------------------------------------
// GEOJSON BUILDERS FOR MAPLIBRE GL JS (INVERTED MASK, GRID, PROVINCES, HIGHWAYS)
// ---------------------------------------------------------------------------

function signedRingArea(ring: [number, number][]): number {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    sum += (ring[i + 1][0] - ring[i][0]) * (ring[i + 1][1] + ring[i][1]);
  }
  return sum * 0.5;
}

function ensureClosedRing(ring: [number, number][]): [number, number][] {
  if (ring.length === 0) return [];
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return [...ring];
  return [...ring, [first[0], first[1]]];
}

function orientRing(ring: [number, number][], clockwise: boolean): [number, number][] {
  const closed = ensureClosedRing(ring);
  const isCw = signedRingArea(closed) > 0;
  return isCw === clockwise ? closed : [...closed].reverse();
}

/**
 * Builds an RFC 7946 GeoJSON Polygon covering the entire globe with exact territorial cutout holes,
 * creating a sleek fog-of-war dim veil over all unrelated neighboring countries.
 */
export function buildInvertedMaskGeoJSON(holes: [number, number][][]) {
  // Counter-clockwise outer world ring, clockwise inner holes (RFC 7946 compliant)
  const outerRing: [number, number][] = [
    [-179, -85],
    [179, -85],
    [179, 85],
    [-179, 85],
    [-179, -85],
  ];

  const orientedHoles = holes.map((h) => orientRing(h, true));

  return {
    type: 'FeatureCollection' as const,
    features: [
      {
        type: 'Feature' as const,
        properties: { role: 'territorial_fog_mask' },
        geometry: {
          type: 'Polygon' as const,
          coordinates: [outerRing, ...orientedHoles],
        },
      },
    ],
  };
}

export function buildCoordinateGridGeoJSON(worldId: WorldId) {
  const b = worldId === 'saudi_arabia' ? SAUDI_MAX_BOUNDS : DUBAI_MAX_BOUNDS;
  const step = worldId === 'saudi_arabia' ? 2.0 : 0.1;
  const features: {
    type: 'Feature';
    properties: { axis: 'lon' | 'lat'; label: string };
    geometry: { type: 'LineString'; coordinates: [number, number][] };
  }[] = [];

  const startLon = Math.ceil(b.sw[0] / step) * step;
  for (let lon = startLon; lon <= b.ne[0] + 1e-6; lon += step) {
    const cleanLon = Number(lon.toFixed(3));
    features.push({
      type: 'Feature',
      properties: { axis: 'lon', label: `${cleanLon}°E` },
      geometry: {
        type: 'LineString',
        coordinates: [
          [cleanLon, b.sw[1] - 1],
          [cleanLon, b.ne[1] + 1],
        ],
      },
    });
  }

  const startLat = Math.ceil(b.sw[1] / step) * step;
  for (let lat = startLat; lat <= b.ne[1] + 1e-6; lat += step) {
    const cleanLat = Number(lat.toFixed(3));
    features.push({
      type: 'Feature',
      properties: { axis: 'lat', label: `${cleanLat}°N` },
      geometry: {
        type: 'LineString',
        coordinates: [
          [b.sw[0] - 1, cleanLat],
          [b.ne[0] + 1, cleanLat],
        ],
      },
    });
  }

  return {
    type: 'FeatureCollection' as const,
    features,
  };
}

export function buildProvincesGeoJSON() {
  return {
    type: 'FeatureCollection' as const,
    features: SAUDI_PROVINCES.map((prov) => ({
      type: 'Feature' as const,
      id: prov.id,
      properties: {
        id: prov.id,
        name: prov.name,
        shortName: prov.name.replace(' Province', '').replace(' (Ash-Sharqiyah)', '').toUpperCase(),
        capital: prov.capital,
      },
      geometry: {
        type: 'Polygon' as const,
        coordinates: [orientRing(prov.polygon, false)],
      },
    })),
  };
}

export function buildHighwaysGeoJSON(worldId: WorldId) {
  return {
    type: 'FeatureCollection' as const,
    features: MASTER_HIGHWAYS.filter((h) => h.worldId === worldId).map((hw) => ({
      type: 'Feature' as const,
      properties: {
        id: hw.id,
        code: hw.code,
        name: hw.name,
        axis: hw.axis,
      },
      geometry: {
        type: 'LineString' as const,
        coordinates: hw.waypoints,
      },
    })),
  };
}

// ---------------------------------------------------------------------------
// POINT-IN-POLYGON & CROSS-WORLD SEARCH
// ---------------------------------------------------------------------------

export function pointInPolygon(lon: number, lat: number, polygon: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0];
    const yi = polygon[i][1];
    const xj = polygon[j][0];
    const yj = polygon[j][1];
    const intersect =
      yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function findProvinceAtGeo(lon: number, lat: number): ProvincePolygon | null {
  for (let i = 0; i < SAUDI_PROVINCES.length; i++) {
    if (pointInPolygon(lon, lat, SAUDI_PROVINCES[i].polygon)) {
      return SAUDI_PROVINCES[i];
    }
  }
  return null;
}

export interface SearchHit {
  kind: 'location' | 'province' | 'highway';
  id: string;
  name: string;
  subtitle: string;
  worldId: WorldId;
  lon: number;
  lat: number;
  zoom: number;
  location?: MapLocation;
  province?: ProvincePolygon;
}

export function searchMapEntities(query: string, limit = 12): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const hits: (SearchHit & { score: number })[] = [];

  for (const prov of SAUDI_PROVINCES) {
    const nameL = prov.name.toLowerCase();
    const capL = prov.capital.toLowerCase();
    if (nameL.includes(q) || capL.includes(q)) {
      hits.push({
        kind: 'province',
        id: `prov_${prov.id}`,
        name: prov.name,
        subtitle: `Province · Capital: ${prov.capital}`,
        worldId: 'saudi_arabia',
        lon: prov.labelPos[0],
        lat: prov.labelPos[1],
        zoom: 7.4,
        province: prov,
        score: nameL.startsWith(q) ? 105 : 72,
      });
    }
  }

  for (const hw of MASTER_HIGHWAYS) {
    const nameL = hw.name.toLowerCase();
    const codeL = `route ${hw.code.toLowerCase()}`;
    if (nameL.includes(q) || codeL.includes(q) || hw.axis.toLowerCase().includes(q)) {
      hits.push({
        kind: 'highway',
        id: hw.id,
        name: hw.name,
        subtitle: `${hw.axis}`,
        worldId: hw.worldId,
        lon: hw.shieldPos[0],
        lat: hw.shieldPos[1],
        zoom: hw.worldId === 'dubai' ? 11.8 : 6.8,
        score: codeL.startsWith(q) || nameL.startsWith(q) ? 98 : 60,
      });
    }
  }

  for (const loc of MAP_LOCATIONS) {
    const nameL = loc.name.toLowerCase();
    const provL = loc.provinceOrSector.toLowerCase();
    const hlMatch = loc.highlights.some((h) => h.toLowerCase().includes(q));
    if (nameL.includes(q) || provL.includes(q) || hlMatch) {
      const score = nameL.startsWith(q) ? 115 : nameL.includes(q) ? 88 : 56;
      hits.push({
        kind: 'location',
        id: loc.id,
        name: loc.name,
        subtitle: `${loc.provinceOrSector} · ${loc.worldId === 'dubai' ? 'World 2: Dubai' : 'World 1: KSA'}`,
        worldId: loc.worldId,
        lon: loc.lon,
        lat: loc.lat,
        zoom: loc.recommendedZoom ?? (loc.worldId === 'dubai' ? 14.2 : 12.6),
        location: loc,
        score,
      });
    }
  }

  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

// ---------------------------------------------------------------------------
// MASTER GIS INTEGRITY VALIDATOR
// ---------------------------------------------------------------------------

export function validateMasterMapTruth(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (SAUDI_PROVINCES.length !== 13) {
    errors.push(`Expected 13 Saudi provinces, found ${SAUDI_PROVINCES.length}`);
  }

  const ksaCodes = Array.from(
    new Set(MASTER_HIGHWAYS.filter((h) => h.worldId === 'saudi_arabia').map((h) => h.code)),
  ).sort();
  if (ksaCodes.join(',') !== '10,15,40,65,85,95') {
    errors.push(`Expected KSA highways 10,15,40,65,85,95, found ${ksaCodes.join(',')}`);
  }

  const badSpell =
    SAUDI_PROVINCES.some((p) => /najazm|najaam/i.test(p.name + p.capital)) ||
    MAP_LOCATIONS.some((l) => /najazm|najaam/i.test(l.name));
  if (badSpell) errors.push('Garbled Najran spelling detected.');

  if (SAUDI_PROVINCES.some((p) => /dubai/i.test(p.name))) {
    errors.push('Dubai leaked into Saudi Arabia provinces.');
  }

  const ksaLocs = MAP_LOCATIONS.filter((l) => l.worldId === 'saudi_arabia');
  const dubaiLocs = MAP_LOCATIONS.filter((l) => l.worldId === 'dubai');
  if (ksaLocs.length < 50) {
    errors.push(`Expected rich KSA location catalog (>= 50), found ${ksaLocs.length}`);
  }
  if (dubaiLocs.length < 28) {
    errors.push(`Expected rich Dubai location catalog (>= 28), found ${dubaiLocs.length}`);
  }

  // NEOM The Line must be strictly on Tabuk Province mainland polygon!
  const theLine = MAP_LOCATIONS.find((l) => l.id === 'ksa_neom_the_line');
  const tabuk = SAUDI_PROVINCES.find((p) => p.id === 'tabuk');
  if (!theLine || !tabuk || !pointInPolygon(theLine.lon, theLine.lat, tabuk.polygon)) {
    errors.push('NEOM — The Line must lie inside mainland Tabuk Province polygon.');
  }

  // Al-Ula must lie strictly inside northern Madinah Province polygon!
  const alUla = MAP_LOCATIONS.find((l) => l.id === 'ksa_al_ula_old_town');
  const madinah = SAUDI_PROVINCES.find((p) => p.id === 'madinah');
  if (!alUla || !madinah || !pointInPolygon(alUla.lon, alUla.lat, madinah.polygon)) {
    errors.push('Al-Ula must lie inside northern Madinah Province polygon.');
  }

  // Every World 1 location must be within SAUDI_MAX_BOUNDS
  for (const loc of ksaLocs) {
    if (
      loc.lon < SAUDI_MAX_BOUNDS.sw[0] ||
      loc.lon > SAUDI_MAX_BOUNDS.ne[0] ||
      loc.lat < SAUDI_MAX_BOUNDS.sw[1] ||
      loc.lat > SAUDI_MAX_BOUNDS.ne[1]
    ) {
      errors.push(`KSA location ${loc.name} is outside SAUDI_MAX_BOUNDS.`);
    }
  }

  // Every World 2 location must be within DUBAI_MAX_BOUNDS
  for (const loc of dubaiLocs) {
    if (
      loc.lon < DUBAI_MAX_BOUNDS.sw[0] ||
      loc.lon > DUBAI_MAX_BOUNDS.ne[0] ||
      loc.lat < DUBAI_MAX_BOUNDS.sw[1] ||
      loc.lat > DUBAI_MAX_BOUNDS.ne[1]
    ) {
      errors.push(`Dubai location ${loc.name} is outside DUBAI_MAX_BOUNDS.`);
    }
  }

  return { valid: errors.length === 0, errors };
}
