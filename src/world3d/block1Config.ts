/**
 * DAY 1 — BLOCK 1: RIYADH (AL-OLAYA · KING FAHD ROAD · KINGDOM CENTRE · AL-FAISALIAH TOWER)
 * Single-source-of-truth configuration for the 4-stage World Labs pipeline:
 *   Part 1: CHISEL (True-scale 1:1 metric spatial layout & calibration cameras)
 *   Part 2: VIEWFINDER (Text-to-world prompt & full_res .spz target)
 *   Part 3: RELIGHT (Golden Hour, Desert Noon, Illuminated Riyadh Night)
 *   Part 4: SPLAT TO MESH (.glb collision proxy + pedestrian 1.65m eye height lock)
 */

export const AUTHORIZED_BLOCK_ID = 'day1_block1' as const;

export type RelightPassId = 'golden_hour' | 'desert_noon' | 'riyadh_night';
export type CameraControlMode = 'orbit' | 'walk';

export const DAY1_BLOCK1_LOCATION_IDS = new Set<string>([
  'ksa_riyadh',
  'ryd_kingdom_centre',
  'ryd_al_faisaliah',
  'ryd_king_fahd_road',
]);

export function isDay1Block1Location(locationId: string): boolean {
  return DAY1_BLOCK1_LOCATION_IDS.has(locationId);
}

export function isAuthorizedWorldLabsBlock(blockId: string): boolean {
  return blockId === AUTHORIZED_BLOCK_ID;
}

export interface Vec3Tuple {
  x: number;
  y: number;
  z: number;
}

export interface CameraCalibration {
  id: string;
  label: string;
  position: Vec3Tuple;
  lookAt: Vec3Tuple;
  yawDeg?: number;
  pitchDeg?: number;
}

/**
 * PART 1 — CHISEL: Exact 1:1 metric architectural specification for Day 1, Block 1.
 * Strict geographic invariant: Kingdom Centre (302 m) and Al-Faisaliah Tower (267 m)
 * are completely independent towers with ZERO bridge connecting them.
 */
export const CHISEL_BLOCK1_SPEC = {
  blockId: AUTHORIZED_BLOCK_ID,
  displayName: 'Riyadh — Al-Olaya (Day 1 — Block 1)',
  district: 'Al-Olaya · King Fahd Road · Tahlia Street Axis',
  pedestrianEyeHeightM: 1.65,
  kingFahdRoad: {
    centerX: -14,
    depthY: -6.5,
    zMin: -215,
    zMax: 32,
    trenchHalfWidth: 15,
    serviceRoadWidth: 8.5,
    overpassesZ: [-140, -72] as const,
    overpassDeckHalfLenZ: 9,
  },
  kingdomCentre: {
    name: 'Kingdom Centre',
    x: 20,
    z: -172,
    heightM: 302,
    skyBridgeElevationM: 297,
    skyBridgeSelfContainedOnly: true,
    podiumHeightM: 6.5,
    footprintHalfX: 19,
    footprintHalfZ: 14,
  },
  alFaisaliahTower: {
    name: 'Al-Faisaliah Tower',
    x: 20,
    z: -108,
    heightM: 267,
    globeElevationM: 200,
    globeRadiusM: 12,
    independentFromKingdomCentre: true,
    hasInterTowerBridge: false as const,
    podiumHeightM: 6.5,
    footprintHalfX: 16,
    footprintHalfZ: 16,
  },
  cameras: {
    axialVista: {
      id: 'axial_vista',
      label: 'King Fahd Vista',
      position: { x: -185, y: 64, z: 68 },
      lookAt: { x: 14, y: 132, z: -138 },
    } satisfies CameraCalibration,
    heroEstablishing: {
      id: 'hero',
      label: 'Hero Establishing',
      position: { x: -98, y: 66, z: -42 },
      lookAt: { x: 18, y: 95, z: -142 },
    } satisfies CameraCalibration,
    pedestrianGround: {
      id: 'pedestrian',
      label: 'Street 1.65m',
      position: { x: 1, y: 1.65, z: -132 },
      // yaw -18° NNE, pitch +7°
      lookAt: { x: 13.4, y: 6.6, z: -170.0 },
      yawDeg: -18,
      pitchDeg: 7,
    } satisfies CameraCalibration,
    splatCenter: {
      id: 'splat_center',
      label: 'Splat Origin',
      position: { x: 0, y: 2.0, z: 4.5 },
      lookAt: { x: 0, y: 1.6, z: -4.0 },
    } satisfies CameraCalibration,
  },
};

/**
 * PART 2 — VIEWFINDER: Pure Text-to-World architectural prompt for World Labs Marble API.
 * Strictly text-only (NO reference image uploads) and explicitly forbids any connecting bridge
 * between Kingdom Centre and Al-Faisaliah Tower.
 */
export const BLOCK1_WORLDLABS_TEXT_PROMPT = [
  'Photorealistic architectural 3D urban scene of Al-Olaya district along sunken King Fahd Road in Riyadh, Saudi Arabia, captured in warm golden late-afternoon Najd sunlight.',
  'In the foreground, King Fahd Road runs straight north-south as a wide sunken 6-lane asphalt expressway cut 6.5 meters below street level, flanked by vertical ribbed precast Riyadh limestone retaining walls, concrete overpass bridges with traffic, illuminated underpass portals, and surface-level service roads lined with evenly spaced mature Phoenix dactylifera date palms in travertine planters and bronze architectural streetlamps.',
  'Rising cleanly on the skyline are two completely separate, independent iconic Riyadh skyscrapers with open sky between them and no skybridge or truss connecting the two towers: Kingdom Centre (302 meters tall) with a curved luxury podium, sleek elliptical sapphire-blue reflective glass and brushed aluminum shaft, sweeping inverted parabolic arch crown, and its own suspended Sky Bridge spanning strictly inside the top of its own arch; and standing separately along the corridor, Al-Faisaliah Tower (267 meters tall) with a travertine plinth, tapering four-sided pyramidal shaft framed by four curved champagne-gold anodized steel corner exoskeleton ribs, its suspended reflective golden geodesic glass sphere ("The Globe") nestled inside its upper frame, and a slender pointed spire.',
  'Lining both sides of the service boulevards along Olaya Street and Tahlia Street are contemporary mid-rise Riyadh travertine limestone and tinted-glass commercial buildings with crisp shadows, wide flat travertine pedestrian plazas, realistic Saudi road markings, and clear warm desert horizon atmosphere. Crisp Unreal Engine 5 photorealistic materials, physically grounded architecture, zero floating objects, no bridge between the two skyscrapers.',
].join(' ');

/**
 * PART 3 — RELIGHT: Switchable physical lighting, atmosphere, and splat color-grading passes.
 */
export interface RelightPassConfig {
  id: RelightPassId;
  label: string;
  shortLabel: string;
  subtitle: string;
  skyTopHex: string;
  skyHorizonHex: string;
  fogHex: string;
  fogDensity: number;
  sunColorHex: string;
  sunIntensity: number;
  sunPosition: Vec3Tuple;
  hemiSkyHex: string;
  hemiGroundHex: string;
  hemiIntensity: number;
  envIntensity: number;
  exposure: number;
  splatRecolorHex: string;
  canvasFilter: string;
  nightAccentIntensity: number;
}

export const RELIGHT_PASSES: Record<RelightPassId, RelightPassConfig> = {
  golden_hour: {
    id: 'golden_hour',
    label: 'Golden Hour',
    shortLabel: 'Golden Hour',
    subtitle: 'Late Afternoon · Warm Najd Sun',
    skyTopHex: '#466a94',
    skyHorizonHex: '#e7ba8c',
    fogHex: '#d9b18a',
    fogDensity: 0.00105,
    sunColorHex: '#ffc77d',
    sunIntensity: 1.9,
    sunPosition: { x: -165, y: 68, z: 95 },
    hemiSkyHex: '#f5d4aa',
    hemiGroundHex: '#594633',
    hemiIntensity: 0.58,
    envIntensity: 0.52,
    exposure: 0.96,
    splatRecolorHex: '#fff3e2',
    canvasFilter: 'contrast(1.04) saturate(1.08) sepia(0.05)',
    nightAccentIntensity: 0.15,
  },
  desert_noon: {
    id: 'desert_noon',
    label: 'Desert Noon',
    shortLabel: 'Desert Noon',
    subtitle: 'High Zenith · Clear Najd Sky',
    skyTopHex: '#3f7ec7',
    skyHorizonHex: '#cbe0f4',
    fogHex: '#c4daee',
    fogDensity: 0.0008,
    sunColorHex: '#fff9ed',
    sunIntensity: 2.15,
    sunPosition: { x: 38, y: 260, z: 54 },
    hemiSkyHex: '#cde3fa',
    hemiGroundHex: '#7d6f5c',
    hemiIntensity: 0.72,
    envIntensity: 0.6,
    exposure: 0.98,
    splatRecolorHex: '#f4f9ff',
    canvasFilter: 'contrast(1.04) saturate(0.98)',
    nightAccentIntensity: 0.0,
  },
  riyadh_night: {
    id: 'riyadh_night',
    label: 'Illuminated Riyadh Night',
    shortLabel: 'Riyadh Night',
    subtitle: 'Sapphire Arch · Golden Globe · 3000K',
    skyTopHex: '#071029',
    skyHorizonHex: '#1b2f58',
    fogHex: '#142342',
    fogDensity: 0.0015,
    sunColorHex: '#6c92e6',
    sunIntensity: 0.48,
    sunPosition: { x: -90, y: 120, z: -60 },
    hemiSkyHex: '#284584',
    hemiGroundHex: '#24180c',
    hemiIntensity: 0.36,
    envIntensity: 0.14,
    exposure: 0.98,
    splatRecolorHex: '#6984b8',
    canvasFilter: 'brightness(0.92) contrast(1.14) saturate(1.16)',
    nightAccentIntensity: 3.1,
  },
};

export interface WorldLabsBlock1Record {
  block_id: typeof AUTHORIZED_BLOCK_ID;
  display_name: string;
  status: 'not_generated' | 'in_progress' | 'completed' | 'failed';
  pipeline_stage:
    | 'idle'
    | 'text_to_image'
    | 'posing_rgbd'
    | 'generating_views'
    | 'reconstructing_splats'
    | 'extracting_mesh'
    | 'completed'
    | 'failed';
  pipeline_stage_label: string;
  model: string;
  operation_id: string | null;
  world_id: string | null;
  world_marble_url: string | null;
  caption: string | null;
  spz_resolution: 'full_res' | '500k' | '100k' | null;
  splat_count?: number | null;
  hero_camera_position?: [number, number, number] | null;
  centroid_world?: [number, number, number] | null;
  has_local_spz: boolean;
  has_local_collider: boolean;
  has_local_thumbnail: boolean;
  spz_bytes?: number;
  collider_bytes?: number;
  created_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  single_generation_locked: boolean;
}

export interface WorldLabsStatusResponse {
  configured: boolean;
  authorized_block: typeof AUTHORIZED_BLOCK_ID;
  credit_protection_active: boolean;
  record: WorldLabsBlock1Record;
}
