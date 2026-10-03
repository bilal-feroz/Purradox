import * as THREE from "three";
import type { CatDef } from "../data/cats";
import { cyl, ico, loft, lowPoly, merge, mix, place, shade, sphere } from "../rendering/LowPoly";

/**
 * Procedural low-poly cats built from the approved turnaround sheets.
 * One shared construction language (loft torso, big-cheeked head, two-part
 * legs, segmented tail) with per-cat proportions and painted markings so
 * Fish Cat, Mochi, Soot and Beans keep distinct silhouettes.
 *
 * Local frame: +Z forward (nose), +Y up, +X = cat's left. Feet at y = 0.
 */

export interface LegRig {
  hip: THREE.Group;
  knee: THREE.Group;
  upperLen: number;
  lowerLen: number;
  front: boolean;
  side: 1 | -1;
  restHip: number;
  restKnee: number;
  /** Paw sole offset below the end of the lower segment. */
  pawDrop: number;
}

export interface CatRig {
  root: THREE.Group;
  visual: THREE.Group;
  body: THREE.Group;
  neck: THREE.Group;
  head: THREE.Group;
  jaw: THREE.Group;
  earL: THREE.Group;
  earR: THREE.Group;
  eyeL: THREE.Group;
  eyeR: THREE.Group;
  mouthSocket: THREE.Object3D;
  legs: { FL: LegRig; FR: LegRig; BL: LegRig; BR: LegRig };
  tail: THREE.Group[];
  tailMeshes: THREE.Mesh[];
  bodyY: number;
  headBase: THREE.Vector3;
  /** All nodes whose local transform the animator writes (for pose capture). */
  animated: THREE.Object3D[];
  meshes: THREE.Mesh[];
  def: CatDef;
}

export interface CatMaterials {
  fur: THREE.Material;
  eye: THREE.Material;
}

type Paint = (c: THREE.Vector3, n: THREE.Vector3) => number;

function inSphere(c: THREE.Vector3, x: number, y: number, z: number, r: number): boolean {
  const dx = c.x - x;
  const dy = c.y - y;
  const dz = c.z - z;
  return dx * dx + dy * dy + dz * dz < r * r;
}

interface Painters {
  torso: Paint;
  head: Paint;
  cheek: Paint;
  muzzle: number;
  neck: number;
  upperLeg: Paint;
  lowerLeg: Paint;
  paw: number;
  tail: (i: number, n: number) => number;
  ear: number;
}

/** Per-cat painting functions for each body region (local part coordinates). */
function painters(def: CatDef): Painters {
  const C = def.colors;
  const P = def.proportions;
  const L = P.bodyLength;
  const H = P.headSize;
  switch (def.pattern) {
    case "fishcat":
      return {
        torso: (c, n) => {
          if (n.y < -0.35) return C.light;
          if (c.z > L * 0.26 && n.z > 0.2 && c.y < P.bodyRadius * 0.4) return C.light;
          if (n.y > 0.25 && Math.sin(c.z * 34 + 0.6) > 0.7) return shade(C.main, 0.86);
          return C.main;
        },
        head: (c, n) => {
          if (c.y < -H * 0.25 && c.z > H * 0.1) return C.light;
          if (c.y > H * 0.45 && c.z > 0 && Math.abs(c.x) < H * 0.35 && Math.sin(c.x * 85) > 0.25) return shade(C.main, 0.82);
          if (n.y < -0.5) return C.light;
          return C.main;
        },
        cheek: (c) => (c.y < -H * 0.36 || c.z > H * 0.3 ? C.light : C.main),
        muzzle: C.light,
        neck: C.main,
        upperLeg: () => C.main,
        lowerLeg: (c) => (c.y > -0.07 ? C.main : C.light),
        paw: C.paw,
        tail: (i, n) => (i >= n - 2 ? C.dark : i === n - 3 ? mix(C.main, C.dark, 0.45) : C.main),
        ear: C.main,
      };
    case "calico":
      return {
        torso: (c, n) => {
          if (n.y < -0.3) return C.light;
          if (inSphere(c, 0.07, 0.12, -L * 0.24, 0.16)) return C.main;
          if (inSphere(c, -0.15, 0.03, L * 0.02, 0.1)) return C.main;
          if (inSphere(c, 0.14, 0.06, L * 0.22, 0.075)) return C.main;
          return C.light;
        },
        head: (c) => {
          if (c.y > H * 0.15 && Math.abs(c.x) > H * 0.12) return C.main;
          if (c.y > H * 0.55) return C.main;
          if (c.z < -H * 0.2 && c.y > -H * 0.1) return C.main;
          return C.light;
        },
        cheek: () => C.light,
        muzzle: C.light,
        neck: C.light,
        upperLeg: (c) => (c.y > -0.06 && c.x > -0.01 ? C.main : C.light),
        lowerLeg: () => C.light,
        paw: C.paw,
        tail: (i, n) => (i >= n - 2 ? C.dark : i === 0 ? mix(C.light, C.main, 0.5) : C.main),
        ear: C.main,
      };
    case "smoky":
      return {
        torso: (c, n) => {
          if (n.y < -0.45) return mix(C.main, C.light, 0.5);
          if (c.z > L * 0.26 && n.z > 0.2 && c.y < P.bodyRadius * 0.35) return C.light;
          return n.y > 0.5 ? shade(C.main, 0.9) : C.main;
        },
        head: (c) => (c.y < -H * 0.4 && c.z > H * 0.2 ? mix(C.main, C.light, 0.6) : C.main),
        cheek: (c) => (c.y < -H * 0.4 ? mix(C.main, C.light, 0.5) : C.main),
        muzzle: mix(C.main, C.light, 0.55),
        neck: C.main,
        upperLeg: () => C.main,
        lowerLeg: (c) => (c.y > -0.05 ? C.main : C.light),
        paw: C.paw,
        tail: (i, n) => (i >= n - 2 ? (i % 2 === 0 ? mix(C.main, C.light, 0.55) : C.main) : C.main),
        ear: C.main,
      };
    case "tabby":
    default:
      return {
        torso: (c, n) => {
          if (n.y < -0.35) return C.light;
          if (c.z > L * 0.26 && n.z > 0.2 && c.y < P.bodyRadius * 0.35) return C.light;
          if (Math.sin(c.z * 32 + Math.abs(c.x) * 7) > 0.3) return C.dark;
          return C.main;
        },
        head: (c, n) => {
          if (c.y < -H * 0.3 && c.z > H * 0.15) return C.light;
          if (n.y < -0.5) return C.light;
          if (c.y > H * 0.35 && Math.sin(c.x * 75) > 0.35) return C.dark;
          if (Math.abs(c.x) > H * 0.7 && Math.sin(c.y * 70) > 0.45) return C.dark;
          return C.main;
        },
        cheek: (c) => (c.y < -H * 0.38 || c.z > H * 0.32 ? C.light : Math.sin(c.y * 80) > 0.3 ? C.dark : C.main),
        muzzle: C.light,
        neck: C.main,
        upperLeg: (c) => (Math.sin(c.y * 48) > 0.25 ? C.dark : C.main),
        lowerLeg: (c) => (c.y < -0.08 ? C.light : Math.sin(c.y * 55) > 0.4 ? C.dark : C.main),
        paw: C.paw,
        tail: (i) => (i % 2 === 0 ? C.main : C.dark),
        ear: C.main,
      };
  }
}

function meshOf(geo: THREE.BufferGeometry, mat: THREE.Material, list: THREE.Mesh[]): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  list.push(m);
  return m;
}

/** Surface z of the head ellipsoid at (x, y). */
function headSurfaceZ(H: number, x: number, y: number): number {
  const a = x / (1.08 * H);
  const b = y / (0.9 * H);
  return 0.94 * H * Math.sqrt(Math.max(0.02, 1 - a * a - b * b));
}

/** Triangular cat ear: outer shell + inner pink face. Base on y=0, front = +Z. */
function earGeometry(EW: number, EH: number, outer: number, inner: number): THREE.BufferGeometry {
  const BL = new THREE.Vector3(-EW, 0, 0);
  const BR = new THREE.Vector3(EW, 0, 0);
  const BK = new THREE.Vector3(0, 0, -EW * 0.75);
  const A = new THREE.Vector3(0, EH, -EW * 0.18);
  const pos: number[] = [];
  const tri = (p: THREE.Vector3, q: THREE.Vector3, r: THREE.Vector3) => pos.push(p.x, p.y, p.z, q.x, q.y, q.z, r.x, r.y, r.z);
  tri(BL, BR, A);
  tri(BR, BK, A);
  tri(BK, BL, A);
  tri(BL, BK, BR);
  const shell = new THREE.BufferGeometry();
  shell.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  const n = new THREE.Vector3().subVectors(BR, BL).cross(new THREE.Vector3().subVectors(A, BL)).normalize();
  const c = new THREE.Vector3().add(BL).add(BR).add(A).multiplyScalar(1 / 3);
  const shrink = (p: THREE.Vector3, k: number) => p.clone().lerp(c, k).addScaledVector(n, EW * 0.08);
  const iBL = shrink(BL, 0.38);
  const iBR = shrink(BR, 0.38);
  const iA = shrink(A, 0.22);
  const ip: number[] = [iBL.x, iBL.y, iBL.z, iBR.x, iBR.y, iBR.z, iA.x, iA.y, iA.z];
  const innerGeo = new THREE.BufferGeometry();
  innerGeo.setAttribute("position", new THREE.Float32BufferAttribute(ip, 3));
  return merge([lowPoly(shell, outer, { variance: 0.05 }), lowPoly(innerGeo, inner, { variance: 0.03 })]);
}

export function buildCat(def: CatDef, mats: CatMaterials): CatRig {
  const P = def.proportions;
  const C = def.colors;
  const paint = painters(def);
  const meshes: THREE.Mesh[] = [];
  const animated: THREE.Object3D[] = [];

  const root = new THREE.Group();
  root.name = `cat-${def.id}`;
  const visual = new THREE.Group();
  root.add(visual);
  const scaleHolder = new THREE.Group();
  scaleHolder.scale.setScalar(P.scale);
  visual.add(scaleHolder);

  const L = P.bodyLength;
  const R = P.bodyRadius;
  const bodyY = P.legLength + R * 0.78;
  const body = new THREE.Group();
  body.position.set(0, bodyY, 0);
  scaleHolder.add(body);

  // ---------------------------------------------------------------- torso
  const hb = P.bodyHeight;
  const torsoGeo = loft(
    [
      [-L * 0.53, R * 0.42, R * 0.46 * hb, R * 0.14],
      [-L * 0.47, R * 0.84, R * 0.9 * hb, R * 0.08],
      [-L * 0.26, R * 1.0, R * 1.0 * hb, 0],
      [0, R * 0.92, R * 0.93 * hb, -R * 0.04],
      [L * 0.26, R * 1.02, R * 1.06 * hb, R * 0.04],
      [L * 0.44, R * 0.86, R * 0.92 * hb, R * 0.2],
      [L * 0.53, R * 0.5, R * 0.56 * hb, R * 0.42],
    ],
    9,
  );
  body.add(meshOf(lowPoly(torsoGeo, paint.torso, { variance: 0.05, seed: 3 }), mats.fur, meshes));
  if (def.pattern !== "calico") {
    const fluff = lowPoly(place(ico(R * 0.6, 0), 0, -R * 0.15, L * 0.42, 0, 0, 0, 1, 1.15, 0.8), C.light, { variance: 0.06, jitter: R * 0.06, seed: 5 });
    body.add(meshOf(fluff, mats.fur, meshes));
  }

  // ---------------------------------------------------------------- neck + head
  const neck = new THREE.Group();
  neck.position.set(0, R * 0.6, L * 0.42);
  body.add(neck);
  neck.add(meshOf(lowPoly(place(cyl(R * 0.56, R * 0.72, 0.22, 7), 0, 0.07, 0.03, 0, 0.55, 0), paint.neck, { variance: 0.05 }), mats.fur, meshes));

  const H = P.headSize;
  const head = new THREE.Group();
  const headBase = new THREE.Vector3(0, 0.13 + P.neckLift, 0.11);
  head.position.copy(headBase);
  neck.add(head);

  const headParts: THREE.BufferGeometry[] = [];
  headParts.push(lowPoly(place(sphere(H, 9, 7), 0, 0, 0, 0, 0, 0, 1.08, 0.9, 0.94), paint.head, { variance: 0.05, seed: 11 }));
  for (const sx of [1, -1]) {
    headParts.push(lowPoly(place(ico(H * 0.5, 0), sx * H * 0.62, -H * 0.34, H * 0.22, 0, 0, sx * 0.3, 1.05, 0.8, 0.9), paint.cheek, { variance: 0.05, seed: 13 + sx }));
  }
  const M = P.muzzleSize;
  const muzzleZ = headSurfaceZ(H, 0, -H * 0.38) - M * 0.3;
  headParts.push(lowPoly(place(ico(M, 1), 0, -H * 0.38, muzzleZ, 0, 0, 0, 1.35, 0.78, 0.85), paint.muzzle, { variance: 0.04, seed: 17 }));
  headParts.push(lowPoly(place(ico(M * 0.6, 0), 0, -H * 0.66, muzzleZ - M * 0.2, 0, 0, 0, 1.1, 0.7, 0.9), paint.muzzle, { variance: 0.04, seed: 19 }));
  headParts.push(lowPoly(place(ico(M * 0.3, 0), 0, -H * 0.2, muzzleZ + M * 0.72, 0, 0, 0, 1.45, 0.85, 0.8), C.nose, { variance: 0.02 }));
  for (const sx of [1, -1]) {
    const bx = sx * H * 0.4;
    const by = H * 0.38;
    headParts.push(
      lowPoly(place(new THREE.BoxGeometry(H * 0.44, H * 0.07, H * 0.09), bx, by, headSurfaceZ(H, bx, by) - H * 0.01, sx * 0.36, -0.2, sx * P.browAngle), shade(def.pattern === "smoky" ? C.dark : C.dark, def.pattern === "smoky" ? 0.65 : 0.92), {
        variance: 0.02,
      }),
    );
  }
  head.add(meshOf(merge(headParts), mats.fur, meshes));

  const jaw = new THREE.Group();
  jaw.position.set(0, -H * 0.52, muzzleZ - M * 0.55);
  head.add(jaw);
  jaw.add(
    meshOf(
      merge([
        lowPoly(place(ico(M * 0.72, 0), 0, -0.012, M * 0.62, 0, 0, 0, 1.15, 0.45, 0.95), paint.muzzle, { variance: 0.04 }),
        lowPoly(place(new THREE.BoxGeometry(M * 1.25, M * 0.12, M * 0.85), 0, M * 0.1, M * 0.6), 0x8a4040, { variance: 0.02 }),
      ]),
      mats.fur,
      meshes,
    ),
  );

  const E = P.eyeSize;
  const makeEye = (sx: number): THREE.Group => {
    const g = new THREE.Group();
    const ex = sx * H * 0.41;
    const ey = H * 0.06;
    g.position.set(ex, ey, headSurfaceZ(H, ex, ey) - E * 0.12);
    g.rotation.set(-0.08, sx * 0.4, 0);
    const parts = [
      lowPoly(place(sphere(E * 1.13, 8, 6), 0, 0, -E * 0.08, 0, 0, 0, 1, 1.12, 0.42), shade(def.pattern === "smoky" ? 0x1a1817 : C.dark, 0.55), { variance: 0 }),
      lowPoly(place(sphere(E, 8, 6), 0, 0, 0, 0, 0, 0, 1, 1.1, 0.45), C.eye, { variance: 0.07 }),
      lowPoly(place(sphere(E * 0.55, 7, 5), 0, -E * 0.04, E * 0.3, 0, 0, 0, 0.8, 1.15, 0.4), 0x14100d, { variance: 0 }),
      lowPoly(place(ico(E * 0.2, 0), -sx * E * 0.32, E * 0.42, E * 0.46), 0xffffff, { variance: 0 }),
    ];
    g.add(meshOf(merge(parts), mats.eye, meshes));
    return g;
  };
  const eyeL = makeEye(1);
  const eyeR = makeEye(-1);
  head.add(eyeL, eyeR);

  const makeEar = (sx: number): THREE.Group => {
    const g = new THREE.Group();
    g.position.set(sx * H * 0.52, H * 0.58, -H * 0.08);
    g.rotation.set(-0.08, sx * 0.2, -sx * 0.34);
    g.add(meshOf(earGeometry(P.earWidth, P.earHeight, paint.ear, C.innerEar), mats.fur, meshes));
    return g;
  };
  const earL = makeEar(1);
  const earR = makeEar(-1);
  head.add(earL, earR);

  const mouthSocket = new THREE.Object3D();
  mouthSocket.position.set(0, -H * 0.5, muzzleZ + M * 0.15);
  head.add(mouthSocket);

  // ---------------------------------------------------------------- legs
  const T = P.legThickness;
  const pawDrop = T * 0.62;
  const makeLeg = (front: boolean, side: 1 | -1): LegRig => {
    const hip = new THREE.Group();
    const attachY = front ? -R * 0.35 : -R * 0.22;
    hip.position.set(side * R * (front ? 0.55 : 0.62), attachY, front ? L * 0.3 : -L * 0.31);
    body.add(hip);
    const restHip = front ? 0.04 : -0.32;
    const restKnee = front ? -0.08 : 0.62;
    const reach = bodyY + attachY - pawDrop;
    const ru = front ? 0.53 : 0.56;
    // Solve segment lengths so the rest pose plants the paw on the ground.
    const vU = Math.cos(restHip);
    const vL = Math.cos(restHip + restKnee);
    const k = reach / (ru * vU + (1 - ru) * vL);
    const upperLen = k * ru;
    const lowerLen = k * (1 - ru);
    const upperR = front ? T : T * 1.35;
    const upperGeo = lowPoly(place(cyl(upperR, T * 0.86, upperLen, 6), 0, -upperLen / 2, 0), paint.upperLeg, { variance: 0.05 });
    if (!front) {
      const thigh = lowPoly(place(ico(T * 1.75, 0), 0, -upperLen * 0.22, -T * 0.15, 0, 0, 0, 0.78, 1.35, 1.1), paint.upperLeg, { variance: 0.05 });
      hip.add(meshOf(merge([upperGeo, thigh]), mats.fur, meshes));
    } else {
      hip.add(meshOf(upperGeo, mats.fur, meshes));
    }
    const knee = new THREE.Group();
    knee.position.set(0, -upperLen, 0);
    hip.add(knee);
    const lowerGeo = lowPoly(place(cyl(T * 0.86, T * 0.72, lowerLen, 6), 0, -lowerLen / 2, 0), paint.lowerLeg, { variance: 0.05 });
    const pawGeo = lowPoly(place(sphere(T * 1.22, 7, 4), 0, -lowerLen - pawDrop + T * 0.73, T * 0.4, 0, 0, 0, 1, 0.6, 1.42), paint.paw, { variance: 0.04 });
    const toes: THREE.BufferGeometry[] = [];
    for (let i = -1; i <= 1; i++) {
      toes.push(lowPoly(place(ico(T * 0.38, 0), i * T * 0.44, -lowerLen - pawDrop + T * 0.3, T * 1.38, 0, 0, 0, 1, 0.8, 1), shade(paint.paw, 0.94), { variance: 0.02 }));
    }
    knee.add(meshOf(merge([lowerGeo, pawGeo, ...toes]), mats.fur, meshes));
    hip.rotation.x = restHip;
    knee.rotation.x = restKnee;
    animated.push(hip, knee);
    return { hip, knee, upperLen, lowerLen, front, side, restHip, restKnee, pawDrop };
  };
  const legs = {
    FL: makeLeg(true, 1),
    FR: makeLeg(true, -1),
    BL: makeLeg(false, 1),
    BR: makeLeg(false, -1),
  };

  // ---------------------------------------------------------------- tail
  const tail: THREE.Group[] = [];
  const tailMeshes: THREE.Mesh[] = [];
  const segs = 7;
  const segLen = P.tailLength / segs;
  let parent: THREE.Object3D = body;
  for (let i = 0; i < segs; i++) {
    const g = new THREE.Group();
    if (i === 0) g.position.set(0, R * 0.55, -L * 0.48);
    else g.position.set(0, 0, -segLen);
    const t0 = 1 - i / segs;
    const t1 = 1 - (i + 1) / segs;
    const r0 = P.tailThickness * (0.6 + 0.4 * t0);
    const r1 = P.tailThickness * (0.6 + 0.4 * t1) * (i === segs - 1 ? 0.55 : 1);
    const geo = lowPoly(place(cyl(r1, r0, segLen * 1.14, 6), 0, 0, -segLen / 2, 0, Math.PI / 2, 0), paint.tail(i, segs), { variance: 0.05, seed: 40 + i });
    const m = meshOf(geo, mats.fur, meshes);
    g.add(m);
    tailMeshes.push(m);
    parent.add(g);
    tail.push(g);
    animated.push(g, m);
    parent = g;
  }

  animated.push(visual, body, neck, head, jaw, earL, earR, eyeL, eyeR);

  return {
    root,
    visual,
    body,
    neck,
    head,
    jaw,
    earL,
    earR,
    eyeL,
    eyeR,
    mouthSocket,
    legs,
    tail,
    tailMeshes,
    bodyY,
    headBase,
    animated,
    meshes,
    def,
  };
}

// --------------------------------------------------------------------------
// Pose capture (Past You afterimages replay the Echo's recent poses)
// --------------------------------------------------------------------------

export const POSE_STRIDE = 10;

export function poseSize(rig: CatRig): number {
  return rig.animated.length * POSE_STRIDE;
}

export function capturePose(rig: CatRig, out: Float32Array): void {
  let o = 0;
  for (const n of rig.animated) {
    out[o++] = n.position.x;
    out[o++] = n.position.y;
    out[o++] = n.position.z;
    out[o++] = n.quaternion.x;
    out[o++] = n.quaternion.y;
    out[o++] = n.quaternion.z;
    out[o++] = n.quaternion.w;
    out[o++] = n.scale.x;
    out[o++] = n.scale.y;
    out[o++] = n.scale.z;
  }
}

export function applyPose(rig: CatRig, pose: Float32Array): void {
  let o = 0;
  for (const n of rig.animated) {
    n.position.set(pose[o], pose[o + 1], pose[o + 2]);
    n.quaternion.set(pose[o + 3], pose[o + 4], pose[o + 5], pose[o + 6]);
    n.scale.set(pose[o + 7], pose[o + 8], pose[o + 9]);
    o += POSE_STRIDE;
  }
}

export function setRigMaterial(rig: CatRig, mat: THREE.Material): void {
  for (const m of rig.meshes) m.material = mat;
}
