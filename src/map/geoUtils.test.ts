import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DUBAI_HATTA_CUTOUT,
  DUBAI_MAIN_CUTOUT,
  KSA_ILLUMINATED_CUTOUT,
} from './mapData';
import {
  buildCoordinateGridGeoJSON,
  buildHighwaysGeoJSON,
  buildInvertedMaskGeoJSON,
  buildProvincesGeoJSON,
  computePolylineDistanceMeters,
  computeTacticalGridSector,
  findProvinceAtGeo,
  formatGeodesicDistance,
  haversineDistanceMeters,
  searchMapEntities,
  validateMasterMapTruth,
} from './geoUtils';

test('Master GIS dataset satisfies all Saudi Arabia & Dubai truth invariants', () => {
  const result = validateMasterMapTruth();
  assert.equal(result.valid, true, `GIS integrity errors: ${result.errors.join('; ')}`);
});

test('Haversine distance computes accurate real-world geodesic distances (Riyadh to Jeddah & Kingdom Centre to Al-Masmak)', () => {
  // Riyadh (46.6753, 24.7136) to Jeddah (39.1865, 21.4858) ≈ 845–855 km
  const riyadhJeddahM = haversineDistanceMeters([46.6753, 24.7136], [39.1865, 21.4858]);
  assert.ok(riyadhJeddahM > 835_000 && riyadhJeddahM < 865_000, `Unexpected Riyadh-Jeddah distance: ${riyadhJeddahM}`);

  // Kingdom Centre (46.6744, 24.7113) to Al-Masmak (46.7134, 24.6312) ≈ 9.6–9.8 km
  const rydSpanM = computePolylineDistanceMeters([
    [46.6744, 24.7113],
    [46.7134, 24.6312],
  ]);
  assert.ok(rydSpanM > 9_000 && rydSpanM < 10_500, `Unexpected Kingdom-Masmak distance: ${rydSpanM}`);
  assert.equal(formatGeodesicDistance(450), '450 m');
  assert.equal(formatGeodesicDistance(9740), '9.74 km');
});

test('Tactical grid sector resolves A1..Z24 cleanly inside both Saudi Arabia and Dubai bounds', () => {
  const riyadhGrid = computeTacticalGridSector(46.6753, 24.7136, 'saudi_arabia');
  assert.match(riyadhGrid, /^[A-Z]([1-9]|1[0-9]|2[0-4])$/);

  const dubaiGrid = computeTacticalGridSector(55.2744, 25.1972, 'dubai');
  assert.match(dubaiGrid, /^[A-Z]([1-9]|1[0-9]|2[0-4])$/);

  // NW corner maps to A1, SE corner maps to Z24
  assert.equal(computeTacticalGridSector(34.0, 32.5, 'saudi_arabia'), 'A1');
  assert.equal(computeTacticalGridSector(56.2, 15.8, 'saudi_arabia'), 'Z24');
});

test('Inverted fog-of-war mask builds valid RFC 7946 GeoJSON polygons with cutout holes', () => {
  const ksaMask = buildInvertedMaskGeoJSON([KSA_ILLUMINATED_CUTOUT]);
  assert.equal(ksaMask.features.length, 1);
  assert.equal(ksaMask.features[0].geometry.type, 'Polygon');
  assert.equal(ksaMask.features[0].geometry.coordinates.length, 2);

  const dubaiMask = buildInvertedMaskGeoJSON([DUBAI_MAIN_CUTOUT, DUBAI_HATTA_CUTOUT]);
  assert.equal(dubaiMask.features[0].geometry.coordinates.length, 3);
});

test('Province, Highway, and Coordinate Grid GeoJSON builders produce complete MapLibre layers', () => {
  const provs = buildProvincesGeoJSON();
  assert.equal(provs.features.length, 13);

  const ksaHw = buildHighwaysGeoJSON('saudi_arabia');
  assert.ok(ksaHw.features.length >= 6);

  const dubaiHw = buildHighwaysGeoJSON('dubai');
  assert.equal(dubaiHw.features.length, 4);

  const ksaGrid = buildCoordinateGridGeoJSON('saudi_arabia');
  assert.ok(ksaGrid.features.length > 15);
});

test('Point-in-polygon and cross-world search resolve provinces, highways, and strictly separated Dubai landmarks', () => {
  assert.equal(findProvinceAtGeo(46.6753, 24.7136)?.id, 'riyadh');
  assert.equal(findProvinceAtGeo(35.298, 28.128)?.id, 'tabuk');
  assert.equal(findProvinceAtGeo(37.9232, 26.6084)?.id, 'madinah');
  assert.equal(findProvinceAtGeo(44.1277, 17.4933)?.id, 'najran');

  const palmHits = searchMapEntities('Palm Jumeirah');
  assert.ok(palmHits.some((h) => h.id === 'dxb_palm_jumeirah' && h.worldId === 'dubai'));

  const routeHits = searchMapEntities('Route 40');
  assert.ok(routeHits.some((h) => h.kind === 'highway' && h.id === 'ksa_route_40'));

  const hegraHits = searchMapEntities('Hegra');
  assert.ok(hegraHits.some((h) => h.id === 'ksa_hegra' && h.worldId === 'saudi_arabia'));
});
