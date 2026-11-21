/**
 * Pure, deterministic camera & asset helpers for the World Labs Atlas v2 pipeline:
 *   1. atlasTextToImage -> hero 16:9 image
 *   2. images2PosedRGBD -> canonicalized RUB hero camera + linear EXR depth + centroidWorld
 *   3. atlasGenerate -> 7 overlapping RUB multi-view RGBD frames around the hero corridor
 *   4. posedImages2Splats -> full_res refined .spz Gaussian Splat
 *   5. splats2Mesh -> aligned .glb collision mesh + collider boxes
 */

export interface AtlasPinholeIntrinsics {
  fx: number;
  fy: number;
  cx: number;
  cy: number;
  width: number;
  height: number;
}

export interface AtlasCoordinateFrame {
  position: [number, number, number];
  quaternion: [number, number, number, number]; // XYZW unit quaternion
  coordinateSystem: 'rub' | 'rdf';
}

export interface AtlasPinholeCamera {
  intrinsics: AtlasPinholeIntrinsics;
  extrinsics: AtlasCoordinateFrame;
}

export interface AtlasTaskAsset {
  assetId?: string | null;
  url?: string | null;
  base64?: string | null;
}

export interface AtlasPosedRGBDFrame {
  imageAsset: AtlasTaskAsset;
  camera: AtlasPinholeCamera;
  depth: {
    depthAsset?: AtlasTaskAsset | null;
    logDepthAsset?: AtlasTaskAsset | null;
    confidenceAsset?: AtlasTaskAsset | null;
    zMin?: number;
    zMax?: number;
  };
}

export type AtlasPipelineStage =
  | 'idle'
  | 'text_to_image'
  | 'posing_rgbd'
  | 'generating_views'
  | 'reconstructing_splats'
  | 'extracting_mesh'
  | 'completed'
  | 'failed';

export const ATLAS_STAGE_LABELS: Record<AtlasPipelineStage, string> = {
  idle: 'Atlas Platform Ready (1-Run Lock)',
  text_to_image: 'Stage 1/5 · Atlas Text-to-Image (Riyadh Al-Olaya)',
  posing_rgbd: 'Stage 2/5 · Atlas Posing Camera & Metric Depth',
  generating_views: 'Stage 3/5 · Atlas Multi-View Corridor Synthesis',
  reconstructing_splats: 'Stage 4/5 · Reconstructing Full-Res .spz Splat',
  extracting_mesh: 'Stage 5/5 · Splat-to-Mesh .glb Collider Extraction',
  completed: 'Atlas Full-Res .spz + .glb Cached',
  failed: 'Atlas Generation Halted',
};

function normalizeVec3(v: [number, number, number]): [number, number, number] {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (len < 1e-8) return [0, 0, 1];
  return [v[0] / len, v[1] / len, v[2] / len];
}

function crossVec3(
  a: [number, number, number],
  b: [number, number, number],
): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

/**
 * Computes a camera-to-world unit XYZW quaternion in RUB convention
 * (Right = +X, Up = +Y, Back = +Z; camera looks along local -Z).
 *
 * Matches World Labs Atlas docs: turning 30° right about +Y yields [0, -0.2588, 0, 0.9659].
 */
export function computeRubLookAtQuaternion(
  eye: [number, number, number],
  target: [number, number, number],
  worldUp: [number, number, number] = [0, 1, 0],
): [number, number, number, number] {
  const back = normalizeVec3([
    eye[0] - target[0],
    eye[1] - target[1],
    eye[2] - target[2],
  ]);

  let rightRaw = crossVec3(worldUp, back);
  if (Math.hypot(rightRaw[0], rightRaw[1], rightRaw[2]) < 1e-6) {
    rightRaw = crossVec3([0, 0, 1], back);
  }
  const right = normalizeVec3(rightRaw);
  const up = normalizeVec3(crossVec3(back, right));

  // Rotation matrix columns are [right, up, back]
  const m00 = right[0];
  const m01 = up[0];
  const m02 = back[0];
  const m10 = right[1];
  const m11 = up[1];
  const m12 = back[1];
  const m20 = right[2];
  const m21 = up[2];
  const m22 = back[2];

  const trace = m00 + m11 + m22;
  let qx: number;
  let qy: number;
  let qz: number;
  let qw: number;

  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1.0);
    qw = 0.25 / s;
    qx = (m21 - m12) * s;
    qy = (m02 - m20) * s;
    qz = (m10 - m01) * s;
  } else if (m00 > m11 && m00 > m22) {
    const s = 2.0 * Math.sqrt(1.0 + m00 - m11 - m22);
    qw = (m21 - m12) / s;
    qx = 0.25 * s;
    qy = (m01 + m10) / s;
    qz = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = 2.0 * Math.sqrt(1.0 + m11 - m00 - m22);
    qw = (m02 - m20) / s;
    qx = (m01 + m10) / s;
    qy = 0.25 * s;
    qz = (m12 + m21) / s;
  } else {
    const s = 2.0 * Math.sqrt(1.0 + m22 - m00 - m11);
    qw = (m10 - m01) / s;
    qx = (m02 + m20) / s;
    qy = (m12 + m21) / s;
    qz = 0.25 * s;
  }

  const qLen = Math.hypot(qx, qy, qz, qw) || 1;
  return [
    Number((qx / qLen).toFixed(6)),
    Number((qy / qLen).toFixed(6)),
    Number((qz / qLen).toFixed(6)),
    Number((qw / qLen).toFixed(6)),
  ];
}

/**
 * Generates 7 overlapping RUB target cameras for `tasks:atlasGenerate` around the
 * canonicalized hero camera, staying well inside open King Fahd Road corridor space
 * so `tasks:posedImages2Splats` achieves sharp geometry and zero ghosting.
 */
export function buildAtlasOrbitTargetCameras(
  heroCamera: AtlasPinholeCamera,
  centroidWorld?: [number, number, number] | null,
): AtlasPinholeCamera[] {
  const origin = heroCamera.extrinsics.position ?? [0, 0, 0];
  const focus: [number, number, number] =
    Array.isArray(centroidWorld) && centroidWorld.length === 3
      ? [centroidWorld[0], centroidWorld[1], centroidWorld[2]]
      : [origin[0], origin[1], origin[2] - 8.0];

  const dx = focus[0] - origin[0];
  const dy = focus[1] - origin[1];
  const dz = focus[2] - origin[2];
  const distToFocus = Math.hypot(dx, dy, dz);

  // Stay within ~14% of focal depth per Build-a-Scene overlap guidelines
  const step = Math.min(3.0, Math.max(0.4, distToFocus * 0.14));

  const offsets: Array<{
    posOffset: [number, number, number];
    lookOffset: [number, number, number];
  }> = [
    // 1. Left service-road parallax
    { posOffset: [-step, step * 0.06, step * 0.05], lookOffset: [0, 0, 0] },
    // 2. Right service-road parallax
    { posOffset: [step, step * 0.06, step * 0.05], lookOffset: [0, 0, 0] },
    // 3. Forward step down King Fahd Road axis
    { posOffset: [0, -step * 0.04, -step * 0.95], lookOffset: [0, 0, 0] },
    // 4. Forward-left oblique establishing angle
    { posOffset: [-step * 0.85, step * 0.12, -step * 0.7], lookOffset: [0, 0, 0] },
    // 5. Forward-right oblique establishing angle
    { posOffset: [step * 0.85, step * 0.12, -step * 0.7], lookOffset: [0, 0, 0] },
    // 6. Elevated aerial vantage looking down sunken corridor
    { posOffset: [0, step * 0.52, step * 0.28], lookOffset: [0, -step * 0.15, 0] },
    // 7. Lower street-level upward look toward Kingdom Centre & Al-Faisaliah Tower
    { posOffset: [step * 0.18, -step * 0.22, -step * 0.42], lookOffset: [0, step * 0.28, 0] },
  ];

  const intrinsics: AtlasPinholeIntrinsics = {
    fx: heroCamera.intrinsics.fx,
    fy: heroCamera.intrinsics.fy,
    cx: heroCamera.intrinsics.cx,
    cy: heroCamera.intrinsics.cy,
    width: heroCamera.intrinsics.width,
    height: heroCamera.intrinsics.height,
  };

  return offsets.map(({ posOffset, lookOffset }) => {
    const pos: [number, number, number] = [
      Number((origin[0] + posOffset[0]).toFixed(5)),
      Number((origin[1] + posOffset[1]).toFixed(5)),
      Number((origin[2] + posOffset[2]).toFixed(5)),
    ];
    const target: [number, number, number] = [
      focus[0] + lookOffset[0],
      focus[1] + lookOffset[1],
      focus[2] + lookOffset[2],
    ];
    return {
      intrinsics: { ...intrinsics },
      extrinsics: {
        position: pos,
        quaternion: computeRubLookAtQuaternion(pos, target),
        coordinateSystem: 'rub',
      },
    };
  });
}

/**
 * Selects the highest splat-count (full_res) TaskAsset from `posedImages2Splats` output.
 */
export function selectHighestResolutionSplat(
  response: Record<string, unknown> | null | undefined,
): { splatCount: number | null; assetId: string | null; url: string | null } {
  if (!response || typeof response !== 'object') {
    return { splatCount: null, assetId: null, url: null };
  }

  const refined = response.refinedSplats as Record<string, AtlasTaskAsset> | undefined;
  if (refined && typeof refined === 'object') {
    const entries = Object.entries(refined)
      .filter(([, asset]) => asset && (asset.url || asset.assetId))
      .map(([countKey, asset]) => ({
        count: Number.parseInt(countKey, 10) || 0,
        asset,
      }))
      .sort((a, b) => b.count - a.count);

    if (entries.length > 0) {
      return {
        splatCount: entries[0].count || null,
        assetId: entries[0].asset.assetId ?? null,
        url: entries[0].asset.url ?? null,
      };
    }
  }

  const draft = response.draftSplat as AtlasTaskAsset | undefined;
  if (draft && (draft.url || draft.assetId)) {
    return {
      splatCount: null,
      assetId: draft.assetId ?? null,
      url: draft.url ?? null,
    };
  }

  return { splatCount: null, assetId: null, url: null };
}

/**
 * Validates that an outbound Atlas asset download URL uses HTTPS and points only
 * to allowlisted World Labs / cloud storage hosts (blocks localhost & private IPs).
 */
export function isAllowedAtlasAssetUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      host.startsWith('169.254.') ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
    ) {
      return false;
    }
    return (
      host === 'worldlabs.ai' ||
      host.endsWith('.worldlabs.ai') ||
      host === 'storage.googleapis.com' ||
      host.endsWith('.googleapis.com') ||
      host.endsWith('.cloudfront.net') ||
      host.endsWith('.r2.cloudflarestorage.com') ||
      host.endsWith('.amazonaws.com') ||
      host.endsWith('.blob.core.windows.net')
    );
  } catch {
    return false;
  }
}
