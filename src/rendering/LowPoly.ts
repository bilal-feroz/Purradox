import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { hash3 } from "../core/Random";

/**
 * Low-poly construction helpers. Every mesh in Purradox is built from
 * non-indexed geometry with per-face vertex colors: a base color plus a tiny
 * deterministic per-triangle variation. Combined with flat shading this gives
 * the handcrafted faceted diorama look of the references without textures.
 */

export type ColorFn = (centroid: THREE.Vector3, normal: THREE.Vector3, face: number) => number;

export interface PaintOptions {
  /** Relative brightness variation per face (0.04 = ±4%). */
  variance?: number;
  /** Random vertex displacement (organic shapes). Coincident vertices move together. */
  jitter?: number;
  /** Seed mixed into variation hashes. */
  seed?: number;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _n = new THREE.Vector3();
const _cent = new THREE.Vector3();
const _e = new THREE.Vector3();
const _col = new THREE.Color();

function jitterGeometry(geo: THREE.BufferGeometry, amount: number, seed: number): void {
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const kx = Math.round(x * 1000) / 1000 + seed * 0.013;
    const ky = Math.round(y * 1000) / 1000;
    const kz = Math.round(z * 1000) / 1000;
    pos.setXYZ(
      i,
      x + (hash3(kx, ky, kz) - 0.5) * 2 * amount,
      y + (hash3(ky, kz, kx + 3.1) - 0.5) * 2 * amount,
      z + (hash3(kz, kx, ky + 7.7) - 0.5) * 2 * amount,
    );
  }
  pos.needsUpdate = true;
}

/** Convert to flat, vertex-colored, non-indexed geometry (position/normal/color only). */
export function lowPoly(source: THREE.BufferGeometry, color: number | ColorFn, opts: PaintOptions = {}): THREE.BufferGeometry {
  const variance = opts.variance ?? 0.045;
  const seed = opts.seed ?? 0;
  let geo = source.index ? source.toNonIndexed() : source.clone();
  if (opts.jitter && opts.jitter > 0) jitterGeometry(geo, opts.jitter, seed);
  for (const name of Object.keys(geo.attributes)) {
    if (name !== "position") geo.deleteAttribute(name);
  }
  geo.computeVertexNormals();
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const faces = pos.count / 3;
  for (let f = 0; f < faces; f++) {
    _a.fromBufferAttribute(pos, f * 3);
    _b.fromBufferAttribute(pos, f * 3 + 1);
    _c.fromBufferAttribute(pos, f * 3 + 2);
    _cent.copy(_a).add(_b).add(_c).multiplyScalar(1 / 3);
    _n.subVectors(_b, _a).cross(_e.subVectors(_c, _a)).normalize();
    const hex = typeof color === "number" ? color : color(_cent, _n, f);
    _col.setHex(hex);
    const v = 1 + (hash3(_cent.x + seed, _cent.y * 1.7, _cent.z - seed) - 0.5) * 2 * variance;
    const r = Math.min(1, _col.r * v);
    const g = Math.min(1, _col.g * v);
    const b = Math.min(1, _col.b * v);
    for (let k = 0; k < 3; k++) {
      colors[(f * 3 + k) * 3] = r;
      colors[(f * 3 + k) * 3 + 1] = g;
      colors[(f * 3 + k) * 3 + 2] = b;
    }
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  if (geo !== source) source.dispose();
  return geo;
}

/** Apply a transform and return the same geometry (chainable). */
export function place(
  geo: THREE.BufferGeometry,
  x: number,
  y: number,
  z: number,
  rotY = 0,
  rotX = 0,
  rotZ = 0,
  sx = 1,
  sy = 1,
  sz = 1,
): THREE.BufferGeometry {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rotX, rotY, rotZ, "YXZ")),
    new THREE.Vector3(sx, sy, sz),
  );
  geo.applyMatrix4(m);
  return geo;
}

export function merge(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const valid = geos.filter((g) => g.getAttribute("position").count > 0);
  if (valid.length === 0) return new THREE.BufferGeometry();
  const out = mergeGeometries(valid, false);
  for (const g of valid) g.dispose();
  if (!out) throw new Error("mergeGeometries failed (attribute mismatch)");
  return out;
}

// ---------------------------------------------------------------------------
// Primitive builders (return raw indexed/non-indexed geometry before painting)
// ---------------------------------------------------------------------------

export function box(w: number, h: number, d: number, sx = 1, sy = 1, sz = 1): THREE.BufferGeometry {
  return new THREE.BoxGeometry(w, h, d, sx, sy, sz);
}

/** Box whose bottom sits at y=0. */
export function boxUp(w: number, h: number, d: number, sx = 1, sy = 1, sz = 1): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d, sx, sy, sz);
  g.translate(0, h / 2, 0);
  return g;
}

export function cyl(rTop: number, rBottom: number, h: number, radial = 7, hSeg = 1, open = false): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(rTop, rBottom, h, radial, hSeg, open);
}

export function cylUp(rTop: number, rBottom: number, h: number, radial = 7, hSeg = 1): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rTop, rBottom, h, radial, hSeg);
  g.translate(0, h / 2, 0);
  return g;
}

export function ico(r: number, detail = 0): THREE.BufferGeometry {
  return new THREE.IcosahedronGeometry(r, detail);
}

export function sphere(r: number, w = 7, h = 5): THREE.BufferGeometry {
  return new THREE.SphereGeometry(r, w, h);
}

export function cone(r: number, h: number, radial = 6): THREE.BufferGeometry {
  return new THREE.ConeGeometry(r, h, radial);
}

/** Triangular prism along Z (gable roof / wedge). Base on y=0, ridge at y=h. */
export function prism(w: number, h: number, d: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, 0);
  shape.lineTo(w / 2, 0);
  shape.lineTo(0, h);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false });
  g.translate(0, 0, -d / 2);
  return g;
}

/** Ramp wedge: slope rising along +Z from y=0 at z=-d/2 to y=h at z=+d/2. */
export function wedge(w: number, h: number, d: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-d / 2, 0);
  shape.lineTo(d / 2, 0);
  shape.lineTo(d / 2, h);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false });
  g.translate(0, 0, -w / 2);
  g.rotateY(-Math.PI / 2);
  return g;
}

/** Rounded arch opening frame (outer block minus semicircle), extruded along Z. */
export function archFrame(width: number, height: number, depth: number, openingW: number, openingH: number, segs = 7): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, 0);
  shape.lineTo(width / 2, 0);
  shape.lineTo(width / 2, height);
  shape.lineTo(-width / 2, height);
  shape.closePath();
  const hole = new THREE.Path();
  const r = openingW / 2;
  const springY = openingH - r;
  hole.moveTo(-r, 0);
  hole.lineTo(r, 0);
  hole.lineTo(r, springY);
  for (let i = 1; i <= segs; i++) {
    const a = (i / segs) * Math.PI;
    hole.lineTo(Math.cos(a) * r, springY + Math.sin(a) * r);
  }
  hole.lineTo(-r, 0);
  shape.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: segs });
  g.translate(0, 0, -depth / 2);
  return g;
}

/**
 * Loft through elliptical rings along +Z. Used for cat bodies, fish and tails.
 * rings: [z, radiusX, radiusY, offsetY]
 */
export function loft(rings: Array<[number, number, number, number]>, radial = 8, capStart = true, capEnd = true): THREE.BufferGeometry {
  const positions: number[] = [];
  const ringPts: THREE.Vector3[][] = rings.map(([z, rx, ry, oy]) => {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < radial; i++) {
      const a = (i / radial) * Math.PI * 2 + Math.PI / radial;
      pts.push(new THREE.Vector3(Math.cos(a) * rx, Math.sin(a) * ry + oy, z));
    }
    return pts;
  });
  const tri = (p: THREE.Vector3, q: THREE.Vector3, r: THREE.Vector3) => {
    positions.push(p.x, p.y, p.z, q.x, q.y, q.z, r.x, r.y, r.z);
  };
  for (let s = 0; s < ringPts.length - 1; s++) {
    const A = ringPts[s];
    const B = ringPts[s + 1];
    for (let i = 0; i < radial; i++) {
      const j = (i + 1) % radial;
      tri(A[i], B[j], B[i]);
      tri(A[i], A[j], B[j]);
    }
  }
  if (capStart) {
    const A = ringPts[0];
    const c = new THREE.Vector3(0, rings[0][3], rings[0][0]);
    for (let i = 0; i < radial; i++) tri(c, A[(i + 1) % radial], A[i]);
  }
  if (capEnd) {
    const A = ringPts[ringPts.length - 1];
    const last = rings[rings.length - 1];
    const c = new THREE.Vector3(0, last[3], last[0]);
    for (let i = 0; i < radial; i++) tri(c, A[i], A[(i + 1) % radial]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return g;
}

/** Flat polygon (in XZ plane, facing +Y) from a list of 2D points. */
export function flatPoly(points: Array<[number, number]>, y = 0): THREE.BufferGeometry {
  const positions: number[] = [];
  const [x0, z0] = points[0];
  // Signed area decides winding so the polygon always faces +Y.
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const [xa, za] = points[i];
    const [xb, zb] = points[(i + 1) % points.length];
    area += xa * zb - xb * za;
  }
  const flip = area < 0;
  for (let i = 1; i < points.length - 1; i++) {
    const [x1, z1] = points[i];
    const [x2, z2] = points[i + 1];
    if (flip) positions.push(x0, y, z0, x1, y, z1, x2, y, z2);
    else positions.push(x0, y, z0, x2, y, z2, x1, y, z1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return g;
}

export function shade(hex: number, factor: number): number {
  _col.setHex(hex);
  _col.r = Math.min(1, _col.r * factor);
  _col.g = Math.min(1, _col.g * factor);
  _col.b = Math.min(1, _col.b * factor);
  return _col.getHex();
}

export function mix(hexA: number, hexB: number, t: number): number {
  const a = new THREE.Color(hexA);
  const b = new THREE.Color(hexB);
  return a.lerp(b, t).getHex();
}
