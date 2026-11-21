import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';
import {
  ArrowLeft,
  Box,
  ChevronDown,
  ChevronUp,
  Compass,
  Footprints,
  Grid3x3,
  Layers,
  Loader2,
  Moon,
  Orbit,
  ShieldCheck,
  Sparkles,
  Sun,
  Sunset,
} from 'lucide-react';
import {
  AUTHORIZED_BLOCK_ID,
  CHISEL_BLOCK1_SPEC,
  CameraControlMode,
  RELIGHT_PASSES,
  RelightPassId,
  WorldLabsStatusResponse,
} from '../world3d/block1Config';
import {
  ChiselRigHandles,
  buildRiyadhBlock1ChiselScene,
} from '../world3d/buildChiselOverlay';
import {
  enforcePedestrianHeightLock,
  resolveHorizontalCollision,
} from '../world3d/playerPhysics';

interface RiyadhBlock1ViewportProps {
  onReturnToMap: () => void;
}

type CameraPresetId = 'splat_vista' | 'hero' | 'pedestrian';

function detectSoftwareWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) ?? '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

function createSkyDomeShader(topHex: string, horizonHex: string): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uTopColor: { value: new THREE.Color(topHex) },
      uHorizonColor: { value: new THREE.Color(horizonHex) },
    },
    vertexShader: `
      varying vec3 vWorldPos;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      uniform vec3 uTopColor;
      uniform vec3 uHorizonColor;
      varying vec3 vWorldPos;
      void main() {
        float h = normalize(vWorldPos).y;
        float t = clamp(pow(max(h, 0.0), 0.55), 0.0, 1.0);
        vec3 col = mix(uHorizonColor, uTopColor, t);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

// Reusable scratch math objects (zero per-frame GC allocation)
const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _moveVec = new THREE.Vector3();
const _rayOrigin = new THREE.Vector3();
const _rayDir = new THREE.Vector3();
const _downDir = new THREE.Vector3(0, -1, 0);
const _upAxis = new THREE.Vector3(0, 1, 0);
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');

export const RiyadhBlock1Viewport: React.FC<RiyadhBlock1ViewportProps> = ({
  onReturnToMap,
}) => {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);

  // 4-Stage interactive HUD state
  const [relightPass, setRelightPass] = useState<RelightPassId>('golden_hour');
  const [cameraMode, setCameraMode] = useState<CameraControlMode>('orbit');
  const [showSplat, setShowSplat] = useState<boolean>(true);
  const [showChiselWireframe, setShowChiselWireframe] = useState<boolean>(false);
  const [showColliderMesh, setShowColliderMesh] = useState<boolean>(false);
  const [dockCollapsed, setDockCollapsed] = useState<boolean>(false);

  // World Labs API & Asset Loading Status
  const [apiStatus, setApiStatus] = useState<WorldLabsStatusResponse | null>(null);
  const [isTriggeringGen, setIsTriggeringGen] = useState<boolean>(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [splatLoaded, setSplatLoaded] = useState<boolean>(false);
  const [colliderLoaded, setColliderLoaded] = useState<boolean>(false);
  const [hudTelemetry, setHudTelemetry] = useState<{
    fps: number;
    eyeY: number;
    groundY: number;
    colliderBound: boolean;
  }>({
    fps: 60,
    eyeY: CHISEL_BLOCK1_SPEC.cameras.heroEstablishing.position.y,
    groundY: 0,
    colliderBound: false,
  });

  // Mutable refs for stable WebGL loop (never tears down renderer on HUD changes)
  const relightPassRef = useRef<RelightPassId>(relightPass);
  const cameraModeRef = useRef<CameraControlMode>(cameraMode);
  const showSplatRef = useRef<boolean>(showSplat);
  const showChiselWireframeRef = useRef<boolean>(showChiselWireframe);
  const showColliderMeshRef = useRef<boolean>(showColliderMesh);
  const splatLoadedRef = useRef<boolean>(false);

  relightPassRef.current = relightPass;
  cameraModeRef.current = cameraMode;
  showSplatRef.current = showSplat;
  showChiselWireframeRef.current = showChiselWireframe;
  showColliderMeshRef.current = showColliderMesh;

  // Imperative scene handles exposed to React controls
  const sceneHandlesRef = useRef<{
    applyRelight: (passId: RelightPassId) => void;
    syncVisibility: () => void;
    jumpToPreset: (preset: CameraPresetId) => void;
    loadWorldLabsAssets: (
      hasSpz: boolean,
      hasGlb: boolean,
      heroCamPos?: [number, number, number] | null,
      centroidWorld?: [number, number, number] | null,
    ) => void;
  } | null>(null);

  // Poll /api/worldlabs/block1/status safely (NEVER auto-generates!)
  const fetchStatus = useCallback(async () => {
    try {
      const resp = await fetch('/api/worldlabs/block1/status');
      if (!resp.ok) return;
      const json = (await resp.json()) as WorldLabsStatusResponse;
      setApiStatus(json);
      if (json.record.error_message) {
        setGenError(json.record.error_message);
      } else {
        setGenError(null);
      }
      if (json.record.has_local_spz || json.record.has_local_collider) {
        sceneHandlesRef.current?.loadWorldLabsAssets(
          json.record.has_local_spz,
          json.record.has_local_collider,
          json.record.hero_camera_position,
          json.record.centroid_world,
        );
      }
    } catch {
      // Non-fatal network warning
    }
  }, []);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  // Poll every 4 seconds ONLY while a single authorized generation is actively running
  useEffect(() => {
    if (apiStatus?.record.status !== 'in_progress') return;
    const timer = window.setInterval(() => {
      void fetchStatus();
    }, 4000);
    return () => window.clearInterval(timer);
  }, [apiStatus?.record.status, fetchStatus]);

  // Manual single-generation trigger (strictly credit-locked on backend)
  const handleGenerateSingleBlock1 = useCallback(async () => {
    if (isTriggeringGen) return;
    if (
      apiStatus?.record.status === 'completed' ||
      apiStatus?.record.status === 'in_progress'
    ) {
      return;
    }
    setIsTriggeringGen(true);
    setGenError(null);
    try {
      const resp = await fetch('/api/worldlabs/block1/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blockId: AUTHORIZED_BLOCK_ID }),
      });
      const json = await resp.json();
      if (!resp.ok) {
        setGenError(json.error || `Request failed (HTTP ${resp.status})`);
      } else if (json.record) {
        setApiStatus({
          configured: Boolean(json.configured),
          authorized_block: AUTHORIZED_BLOCK_ID,
          credit_protection_active: true,
          record: json.record,
        });
      }
    } catch (err) {
      setGenError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setIsTriggeringGen(false);
    }
  }, [apiStatus?.record.status, isTriggeringGen]);

  // Keyboard shortcut H to toggle Cinema / Zen Mode
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'h' || e.key === 'H') {
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
          setDockCollapsed((prev) => !prev);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 1. Mount single persistent Three.js + @sparkjsdev/spark WebGL Viewport
  useEffect(() => {
    const mount = canvasMountRef.current;
    if (!mount) return;

    const isSoftwareGl = detectSoftwareWebGL();
    const width = mount.clientWidth || window.innerWidth;
    const height = mount.clientHeight || window.innerHeight;

    const scene = new THREE.Scene();
    const initPass = RELIGHT_PASSES[relightPassRef.current];
    scene.background = new THREE.Color(initPass.skyHorizonHex);
    scene.fog = new THREE.FogExp2(initPass.fogHex, initPass.fogDensity);

    const camera = new THREE.PerspectiveCamera(58, width / height, 0.1, 1600);
    const axialCam = CHISEL_BLOCK1_SPEC.cameras.axialVista;
    camera.position.set(axialCam.position.x, axialCam.position.y, axialCam.position.z);

    // SparkRenderer recommends antialias: false for optimal 60 FPS Gaussian Splatting
    const renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true,
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = initPass.exposure;
    renderer.setPixelRatio(isSoftwareGl ? 0.5 : Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.transition = 'filter 280ms ease';
    renderer.domElement.style.filter = initPass.canvasFilter;
    mount.innerHTML = '';
    mount.appendChild(renderer.domElement);

    // Mandatory studio environment reflections (RoomEnvironment + PMREMGenerator)
    const pmrem = new THREE.PMREMGenerator(renderer);
    const roomEnv = new RoomEnvironment();
    const envTarget = pmrem.fromScene(roomEnv, 0.04);
    scene.environment = envTarget.texture;
    scene.environmentIntensity = initPass.envIntensity;
    roomEnv.dispose();
    pmrem.dispose();

    // Procedural atmospheric gradient Sky Dome
    const skyGeo = new THREE.SphereGeometry(900, 24, 16);
    const skyMat = createSkyDomeShader(initPass.skyTopHex, initPass.skyHorizonHex);
    const skyDome = new THREE.Mesh(skyGeo, skyMat);
    scene.add(skyDome);

    // Physical Directional Sun + Cool/Warm Hemisphere Fill Rig
    const sunLight = new THREE.DirectionalLight(initPass.sunColorHex, initPass.sunIntensity);
    sunLight.position.set(
      initPass.sunPosition.x,
      initPass.sunPosition.y,
      initPass.sunPosition.z,
    );
    sunLight.castShadow = !isSoftwareGl;
    if (!isSoftwareGl) {
      sunLight.shadow.mapSize.set(1024, 1024);
      sunLight.shadow.camera.near = 10;
      sunLight.shadow.camera.far = 520;
      sunLight.shadow.camera.left = -220;
      sunLight.shadow.camera.right = 220;
      sunLight.shadow.camera.top = 220;
      sunLight.shadow.camera.bottom = -220;
      sunLight.shadow.bias = -0.0005;
      sunLight.shadow.normalBias = 0.02;
    }
    scene.add(sunLight);

    const hemiLight = new THREE.HemisphereLight(
      initPass.hemiSkyHex,
      initPass.hemiGroundHex,
      initPass.hemiIntensity,
    );
    scene.add(hemiLight);

    // PART 1: Chisel 1:1 Metric Spatial Reference & Wireframe Overlay
    const chiselRig: ChiselRigHandles = buildRiyadhBlock1ChiselScene(isSoftwareGl);
    scene.add(chiselRig.rootGroup);

    // PART 2: @sparkjsdev/spark Gaussian Splat Renderer (mounted once)
    let sparkRenderer: SparkRenderer | null = null;
    try {
      sparkRenderer = new SparkRenderer({
        renderer,
        ...(isSoftwareGl
          ? { enableLod: true, lodSplatCount: 250000, maxStdDev: 2.0, maxPixelRadius: 64 }
          : {}),
      });
      scene.add(sparkRenderer);
    } catch (err) {
      console.warn('[Spark] SparkRenderer init warning:', err);
    }

    let splatMesh: SplatMesh | null = null;
    let spzLoadInitiated = false;

    // PART 4: .glb Collision Mesh Container
    const colliderGroup = new THREE.Group();
    colliderGroup.name = 'WorldLabs_Collider_GLB';
    colliderGroup.visible = false;
    scene.add(colliderGroup);

    const colliderMeshes: THREE.Mesh[] = [];
    const colliderWireMaterial = new THREE.MeshBasicMaterial({
      color: 0x4fd6d0,
      wireframe: true,
      transparent: true,
      opacity: 0.42,
    });
    let glbLoadInitiated = false;
    const splatOriginCenter = new THREE.Vector3(0, 0, -6);
    const splatOriginCameraPos = new THREE.Vector3(0, 0.2, 0.1);
    let hasAtlasHeroPose = false;

    // OrbitControls for Free Aerial Orbit Mode
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.06;
    controls.maxDistance = 480;
    controls.minDistance = 0.5;
    controls.maxPolarAngle = Math.PI * 0.68;
    controls.target.set(axialCam.lookAt.x, axialCam.lookAt.y, axialCam.lookAt.z);
    controls.update();

    // First-Person Walk Mode State (WASD + Mouse Look + 1.65 m Ground Lock)
    const keysPressed: Record<string, boolean> = {};
    let walkYaw = THREE.MathUtils.degToRad(-18);
    let walkPitch = THREE.MathUtils.degToRad(7);
    let draggingLook = false;
    let lastMouseX = 0;
    let lastMouseY = 0;
    const raycaster = new THREE.Raycaster();
    let lastGroundY = 0;

    // Smooth camera transition target (cancelled on user drag/Orbit start)
    let camTransition: {
      active: boolean;
      targetPos: THREE.Vector3;
      targetLook: THREE.Vector3;
    } = {
      active: false,
      targetPos: new THREE.Vector3(),
      targetLook: new THREE.Vector3(),
    };

    controls.addEventListener('start', () => {
      camTransition.active = false;
    });

    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      keysPressed[e.code] = true;
      scheduleSoftwareRender(3);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      keysPressed[e.code] = false;
    };
    const onPointerDown = (e: PointerEvent) => {
      if (cameraModeRef.current !== 'walk') return;
      draggingLook = true;
      lastMouseX = e.clientX;
      lastMouseY = e.clientY;
    };
    const onPointerMove = (e: PointerEvent) => {
      if (cameraModeRef.current !== 'walk') return;
      if (document.pointerLockElement === renderer.domElement) {
        walkYaw -= e.movementX * 0.0022;
        walkPitch = THREE.MathUtils.clamp(
          walkPitch - e.movementY * 0.0022,
          -Math.PI * 0.44,
          Math.PI * 0.44,
        );
        scheduleSoftwareRender(1);
      } else if (draggingLook) {
        const dx = e.clientX - lastMouseX;
        const dy = e.clientY - lastMouseY;
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
        walkYaw -= dx * 0.004;
        walkPitch = THREE.MathUtils.clamp(
          walkPitch - dy * 0.004,
          -Math.PI * 0.44,
          Math.PI * 0.44,
        );
        scheduleSoftwareRender(1);
      }
    };
    const onPointerUp = () => {
      draggingLook = false;
    };
    const onDoubleClick = () => {
      if (cameraModeRef.current === 'walk' && document.pointerLockElement !== renderer.domElement) {
        renderer.domElement.requestPointerLock?.();
      }
    };

    controls.addEventListener('change', () => {
      scheduleSoftwareRender(1);
    });

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('dblclick', onDoubleClick);

    // Apply PART 3 Relight Pass dynamically with zero geometry mutation
    const applyRelight = (passId: RelightPassId) => {
      const cfg = RELIGHT_PASSES[passId];
      skyMat.uniforms.uTopColor.value.set(cfg.skyTopHex);
      skyMat.uniforms.uHorizonColor.value.set(cfg.skyHorizonHex);
      scene.background = new THREE.Color(cfg.skyHorizonHex);
      scene.fog = new THREE.FogExp2(cfg.fogHex, cfg.fogDensity);

      sunLight.color.set(cfg.sunColorHex);
      sunLight.intensity = cfg.sunIntensity;
      sunLight.position.set(cfg.sunPosition.x, cfg.sunPosition.y, cfg.sunPosition.z);

      hemiLight.color.set(cfg.hemiSkyHex);
      hemiLight.groundColor.set(cfg.hemiGroundHex);
      hemiLight.intensity = cfg.hemiIntensity;
      scene.environmentIntensity = cfg.envIntensity;

      renderer.toneMappingExposure = cfg.exposure;
      renderer.domElement.style.filter = cfg.canvasFilter;

      // Real-time Gaussian Splat tint grading via SparkJS recolor
      if (splatMesh) {
        splatMesh.recolor.set(cfg.splatRecolorHex);
      }

      // Illuminated Riyadh Night architectural lighting accents
      const n = cfg.nightAccentIntensity;
      chiselRig.nightGlowMaterials.kingdomArchGlow.emissiveIntensity = 0.14 + n * 0.95;
      chiselRig.nightGlowMaterials.faisaliahGlobeGlow.emissiveIntensity = 0.12 + n * 0.85;
      chiselRig.nightGlowMaterials.faisaliahRibsGlow.emissiveIntensity = 0.03 + n * 0.42;
      chiselRig.nightGlowMaterials.highwayLightsGlow.emissiveIntensity = 0.25 + n * 0.85;
      chiselRig.nightGlowMaterials.streetLampsGlow.emissiveIntensity = 0.2 + n * 0.9;
      scheduleSoftwareRender(2);
    };

    const syncVisibility = () => {
      const activeSplat = splatLoadedRef.current && showSplatRef.current;
      if (splatMesh) {
        splatMesh.visible = activeSplat;
      }
      // Show solid Chisel reference only when .spz splat is hidden or still generating
      chiselRig.solidGroup.visible = !activeSplat;
      chiselRig.wireframeGroup.visible = showChiselWireframeRef.current;
      colliderGroup.visible = showColliderMeshRef.current;
      scheduleSoftwareRender(2);
    };

    const jumpToPreset = (preset: CameraPresetId) => {
      camTransition.active = false;
      if (preset === 'splat_vista') {
        setCameraMode('orbit');
        cameraModeRef.current = 'orbit';
        controls.enabled = true;
        camera.position.copy(splatOriginCameraPos);
        controls.target.copy(splatOriginCenter);
        controls.update();
        scheduleSoftwareRender(2);
        return;
      }
      if (preset === 'hero') {
        setCameraMode('orbit');
        cameraModeRef.current = 'orbit';
        controls.enabled = true;
        const h = CHISEL_BLOCK1_SPEC.cameras.axialVista;
        camera.position.set(h.position.x, h.position.y, h.position.z);
        controls.target.set(h.lookAt.x, h.lookAt.y, h.lookAt.z);
        controls.update();
        scheduleSoftwareRender(2);
        return;
      }
      if (preset === 'pedestrian') {
        setCameraMode('walk');
        cameraModeRef.current = 'walk';
        controls.enabled = false;
        if (splatLoadedRef.current) {
          // Spawn pedestrian cleanly along the foreground Atlas corridor looking toward the skyline
          const dirToCenter = _forward
            .subVectors(splatOriginCenter, splatOriginCameraPos)
            .setY(0);
          if (dirToCenter.lengthSq() < 1e-4) dirToCenter.set(0, 0, -1);
          dirToCenter.normalize();
          const startX = splatOriginCameraPos.x + dirToCenter.x * 6.0;
          const startZ = splatOriginCameraPos.z + dirToCenter.z * 6.0;
          let groundY = splatOriginCenter.y;
          if (colliderMeshes.length > 0) {
            raycaster.set(
              _rayOrigin.set(startX, Math.max(splatOriginCameraPos.y, splatOriginCenter.y) + 25, startZ),
              _downDir,
            );
            const hits = raycaster.intersectObjects(colliderMeshes, false);
            if (hits.length > 0) {
              groundY = hits[0].point.y;
            }
          }
          lastGroundY = groundY;
          camera.position.set(startX, groundY + 1.65, startZ);
          walkYaw = Math.atan2(-dirToCenter.x, -dirToCenter.z);
          walkPitch = THREE.MathUtils.degToRad(6);
        } else {
          const p = CHISEL_BLOCK1_SPEC.cameras.pedestrianGround;
          lastGroundY = 0;
          camera.position.set(p.position.x, p.position.y, p.position.z);
          walkYaw = THREE.MathUtils.degToRad(p.yawDeg ?? -18);
          walkPitch = THREE.MathUtils.degToRad(p.pitchDeg ?? 7);
        }
        _euler.set(walkPitch, walkYaw, 0, 'YXZ');
        camera.quaternion.setFromEuler(_euler);
        scheduleSoftwareRender(2);
      }
    };

    // Load cached World Labs Atlas .spz Gaussian Splat and .glb Collider Mesh once available
    const loadWorldLabsAssets = (
      hasSpz: boolean,
      hasGlb: boolean,
      heroCamPos?: [number, number, number] | null,
      centroidWorld?: [number, number, number] | null,
    ) => {
      if (
        Array.isArray(heroCamPos) &&
        heroCamPos.length === 3 &&
        Array.isArray(centroidWorld) &&
        centroidWorld.length === 3
      ) {
        splatOriginCameraPos.set(heroCamPos[0], heroCamPos[1], heroCamPos[2]);
        // Aim level/slightly upward down the King Fahd Road corridor so both full tower crowns stay in frame
        splatOriginCenter.set(
          centroidWorld[0],
          Math.max(centroidWorld[1], heroCamPos[1] + 2.0),
          centroidWorld[2],
        );
        hasAtlasHeroPose = true;
      }

      if (hasSpz && !spzLoadInitiated) {
        spzLoadInitiated = true;
        try {
          // Atlas v2 RUB .spz renders natively in Three.js (+X right, +Y up, -Z forward)
          const mesh = new SplatMesh({
            url: '/api/worldlabs/block1/asset/splat.spz',
            ...(isSoftwareGl ? { lod: true } : {}),
          });
          mesh.recolor.set(RELIGHT_PASSES[relightPassRef.current].splatRecolorHex);
          splatMesh = mesh;
          scene.add(mesh);

          void mesh.initialized.then(() => {
            splatLoadedRef.current = true;
            setSplatLoaded(true);
            controls.maxPolarAngle = Math.PI * 0.85;
            controls.maxDistance = Math.max(
              480,
              splatOriginCameraPos.distanceTo(splatOriginCenter) * 2.5,
            );
            syncVisibility();
            // Frame the photorealistic World Labs Atlas splat cleanly from the hero RUB camera
            camera.position.copy(splatOriginCameraPos);
            controls.target.copy(splatOriginCenter);
            controls.update();
            scheduleSoftwareRender(3);
          });
        } catch (err) {
          console.error('[Spark] Failed loading .spz splat:', err);
        }
      }

      if (hasGlb && !glbLoadInitiated) {
        glbLoadInitiated = true;
        const gltfLoader = new GLTFLoader();
        gltfLoader.load(
          '/api/worldlabs/block1/asset/collider.glb',
          (gltf) => {
            const model = gltf.scene;
            colliderMeshes.length = 0;
            model.traverse((obj) => {
              if ((obj as THREE.Mesh).isMesh) {
                const m = obj as THREE.Mesh;
                m.material = colliderWireMaterial;
                colliderMeshes.push(m);
              }
            });
            colliderGroup.add(model);

            // Use collider bounds only if Atlas hero camera/centroid wasn't already persisted
            if (!hasAtlasHeroPose) {
              const box = new THREE.Box3().setFromObject(model);
              if (!box.isEmpty()) {
                const center = box.getCenter(new THREE.Vector3());
                const size = box.getSize(new THREE.Vector3());
                const groundY = box.min.y + Math.min(0.4, size.y * 0.05);
                splatOriginCenter.set(center.x, groundY + 1.65, center.z);
                splatOriginCameraPos.set(
                  center.x,
                  groundY + Math.min(3.2, Math.max(1.85, size.y * 0.25)),
                  center.z + Math.min(6.0, Math.max(2.6, size.z * 0.22)),
                );
                if (splatLoadedRef.current && cameraModeRef.current === 'orbit') {
                  camera.position.copy(splatOriginCameraPos);
                  controls.target.copy(splatOriginCenter);
                  controls.update();
                }
              }
            }

            setColliderLoaded(true);
            syncVisibility();
            scheduleSoftwareRender(2);
          },
          undefined,
          (err) => {
            console.warn('[Collider] GLB load warning:', err);
          },
        );
      }
    };

    sceneHandlesRef.current = {
      applyRelight,
      syncVisibility,
      jumpToPreset,
      loadWorldLabsAssets,
    };

    // Handle window resize cleanly
    const onResize = () => {
      const w = mount.clientWidth || window.innerWidth;
      const h = mount.clientHeight || window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      scheduleSoftwareRender(2);
    };
    window.addEventListener('resize', onResize);

    // Render loop: locked 60 FPS rAF on GPU, on-demand afterDraw-paced on software WebGL
    let disposed = false;
    let frameId = 0;
    let prevTime = performance.now();
    let fpsAccumulator = 0;
    let fpsFrames = 0;
    let lastHudUpdate = 0;
    let swPendingFrames = 2;
    let swLoopActive = false;

    function scheduleSoftwareRender(extraFrames = 1) {
      if (!isSoftwareGl || disposed) return;
      swPendingFrames = Math.max(swPendingFrames, extraFrames);
      if (!swLoopActive) {
        swLoopActive = true;
        frameId = window.setTimeout(tick, 16);
      }
    }

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed) {
          if (sync) gl.deleteSync(sync);
          swLoopActive = false;
          return;
        }
        const status = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (status === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 12);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 120);
        }
      };
      frameId = window.setTimeout(poll, 12);
    }

    function stepWalkController(dt: number) {
      controls.enabled = false;
      _euler.set(walkPitch, walkYaw, 0, 'YXZ');
      camera.quaternion.setFromEuler(_euler);

      const moveFwd =
        (keysPressed.KeyW || keysPressed.ArrowUp ? 1 : 0) -
        (keysPressed.KeyS || keysPressed.ArrowDown ? 1 : 0);
      const moveSide =
        (keysPressed.KeyD || keysPressed.ArrowRight ? 1 : 0) -
        (keysPressed.KeyA || keysPressed.ArrowLeft ? 1 : 0);

      // Scale walk speed naturally depending on whether inside compact Splat room or 1:1 macro Chisel
      const baseSpeed = splatLoadedRef.current ? 4.2 : 14.0;
      const sprint = keysPressed.ShiftLeft || keysPressed.ShiftRight ? 2.1 : 1.0;

      if (moveFwd !== 0 || moveSide !== 0) {
        camera.getWorldDirection(_forward);
        _forward.y = 0;
        if (_forward.lengthSq() > 1e-6) _forward.normalize();
        _right.crossVectors(_forward, _upAxis).normalize();

        _moveVec
          .set(0, 0, 0)
          .addScaledVector(_forward, moveFwd)
          .addScaledVector(_right, moveSide);
        if (_moveVec.lengthSq() > 1e-6) _moveVec.normalize();

        const stepDist = baseSpeed * sprint * dt;
        const prevX = camera.position.x;
        const prevZ = camera.position.z;
        let nextX = prevX + _moveVec.x * stepDist;
        let nextZ = prevZ + _moveVec.z * stepDist;

        // Swept horizontal raycast against .glb collider mesh (prevents wall clipping)
        if (colliderMeshes.length > 0) {
          _rayOrigin.set(prevX, camera.position.y - 0.5, prevZ);
          _rayDir.set(_moveVec.x, 0, _moveVec.z).normalize();
          raycaster.set(_rayOrigin, _rayDir);
          raycaster.far = stepDist + 0.65;
          const wallHits = raycaster.intersectObjects(colliderMeshes, false);
          raycaster.far = Infinity;
          if (wallHits.length > 0 && wallHits[0].distance < stepDist + 0.55) {
            nextX = prevX;
            nextZ = prevZ;
          }
        }

        // Also enforce Chisel solid podium footprints when on 1:1 macro scene
        if (!splatLoadedRef.current) {
          const resolved = resolveHorizontalCollision(prevX, prevZ, nextX, nextZ, 0.65);
          nextX = resolved.x;
          nextZ = resolved.z;
        }

        camera.position.x = nextX;
        camera.position.z = nextZ;
      }

      // Ground raycast against .glb collision proxy -> enforce non-negotiable y >= groundY + 1.65 m
      let colliderGroundY: number | null = null;
      if (colliderMeshes.length > 0) {
        _rayOrigin.set(camera.position.x, camera.position.y + 1.8, camera.position.z);
        raycaster.set(_rayOrigin, _downDir);
        raycaster.far = 20;
        const groundHits = raycaster.intersectObjects(colliderMeshes, false);
        raycaster.far = Infinity;
        if (groundHits.length > 0) {
          colliderGroundY = groundHits[0].point.y;
        }
      }

      const targetEyeY = enforcePedestrianHeightLock(
        camera.position.x,
        colliderGroundY !== null ? colliderGroundY + 1.65 : camera.position.y - 6 * dt,
        camera.position.z,
        colliderGroundY,
        CHISEL_BLOCK1_SPEC.pedestrianEyeHeightM,
      );
      lastGroundY = colliderGroundY ?? targetEyeY - CHISEL_BLOCK1_SPEC.pedestrianEyeHeightM;
      // Smoothly damp upward/downward steps while NEVER dropping below groundY + 1.65 m
      const dampedY = THREE.MathUtils.damp(camera.position.y, targetEyeY, 12, dt);
      camera.position.y = enforcePedestrianHeightLock(
        camera.position.x,
        dampedY,
        camera.position.z,
        colliderGroundY,
        CHISEL_BLOCK1_SPEC.pedestrianEyeHeightM,
      );
    }

    function tick() {
      if (disposed) return;
      const now = performance.now();
      const dt = Math.min(0.08, Math.max(0.001, (now - prevTime) / 1000));
      prevTime = now;

      if (cameraModeRef.current === 'walk') {
        stepWalkController(dt);
      } else {
        controls.enabled = true;
        if (!isSoftwareGl) {
          controls.update();
        }
      }

      // Keep sky dome centered on camera
      skyDome.position.copy(camera.position);

      renderer.render(scene, camera);

      // Update throttled HUD telemetry (~4 Hz)
      fpsAccumulator += dt;
      fpsFrames += 1;
      if (now - lastHudUpdate > 260) {
        const measuredFps = Math.min(
          60,
          Math.max(1, Math.round(fpsFrames / Math.max(0.001, fpsAccumulator))),
        );
        fpsAccumulator = 0;
        fpsFrames = 0;
        lastHudUpdate = now;
        setHudTelemetry({
          fps: measuredFps,
          eyeY: Number(camera.position.y.toFixed(2)),
          groundY: Number(lastGroundY.toFixed(2)),
          colliderBound: colliderMeshes.length > 0,
        });
      }

      if (isSoftwareGl) {
        swPendingFrames = Math.max(0, swPendingFrames - 1);
        const anyWalkKey =
          cameraModeRef.current === 'walk' &&
          Boolean(
            keysPressed.KeyW ||
              keysPressed.KeyS ||
              keysPressed.KeyA ||
              keysPressed.KeyD ||
              keysPressed.ArrowUp ||
              keysPressed.ArrowDown ||
              keysPressed.ArrowLeft ||
              keysPressed.ArrowRight,
          );
        if (swPendingFrames > 0 || anyWalkKey) {
          afterDraw(tick);
        } else {
          swLoopActive = false;
        }
      } else {
        frameId = requestAnimationFrame(tick);
      }
    }

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
      tick();
    } else {
      scheduleSoftwareRender(2);
    }

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('dblclick', onDoubleClick);

      if (document.pointerLockElement === renderer.domElement) {
        document.exitPointerLock?.();
      }

      controls.dispose();
      splatMesh?.dispose();
      sparkRenderer?.dispose();
      chiselRig.dispose();
      skyGeo.dispose();
      skyMat.dispose();
      colliderWireMaterial.dispose();
      envTarget.dispose();
      renderer.dispose();
      sceneHandlesRef.current = null;
    };
  }, []);

  // Sync Relight Pass changes immediately into WebGL scene
  useEffect(() => {
    sceneHandlesRef.current?.applyRelight(relightPass);
  }, [relightPass]);

  // Sync Layer Visibility toggles immediately into WebGL scene
  useEffect(() => {
    sceneHandlesRef.current?.syncVisibility();
  }, [showSplat, showChiselWireframe, showColliderMesh, splatLoaded]);

  // Sync Camera Mode changes cleanly
  const handleSwitchCameraMode = (mode: CameraControlMode) => {
    setCameraMode(mode);
    cameraModeRef.current = mode;
    if (mode === 'walk') {
      sceneHandlesRef.current?.jumpToPreset('pedestrian');
    }
  };

  const record = apiStatus?.record;
  const activePass = RELIGHT_PASSES[relightPass];

  return (
    <section
      aria-label="Riyadh Day 1 Block 1 Ultra-Realistic 3D Viewport"
      data-testid="riyadh-block1-3d-viewport"
      data-relight={relightPass}
      data-camera-mode={cameraMode}
      data-splat-loaded={splatLoaded ? 'true' : 'false'}
      className="relative h-screen w-screen overflow-hidden bg-[#080a0f] text-[#f6efe2]"
    >
      {/* DEDICATED ISOLATED WEBGL CANVAS CONTAINER */}
      <div ref={canvasMountRef} className="absolute inset-0 z-0 h-full w-full" />

      {/* TOP BAR: RETURN TO 2D GIANT MAP (LEFT) + WORLD LABS OPERATION & CREDIT LOCK BADGE (RIGHT) */}
      <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex flex-wrap items-start justify-between gap-3 px-4 pt-3.5">
        {/* Left: Return Button + Block 1 Identity */}
        <div className="pointer-events-auto flex items-center gap-2.5">
          <button
            type="button"
            onClick={onReturnToMap}
            data-testid="return-to-2d-map-btn"
            className="flex items-center gap-2 rounded-md border border-[#d9a441]/55 bg-[#120f0b]/95 px-3.5 py-2 text-xs font-semibold tracking-wide text-[#fde6ac] shadow-[0_10px_28px_rgba(0,0,0,0.68)] transition-colors hover:border-[#f4ca70] hover:bg-[#1e1810]"
          >
            <ArrowLeft className="h-3.5 w-3.5 text-[#e6b95c]" />
            <span>Return to 2D Giant Map</span>
          </button>

          <div className="hidden rounded-md border border-[#d9a441]/30 bg-[#110e0a]/92 px-3.5 py-1.5 shadow-[0_10px_28px_rgba(0,0,0,0.6)] md:block">
            <div className="text-[9.5px] font-semibold tracking-[0.18em] text-[#e6b95c] uppercase">
              Day 1 — Block 1 · Riyadh Al-Olaya
            </div>
            <div className="font-display text-xs font-semibold tracking-wide text-[#fbf4e4]">
              King Fahd Road · Kingdom Centre · Al-Faisaliah Tower
            </div>
          </div>
        </div>

        {/* Right: World Labs API Status, Single-Generation Credit Lock & Operation ID Badge */}
        <div
          data-testid="worldlabs-status-badge"
          className="pointer-events-auto flex flex-col items-end gap-1.5"
        >
          <div className="flex items-center gap-3 rounded-md border border-[#d9a441]/40 bg-[#110e0a]/94 px-3.5 py-2 text-[11px] shadow-[0_10px_28px_rgba(0,0,0,0.68)]">
            <div className="flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-[#67c587]" />
              <span className="font-semibold text-[#e6f5ea]">
                {record?.status === 'completed'
                  ? `Atlas Full-Res .spz Cached${record.splat_count ? ` (${(record.splat_count / 1_000_000).toFixed(1)}M)` : ''}`
                  : record?.status === 'in_progress'
                    ? record.pipeline_stage_label || 'Atlas Pipeline Running...'
                    : apiStatus?.configured
                      ? 'Atlas Platform Ready (1-Run Lock)'
                      : 'Chisel 3D Active · Awaiting API Secret'}
              </span>
            </div>

            <div className="h-3.5 w-px bg-[#d9a441]/25" aria-hidden="true" />

            <div className="font-mono-tabular tabular-nums text-[10.5px] text-[#f3d48c]">
              {hudTelemetry.fps} FPS
            </div>

            <div className="h-3.5 w-px bg-[#d9a441]/25" aria-hidden="true" />

            <div className="font-mono-tabular tabular-nums text-[10.5px] text-[#c7bba6]">
              Y: {hudTelemetry.eyeY.toFixed(2)}m
            </div>
          </div>

          {/* Operation ID / Asset Metadata Strip (static, crisp, zero animation noise) */}
          {record && (record.operation_id || record.status === 'not_generated' || genError) && (
            <div className="flex flex-wrap items-center justify-end gap-2 rounded border border-[#d9a441]/25 bg-[#0f0c09]/92 px-3 py-1 text-[10px] text-[#cbbca1]">
              {record.operation_id && (
                <span className="font-mono-tabular">
                  OP: <strong className="text-[#f5dfa8]">{record.operation_id.slice(0, 22)}</strong>
                </span>
              )}
              {record.has_local_spz && (
                <span className="font-mono-tabular text-[#8fe2aa]">
                  .spz {formatBytes(record.spz_bytes)}
                </span>
              )}
              {record.has_local_collider && (
                <span className="font-mono-tabular text-[#7ce8e2]">
                  .glb {formatBytes(record.collider_bytes)}
                </span>
              )}
              {record.single_generation_locked && (
                <span className="rounded bg-[#1a2b1e] px-1.5 py-0.5 text-[9.5px] font-semibold tracking-wider text-[#8be0a7] uppercase">
                  Credit Lock On
                </span>
              )}

              {/* One-shot trigger ONLY if not yet generated (or retry after a failed attempt) */}
              {(record.status === 'not_generated' || record.status === 'failed') &&
                !record.single_generation_locked &&
                apiStatus?.configured && (
                  <button
                    type="button"
                    onClick={handleGenerateSingleBlock1}
                    disabled={isTriggeringGen}
                    data-testid="trigger-block1-generation-btn"
                    className="flex items-center gap-1.5 rounded border border-[#e6b95c]/70 bg-[#d9a441]/22 px-2.5 py-0.5 text-[10.5px] font-semibold text-[#fde6ac] transition-colors hover:bg-[#d9a441]/35 disabled:opacity-50"
                  >
                    {isTriggeringGen ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Sparkles className="h-3 w-3" />
                    )}
                    <span>
                      {record.status === 'failed'
                        ? 'Retry Atlas Block 1 (1 Run Max)'
                        : 'Generate Atlas Block 1 .spz (1 Run Max)'}
                    </span>
                  </button>
                )}

              {record.status === 'in_progress' && (
                <span className="flex items-center gap-1 text-[#f4ca70]">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span>{record.pipeline_stage_label}</span>
                </span>
              )}

              {genError && (
                <span className="max-w-[340px] truncate text-[#f29b9b]" title={genError}>
                  {genError}
                </span>
              )}
            </div>
          )}
        </div>
      </header>

      {/* UNIFIED COLLAPSIBLE BOTTOM CONTROL DOCK (ZERO VIEWPORT OCCLUSION, ZERO BACKDROP-BLUR) */}
      <div className="pointer-events-none absolute inset-x-0 bottom-3.5 z-20 flex flex-col items-center px-3">
        {/* Walk Mode Controls Hint cleanly anchored above dock — zero top-header overlap */}
        {cameraMode === 'walk' && (
          <div className="mb-1.5 rounded border border-[#4fd6d0]/45 bg-[#0a161c]/94 px-3 py-1 text-[10.5px] font-medium text-[#bdf8f5] shadow-[0_6px_18px_rgba(0,0,0,0.6)]">
            Walk Mode · <span className="font-mono-tabular font-bold">WASD</span> Move · Drag or Double-Click to Look · Ground Lock{' '}
            <span className="font-mono-tabular text-[#fde6ac]">
              Y ≥ {(hudTelemetry.groundY + 1.65).toFixed(2)}m
            </span>
          </div>
        )}

        <button
          type="button"
          onClick={() => setDockCollapsed((c) => !c)}
          aria-label={dockCollapsed ? 'Show 3D Controls' : 'Hide 3D Controls'}
          className="pointer-events-auto mb-1 flex items-center gap-1.5 rounded-t border border-b-0 border-[#d9a441]/35 bg-[#120f0b]/94 px-3 py-0.5 text-[10px] font-semibold tracking-[0.14em] text-[#dfc999] uppercase transition-colors hover:text-white"
        >
          {dockCollapsed ? (
            <>
              <ChevronUp className="h-3 w-3 text-[#e6b95c]" />
              <span>Show Controls (H)</span>
            </>
          ) : (
            <>
              <ChevronDown className="h-3 w-3 text-[#e6b95c]" />
              <span>Hide Controls (H)</span>
            </>
          )}
        </button>

        {!dockCollapsed && (
          <div
            role="toolbar"
            aria-label="Block 1 3D Relight, Camera & Pipeline Controls"
            data-testid="block1-control-dock"
            className="pointer-events-auto flex max-w-[min(1120px,97vw)] flex-wrap items-center justify-center gap-1.5 rounded-lg border border-[#d9a441]/40 bg-[#110e0b]/95 px-3 py-2 shadow-[0_18px_48px_rgba(0,0,0,0.78)]"
          >
            {/* PART 3: RELIGHT PASSES */}
            <div className="flex items-center gap-1" role="group" aria-label="Relight Presets">
              <span className="mr-1 hidden text-[9.5px] font-semibold tracking-[0.15em] text-[#a7987e] uppercase xl:inline">
                Relight
              </span>
              {(
                [
                  { id: 'golden_hour', label: 'Golden Hour', icon: Sunset },
                  { id: 'desert_noon', label: 'Desert Noon', icon: Sun },
                  { id: 'riyadh_night', label: 'Riyadh Night', icon: Moon },
                ] as const
              ).map(({ id, label, icon: Icon }) => {
                const active = relightPass === id;
                return (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setRelightPass(id)}
                    className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                      active
                        ? 'bg-[#d9a441]/25 text-[#fde6ac] shadow-[inset_0_0_0_1px_rgba(232,184,84,0.7)]'
                        : 'text-[#cabca4] hover:bg-[#1e1811] hover:text-white'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    <span>{label}</span>
                  </button>
                );
              })}
            </div>

            <div className="hidden h-4 w-px bg-[#d9a441]/25 lg:block" aria-hidden="true" />

            {/* PART 4: CAMERA MODES & CALIBRATION PRESETS */}
            <div className="flex items-center gap-1" role="group" aria-label="Camera Mode">
              <button
                type="button"
                aria-pressed={cameraMode === 'orbit'}
                onClick={() => handleSwitchCameraMode('orbit')}
                className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                  cameraMode === 'orbit'
                    ? 'bg-[#4fd6d0]/20 text-[#aefbf7] shadow-[inset_0_0_0_1px_rgba(79,214,208,0.6)]'
                    : 'text-[#cabca4] hover:bg-[#1e1811] hover:text-white'
                }`}
              >
                <Orbit className="h-3.5 w-3.5" />
                <span>Aerial Orbit</span>
              </button>
              <button
                type="button"
                aria-pressed={cameraMode === 'walk'}
                onClick={() => handleSwitchCameraMode('walk')}
                className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                  cameraMode === 'walk'
                    ? 'bg-[#4fd6d0]/20 text-[#aefbf7] shadow-[inset_0_0_0_1px_rgba(79,214,208,0.6)]'
                    : 'text-[#cabca4] hover:bg-[#1e1811] hover:text-white'
                }`}
              >
                <Footprints className="h-3.5 w-3.5" />
                <span>Walk (1.65m)</span>
              </button>

              <button
                type="button"
                onClick={() =>
                  sceneHandlesRef.current?.jumpToPreset(splatLoaded ? 'splat_vista' : 'hero')
                }
                title="Reset to Establishing Camera"
                className="flex items-center gap-1 rounded border border-[#d9a441]/25 bg-[#19150f] px-2 py-1 text-[10.5px] font-medium text-[#e5d6ba] transition-colors hover:border-[#e6b95c]/60 hover:text-white"
              >
                <Compass className="h-3 w-3 text-[#e6b95c]" />
                <span>Reset Cam</span>
              </button>
            </div>

            <div className="hidden h-4 w-px bg-[#d9a441]/25 lg:block" aria-hidden="true" />

            {/* 4-STAGE PIPELINE LAYER TOGGLES */}
            <div className="flex items-center gap-1" role="group" aria-label="Pipeline Layers">
              <button
                type="button"
                aria-pressed={showSplat && splatLoaded}
                disabled={!splatLoaded}
                onClick={() => setShowSplat((v) => !v)}
                className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-[11px] font-semibold transition-colors disabled:opacity-45 ${
                  showSplat && splatLoaded
                    ? 'bg-[#67c587]/20 text-[#b8f0ca] shadow-[inset_0_0_0_1px_rgba(103,197,135,0.6)]'
                    : 'text-[#cabca4] hover:bg-[#1e1811] hover:text-white'
                }`}
              >
                <Layers className="h-3.5 w-3.5" />
                <span>Splat (.spz)</span>
              </button>

              <button
                type="button"
                aria-pressed={showChiselWireframe}
                onClick={() => setShowChiselWireframe((v) => !v)}
                className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                  showChiselWireframe
                    ? 'bg-[#d9a441]/22 text-[#fde6ac] shadow-[inset_0_0_0_1px_rgba(232,184,84,0.6)]'
                    : 'text-[#cabca4] hover:bg-[#1e1811] hover:text-white'
                }`}
              >
                <Grid3x3 className="h-3.5 w-3.5" />
                <span>Chisel</span>
              </button>

              <button
                type="button"
                aria-pressed={showColliderMesh}
                disabled={!colliderLoaded}
                onClick={() => setShowColliderMesh((v) => !v)}
                className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-[11px] font-semibold transition-colors disabled:opacity-45 ${
                  showColliderMesh && colliderLoaded
                    ? 'bg-[#4fd6d0]/20 text-[#aefbf7] shadow-[inset_0_0_0_1px_rgba(79,214,208,0.6)]'
                    : 'text-[#cabca4] hover:bg-[#1e1811] hover:text-white'
                }`}
              >
                <Box className="h-3.5 w-3.5" />
                <span>Collider (.glb)</span>
              </button>
            </div>
          </div>
        )}

        {/* Active Relight Atmosphere Micro-Caption */}
        {!dockCollapsed && (
          <div className="mt-1 text-[10px] tracking-[0.12em] text-[#cbbca1]/85 uppercase">
            {activePass.label} · {activePass.subtitle} ·{' '}
            {splatLoaded
              ? 'World Labs Gaussian Splat Active'
              : 'Chisel 1:1 Metric Architectural Massing'}
          </div>
        )}
      </div>
    </section>
  );
};
