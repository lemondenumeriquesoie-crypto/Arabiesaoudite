import { CHISEL_BLOCK1_SPEC } from './block1Config';

export interface PlayerTransform {
  x: number;
  y: number;
  z: number;
}

export interface Aabb2D {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

const KFR = CHISEL_BLOCK1_SPEC.kingFahdRoad;
const KC = CHISEL_BLOCK1_SPEC.kingdomCentre;
const AF = CHISEL_BLOCK1_SPEC.alFaisaliahTower;

/**
 * Analytic Chisel surface elevation groundY(x, z) for Riyadh Day 1 — Block 1.
 * Returns -6.5 m inside the sunken King Fahd Road expressway cut (unless standing on
 * one of the grade-separated overpasses at Z = -140 m or Z = -72 m), and 0.0 m on
 * the surrounding travertine pedestrian plazas and surface service boulevards.
 */
export function chiselGroundHeightAt(x: number, z: number): number {
  const inTrenchX = Math.abs(x - KFR.centerX) <= KFR.trenchHalfWidth;
  const inTrenchZ = z >= KFR.zMin && z <= KFR.zMax;

  if (inTrenchX && inTrenchZ) {
    // Check if pedestrian is crossing on one of the two surface-level overpasses
    for (const ovZ of KFR.overpassesZ) {
      if (Math.abs(z - ovZ) <= KFR.overpassDeckHalfLenZ) {
        return 0;
      }
    }
    return KFR.depthY;
  }

  return 0;
}

/**
 * Non-negotiable pedestrian camera height lock:
 *   y >= groundY(x, z) + 1.65 m
 * Uses the .glb collider mesh raycast ground elevation when available, falling back
 * to the Chisel analytic ground height so the camera can never clip underground.
 */
export function enforcePedestrianHeightLock(
  x: number,
  currentY: number,
  z: number,
  colliderGroundY: number | null,
  eyeHeightM = CHISEL_BLOCK1_SPEC.pedestrianEyeHeightM,
): number {
  const baseGroundY =
    colliderGroundY !== null && Number.isFinite(colliderGroundY)
      ? colliderGroundY
      : chiselGroundHeightAt(x, z);
  const minAllowedY = baseGroundY + eyeHeightM;
  return Math.max(currentY, minAllowedY);
}

/**
 * Solid Chisel podium & retaining wall obstacle footprints used alongside .glb
 * collider raycasts so the pedestrian never clips into tower podiums or out of bounds.
 */
export const CHISEL_SOLID_OBSTACLES: Aabb2D[] = [
  // Kingdom Centre podium footprint (X=+20, Z=-172)
  {
    minX: KC.x - KC.footprintHalfX,
    maxX: KC.x + KC.footprintHalfX,
    minZ: KC.z - KC.footprintHalfZ,
    maxZ: KC.z + KC.footprintHalfZ,
  },
  // Al-Faisaliah Tower podium footprint (X=+20, Z=-108)
  {
    minX: AF.x - AF.footprintHalfX,
    maxX: AF.x + AF.footprintHalfX,
    minZ: AF.z - AF.footprintHalfZ,
    maxZ: AF.z + AF.footprintHalfZ,
  },
];

/**
 * Resolves horizontal swept movement against Chisel podium AABBs and playable bounds
 * (pure math — tested deterministically via node:test).
 */
export function resolveHorizontalCollision(
  prevX: number,
  prevZ: number,
  nextX: number,
  nextZ: number,
  playerRadius = 0.6,
  obstacles: Aabb2D[] = CHISEL_SOLID_OBSTACLES,
  worldHalfExtent = 260,
): { x: number; z: number; collided: boolean } {
  let x = Math.max(-worldHalfExtent, Math.min(worldHalfExtent, nextX));
  let z = Math.max(-worldHalfExtent, Math.min(worldHalfExtent, nextZ));
  let collided = x !== nextX || z !== nextZ;

  for (const box of obstacles) {
    const minX = box.minX - playerRadius;
    const maxX = box.maxX + playerRadius;
    const minZ = box.minZ - playerRadius;
    const maxZ = box.maxZ + playerRadius;

    if (x > minX && x < maxX && z > minZ && z < maxZ) {
      collided = true;
      // Slide cleanly along the axis that was outside prior to the step
      const wasOutsideX = prevX <= minX || prevX >= maxX;
      const wasOutsideZ = prevZ <= minZ || prevZ >= maxZ;

      if (wasOutsideX && !wasOutsideZ) {
        x = prevX <= minX ? minX : maxX;
      } else if (wasOutsideZ && !wasOutsideX) {
        z = prevZ <= minZ ? minZ : maxZ;
      } else {
        // Push out via minimum penetration axis
        const dxMin = Math.abs(x - minX);
        const dxMax = Math.abs(maxX - x);
        const dzMin = Math.abs(z - minZ);
        const dzMax = Math.abs(maxZ - z);
        const m = Math.min(dxMin, dxMax, dzMin, dzMax);
        if (m === dxMin) x = minX;
        else if (m === dxMax) x = maxX;
        else if (m === dzMin) z = minZ;
        else z = maxZ;
      }
    }
  }

  return { x, z, collided };
}
