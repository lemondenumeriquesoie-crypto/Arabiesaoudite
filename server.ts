import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  AUTHORIZED_BLOCK_ID,
  BLOCK1_WORLDLABS_TEXT_PROMPT,
  CHISEL_BLOCK1_SPEC,
  WorldLabsBlock1Record,
  isAuthorizedWorldLabsBlock,
} from './src/world3d/block1Config';
import {
  ATLAS_STAGE_LABELS,
  AtlasPinholeCamera,
  AtlasPipelineStage,
  AtlasPosedRGBDFrame,
  AtlasTaskAsset,
  buildAtlasOrbitTargetCameras,
  isAllowedAtlasAssetUrl,
  selectHighestResolutionSplat,
} from './src/world3d/atlasPipelineUtils';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const ATLAS_API_BASE = 'https://api.atlas.worldlabs.ai/api/v2';
const CACHE_DIR = path.resolve(__dirname, '.worldlabs-cache');
const MANIFEST_PATH = path.resolve(CACHE_DIR, 'day1-block1.json');

const LOCAL_ASSET_FILES = {
  'splat.spz': {
    filename: 'day1-block1-full.spz',
    contentType: 'application/octet-stream',
  },
  'collider.glb': {
    filename: 'day1-block1-collider.glb',
    contentType: 'model/gltf-binary',
  },
  'thumbnail.jpg': {
    filename: 'day1-block1-thumb.jpg',
    contentType: 'image/png',
  },
} as const;

type AllowedAssetKind = keyof typeof LOCAL_ASSET_FILES;

interface StoredAtlasManifest extends WorldLabsBlock1Record {
  run_id?: string | null;
  hero_image_asset_id?: string | null;
  prompt_used?: string | null;
  hero_posed_frame?: AtlasPosedRGBDFrame | null;
  all_posed_frames?: AtlasPosedRGBDFrame[] | null;
  splat_asset_id?: string | null;
  collider_asset_id?: string | null;
  atlas_operations?: {
    text_to_image?: string | null;
    posing_rgbd?: string | null;
    generating_views?: string | null;
    reconstructing_splats?: string | null;
    extracting_mesh?: string | null;
  };
  last_poll_at?: number;
}

function ensureCacheDir(): void {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function createEmptyManifest(): StoredAtlasManifest {
  return {
    block_id: AUTHORIZED_BLOCK_ID,
    display_name: CHISEL_BLOCK1_SPEC.displayName,
    status: 'not_generated',
    pipeline_stage: 'idle',
    pipeline_stage_label: ATLAS_STAGE_LABELS.idle,
    model: 'worldlabs-atlas-v2',
    operation_id: null,
    world_id: null,
    world_marble_url: null,
    caption: null,
    spz_resolution: null,
    splat_count: null,
    hero_camera_position: null,
    centroid_world: null,
    has_local_spz: false,
    has_local_collider: false,
    has_local_thumbnail: false,
    created_at: null,
    completed_at: null,
    error_message: null,
    single_generation_locked: false,
    run_id: null,
    hero_image_asset_id: null,
    prompt_used: null,
    hero_posed_frame: null,
    all_posed_frames: null,
    splat_asset_id: null,
    collider_asset_id: null,
    atlas_operations: {},
    last_poll_at: 0,
  };
}

function readManifest(): StoredAtlasManifest {
  ensureCacheDir();
  if (!fs.existsSync(MANIFEST_PATH)) {
    return createEmptyManifest();
  }
  try {
    const raw = fs.readFileSync(MANIFEST_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Partial<StoredAtlasManifest>;
    const merged: StoredAtlasManifest = {
      ...createEmptyManifest(),
      ...parsed,
    };

    const spzPath = path.resolve(CACHE_DIR, LOCAL_ASSET_FILES['splat.spz'].filename);
    const glbPath = path.resolve(CACHE_DIR, LOCAL_ASSET_FILES['collider.glb'].filename);
    const thumbPath = path.resolve(CACHE_DIR, LOCAL_ASSET_FILES['thumbnail.jpg'].filename);

    merged.has_local_spz = fs.existsSync(spzPath) && fs.statSync(spzPath).size > 1024;
    merged.has_local_collider = fs.existsSync(glbPath) && fs.statSync(glbPath).size > 256;
    merged.has_local_thumbnail = fs.existsSync(thumbPath) && fs.statSync(thumbPath).size > 256;

    if (merged.has_local_spz) merged.spz_bytes = fs.statSync(spzPath).size;
    if (merged.has_local_collider) merged.collider_bytes = fs.statSync(glbPath).size;
    merged.pipeline_stage_label =
      ATLAS_STAGE_LABELS[merged.pipeline_stage] ?? ATLAS_STAGE_LABELS.idle;

    return merged;
  } catch {
    return createEmptyManifest();
  }
}

function writeManifest(manifest: StoredAtlasManifest): void {
  ensureCacheDir();
  manifest.pipeline_stage_label =
    ATLAS_STAGE_LABELS[manifest.pipeline_stage] ?? ATLAS_STAGE_LABELS.idle;
  const tmpPath = `${MANIFEST_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(manifest, null, 2), 'utf8');
  fs.renameSync(tmpPath, MANIFEST_PATH);
}

function toPublicRecord(m: StoredAtlasManifest): WorldLabsBlock1Record {
  return {
    block_id: m.block_id,
    display_name: m.display_name,
    status: m.status,
    pipeline_stage: m.pipeline_stage,
    pipeline_stage_label: m.pipeline_stage_label,
    model: m.model,
    operation_id: m.operation_id,
    world_id: m.world_id,
    world_marble_url: m.world_marble_url,
    caption: m.caption,
    spz_resolution: m.spz_resolution,
    splat_count: m.splat_count ?? null,
    hero_camera_position: m.hero_camera_position ?? null,
    centroid_world: m.centroid_world ?? null,
    has_local_spz: m.has_local_spz,
    has_local_collider: m.has_local_collider,
    has_local_thumbnail: m.has_local_thumbnail,
    spz_bytes: m.spz_bytes,
    collider_bytes: m.collider_bytes,
    created_at: m.created_at,
    completed_at: m.completed_at,
    error_message: m.error_message,
    single_generation_locked: m.single_generation_locked,
  };
}

function getApiKey(): string | null {
  let key = process.env.WORLD_LABS_API_KEY?.trim() ?? '';
  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1).trim();
  }
  key = key.replace(/^WLT-Api-Key\s*:\s*/i, '').replace(/^Bearer\s+/i, '').trim();
  return key && key.length > 8 && key !== 'MY_WORLD_LABS_API_KEY' ? key : null;
}

async function mintFreshReadUrl(assetId: string, apiKey: string): Promise<string | null> {
  try {
    const resp = await fetch(
      `${ATLAS_API_BASE}/assets/${encodeURIComponent(assetId)}:createReadUrl`,
      {
        method: 'POST',
        headers: {
          'WLT-Api-Key': apiKey,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(20_000),
      },
    );
    if (!resp.ok) return null;
    const json = (await resp.json()) as { url?: string };
    return typeof json.url === 'string' ? json.url : null;
  } catch {
    return null;
  }
}

async function downloadAtlasAssetToCache(
  asset: AtlasTaskAsset | null | undefined,
  assetKind: AllowedAssetKind,
  apiKey: string,
): Promise<boolean> {
  if (!asset) return false;
  const targetPath = path.resolve(CACHE_DIR, LOCAL_ASSET_FILES[assetKind].filename);
  if (!targetPath.startsWith(CACHE_DIR + path.sep)) return false;

  const tryFetchUrl = async (url: string | null | undefined): Promise<boolean> => {
    if (!url || !isAllowedAtlasAssetUrl(url)) return false;
    try {
      const resp = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(180_000),
      });
      if (!resp.ok) return false;
      const buf = await resp.arrayBuffer();
      if (buf.byteLength < 256) return false;
      const tmpPath = `${targetPath}.tmp`;
      fs.writeFileSync(tmpPath, Buffer.from(buf));
      fs.renameSync(tmpPath, targetPath);
      return true;
    } catch {
      return false;
    }
  };

  if (await tryFetchUrl(asset.url)) return true;

  // If the signed read URL expired, mint a fresh read URL from the durable assetId
  if (asset.assetId) {
    const freshUrl = await mintFreshReadUrl(asset.assetId, apiKey);
    return tryFetchUrl(freshUrl);
  }
  return false;
}

async function submitAtlasTask(
  taskName: string,
  body: Record<string, unknown>,
  idempotencyKey: string,
  apiKey: string,
): Promise<{ ok: boolean; status: number; operationId?: string; errorText?: string }> {
  const resp = await fetch(`${ATLAS_API_BASE}/tasks:${taskName}`, {
    method: 'POST',
    headers: {
      'WLT-Api-Key': apiKey,
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(35_000),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => `HTTP ${resp.status}`);
    return { ok: false, status: resp.status, errorText: errText };
  }

  const json = (await resp.json()) as { id?: string };
  if (typeof json.id !== 'string' || !json.id) {
    return {
      ok: false,
      status: 502,
      errorText: `Atlas ${taskName} response did not include an operation id.`,
    };
  }
  return { ok: true, status: resp.status, operationId: json.id };
}

function getActiveStageOperationId(m: StoredAtlasManifest): string | null {
  const ops = m.atlas_operations ?? {};
  switch (m.pipeline_stage) {
    case 'text_to_image':
      return ops.text_to_image ?? m.operation_id;
    case 'posing_rgbd':
      return ops.posing_rgbd ?? m.operation_id;
    case 'generating_views':
      return ops.generating_views ?? m.operation_id;
    case 'reconstructing_splats':
      return ops.reconstructing_splats ?? m.operation_id;
    case 'extracting_mesh':
      return ops.extracting_mesh ?? m.operation_id;
    default:
      return m.operation_id;
  }
}

function failManifest(
  manifest: StoredAtlasManifest,
  message: string,
  keepCreditLock = false,
): StoredAtlasManifest {
  manifest.status = 'failed';
  manifest.pipeline_stage = 'failed';
  manifest.error_message = message;
  if (!keepCreditLock) {
    manifest.single_generation_locked = false;
  }
  writeManifest(manifest);
  return readManifest();
}

// Mutex locks preventing duplicate Atlas submissions or concurrent polling races
let generationMutex = false;
let pollMutex = false;

/**
 * Advances the 5-stage World Labs Atlas Platform pipeline one step at a time:
 *   1. text_to_image        -> tasks:atlasTextToImage
 *   2. posing_rgbd          -> tasks:images2PosedRGBD (canonicalized RUB, 1280x720)
 *   3. generating_views     -> tasks:atlasGenerate (7 overlapping corridor views with depth)
 *   4. reconstructing_splats-> tasks:posedImages2Splats (refined full_res .spz)
 *   5. extracting_mesh      -> tasks:splats2Mesh (.glb mesh + collider boxes)
 */
async function advanceAtlasPipeline(
  manifest: StoredAtlasManifest,
  forcePoll = false,
): Promise<StoredAtlasManifest> {
  if (manifest.status !== 'in_progress') return manifest;
  const apiKey = getApiKey();
  if (!apiKey) return manifest;

  const activeOpId = getActiveStageOperationId(manifest);
  if (!activeOpId) return manifest;

  const now = Date.now();
  if (pollMutex || (!forcePoll && now - (manifest.last_poll_at ?? 0) < 3500)) {
    return manifest;
  }

  pollMutex = true;
  try {
    manifest.last_poll_at = now;
    const opResp = await fetch(
      `${ATLAS_API_BASE}/operations/${encodeURIComponent(activeOpId)}`,
      {
        method: 'GET',
        headers: {
          'WLT-Api-Key': apiKey,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(25_000),
      },
    );

    if (opResp.status === 404) {
      // Per Atlas quickstart: a brief 404 immediately after submission is transient
      writeManifest(manifest);
      return manifest;
    }

    if (!opResp.ok) {
      const errText = await opResp.text().catch(() => '');
      if (opResp.status === 401 || opResp.status === 403) {
        return failManifest(
          manifest,
          `Atlas API authentication error (HTTP ${opResp.status}): ${errText.slice(0, 180)}`,
          manifest.single_generation_locked,
        );
      }
      return manifest;
    }

    const opJson = (await opResp.json()) as {
      id?: string;
      done?: boolean;
      error?: { message?: string; code?: number } | null;
      response?: Record<string, unknown> | null;
      metadata?: Record<string, unknown> | null;
    };

    if (opJson.error) {
      return failManifest(
        manifest,
        `Atlas ${manifest.pipeline_stage} failed: ${opJson.error.message || 'Operation error'}`,
        manifest.single_generation_locked,
      );
    }

    if (opJson.done !== true || !opJson.response) {
      writeManifest(manifest);
      return manifest;
    }

    const runId = manifest.run_id || 'day1-block1-v1';
    const ops = manifest.atlas_operations ?? {};

    // --- STAGE 1 COMPLETE -> SUBMIT STAGE 2 (images2PosedRGBD) ---
    if (manifest.pipeline_stage === 'text_to_image') {
      const frames = opJson.response.frames as Array<{ imageAsset?: AtlasTaskAsset }> | undefined;
      const heroAsset = frames?.[0]?.imageAsset;
      if (!heroAsset?.assetId) {
        return failManifest(manifest, 'Atlas text-to-image succeeded without returning an imageAsset.assetId.');
      }

      manifest.hero_image_asset_id = heroAsset.assetId;
      manifest.prompt_used =
        typeof opJson.response.promptUsed === 'string' && opJson.response.promptUsed
          ? opJson.response.promptUsed
          : BLOCK1_WORLDLABS_TEXT_PROMPT;
      manifest.caption = manifest.prompt_used;

      // Cache hero preview image locally
      await downloadAtlasAssetToCache(heroAsset, 'thumbnail.jpg', apiKey);

      const poseSub = await submitAtlasTask(
        'images2PosedRGBD',
        {
          frames: [{ imageAsset: { assetId: heroAsset.assetId } }],
          canonicalizeToFirstFrame: true,
          targetResolution: [1280, 720],
        },
        `${runId}-stage2-pose`,
        apiKey,
      );

      if (!poseSub.ok || !poseSub.operationId) {
        return failManifest(
          manifest,
          `Atlas images2PosedRGBD submission failed (HTTP ${poseSub.status}): ${(poseSub.errorText || '').slice(0, 180)}`,
        );
      }

      ops.posing_rgbd = poseSub.operationId;
      manifest.atlas_operations = ops;
      manifest.operation_id = poseSub.operationId;
      manifest.pipeline_stage = 'posing_rgbd';
      manifest.last_poll_at = Date.now();
      writeManifest(manifest);
      console.log(`[Atlas] Stage 1 complete -> submitted Stage 2 images2PosedRGBD (${poseSub.operationId})`);
      return readManifest();
    }

    // --- STAGE 2 COMPLETE -> SUBMIT STAGE 3 (atlasGenerate: 7 corridor views) ---
    if (manifest.pipeline_stage === 'posing_rgbd') {
      const frames = opJson.response.frames as
        | Array<{
            imageAsset?: AtlasTaskAsset;
            camera?: AtlasPinholeCamera;
            depth?: { depthAsset?: AtlasTaskAsset | null; confidenceAsset?: AtlasTaskAsset | null };
            centroidWorld?: [number, number, number];
          }>
        | undefined;
      const f0 = frames?.[0];
      if (!f0?.imageAsset?.assetId || !f0.camera || !f0.depth?.depthAsset?.assetId) {
        return failManifest(manifest, 'Atlas images2PosedRGBD response missing posed camera or depthAsset.');
      }

      const heroFrame: AtlasPosedRGBDFrame = {
        imageAsset: { assetId: f0.imageAsset.assetId },
        camera: f0.camera,
        depth: {
          depthAsset: { assetId: f0.depth.depthAsset.assetId },
          ...(f0.depth.confidenceAsset?.assetId
            ? { confidenceAsset: { assetId: f0.depth.confidenceAsset.assetId } }
            : {}),
        },
      };

      manifest.hero_posed_frame = heroFrame;
      manifest.hero_camera_position = f0.camera.extrinsics.position;
      manifest.centroid_world =
        Array.isArray(f0.centroidWorld) && f0.centroidWorld.length === 3
          ? f0.centroidWorld
          : [0, 0, -8];

      const targetCameras = buildAtlasOrbitTargetCameras(f0.camera, manifest.centroid_world);

      const genViewsSub = await submitAtlasTask(
        'atlasGenerate',
        {
          contextFrames: [heroFrame],
          targetCameras,
          prompt: manifest.prompt_used || BLOCK1_WORLDLABS_TEXT_PROMPT,
          enhancePrompt: false,
          returnDepth: true,
        },
        `${runId}-stage3-views`,
        apiKey,
      );

      if (!genViewsSub.ok || !genViewsSub.operationId) {
        return failManifest(
          manifest,
          `Atlas atlasGenerate submission failed (HTTP ${genViewsSub.status}): ${(genViewsSub.errorText || '').slice(0, 180)}`,
        );
      }

      ops.generating_views = genViewsSub.operationId;
      manifest.atlas_operations = ops;
      manifest.operation_id = genViewsSub.operationId;
      manifest.pipeline_stage = 'generating_views';
      manifest.last_poll_at = Date.now();
      writeManifest(manifest);
      console.log(`[Atlas] Stage 2 complete -> submitted Stage 3 atlasGenerate (${genViewsSub.operationId})`);
      return readManifest();
    }

    // --- STAGE 3 COMPLETE -> SUBMIT STAGE 4 (posedImages2Splats: SINGLE CREDIT-LOCKED FULL_RES RUN) ---
    if (manifest.pipeline_stage === 'generating_views') {
      const genFrames = (opJson.response.frames ?? []) as Array<{
        imageAsset?: AtlasTaskAsset;
        camera?: AtlasPinholeCamera;
        depth?: {
          depthAsset?: AtlasTaskAsset | null;
          logDepthAsset?: AtlasTaskAsset | null;
          confidenceAsset?: AtlasTaskAsset | null;
          zMin?: number;
          zMax?: number;
        } | null;
      }>;

      const posedFrames: AtlasPosedRGBDFrame[] = [];
      if (manifest.hero_posed_frame) {
        posedFrames.push(manifest.hero_posed_frame);
      }

      for (const gf of genFrames) {
        if (!gf?.imageAsset?.assetId || !gf.camera || !gf.depth) continue;
        if (gf.depth.depthAsset?.assetId) {
          posedFrames.push({
            imageAsset: { assetId: gf.imageAsset.assetId },
            camera: gf.camera,
            depth: {
              depthAsset: { assetId: gf.depth.depthAsset.assetId },
              ...(gf.depth.confidenceAsset?.assetId
                ? { confidenceAsset: { assetId: gf.depth.confidenceAsset.assetId } }
                : {}),
            },
          });
        } else if (
          gf.depth.logDepthAsset?.assetId &&
          typeof gf.depth.zMin === 'number' &&
          typeof gf.depth.zMax === 'number'
        ) {
          posedFrames.push({
            imageAsset: { assetId: gf.imageAsset.assetId },
            camera: gf.camera,
            depth: {
              logDepthAsset: { assetId: gf.depth.logDepthAsset.assetId },
              zMin: gf.depth.zMin,
              zMax: gf.depth.zMax,
              ...(gf.depth.confidenceAsset?.assetId
                ? { confidenceAsset: { assetId: gf.depth.confidenceAsset.assetId } }
                : {}),
            },
          });
        }
      }

      if (posedFrames.length < 2) {
        return failManifest(
          manifest,
          `Atlas multi-view synthesis returned fewer than 2 depth frames (${posedFrames.length}); cannot reconstruct splat.`,
        );
      }

      manifest.all_posed_frames = posedFrames;

      // HARD CREDIT LOCK: posedImages2Splats is submitted ONCE and locked immediately
      const splatSub = await submitAtlasTask(
        'posedImages2Splats',
        {
          posedFrames,
          prompt: manifest.prompt_used || BLOCK1_WORLDLABS_TEXT_PROMPT,
          enhancePrompt: false,
        },
        `${runId}-stage4-splats`,
        apiKey,
      );

      if (!splatSub.ok || !splatSub.operationId) {
        return failManifest(
          manifest,
          `Atlas posedImages2Splats submission failed (HTTP ${splatSub.status}): ${(splatSub.errorText || '').slice(0, 180)}`,
        );
      }

      ops.reconstructing_splats = splatSub.operationId;
      manifest.atlas_operations = ops;
      manifest.operation_id = splatSub.operationId;
      manifest.world_id = splatSub.operationId;
      manifest.pipeline_stage = 'reconstructing_splats';
      manifest.single_generation_locked = true;
      manifest.last_poll_at = Date.now();
      writeManifest(manifest);
      console.log(
        `[Atlas] Stage 3 complete (${posedFrames.length} views) -> submitted Stage 4 posedImages2Splats (${splatSub.operationId}) [CREDIT LOCK ON]`,
      );
      return readManifest();
    }

    // --- STAGE 4 COMPLETE -> CACHE FULL_RES .SPZ + SUBMIT STAGE 5 (splats2Mesh) ---
    if (manifest.pipeline_stage === 'reconstructing_splats') {
      const selected = selectHighestResolutionSplat(opJson.response);
      if (!selected.assetId && !selected.url) {
        return failManifest(
          manifest,
          'Atlas posedImages2Splats completed without returning any refinedSplats asset.',
          true,
        );
      }

      const spzOk = await downloadAtlasAssetToCache(
        { assetId: selected.assetId, url: selected.url },
        'splat.spz',
        apiKey,
      );

      if (!spzOk) {
        return failManifest(
          manifest,
          'Atlas full_res .spz reconstruction completed, but local cache download failed.',
          true,
        );
      }

      manifest.splat_asset_id = selected.assetId;
      manifest.splat_count = selected.splatCount;
      manifest.spz_resolution = 'full_res';
      manifest.has_local_spz = true;

      if (!selected.assetId) {
        // Splat cached cleanly; complete without mesh if no durable assetId
        manifest.status = 'completed';
        manifest.pipeline_stage = 'completed';
        manifest.completed_at = new Date().toISOString();
        manifest.single_generation_locked = true;
        manifest.error_message = null;
        writeManifest(manifest);
        return readManifest();
      }

      const meshSub = await submitAtlasTask(
        'splats2Mesh',
        {
          splatAsset: { assetId: selected.assetId },
          textureMode: 'none',
          colliderBoxes: { targetBoxes: 64 },
        },
        `${runId}-stage5-mesh`,
        apiKey,
      );

      if (!meshSub.ok || !meshSub.operationId) {
        // Keep the photorealistic .spz playable & locked even if mesh extraction fails!
        manifest.status = 'completed';
        manifest.pipeline_stage = 'completed';
        manifest.completed_at = new Date().toISOString();
        manifest.single_generation_locked = true;
        manifest.error_message = null;
        writeManifest(manifest);
        console.warn(
          `[Atlas] Stage 4 .spz cached, Stage 5 splats2Mesh skipped (HTTP ${meshSub.status})`,
        );
        return readManifest();
      }

      ops.extracting_mesh = meshSub.operationId;
      manifest.atlas_operations = ops;
      manifest.operation_id = meshSub.operationId;
      manifest.pipeline_stage = 'extracting_mesh';
      manifest.single_generation_locked = true;
      manifest.last_poll_at = Date.now();
      writeManifest(manifest);
      console.log(
        `[Atlas] Stage 4 .spz cached (${selected.splatCount ?? 'full_res'} splats) -> submitted Stage 5 splats2Mesh (${meshSub.operationId})`,
      );
      return readManifest();
    }

    // --- STAGE 5 COMPLETE -> CACHE .GLB COLLIDER & FINISH ---
    if (manifest.pipeline_stage === 'extracting_mesh') {
      const meshAsset = opJson.response.mesh as AtlasTaskAsset | undefined;
      const colliderBoxesAsset = opJson.response.colliderBoxes as AtlasTaskAsset | undefined;

      // Prefer the high-detail aligned GLB mesh (fallback to colliderBoxes GLB)
      let glbOk = await downloadAtlasAssetToCache(meshAsset, 'collider.glb', apiKey);
      let usedAssetId = meshAsset?.assetId ?? null;
      if (!glbOk && colliderBoxesAsset) {
        glbOk = await downloadAtlasAssetToCache(colliderBoxesAsset, 'collider.glb', apiKey);
        usedAssetId = colliderBoxesAsset.assetId ?? null;
      }

      manifest.collider_asset_id = usedAssetId;
      manifest.has_local_collider = glbOk;
      manifest.status = 'completed';
      manifest.pipeline_stage = 'completed';
      manifest.completed_at = new Date().toISOString();
      manifest.single_generation_locked = true;
      manifest.error_message = null;
      writeManifest(manifest);
      console.log(
        `[Atlas] Stage 5 complete! Day 1 Block 1 full_res .spz + .glb collider permanently cached.`,
      );
      return readManifest();
    }

    return manifest;
  } catch (err) {
    console.error('[Atlas] Poll warning:', err instanceof Error ? err.message : err);
    return manifest;
  } finally {
    pollMutex = false;
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '64kb' }));

  // Background pipeline stepper: runs ONLY while an authorized Block 1 Atlas job is actively in_progress
  const bgPoller = setInterval(() => {
    const m = readManifest();
    if (m.status === 'in_progress') {
      void advanceAtlasPipeline(m);
    }
  }, 6000);
  bgPoller.unref();

  // 0. GET /api/worldlabs/block1/health — Zero-cost Atlas connectivity + API key auth verification
  app.get('/api/worldlabs/block1/health', async (_req, res) => {
    const apiKey = getApiKey();
    if (!apiKey) {
      res.status(503).json({
        configured: false,
        reachable: false,
        authenticated: false,
        api_base: ATLAS_API_BASE,
      });
      return;
    }

    try {
      const [healthResp, authResp] = await Promise.all([
        fetch(`${ATLAS_API_BASE}/health`, { signal: AbortSignal.timeout(10_000) }),
        fetch(`${ATLAS_API_BASE}/operations?pageSize=1`, {
          headers: { 'WLT-Api-Key': apiKey, Accept: 'application/json' },
          signal: AbortSignal.timeout(10_000),
        }),
      ]);
      res.json({
        configured: true,
        reachable: healthResp.ok,
        authenticated: authResp.ok,
        auth_http_status: authResp.status,
        api_base: ATLAS_API_BASE,
      });
    } catch (err) {
      res.status(502).json({
        configured: true,
        reachable: false,
        authenticated: false,
        error: err instanceof Error ? err.message : 'Atlas health check failed',
      });
    }
  });

  // 1. GET /api/worldlabs/block1/status — Safe read/poll endpoint (NEVER initiates a new run)
  app.get('/api/worldlabs/block1/status', async (_req, res) => {
    const configured = Boolean(getApiKey());
    let manifest = readManifest();
    if (manifest.status === 'in_progress') {
      manifest = await advanceAtlasPipeline(manifest);
    }
    res.json({
      configured,
      authorized_block: AUTHORIZED_BLOCK_ID,
      credit_protection_active: true,
      record: toPublicRecord(manifest),
    });
  });

  // 2. POST /api/worldlabs/block1/generate — Strictly credit-locked SINGLE Atlas run for Day 1 Block 1
  app.post('/api/worldlabs/block1/generate', async (req, res) => {
    const requestedBlock =
      typeof req.body?.blockId === 'string' ? req.body.blockId : AUTHORIZED_BLOCK_ID;

    if (!isAuthorizedWorldLabsBlock(requestedBlock)) {
      res.status(403).json({
        error:
          'Single-block credit lock active: only Day 1 — Block 1 (day1_block1) is authorized.',
      });
      return;
    }

    const existing = readManifest();
    // HARD CREDIT-PROTECTION LOCK: Never generate twice once completed or locked!
    if (existing.status === 'completed' || existing.single_generation_locked) {
      const current =
        existing.status === 'in_progress'
          ? await advanceAtlasPipeline(existing)
          : existing;
      res.json({
        cached: true,
        configured: Boolean(getApiKey()),
        authorized_block: AUTHORIZED_BLOCK_ID,
        credit_protection_active: true,
        record: toPublicRecord(current),
      });
      return;
    }

    if (existing.status === 'in_progress' && getActiveStageOperationId(existing)) {
      const polled = await advanceAtlasPipeline(existing);
      res.json({
        cached: true,
        configured: Boolean(getApiKey()),
        authorized_block: AUTHORIZED_BLOCK_ID,
        credit_protection_active: true,
        record: toPublicRecord(polled),
      });
      return;
    }

    const apiKey = getApiKey();
    if (!apiKey) {
      res.status(503).json({
        error: 'WORLD_LABS_API_KEY is not configured in server environment secrets.',
        configured: false,
      });
      return;
    }

    if (generationMutex) {
      res.status(409).json({
        error: 'Block 1 Atlas generation request is already in flight.',
      });
      return;
    }

    generationMutex = true;
    try {
      const recheck = readManifest();
      if (
        recheck.status === 'completed' ||
        recheck.status === 'in_progress' ||
        recheck.single_generation_locked
      ) {
        res.json({
          cached: true,
          configured: true,
          authorized_block: AUTHORIZED_BLOCK_ID,
          credit_protection_active: true,
          record: toPublicRecord(recheck),
        });
        return;
      }

      // Fresh run ID + pure text-to-image Stage 1 submission to World Labs Atlas v2
      const runId = `day1-block1-${Date.now()}`;
      const t2iSub = await submitAtlasTask(
        'atlasTextToImage',
        {
          prompt: BLOCK1_WORLDLABS_TEXT_PROMPT,
          aspectRatio: '16:9',
          enhancePrompt: true,
          seed: 20261121,
          numSamples: 1,
        },
        `${runId}-stage1-t2i`,
        apiKey,
      );

      if (!t2iSub.ok || !t2iSub.operationId) {
        const cleanMessage =
          t2iSub.status === 401 || t2iSub.status === 403
            ? `Atlas API returned HTTP ${t2iSub.status} — verify wl_live_ key scopes (tasks.create, operations.read, assets.read) in Secrets.`
            : `Atlas text-to-image HTTP ${t2iSub.status}: ${(t2iSub.errorText || '').replace(/\s+/g, ' ').slice(0, 180)}`;
        const failedManifest = failManifest(
          {
            ...createEmptyManifest(),
            created_at: new Date().toISOString(),
          },
          cleanMessage,
          false,
        );
        res.status(t2iSub.status === 401 ? 401 : 502).json({
          error: cleanMessage,
          record: toPublicRecord(failedManifest),
        });
        return;
      }

      const activeManifest: StoredAtlasManifest = {
        ...createEmptyManifest(),
        status: 'in_progress',
        pipeline_stage: 'text_to_image' satisfies AtlasPipelineStage,
        pipeline_stage_label: ATLAS_STAGE_LABELS.text_to_image,
        run_id: runId,
        operation_id: t2iSub.operationId,
        created_at: new Date().toISOString(),
        single_generation_locked: true,
        atlas_operations: {
          text_to_image: t2iSub.operationId,
        },
        last_poll_at: Date.now(),
      };
      // Persist immediately BEFORE responding so reloads or restarts can NEVER double-submit
      writeManifest(activeManifest);
      console.log(
        `[Atlas] Started Day 1 Block 1 single-run pipeline -> Stage 1 atlasTextToImage (${t2iSub.operationId})`,
      );

      res.json({
        cached: false,
        configured: true,
        authorized_block: AUTHORIZED_BLOCK_ID,
        credit_protection_active: true,
        record: toPublicRecord(activeManifest),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unexpected Atlas proxy error';
      res.status(502).json({ error: msg });
    } finally {
      generationMutex = false;
    }
  });

  // 3. GET /api/worldlabs/block1/asset/:kind — Path-safe binary proxy for cached .spz / .glb / thumbnail
  app.get('/api/worldlabs/block1/asset/:kind', (req, res) => {
    const kind = req.params.kind as AllowedAssetKind;
    const spec = LOCAL_ASSET_FILES[kind];
    if (!spec) {
      res.status(404).json({ error: 'Unknown asset kind' });
      return;
    }

    const resolved = path.resolve(CACHE_DIR, spec.filename);
    if (!resolved.startsWith(CACHE_DIR + path.sep) || !fs.existsSync(resolved)) {
      res.status(404).json({ error: 'Cached Block 1 asset not available yet' });
      return;
    }

    res.setHeader('Content-Type', spec.contentType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.sendFile(resolved);
  });

  // Vite dev middleware or production static serving
  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distDir, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(
      `[Server] Arabia & Dubai Giant Map + World Labs Atlas v2 Proxy listening on http://0.0.0.0:${PORT} (WORLD_LABS_API_KEY: ${getApiKey() ? 'ACTIVE' : 'NOT_SET'})`,
    );
  });
}

startServer().catch((err) => {
  console.error('[Server] Fatal startup error:', err);
  process.exit(1);
});
