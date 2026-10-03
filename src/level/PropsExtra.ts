import * as THREE from "three";
import { FISH_COLORS, PALETTE } from "../data/palette";
import { Random } from "../core/Random";
import { box, boxUp, cone, cyl, cylUp, ico, lowPoly, merge, place, prism, shade, sphere } from "../rendering/LowPoly";
import type { LevelBuilder } from "./LevelBuilder";
import { displayFish, group, rot } from "./Props";

/**
 * Props from the market / street / rooftop reference sheets that the first
 * kit did not cover: canvas shades, market clutter, a pipe kit, rooftop and
 * street clutter. Same flat-shaded, vertex-coloured style as Props.ts. They
 * draw from their own random stream so adding them never reshuffles the
 * rest of the street.
 */

const deco = new Random(9090);

const ROPE = 0xb38a55;
const CANVAS: Record<"cream" | "coral" | "teal", number> = { cream: PALETTE.awningCream, coral: PALETTE.awningCoral, teal: PALETTE.awningTeal };
const STEEL = 0x8d99a3;

// --------------------------------------------------------------------- market

/**
 * Canvas shade on four poles. (x, y, z) is the centre on the ground; the
 * front edge (+z after yaw) is at hFront, the back at hBack. `sag` dips the
 * middle (0.05 stretched, 0.3 sagging).
 */
export function canvasShade(
  b: LevelBuilder,
  x: number,
  y: number,
  z: number,
  yaw: number,
  w: number,
  d: number,
  hFront: number,
  hBack: number,
  color: "cream" | "coral" | "teal",
  sag = 0.08,
): void {
  const parts: THREE.BufferGeometry[] = [];
  for (const [sx, sz] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ]) {
    const h = sz > 0 ? hFront : hBack;
    parts.push(place(lowPoly(cylUp(0.04, 0.05, h, 5), PALETTE.woodDark), sx * w * 0.5, 0, sz * d * 0.5));
    parts.push(place(lowPoly(box(0.09, 0.08, 0.09), shade(ROPE, 0.8)), sx * w * 0.5, h - 0.02, sz * d * 0.5));
  }
  // the canvas: a thin slab bent between the poles
  const cloth = new THREE.BoxGeometry(w * 1.04, 0.03, d * 1.04, 6, 1, 4);
  const pos = cloth.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i);
    const pz = pos.getZ(i);
    const u = Math.min(1, Math.abs((2 * px) / w));
    const v = Math.min(1, Math.abs((2 * pz) / d));
    const height = hBack + (hFront - hBack) * (pz / d + 0.5);
    pos.setY(i, pos.getY(i) + height - sag * (1 - u * u) * (1 - v * v));
  }
  const base = CANVAS[color];
  parts.push(lowPoly(cloth, (c) => shade(base, c.y > 0 ? 1 : 0.86), { variance: 0.035 }));
  group(b, parts, x, y, z, yaw);
  for (const [sx, sz] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ]) {
    const [ox, oz] = rot(sx * w * 0.5, sz * d * 0.5, yaw);
    const h = sz > 0 ? hFront : hBack;
    b.collider(x + ox - 0.05, x + ox + 0.05, y, y + h, z + oz - 0.05, z + oz + 0.05, false);
  }
}

/** A coil of rope (three stacked loops). */
export function ropeCoil(b: LevelBuilder, x: number, y: number, z: number, color: number = ROPE): void {
  const parts: THREE.BufferGeometry[] = [];
  [0.25, 0.22, 0.18].forEach((r, i) => {
    const t = new THREE.TorusGeometry(r, 0.045, 4, 12);
    t.rotateX(Math.PI / 2);
    parts.push(place(lowPoly(t, shade(color, 1 - i * 0.06), { variance: 0.06 }), deco.range(-0.02, 0.02), 0.045 + i * 0.075, deco.range(-0.02, 0.02)));
  });
  parts.push(place(lowPoly(cyl(0.035, 0.035, 0.35, 4), shade(color, 0.9)), 0.3, 0.04, 0.06, 0.5, 0, Math.PI / 2));
  group(b, parts, x, y, z, deco.range(0, 6));
}

/** A little pyramid of lemons. */
export function lemonPile(b: LevelBuilder, x: number, y: number, z: number, n = 9): void {
  const parts: THREE.BufferGeometry[] = [];
  const layers = [Math.min(n, 6), Math.min(Math.max(n - 6, 0), 3), n > 9 ? 1 : 0];
  layers.forEach((count, layer) => {
    for (let i = 0; i < count; i++) {
      const a = (i / Math.max(1, count)) * Math.PI * 2 + layer;
      const r = layer === 2 ? 0 : layer === 1 ? 0.08 : 0.15;
      parts.push(place(lowPoly(ico(0.075, 0), shade(PALETTE.lemon, deco.range(0.92, 1.04)), { variance: 0.05 }), Math.cos(a) * r, 0.07 + layer * 0.11, Math.sin(a) * r, deco.range(0, 3), deco.range(0, 3), 0, 1.15, 1, 1));
    }
  });
  group(b, parts, x, y, z, deco.range(0, 6));
}

/** Shallow wooden tray with a metal liner; optionally a few fish on ice. */
export function shallowTray(b: LevelBuilder, x: number, y: number, z: number, yaw: number, withFish = false): void {
  const w = 0.9;
  const d = 0.55;
  const parts: THREE.BufferGeometry[] = [
    lowPoly(boxUp(w, 0.05, d), PALETTE.woodHoney),
    place(lowPoly(boxUp(w - 0.1, 0.03, d - 0.1), PALETTE.metalBlueGray), 0, 0.05, 0),
  ];
  for (const sz of [-1, 1]) parts.push(place(lowPoly(boxUp(w, 0.12, 0.05), shade(PALETTE.woodHoney, 0.92)), 0, 0, sz * (d / 2 - 0.025)));
  for (const sx of [-1, 1]) parts.push(place(lowPoly(boxUp(0.05, 0.12, d), shade(PALETTE.woodHoney, 0.92)), sx * (w / 2 - 0.025), 0, 0));
  if (withFish) {
    parts.push(place(lowPoly(boxUp(w - 0.14, 0.02, d - 0.14), 0xeaf4f6, { variance: 0.08 }), 0, 0.075, 0));
    for (let i = 0; i < 3; i++) parts.push(place(displayFish(deco.pick([FISH_COLORS.body, 0xe0857a])), -0.22 + i * 0.22, 0.1, deco.range(-0.06, 0.06), Math.PI / 2 + deco.range(-0.3, 0.3)));
  }
  group(b, parts, x, y, z, yaw);
}

/** A neatly folded stack of cloth with a blue band. */
export function foldedCloth(b: LevelBuilder, x: number, y: number, z: number, yaw: number): void {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    const w = 0.56 - i * 0.03;
    parts.push(place(lowPoly(box(w, 0.06, 0.38, 6, 1, 1), (c) => (Math.abs(c.x - 0.08) < 0.06 ? PALETTE.clothBlue : PALETTE.sheetCream), { variance: 0.04 }), deco.range(-0.02, 0.02), 0.03 + i * 0.062, 0, 0, deco.range(-0.06, 0.06), 0));
  }
  group(b, parts, x, y, z, yaw);
}

/** Small A-frame chalkboard with a chalk fish. */
export function smallChalkboard(b: LevelBuilder, x: number, y: number, z: number, yaw: number): void {
  const parts: THREE.BufferGeometry[] = [];
  for (const sz of [-1, 1]) {
    const board = merge([
      lowPoly(box(0.42, 0.52, 0.04), PALETTE.woodHoney),
      place(lowPoly(box(0.33, 0.4, 0.02), 0x2e3a40), 0, 0.02, sz * 0.025),
      // chalk fish: body, tail and two wavy lines
      place(lowPoly(sphere(0.06, 5, 3), 0xe9efe8), -0.02, 0.07, sz * 0.037, 0, 0, 0, 1.8, 0.7, 0.2),
      place(lowPoly(cone(0.04, 0.06, 3), 0xe9efe8), 0.11, 0.07, sz * 0.037, 0, 0, Math.PI / 2, 1, 1, 0.2),
      place(lowPoly(box(0.2, 0.012, 0.01), 0xe9efe8), 0, -0.07, sz * 0.037),
      place(lowPoly(box(0.16, 0.012, 0.01), 0xe9efe8), 0, -0.11, sz * 0.037),
    ]);
    parts.push(place(board, 0, 0.27, sz * 0.09, 0, sz * 0.2, 0));
  }
  group(b, parts, x, y, z, yaw);
}

/** A barrel lying on its side, held by two wooden chocks. */
export function barrelOnSide(b: LevelBuilder, x: number, y: number, z: number, yaw: number): void {
  const r = 0.33;
  const h = 0.82;
  const body = merge([
    lowPoly(cylUp(r * 0.88, r * 0.88, h, 9), PALETTE.woodHoney, { variance: 0.06 }),
    place(lowPoly(cyl(r, r, h * 0.55, 9), shade(PALETTE.woodHoney, 1.05), { variance: 0.05 }), 0, h * 0.5, 0),
    place(lowPoly(cyl(r * 0.97, r * 0.97, 0.06, 9), PALETTE.metalDark), 0, h * 0.18, 0),
    place(lowPoly(cyl(r * 0.97, r * 0.97, 0.06, 9), PALETTE.metalDark), 0, h * 0.82, 0),
    place(lowPoly(cyl(r * 0.84, r * 0.84, 0.02, 9), shade(PALETTE.woodDark, 1.1)), 0, h, 0),
  ]);
  // lie it down along local X
  body.translate(0, -h / 2, 0);
  body.rotateZ(Math.PI / 2);
  body.translate(0, r, 0);
  const parts: THREE.BufferGeometry[] = [body];
  for (const sx of [-1, 1]) parts.push(place(lowPoly(prism(0.16, 0.12, 0.5), PALETTE.woodDark), sx * 0.26, 0, 0, Math.PI / 2));
  group(b, parts, x, y, z, yaw);
  b.colliderRot(x, y + r, z, h / 2, r, r, yaw, false);
}

/** Round café table (for the canvas-shade corners). */
export function cafeTable(b: LevelBuilder, x: number, y: number, z: number): void {
  const parts: THREE.BufferGeometry[] = [
    lowPoly(cylUp(0.24, 0.28, 0.05, 8), PALETTE.metalDark),
    place(lowPoly(cylUp(0.04, 0.04, 0.68, 6), PALETTE.metalDark), 0, 0.05, 0),
    place(lowPoly(cylUp(0.38, 0.38, 0.05, 10), PALETTE.potCream, { variance: 0.03 }), 0, 0.72, 0),
    place(lowPoly(cylUp(0.07, 0.06, 0.1, 6), PALETTE.awningTeal), 0.1, 0.77, 0.05),
  ];
  group(b, parts, x, y, z, 0);
  b.collider(x - 0.3, x + 0.3, y, y + 0.75, z - 0.3, z + 0.3, false);
}

// --------------------------------------------------------------------- pipe kit

/**
 * A wall pipe run through `pts` (world space): straight pipes, an elbow at
 * every bend, a bracket band every metre or so, and an optional drain
 * outlet turning out at the last point.
 */
export function pipeRun(b: LevelBuilder, pts: Array<[number, number, number]>, opts: { r?: number; color?: number; outlet?: [number, number] } = {}): void {
  const r = opts.r ?? 0.07;
  const color = opts.color ?? PALETTE.metalBlueGray;
  const parts: THREE.BufferGeometry[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  const a = new THREE.Vector3();
  const c = new THREE.Vector3();
  const segment = (from: THREE.Vector3, to: THREE.Vector3, radius: number, col: number) => {
    const dir = new THREE.Vector3().subVectors(to, from);
    const len = dir.length();
    if (len < 1e-3) return;
    const g = lowPoly(cyl(radius, radius, len, 6), col, { variance: 0.04 });
    const q = new THREE.Quaternion().setFromUnitVectors(up, dir.clone().normalize());
    g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
    parts.push(g);
  };
  for (let i = 0; i < pts.length - 1; i++) {
    a.set(...pts[i]);
    c.set(...pts[i + 1]);
    segment(a, c, r, color);
    // bracket bands along the run
    const len = a.distanceTo(c);
    for (let s = 0.6; s < len - 0.3; s += 1.2) {
      const p = a.clone().lerp(c, s / len);
      segment(p.clone().addScaledVector(c.clone().sub(a).normalize(), -0.04), p.clone().addScaledVector(c.clone().sub(a).normalize(), 0.04), r * 1.45, PALETTE.metalDark);
    }
  }
  // elbows
  for (let i = 1; i < pts.length - 1; i++) parts.push(place(lowPoly(ico(r * 1.35, 0), shade(color, 0.92)), ...pts[i]));
  // drain outlet: a short spout kicking out at the bottom
  if (opts.outlet) {
    const end = new THREE.Vector3(...pts[pts.length - 1]);
    const out = end.clone().add(new THREE.Vector3(opts.outlet[0] * 0.22, -0.12, opts.outlet[1] * 0.22));
    segment(end, out, r, color);
    parts.push(place(lowPoly(ico(r * 1.3, 0), shade(color, 0.92)), end.x, end.y, end.z));
    parts.push(place(lowPoly(cyl(r * 1.25, r * 1.1, 0.06, 6), PALETTE.metalDark), out.x, out.y - 0.02, out.z));
  }
  if (parts.length === 0) return;
  b.add(merge(parts));
}

// --------------------------------------------------------------------- rooftop clutter

/** Wooden pallet, optionally with a folded tarp on top. */
export function pallet(b: LevelBuilder, x: number, y: number, z: number, yaw: number, tarp = false): void {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) parts.push(place(lowPoly(boxUp(1.2, 0.03, 0.12), shade(PALETTE.woodLight, 0.9)), 0, 0, -0.34 + i * 0.34));
  for (let i = 0; i < 3; i++) parts.push(place(lowPoly(boxUp(0.12, 0.09, 0.8), PALETTE.woodDark), -0.52 + i * 0.52, 0.03, 0));
  for (let i = 0; i < 5; i++) parts.push(place(lowPoly(boxUp(1.2, 0.03, 0.13), shade(PALETTE.woodLight, 0.95 + (i % 2) * 0.06), { variance: 0.05 }), 0, 0.12, -0.33 + i * 0.165));
  if (tarp) parts.push(...tarpParts(0.15));
  group(b, parts, x, y, z, yaw);
  b.colliderRot(x, y + (tarp ? 0.16 : 0.075), z, 0.6, tarp ? 0.16 : 0.075, 0.4, yaw, false);
}

function tarpParts(y0: number): THREE.BufferGeometry[] {
  const blue = PALETTE.clothBlue;
  const g = new THREE.BoxGeometry(0.95, 0.16, 0.62, 4, 1, 3);
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) if (pos.getY(i) > 0) pos.setY(i, pos.getY(i) + Math.sin(pos.getX(i) * 7 + pos.getZ(i) * 5) * 0.025);
  return [
    place(lowPoly(g, (c) => shade(blue, c.y > 0.05 ? 1 : 0.85), { variance: 0.05 }), 0, y0 + 0.08, 0),
    place(lowPoly(box(0.04, 0.18, 0.66), ROPE), 0.22, y0 + 0.08, 0),
  ];
}

/** A folded blue tarp on its own. */
export function tarp(b: LevelBuilder, x: number, y: number, z: number, yaw: number): void {
  group(b, tarpParts(0), x, y, z, yaw);
}

/** Simple wooden chair. Back faces -z (it faces +z after yaw). */
export function chair(b: LevelBuilder, x: number, y: number, z: number, yaw: number): void {
  const wood = PALETTE.woodHoney;
  const parts: THREE.BufferGeometry[] = [place(lowPoly(boxUp(0.46, 0.05, 0.44), wood, { variance: 0.04 }), 0, 0.44, 0)];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) parts.push(place(lowPoly(boxUp(0.05, 0.44, 0.05), shade(wood, 0.82)), sx * 0.19, 0, sz * 0.18));
    parts.push(place(lowPoly(boxUp(0.05, 0.5, 0.05), shade(wood, 0.82)), sx * 0.19, 0.49, -0.19));
  }
  for (let i = 0; i < 2; i++) parts.push(place(lowPoly(box(0.42, 0.07, 0.04), shade(wood, 1.04)), 0, 0.7 + i * 0.18, -0.19));
  group(b, parts, x, y, z, yaw);
  b.colliderRot(x, y + 0.25, z, 0.24, 0.25, 0.24, yaw, false);
}

/** Woven mat (two tones). */
export function mat(b: LevelBuilder, x: number, y: number, z: number, yaw: number, w = 1.1, d = 0.75, color = 0xd9b47a): void {
  const g = box(w, 0.025, d, 8, 1, 6);
  const painted = lowPoly(g, (c) => {
    const edge = Math.abs(c.x) > w / 2 - 0.08 || Math.abs(c.z) > d / 2 - 0.08;
    if (edge) return shade(color, 0.78);
    return (Math.floor((c.x + w) * 6) + Math.floor((c.z + d) * 6)) % 2 ? color : shade(color, 0.9);
  });
  group(b, [place(painted, 0, 0.013, 0)], x, y, z, yaw);
}

/** Coil of dark cable with a loose end. */
export function cableCoil(b: LevelBuilder, x: number, y: number, z: number): void {
  const parts: THREE.BufferGeometry[] = [];
  [0.22, 0.2, 0.17].forEach((r, i) => {
    const t = new THREE.TorusGeometry(r, 0.03, 4, 12);
    t.rotateX(Math.PI / 2);
    parts.push(place(lowPoly(t, shade(0x2f3539, 1 + i * 0.05)), deco.range(-0.02, 0.02), 0.03 + i * 0.05, deco.range(-0.02, 0.02)));
  });
  parts.push(place(lowPoly(cyl(0.025, 0.025, 0.5, 4), 0x2f3539), 0.32, 0.03, 0.1, 0.4, 0, Math.PI / 2));
  group(b, parts, x, y, z, deco.range(0, 6));
}

/** A small stack of wooden planks. */
export function planks(b: LevelBuilder, x: number, y: number, z: number, yaw: number, n = 3): void {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < n; i++) {
    parts.push(place(lowPoly(boxUp(1.7, 0.06, 0.24), shade(PALETTE.woodLight, deco.range(0.88, 1.04)), { variance: 0.05 }), deco.range(-0.08, 0.08), i * 0.062, deco.range(-0.05, 0.05), deco.range(-0.06, 0.06)));
  }
  group(b, parts, x, y, z, yaw);
}

/** Metal vent box with louvres and a little roof. */
export function ventBox(b: LevelBuilder, x: number, y: number, z: number, yaw: number): void {
  const parts: THREE.BufferGeometry[] = [
    lowPoly(boxUp(0.62, 0.06, 0.62), PALETTE.metalDark),
    place(lowPoly(boxUp(0.5, 0.55, 0.5), STEEL, { variance: 0.03 }), 0, 0.06, 0),
    place(lowPoly(prism(0.62, 0.16, 0.62), shade(STEEL, 1.08)), 0, 0.69, 0),
  ];
  for (const sz of [-1, 1]) for (let i = 0; i < 4; i++) parts.push(place(lowPoly(box(0.4, 0.03, 0.03), PALETTE.metalDark), 0, 0.2 + i * 0.1, sz * 0.26));
  group(b, parts, x, y, z, yaw);
  b.colliderRot(x, y + 0.38, z, 0.28, 0.38, 0.28, yaw, false);
}

// --------------------------------------------------------------------- street clutter

/** A broom leaning against a wall; the wall is behind it (-z after yaw). */
export function broom(b: LevelBuilder, x: number, y: number, z: number, yaw: number): void {
  const lean = 0.22;
  const parts: THREE.BufferGeometry[] = [
    place(lowPoly(cylUp(0.022, 0.022, 1.25, 5), PALETTE.woodLight), 0, 0.22, 0, 0, -lean, 0),
    place(lowPoly(box(0.3, 0.06, 0.08), PALETTE.woodDark), 0, 0.22, 0.05, 0, -lean, 0),
    place(lowPoly(cone(0.18, 0.26, 4), 0xc9a25b, { variance: 0.08 }), 0, 0.1, 0.03, Math.PI / 4, Math.PI, 0, 1, 1, 0.45),
  ];
  group(b, parts, x, y, z, yaw);
}

/** Street bollard. */
export function bollard(b: LevelBuilder, x: number, y: number, z: number): void {
  const parts: THREE.BufferGeometry[] = [
    lowPoly(cylUp(0.13, 0.15, 0.08, 8), PALETTE.metalDark),
    place(lowPoly(cylUp(0.1, 0.11, 0.62, 8), PALETTE.metalDark, { variance: 0.03 }), 0, 0.08, 0),
    place(lowPoly(cylUp(0.12, 0.12, 0.05, 8), shade(PALETTE.metalDark, 1.25)), 0, 0.52, 0),
    place(lowPoly(sphere(0.11, 7, 4), PALETTE.metalDark), 0, 0.7, 0, 0, 0, 0, 1, 0.6, 1),
  ];
  group(b, parts, x, y, z, 0);
  b.collider(x - 0.12, x + 0.12, y, y + 0.75, z - 0.12, z + 0.12, false);
}

/** Doormat with a darker border. */
export function doormat(b: LevelBuilder, x: number, y: number, z: number, yaw: number): void {
  mat(b, x, y, z, yaw, 0.85, 0.52, 0xa9744a);
}

/** Grey utility box against a wall (its back at -z after yaw). */
export function utilityBox(b: LevelBuilder, x: number, y: number, z: number, yaw: number): void {
  const grey = 0xb9bcb8;
  const parts: THREE.BufferGeometry[] = [
    place(lowPoly(boxUp(0.62, 0.95, 0.32), grey, { variance: 0.03 }), 0, 0.05, 0),
    lowPoly(boxUp(0.66, 0.05, 0.36), PALETTE.metalDark),
    place(lowPoly(box(0.7, 0.05, 0.4), shade(grey, 1.06)), 0, 1.02, 0.02),
    place(lowPoly(box(0.012, 0.8, 0.01), shade(grey, 0.7)), 0, 0.52, 0.165),
    place(lowPoly(box(0.04, 0.12, 0.03), PALETTE.metalDark), 0.12, 0.55, 0.17),
    // yellow warning triangle
    place(lowPoly(cone(0.08, 0.01, 3), 0xf2c14e), -0.14, 0.8, 0.168, 0, Math.PI / 2, 0),
  ];
  group(b, parts, x, y, z, yaw);
  b.colliderRot(x, y + 0.52, z, 0.32, 0.52, 0.17, yaw, false);
}

/** Terracotta amphora pot with two little handles. */
export function ceramicPot(b: LevelBuilder, x: number, y: number, z: number, s = 1): void {
  const col = PALETTE.potTerracotta;
  const parts: THREE.BufferGeometry[] = [
    lowPoly(cylUp(0.12 * s, 0.16 * s, 0.08 * s, 8), shade(col, 0.9)),
    place(lowPoly(sphere(0.27 * s, 9, 6), col, { variance: 0.04 }), 0, 0.33 * s, 0, 0, 0, 0, 1, 1.1, 1),
    place(lowPoly(cylUp(0.11 * s, 0.14 * s, 0.16 * s, 8), shade(col, 1.04)), 0, 0.58 * s, 0),
    place(lowPoly(cylUp(0.15 * s, 0.13 * s, 0.05 * s, 8), shade(col, 1.1)), 0, 0.74 * s, 0),
  ];
  for (const sx of [-1, 1]) {
    const t = new THREE.TorusGeometry(0.07 * s, 0.018 * s, 3, 6, Math.PI);
    parts.push(place(lowPoly(t, shade(col, 0.95)), sx * 0.17 * s, 0.6 * s, 0, 0, sx > 0 ? -Math.PI / 2 : Math.PI / 2, 0));
  }
  group(b, parts, x, y, z, deco.range(0, 6));
  b.collider(x - 0.22 * s, x + 0.22 * s, y, y + 0.6 * s, z - 0.22 * s, z + 0.22 * s, false);
}
