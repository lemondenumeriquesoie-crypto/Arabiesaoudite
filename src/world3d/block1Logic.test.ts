import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTHORIZED_BLOCK_ID,
  BLOCK1_WORLDLABS_TEXT_PROMPT,
  CHISEL_BLOCK1_SPEC,
  RELIGHT_PASSES,
  isAuthorizedWorldLabsBlock,
  isDay1Block1Location,
} from './block1Config';
import {
  chiselGroundHeightAt,
  enforcePedestrianHeightLock,
  resolveHorizontalCollision,
} from './playerPhysics';
import {
  buildAtlasOrbitTargetCameras,
  computeRubLookAtQuaternion,
  isAllowedAtlasAssetUrl,
  selectHighestResolutionSplat,
} from './atlasPipelineUtils';

test('Single-block credit protection authorizes ONLY day1_block1 and maps Day 1 Riyadh markers', () => {
  assert.equal(isAuthorizedWorldLabsBlock(AUTHORIZED_BLOCK_ID), true);
  assert.equal(isAuthorizedWorldLabsBlock('day1_block2'), false);
  assert.equal(isAuthorizedWorldLabsBlock('dubai_downtown'), false);
  assert.equal(isAuthorizedWorldLabsBlock(''), false);

  assert.equal(isDay1Block1Location('ksa_riyadh'), true);
  assert.equal(isDay1Block1Location('ryd_kingdom_centre'), true);
  assert.equal(isDay1Block1Location('ryd_al_faisaliah'), true);
  assert.equal(isDay1Block1Location('ryd_king_fahd_road'), true);
  assert.equal(isDay1Block1Location('ryd_al_masmak'), false);
  assert.equal(isDay1Block1Location('dxb_downtown'), false);
});

test('Chisel Block 1 architectural spec enforces separate towers with zero inter-tower bridge', () => {
  assert.equal(CHISEL_BLOCK1_SPEC.kingdomCentre.heightM, 302);
  assert.equal(CHISEL_BLOCK1_SPEC.kingdomCentre.skyBridgeElevationM, 297);
  assert.equal(CHISEL_BLOCK1_SPEC.kingdomCentre.skyBridgeSelfContainedOnly, true);

  assert.equal(CHISEL_BLOCK1_SPEC.alFaisaliahTower.heightM, 267);
  assert.equal(CHISEL_BLOCK1_SPEC.alFaisaliahTower.globeElevationM, 200);
  assert.equal(CHISEL_BLOCK1_SPEC.alFaisaliahTower.independentFromKingdomCentre, true);
  assert.equal(CHISEL_BLOCK1_SPEC.alFaisaliahTower.hasInterTowerBridge, false);

  assert.equal(CHISEL_BLOCK1_SPEC.kingFahdRoad.centerX, -14);
  assert.equal(CHISEL_BLOCK1_SPEC.kingFahdRoad.depthY, -6.5);

  // Prompt must explicitly specify text-only anti-bridge realism
  assert.match(BLOCK1_WORLDLABS_TEXT_PROMPT, /no skybridge or truss connecting the two towers/i);
  assert.match(BLOCK1_WORLDLABS_TEXT_PROMPT, /Kingdom Centre/i);
  assert.match(BLOCK1_WORLDLABS_TEXT_PROMPT, /Al-Faisaliah Tower/i);
  assert.match(BLOCK1_WORLDLABS_TEXT_PROMPT, /King Fahd Road/i);
});

test('All 3 Relight passes (Golden Hour, Desert Noon, Illuminated Riyadh Night) are calibrated', () => {
  const keys = Object.keys(RELIGHT_PASSES);
  assert.deepEqual(keys.sort(), ['desert_noon', 'golden_hour', 'riyadh_night']);
  assert.ok(RELIGHT_PASSES.desert_noon.sunIntensity > RELIGHT_PASSES.golden_hour.sunIntensity);
  assert.ok(RELIGHT_PASSES.golden_hour.sunIntensity > RELIGHT_PASSES.riyadh_night.sunIntensity);
  assert.ok(RELIGHT_PASSES.riyadh_night.nightAccentIntensity > 2.0);
});

test('Pedestrian height lock strictly enforces y >= groundY(x, z) + 1.65 m across plazas, sunken highway & overpasses', () => {
  assert.equal(chiselGroundHeightAt(1, -132), 0);
  assert.equal(enforcePedestrianHeightLock(1, 0.2, -132, null), 1.65);
  assert.equal(enforcePedestrianHeightLock(1, 3.0, -132, null), 3.0);

  assert.equal(chiselGroundHeightAt(-14, -100), -6.5);
  assert.equal(enforcePedestrianHeightLock(-14, -10, -100, null), -4.85);

  assert.equal(chiselGroundHeightAt(-14, -140), 0);
  assert.equal(enforcePedestrianHeightLock(-14, -2, -140, null), 1.65);

  assert.equal(enforcePedestrianHeightLock(0, 1.0, 0, 2.4), 4.05);
});

test('Horizontal swept collision stops pedestrian cleanly at Kingdom Centre and Al-Faisaliah podiums', () => {
  const hitKc = resolveHorizontalCollision(-2, -172, 10, -172, 0.6);
  assert.equal(hitKc.collided, true);
  assert.ok(hitKc.x <= 0.4 + 1e-6, `Expected stop outside Kingdom Centre west edge, got x=${hitKc.x}`);

  const clearWalk = resolveHorizontalCollision(1, -132, 1, -136, 0.6);
  assert.equal(clearWalk.collided, false);
  assert.equal(clearWalk.x, 1);
  assert.equal(clearWalk.z, -136);
});

test('Atlas v2 RUB camera math matches official docs and generates 7 distinct overlapping corridor cameras', () => {
  // Looking straight along -Z -> identity quaternion [0, 0, 0, 1]
  const qFwd = computeRubLookAtQuaternion([0, 0, 0], [0, 0, -10]);
  assert.ok(Math.abs(qFwd[3] - 1) < 1e-5);
  assert.ok(Math.abs(qFwd[1]) < 1e-5);

  // Turning 30 deg right about +Y -> [0, -0.2588, 0, 0.9659] per Atlas cameras-and-posed-images docs
  const qRight30 = computeRubLookAtQuaternion(
    [0, 0, 0],
    [Math.sin(Math.PI / 6), 0, -Math.cos(Math.PI / 6)],
  );
  assert.ok(Math.abs(qRight30[1] - -0.258819) < 1e-3, `got qy=${qRight30[1]}`);
  assert.ok(Math.abs(qRight30[3] - 0.965926) < 1e-3, `got qw=${qRight30[3]}`);

  const heroCam = {
    intrinsics: { fx: 762, fy: 762, cx: 640, cy: 360, width: 1280, height: 720 },
    extrinsics: {
      position: [0, 0, 0] as [number, number, number],
      quaternion: [0, 0, 0, 1] as [number, number, number, number],
      coordinateSystem: 'rub' as const,
    },
  };
  const views = buildAtlasOrbitTargetCameras(heroCam, [0, 0, -12]);
  assert.equal(views.length, 7);
  const posKeys = new Set(views.map((v) => v.extrinsics.position.join(',')));
  assert.equal(posKeys.size, 7);
  for (const v of views) {
    assert.equal(v.extrinsics.coordinateSystem, 'rub');
    assert.equal(v.intrinsics.width, 1280);
    assert.equal(v.intrinsics.height, 720);
    const norm = Math.hypot(...v.extrinsics.quaternion);
    assert.ok(Math.abs(norm - 1) < 1e-4);
  }
});

test('Atlas v2 splat selector picks highest splat count and allowlist blocks unsafe URLs', () => {
  const best = selectHighestResolutionSplat({
    refinedSplats: {
      '500000': { assetId: 'a500', url: 'https://storage.googleapis.com/bucket/500k.spz' },
      '2000000': { assetId: 'a2m', url: 'https://storage.googleapis.com/bucket/2m.spz' },
    },
  });
  assert.equal(best.splatCount, 2000000);
  assert.equal(best.assetId, 'a2m');

  assert.equal(isAllowedAtlasAssetUrl('https://storage.googleapis.com/atlas/file.spz'), true);
  assert.equal(isAllowedAtlasAssetUrl('https://cdn.atlas.worldlabs.ai/file.spz'), true);
  assert.equal(isAllowedAtlasAssetUrl('http://127.0.0.1:8080/secret'), false);
  assert.equal(isAllowedAtlasAssetUrl('https://169.254.169.254/latest/meta-data'), false);
});
