import * as THREE from 'three';
import { CHISEL_BLOCK1_SPEC } from './block1Config';

export interface ChiselRigHandles {
  rootGroup: THREE.Group;
  solidGroup: THREE.Group;
  wireframeGroup: THREE.Group;
  nightGlowMaterials: {
    kingdomArchGlow: THREE.MeshStandardMaterial;
    faisaliahGlobeGlow: THREE.MeshStandardMaterial;
    faisaliahRibsGlow: THREE.MeshStandardMaterial;
    highwayLightsGlow: THREE.MeshStandardMaterial;
    streetLampsGlow: THREE.MeshStandardMaterial;
  };
  dispose: () => void;
}

/**
 * PART 1 — CHISEL: Exact 1:1 metric spatial architecture for Riyadh Day 1 — Block 1
 * (Al-Olaya · King Fahd Road · Kingdom Centre · Al-Faisaliah Tower).
 *
 * Non-negotiable architectural accuracy:
 * - Kingdom Centre (X=+20, Z=-172, H=302 m) has its own self-contained Sky Bridge at 297 m.
 * - Al-Faisaliah Tower (X=+20, Z=-108, H=267 m) stands completely independently with NO
 *   horizontal bridge connecting it to Kingdom Centre.
 */
function createProceduralTexture(
  kind: 'travertine' | 'asphalt' | 'facade' | 'curtain_glass',
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    if (kind === 'travertine') {
      ctx.fillStyle = '#c5b093';
      ctx.fillRect(0, 0, 256, 256);
      ctx.strokeStyle = 'rgba(92, 74, 52, 0.24)';
      ctx.lineWidth = 1.5;
      for (let y = 0; y < 256; y += 32) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(256, y);
        ctx.stroke();
      }
      for (let x = 0; x < 256; x += 64) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, 256);
        ctx.stroke();
      }
    } else if (kind === 'asphalt') {
      ctx.fillStyle = '#25282e';
      ctx.fillRect(0, 0, 256, 256);
      // Subtle lane dashes & shoulder lines
      ctx.fillStyle = 'rgba(240, 200, 108, 0.72)';
      ctx.fillRect(10, 0, 4, 256);
      ctx.fillRect(242, 0, 4, 256);
      ctx.fillStyle = 'rgba(235, 238, 242, 0.55)';
      for (let y = 12; y < 256; y += 48) {
        ctx.fillRect(84, y, 4, 24);
        ctx.fillRect(168, y, 4, 24);
      }
    } else if (kind === 'curtain_glass') {
      const grad = ctx.createLinearGradient(0, 0, 256, 0);
      grad.addColorStop(0, '#3a6289');
      grad.addColorStop(0.5, '#5889b4');
      grad.addColorStop(1, '#365c82');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 256, 256);
      ctx.strokeStyle = 'rgba(215, 232, 248, 0.34)';
      ctx.lineWidth = 1;
      for (let y = 0; y < 256; y += 16) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(256, y);
        ctx.stroke();
      }
      for (let x = 0; x < 256; x += 16) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, 256);
        ctx.stroke();
      }
    } else {
      ctx.fillStyle = '#b9a384';
      ctx.fillRect(0, 0, 256, 256);
      for (let y = 14; y < 256; y += 32) {
        for (let x = 14; x < 256; x += 32) {
          ctx.fillStyle = '#3c4e60';
          ctx.fillRect(x, y, 20, 18);
          ctx.strokeStyle = '#8b775d';
          ctx.strokeRect(x, y, 20, 18);
        }
      }
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  if (kind === 'travertine') tex.repeat.set(14, 24);
  if (kind === 'asphalt') tex.repeat.set(1, 14);
  if (kind === 'curtain_glass') tex.repeat.set(6, 14);
  if (kind === 'facade') tex.repeat.set(2, 3);
  return tex;
}

export function buildRiyadhBlock1ChiselScene(isSoftwareGl: boolean): ChiselRigHandles {
  const disposables: Array<{ dispose: () => void }> = [];
  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    disposables.push(g);
    return g;
  };
  const trackMat = <T extends THREE.Material>(m: T): T => {
    disposables.push(m);
    return m;
  };
  const trackTex = (t: THREE.Texture): THREE.Texture => {
    disposables.push(t);
    return t;
  };

  const rootGroup = new THREE.Group();
  rootGroup.name = 'Day1_Block1_Chisel_Root';

  const solidGroup = new THREE.Group();
  solidGroup.name = 'Day1_Block1_SolidReference';

  const wireframeGroup = new THREE.Group();
  wireframeGroup.name = 'Day1_Block1_WireframeOverlay';

  const travertineTex = trackTex(createProceduralTexture('travertine'));
  const asphaltTex = trackTex(createProceduralTexture('asphalt'));
  const curtainTex = trackTex(createProceduralTexture('curtain_glass'));
  const facadeTex = trackTex(createProceduralTexture('facade'));

  // --- Shared PBR Riyadh Materials ---
  const travertineMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: travertineTex,
      roughness: 0.84,
      metalness: 0.04,
    }),
  );
  const precastWallMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xb9a68a,
      roughness: 0.88,
      metalness: 0.04,
    }),
  );
  const asphaltMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: asphaltTex,
      roughness: 0.9,
      metalness: 0.06,
    }),
  );
  const laneStripeMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xe6be63,
      roughness: 0.55,
      metalness: 0.05,
    }),
  );
  const sapphireGlassMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      map: curtainTex,
      roughness: 0.16,
      metalness: 0.65,
      clearcoat: 0.85,
      clearcoatRoughness: 0.14,
    }),
  );
  const brushedAluminumMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xbec9d4,
      roughness: 0.3,
      metalness: 0.82,
    }),
  );
  const champagneGoldMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xcfa96c,
      roughness: 0.28,
      metalness: 0.82,
      emissive: new THREE.Color(0xd69f40),
      emissiveIntensity: 0.05,
    }),
  );
  const faisaliahGlassMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: 0x7b8ea1,
      roughness: 0.24,
      metalness: 0.58,
      clearcoat: 0.6,
    }),
  );
  const commercialGlassMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: facadeTex,
      roughness: 0.55,
      metalness: 0.25,
    }),
  );

  // Night architectural illumination materials (driven dynamically by Relight Pass)
  const kingdomArchGlow = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x8eb8ff,
      emissive: new THREE.Color(0x4c7eff),
      emissiveIntensity: 0.18,
      roughness: 0.25,
      metalness: 0.4,
    }),
  );
  const faisaliahGlobeGlow = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: 0xdfb154,
      emissive: new THREE.Color(0xffb538),
      emissiveIntensity: 0.15,
      roughness: 0.18,
      metalness: 0.88,
      clearcoat: 1.0,
    }),
  );
  const highwayLightsGlow = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xffd088,
      emissive: new THREE.Color(0xffa63d),
      emissiveIntensity: 0.35,
      roughness: 0.3,
    }),
  );
  const streetLampsGlow = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xffe4b3,
      emissive: new THREE.Color(0xffb84d),
      emissiveIntensity: 0.25,
      roughness: 0.2,
    }),
  );

  const wireGoldMat = trackMat(
    new THREE.LineBasicMaterial({
      color: 0xf4c45c,
      transparent: true,
      opacity: 0.55,
    }),
  );
  const wireCyanMat = trackMat(
    new THREE.LineBasicMaterial({
      color: 0x4fd6d0,
      transparent: true,
      opacity: 0.52,
    }),
  );

  const addWireEdges = (
    geo: THREE.BufferGeometry,
    pos: [number, number, number],
    mat: THREE.LineBasicMaterial,
    rot?: [number, number, number],
  ) => {
    const edges = trackGeo(new THREE.EdgesGeometry(geo, 18));
    const line = new THREE.LineSegments(edges, mat);
    line.position.set(pos[0], pos[1], pos[2]);
    if (rot) line.rotation.set(rot[0], rot[1], rot[2]);
    wireframeGroup.add(line);
  };

  // --- 1. SUNKEN KING FAHD ROAD & TRAVERTINE SURFACE DECKS ---
  const KFR = CHISEL_BLOCK1_SPEC.kingFahdRoad;
  const trenchLen = KFR.zMax - KFR.zMin; // 247 m
  const trenchCenterZ = (KFR.zMin + KFR.zMax) / 2;
  const trenchWidth = KFR.trenchHalfWidth * 2; // 30 m

  // Sunken 6-lane asphalt roadbed at Y = -6.5 m
  const roadGeo = trackGeo(new THREE.BoxGeometry(trenchWidth, 0.4, trenchLen + 90));
  const roadMesh = new THREE.Mesh(roadGeo, asphaltMat);
  roadMesh.position.set(KFR.centerX, KFR.depthY - 0.2, trenchCenterZ);
  roadMesh.receiveShadow = !isSoftwareGl;
  solidGroup.add(roadMesh);
  addWireEdges(roadGeo, [KFR.centerX, KFR.depthY - 0.2, trenchCenterZ], wireCyanMat);

  // Median barrier + lane markings inside sunken highway
  const medianGeo = trackGeo(new THREE.BoxGeometry(1.4, 0.9, trenchLen + 80));
  const medianMesh = new THREE.Mesh(medianGeo, precastWallMat);
  medianMesh.position.set(KFR.centerX, KFR.depthY + 0.45, trenchCenterZ);
  solidGroup.add(medianMesh);

  for (const offset of [-1.2, 1.2]) {
    const stripeGeo = trackGeo(new THREE.PlaneGeometry(0.24, trenchLen + 70));
    const stripe = new THREE.Mesh(stripeGeo, laneStripeMat);
    stripe.rotation.x = -Math.PI / 2;
    stripe.position.set(KFR.centerX + offset, KFR.depthY + 0.03, trenchCenterZ);
    solidGroup.add(stripe);
  }

  // Warm illuminated traffic light ribbons inside sunken highway (bright in Night Relight)
  for (const laneX of [-9.5, -5.5, 5.5, 9.5]) {
    const ribbonGeo = trackGeo(new THREE.BoxGeometry(0.32, 0.14, trenchLen + 40));
    const ribbon = new THREE.Mesh(ribbonGeo, highwayLightsGlow);
    ribbon.position.set(KFR.centerX + laneX, KFR.depthY + 0.12, trenchCenterZ);
    solidGroup.add(ribbon);
  }

  // Vertical precast limestone retaining walls flanking the sunken expressway (-6.5 m to 0 m)
  const wallGeo = trackGeo(new THREE.BoxGeometry(1.4, Math.abs(KFR.depthY) + 0.8, trenchLen + 80));
  for (const side of [-1, 1]) {
    const wallX = KFR.centerX + side * (KFR.trenchHalfWidth + 0.7);
    const wall = new THREE.Mesh(wallGeo, precastWallMat);
    wall.position.set(wallX, KFR.depthY / 2 + 0.2, trenchCenterZ);
    wall.receiveShadow = !isSoftwareGl;
    solidGroup.add(wall);
    addWireEdges(wallGeo, [wallX, KFR.depthY / 2 + 0.2, trenchCenterZ], wireCyanMat);
  }

  // Seamless Riyadh / Najd plateau horizon skirt (eliminates floating ground slab edges)
  const horizonGeo = trackGeo(new THREE.PlaneGeometry(2800, 2800));
  const horizonMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xb7a081,
      roughness: 0.95,
      metalness: 0.02,
    }),
  );
  const horizonMesh = new THREE.Mesh(horizonGeo, horizonMat);
  horizonMesh.rotation.x = -Math.PI / 2;
  horizonMesh.position.set(0, -7.2, -100);
  solidGroup.add(horizonMesh);

  // East & West travertine urban ground planes (Y = 0) + 8.5 m service boulevards
  const westPlazaGeo = trackGeo(new THREE.BoxGeometry(520, 1.0, 760));
  const westPlaza = new THREE.Mesh(westPlazaGeo, travertineMat);
  westPlaza.position.set(KFR.centerX - KFR.trenchHalfWidth - 260, -0.5, -100);
  westPlaza.receiveShadow = !isSoftwareGl;
  solidGroup.add(westPlaza);

  const eastPlazaGeo = trackGeo(new THREE.BoxGeometry(520, 1.0, 760));
  const eastPlaza = new THREE.Mesh(eastPlazaGeo, travertineMat);
  eastPlaza.position.set(KFR.centerX + KFR.trenchHalfWidth + 260, -0.5, -100);
  eastPlaza.receiveShadow = !isSoftwareGl;
  solidGroup.add(eastPlaza);

  const serviceRoadGeo = trackGeo(new THREE.BoxGeometry(KFR.serviceRoadWidth, 0.08, 420));
  for (const side of [-1, 1]) {
    const srX = KFR.centerX + side * (KFR.trenchHalfWidth + 2.2 + KFR.serviceRoadWidth / 2);
    const sr = new THREE.Mesh(serviceRoadGeo, asphaltMat);
    sr.position.set(srX, 0.02, -95);
    solidGroup.add(sr);
  }

  // Grade-separated overpasses at Z = -140 m (Tahlia Street axis) and Z = -72 m
  const overpassGeo = trackGeo(new THREE.BoxGeometry(trenchWidth + 24, 1.4, KFR.overpassDeckHalfLenZ * 2));
  for (const ovZ of KFR.overpassesZ) {
    const deck = new THREE.Mesh(overpassGeo, precastWallMat);
    deck.position.set(KFR.centerX, -0.7, ovZ);
    deck.receiveShadow = !isSoftwareGl;
    deck.castShadow = !isSoftwareGl;
    solidGroup.add(deck);
    addWireEdges(overpassGeo, [KFR.centerX, -0.7, ovZ], wireCyanMat);

    // Asphalt top on overpass
    const topGeo = trackGeo(new THREE.BoxGeometry(trenchWidth + 24, 0.08, KFR.overpassDeckHalfLenZ * 1.65));
    const top = new THREE.Mesh(topGeo, asphaltMat);
    top.position.set(KFR.centerX, 0.04, ovZ);
    solidGroup.add(top);

    // Warm underpass soffit illumination strips
    const soffitGeo = trackGeo(new THREE.BoxGeometry(trenchWidth - 2, 0.16, 1.2));
    const soffit = new THREE.Mesh(soffitGeo, highwayLightsGlow);
    soffit.position.set(KFR.centerX, -1.48, ovZ);
    solidGroup.add(soffit);
  }

  // --- 2. HERO STRUCTURE 1: KINGDOM CENTRE (X = +20 m, Z = -172 m, H = 302 m) ---
  const KC = CHISEL_BLOCK1_SPEC.kingdomCentre;
  const kcGroup = new THREE.Group();
  kcGroup.position.set(KC.x, 0, KC.z);

  // Curved 2-wing luxury podium (Y = 0 to 6.5 m)
  const podiumWingGeo = trackGeo(new THREE.BoxGeometry(36, KC.podiumHeightM, 24));
  const kcPodium = new THREE.Mesh(podiumWingGeo, travertineMat);
  kcPodium.position.set(0, KC.podiumHeightM / 2, 0);
  kcPodium.castShadow = !isSoftwareGl;
  kcPodium.receiveShadow = !isSoftwareGl;
  kcGroup.add(kcPodium);
  addWireEdges(podiumWingGeo, [KC.x, KC.podiumHeightM / 2, KC.z], wireGoldMat);

  // Lower elliptical sapphire-glass shaft (Y = 6.5 m to 206 m)
  const shaftGeo = trackGeo(new THREE.CylinderGeometry(13.5, 16.5, 200, 28));
  shaftGeo.scale(1.22, 1, 0.72);
  const kcShaft = new THREE.Mesh(shaftGeo, sapphireGlassMat);
  kcShaft.position.set(0, 106.5, 0);
  kcShaft.castShadow = !isSoftwareGl;
  kcGroup.add(kcShaft);
  addWireEdges(shaftGeo, [KC.x, 106.5, KC.z], wireGoldMat);

  // Twin sweeping parabolic crown arms (Y = 206 m to 302 m) forming the iconic inverted arch
  const armGeo = trackGeo(new THREE.BoxGeometry(7.2, 96, 15.5));
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(armGeo, brushedAluminumMat);
    arm.position.set(side * 12.2, 254, 0);
    arm.rotation.z = side * -0.065;
    arm.castShadow = !isSoftwareGl;
    kcGroup.add(arm);
    addWireEdges(armGeo, [KC.x + side * 12.2, 254, KC.z], wireGoldMat, [0, 0, side * -0.065]);
  }

  // Self-contained Sky Bridge spanning strictly inside Kingdom Centre's own apex at 297 m
  const skyBridgeGeo = trackGeo(new THREE.BoxGeometry(27, 6.2, 11.5));
  const skyBridge = new THREE.Mesh(skyBridgeGeo, brushedAluminumMat);
  skyBridge.position.set(0, KC.skyBridgeElevationM, 0);
  kcGroup.add(skyBridge);
  addWireEdges(skyBridgeGeo, [KC.x, KC.skyBridgeElevationM, KC.z], wireGoldMat);

  // Sapphire architectural uplight lining the inner parabolic arch (glows vividly in Night Relight)
  const archGlowGeo = trackGeo(new THREE.TorusGeometry(10.5, 0.75, 10, 32, Math.PI));
  const archGlow = new THREE.Mesh(archGlowGeo, kingdomArchGlow);
  archGlow.position.set(0, 224, 0);
  archGlow.rotation.z = Math.PI;
  kcGroup.add(archGlow);

  solidGroup.add(kcGroup);

  // --- 3. HERO STRUCTURE 2: AL-FAISALIAH TOWER (X = +20 m, Z = -108 m, H = 267 m) ---
  // Strictly independent from Kingdom Centre — ZERO connecting bridge!
  const AF = CHISEL_BLOCK1_SPEC.alFaisaliahTower;
  const afGroup = new THREE.Group();
  afGroup.position.set(AF.x, 0, AF.z);

  // Travertine plinth podium
  const afPodiumGeo = trackGeo(new THREE.BoxGeometry(30, AF.podiumHeightM, 30));
  const afPodium = new THREE.Mesh(afPodiumGeo, travertineMat);
  afPodium.position.set(0, AF.podiumHeightM / 2, 0);
  afPodium.castShadow = !isSoftwareGl;
  afPodium.receiveShadow = !isSoftwareGl;
  afGroup.add(afPodium);
  addWireEdges(afPodiumGeo, [AF.x, AF.podiumHeightM / 2, AF.z], wireGoldMat);

  // Tapering 4-sided pyramidal tower shaft
  const afCoreGeo = trackGeo(new THREE.CylinderGeometry(3.2, 14.5, 226, 4));
  afCoreGeo.rotateY(Math.PI / 4);
  const afCore = new THREE.Mesh(afCoreGeo, faisaliahGlassMat);
  afCore.position.set(0, 119.5, 0);
  afCore.castShadow = !isSoftwareGl;
  afGroup.add(afCore);
  addWireEdges(afCoreGeo, [AF.x, 119.5, AF.z], wireGoldMat);

  // 4 external curved champagne-gold corner exoskeleton ribs converging toward the 267 m apex
  const ribCorners: [number, number][] = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  for (const [cx, cz] of ribCorners) {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(cx * 14.8, 6.5, cz * 14.8),
      new THREE.Vector3(cx * 11.4, 110, cz * 11.4),
      new THREE.Vector3(cx * 5.6, 200, cz * 5.6),
      new THREE.Vector3(0, AF.heightM - 16, 0),
    ]);
    const ribGeo = trackGeo(new THREE.TubeGeometry(curve, 18, 0.95, 6, false));
    const ribMesh = new THREE.Mesh(ribGeo, champagneGoldMat);
    afGroup.add(ribMesh);
  }

  // Suspended golden geodesic glass sphere ("The Globe") at Y = 200 m
  const globeGeo = trackGeo(new THREE.IcosahedronGeometry(AF.globeRadiusM, 2));
  const globeMesh = new THREE.Mesh(globeGeo, faisaliahGlobeGlow);
  globeMesh.position.set(0, AF.globeElevationM, 0);
  afGroup.add(globeMesh);
  addWireEdges(globeGeo, [AF.x, AF.globeElevationM, AF.z], wireGoldMat);

  // Pointed pinnacle spire reaching 267 m
  const spireGeo = trackGeo(new THREE.ConeGeometry(1.4, 24, 8));
  const spire = new THREE.Mesh(spireGeo, champagneGoldMat);
  spire.position.set(0, AF.heightM - 12, 0);
  afGroup.add(spire);

  solidGroup.add(afGroup);

  // --- 4. SURROUNDING RIYADH COMMERCIAL FABRIC (OLAYA & TAHLIA CORRIDORS) ---
  const blockDefs: Array<[number, number, number, number, number]> = [
    [-46, -185, 22, 34, 24],
    [-48, -145, 24, 42, 22],
    [-46, -105, 22, 28, 26],
    [-46, -65, 24, 36, 24],
    [-48, -24, 26, 26, 28],
    [52, -196, 24, 40, 26],
    [56, -140, 26, 32, 24],
    [52, -74, 22, 38, 22],
    [48, -32, 26, 28, 26],
    [16, -42, 22, 24, 22],
  ];
  for (const [bx, bz, bw, bh, bd] of blockDefs) {
    const bGeo = trackGeo(new THREE.BoxGeometry(bw, bh, bd));
    const bMesh = new THREE.Mesh(bGeo, travertineMat);
    bMesh.position.set(bx, bh / 2, bz);
    bMesh.receiveShadow = !isSoftwareGl;
    solidGroup.add(bMesh);
    addWireEdges(bGeo, [bx, bh / 2, bz], wireCyanMat);

    // Recessed tinted glass window band
    const winGeo = trackGeo(new THREE.BoxGeometry(bw + 0.18, bh * 0.62, bd * 0.86));
    const winMesh = new THREE.Mesh(winGeo, commercialGlassMat);
    winMesh.position.set(bx, bh * 0.56, bz);
    solidGroup.add(winMesh);
  }

  // --- 5. INSTANCED PHOENIX DACTYLIFERA DATE PALMS & BRONZE STREETLAMPS ---
  const palmPositions: Array<[number, number]> = [];
  for (let z = -200; z <= 22; z += 14) {
    // Skip right on top of overpasses
    if (Math.abs(z - -140) < 11 || Math.abs(z - -72) < 11) continue;
    palmPositions.push([KFR.centerX - KFR.trenchHalfWidth - 1.5, z]);
    palmPositions.push([KFR.centerX + KFR.trenchHalfWidth + 1.5, z]);
  }

  const trunkGeo = trackGeo(new THREE.CylinderGeometry(0.22, 0.36, 6.2, 7));
  const trunkMat = trackMat(
    new THREE.MeshStandardMaterial({ color: 0x6c543c, roughness: 0.92 }),
  );
  const crownGeo = trackGeo(new THREE.ConeGeometry(2.4, 2.2, 8));
  const crownMat = trackMat(
    new THREE.MeshStandardMaterial({ color: 0x3b6334, roughness: 0.82 }),
  );

  const trunkInst = new THREE.InstancedMesh(trunkGeo, trunkMat, palmPositions.length);
  const crownInst = new THREE.InstancedMesh(crownGeo, crownMat, palmPositions.length);
  const dummy = new THREE.Object3D();

  palmPositions.forEach(([px, pz], idx) => {
    const scaleY = 0.9 + ((idx * 17) % 10) * 0.025;
    dummy.position.set(px, 3.1 * scaleY, pz);
    dummy.scale.set(1, scaleY, 1);
    dummy.rotation.set(0, (idx * 0.7) % Math.PI, 0);
    dummy.updateMatrix();
    trunkInst.setMatrixAt(idx, dummy.matrix);

    dummy.position.set(px, 6.2 * scaleY + 0.6, pz);
    dummy.scale.set(1.05, 0.95, 1.05);
    dummy.updateMatrix();
    crownInst.setMatrixAt(idx, dummy.matrix);
  });
  trunkInst.computeBoundingSphere();
  crownInst.computeBoundingSphere();
  solidGroup.add(trunkInst, crownInst);

  // Bronze streetlamps with warm 3000K luminaires
  const lampOrbGeo = trackGeo(new THREE.SphereGeometry(0.32, 8, 8));
  const lampInst = new THREE.InstancedMesh(lampOrbGeo, streetLampsGlow, palmPositions.length);
  palmPositions.forEach(([px, pz], idx) => {
    const offset = px < KFR.centerX ? -10.2 : 10.2;
    dummy.position.set(px + offset, 6.8, pz);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    lampInst.setMatrixAt(idx, dummy.matrix);
  });
  lampInst.computeBoundingSphere();
  solidGroup.add(lampInst);

  wireframeGroup.visible = false;
  rootGroup.add(solidGroup, wireframeGroup);

  return {
    rootGroup,
    solidGroup,
    wireframeGroup,
    nightGlowMaterials: {
      kingdomArchGlow,
      faisaliahGlobeGlow,
      faisaliahRibsGlow: champagneGoldMat,
      highwayLightsGlow,
      streetLampsGlow,
    },
    dispose: () => {
      for (const item of disposables) {
        item.dispose();
      }
    },
  };
}
