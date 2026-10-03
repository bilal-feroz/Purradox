import * as THREE from "three";
import { FISH_COLORS, PALETTE } from "../data/palette";
import { Random } from "../core/Random";
import { box, boxUp, cone, cyl, cylUp, ico, lowPoly, merge, place, prism, shade, sphere } from "../rendering/LowPoly";
import type { LevelBuilder } from "./LevelBuilder";

/**
 * Modular prop kit (Fish Market, Street + Rooftop and Interactive prop
 * sheets). Every function paints and places geometry into the builder and
 * registers colliders for anything a cat can stand on or bump into.
 */

export type Face = "n" | "s" | "e" | "w";
export const FACE_YAW: Record<Face, number> = { s: 0, n: Math.PI, e: Math.PI / 2, w: -Math.PI / 2 };

const rng = new Random(4242);

/** Transform a local offset (lx, lz) by a yaw. */
function rot(lx: number, lz: number, yaw: number): [number, number] {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [lx * c + lz * s, -lx * s + lz * c];
}

/** Build a local group of geometries then place it with one yaw. */
function group(b: LevelBuilder, parts: THREE.BufferGeometry[], x: number, y: number, z: number, yaw: number, bucket: "world" | "glow" = "world"): void {
  if (parts.length === 0) return;
  const g = merge(parts);
  place(g, x, y, z, yaw);
  b.add(g, bucket);
}

// --------------------------------------------------------------------- crates

export function crate(b: LevelBuilder, x: number, y: number, z: number, yaw = 0, size = 0.8, collider = true): number {
  const s = size;
  const h = s * 0.92;
  const parts: THREE.BufferGeometry[] = [];
  const wood = rng.pick([PALETTE.woodHoney, PALETTE.woodLight, shade(PALETTE.woodHoney, 0.92)]);
  parts.push(place(lowPoly(boxUp(s * 0.94, h * 0.96, s * 0.94), shade(wood, 0.86), { variance: 0.03 }), 0, 0, 0));
  // slats
  for (let i = 0; i < 3; i++) {
    const yy = h * (0.12 + i * 0.32);
    for (const [fx, fz, w, d] of [
      [0, s * 0.48, s, 0.04],
      [0, -s * 0.48, s, 0.04],
      [s * 0.48, 0, 0.04, s],
      [-s * 0.48, 0, 0.04, s],
    ] as Array<[number, number, number, number]>) {
      parts.push(place(lowPoly(box(w, h * 0.22, d), shade(wood, 1.0 + (i % 2) * 0.05), { variance: 0.05 }), fx, yy + h * 0.11, fz));
    }
  }
  // corner posts + metal corners
  for (const cx of [-1, 1]) {
    for (const cz of [-1, 1]) {
      parts.push(place(lowPoly(box(0.08, h, 0.08), shade(wood, 0.8)), cx * s * 0.47, h / 2, cz * s * 0.47));
      parts.push(place(lowPoly(box(0.1, 0.08, 0.1), PALETTE.metalBlueGray), cx * s * 0.47, h - 0.04, cz * s * 0.47));
      parts.push(place(lowPoly(box(0.1, 0.08, 0.1), PALETTE.metalBlueGray), cx * s * 0.47, 0.04, cz * s * 0.47));
    }
  }
  group(b, parts, x, y, z, yaw);
  if (collider) b.colliderRot(x, y + h / 2, z, s / 2, h / 2, s / 2, yaw);
  return y + h;
}

export function crateStack(b: LevelBuilder, x: number, y: number, z: number, n: number, yaw = 0, size = 0.8): number {
  let top = y;
  for (let i = 0; i < n; i++) top = crate(b, x + rng.range(-0.05, 0.05), top, z + rng.range(-0.05, 0.05), yaw + rng.range(-0.12, 0.12), size);
  return top;
}

export function barrel(b: LevelBuilder, x: number, y: number, z: number, collider = true, h = 0.82): void {
  const r = 0.33;
  const parts = [
    lowPoly(cylUp(r * 0.88, r * 0.88, h, 9), PALETTE.woodHoney, { variance: 0.06 }),
    place(lowPoly(cyl(r, r, h * 0.55, 9), shade(PALETTE.woodHoney, 1.05), { variance: 0.05 }), 0, h * 0.5, 0),
    place(lowPoly(cyl(r * 0.97, r * 0.97, 0.06, 9), PALETTE.metalDark), 0, h * 0.18, 0),
    place(lowPoly(cyl(r * 0.97, r * 0.97, 0.06, 9), PALETTE.metalDark), 0, h * 0.82, 0),
    place(lowPoly(cyl(r * 0.84, r * 0.84, 0.02, 9), shade(PALETTE.woodDark, 1.1)), 0, h, 0),
  ];
  group(b, parts, x, y, z, rng.range(0, 3));
  if (collider) b.collider(x - r, x + r, y, y + h, z - r, z + r);
}

export function basket(b: LevelBuilder, x: number, y: number, z: number, contents: "fish" | "lemons" | "empty" = "lemons", collider = false): void {
  const parts: THREE.BufferGeometry[] = [
    lowPoly(cylUp(0.36, 0.28, 0.34, 8), PALETTE.woodLight, { variance: 0.08 }),
    place(lowPoly(cyl(0.37, 0.37, 0.05, 8), PALETTE.woodHoney), 0, 0.34, 0),
  ];
  if (contents === "lemons") {
    for (let i = 0; i < 7; i++) {
      parts.push(place(lowPoly(ico(0.085, 0), PALETTE.lemon, { variance: 0.08 }), rng.range(-0.18, 0.18), 0.36 + rng.range(0, 0.06), rng.range(-0.18, 0.18)));
    }
  } else if (contents === "fish") {
    for (let i = 0; i < 3; i++) parts.push(place(displayFish(rng.pick([FISH_COLORS.body, 0xe0857a])), rng.range(-0.1, 0.1), 0.37, rng.range(-0.12, 0.12), rng.range(0, 3)));
  }
  group(b, parts, x, y, z, rng.range(0, 3));
  if (collider) b.collider(x - 0.35, x + 0.35, y, y + 0.36, z - 0.35, z + 0.35);
}

/** Small decorative fish for tables, baskets and hanging lines. */
export function displayFish(color: number): THREE.BufferGeometry {
  const parts = [
    lowPoly(place(sphere(0.12, 6, 4), 0, 0.04, 0, 0, 0, 0, 2.2, 0.75, 0.8), (c) => (c.y < 0.02 ? FISH_COLORS.belly : color), { variance: 0.06 }),
    lowPoly(place(cone(0.08, 0.14, 3), -0.3, 0.04, 0, 0, 0, -Math.PI / 2, 1, 1, 0.3), shade(color, 0.85)),
    lowPoly(place(ico(0.025, 0), 0.19, 0.07, 0.07), 0x222222),
  ];
  return merge(parts);
}

export function bucket(b: LevelBuilder, x: number, y: number, z: number, color: number = PALETTE.metalBlueGray): void {
  group(b, [lowPoly(cylUp(0.26, 0.21, 0.42, 8), color, { variance: 0.05 }), place(lowPoly(cyl(0.25, 0.25, 0.02, 8), shade(color, 0.6)), 0, 0.4, 0)], x, y, z, 0);
}

export function bowlCeramic(b: LevelBuilder, x: number, y: number, z: number): void {
  group(
    b,
    [
      lowPoly(cylUp(0.3, 0.22, 0.32, 9), (c) => (c.y > 0.1 && c.y < 0.22 ? PALETTE.awningTeal : PALETTE.potCream), { variance: 0.03 }),
    ],
    x,
    y,
    z,
    0,
  );
}

// --------------------------------------------------------------------- market

export function displayTable(b: LevelBuilder, x: number, y: number, z: number, yaw = 0, w = 2.2, d = 1.1, withFish = true): number {
  const h = 0.82;
  const parts: THREE.BufferGeometry[] = [];
  const wood = PALETTE.woodHoney;
  for (const cx of [-1, 1]) for (const cz of [-1, 1]) parts.push(place(lowPoly(box(0.1, h - 0.1, 0.1), shade(wood, 0.85)), cx * (w / 2 - 0.1), (h - 0.1) / 2, cz * (d / 2 - 0.1)));
  parts.push(place(lowPoly(box(w, 0.12, d), wood), 0, h - 0.16, 0));
  parts.push(place(lowPoly(box(w - 0.1, 0.02, d - 0.1), 0x8fa7b5, { variance: 0.03 }), 0, h - 0.09, 0));
  // tray rim
  parts.push(place(lowPoly(box(w, 0.1, 0.08), PALETTE.metalBlueGray), 0, h - 0.06, d / 2 - 0.04));
  parts.push(place(lowPoly(box(w, 0.1, 0.08), PALETTE.metalBlueGray), 0, h - 0.06, -d / 2 + 0.04));
  parts.push(place(lowPoly(box(0.08, 0.1, d), PALETTE.metalBlueGray), w / 2 - 0.04, h - 0.06, 0));
  parts.push(place(lowPoly(box(0.08, 0.1, d), PALETTE.metalBlueGray), -w / 2 + 0.04, h - 0.06, 0));
  // crushed ice
  for (let i = 0; i < 18; i++) {
    parts.push(place(lowPoly(ico(rng.range(0.06, 0.1), 0), rng.pick([0xf2f8fb, 0xdfeef5, 0xffffff]), { variance: 0.04 }), rng.range(-w / 2 + 0.2, w / 2 - 0.2), h - 0.07, rng.range(-d / 2 + 0.15, d / 2 - 0.15)));
  }
  parts.push(place(lowPoly(box(0.08, 0.3, 0.6), shade(wood, 0.8)), 0, 0.15, 0));
  // lower shelf
  parts.push(place(lowPoly(box(w - 0.2, 0.06, d - 0.2), shade(wood, 0.9)), 0, 0.22, 0));
  if (withFish) {
    for (let i = 0; i < 5; i++) {
      const col = i % 2 === 0 ? 0xe58d82 : FISH_COLORS.body;
      parts.push(place(displayFish(col), -w / 2 + 0.4 + i * ((w - 0.8) / 4), h - 0.03, rng.range(-0.15, 0.15), rng.range(-0.4, 0.4) + Math.PI / 2 + 0.6));
    }
  }
  group(b, parts, x, y, z, yaw);
  const [hx, hz] = Math.abs(Math.sin(yaw)) > 0.7 ? [d / 2, w / 2] : [w / 2, d / 2];
  b.collider(x - hx, x + hx, y, y + h - 0.04, z - hz, z + hz, false);
  return y + h - 0.04;
}

/** Striped canvas awning. Local: hangs along X, slopes down toward +Z. */
function awningCanvas(w: number, depth: number, drop: number, variant: "coral" | "teal"): THREE.BufferGeometry {
  const stripe = variant === "coral" ? PALETTE.awningCoral : PALETTE.awningTeal;
  const cream = PALETTE.awningCream;
  const stripes = Math.max(4, Math.round(w / 0.32));
  const len = Math.hypot(depth, drop);
  const slope = Math.atan2(drop, depth);
  const canvas = new THREE.BoxGeometry(w, 0.05, len, stripes, 1, 2);
  const painted = lowPoly(
    canvas,
    (c) => {
      const i = Math.floor(((c.x + w / 2) / w) * stripes);
      return i % 2 === 0 ? stripe : cream;
    },
    { variance: 0.035 },
  );
  place(painted, 0, -drop / 2, depth / 2, 0, slope, 0);
  // scalloped valance
  const val: THREE.BufferGeometry[] = [painted];
  const tri = new THREE.ConeGeometry(0.16, 0.22, 3);
  for (let i = 0; i < stripes; i++) {
    const cx = -w / 2 + (i + 0.5) * (w / stripes);
    val.push(place(lowPoly(tri.clone(), i % 2 === 0 ? stripe : cream, { variance: 0.03 }), cx, -drop - 0.12, depth + 0.01, 0, Math.PI, 0, 1, 1, 0.25));
  }
  tri.dispose();
  return merge(val);
}

/**
 * Wall-mounted awning that cats can land on. (x,z) = center of the wall
 * attachment line, face = direction it projects.
 */
export function awning(
  b: LevelBuilder,
  x: number,
  yTop: number,
  z: number,
  face: Face,
  w: number,
  depth: number,
  drop: number,
  variant: "coral" | "teal",
  walkable = true,
): void {
  const yaw = FACE_YAW[face];
  const parts: THREE.BufferGeometry[] = [awningCanvas(w, depth, drop, variant)];
  // iron brackets
  for (const sx of [-1, 1]) {
    parts.push(place(lowPoly(box(0.05, 0.05, depth * 0.95), PALETTE.metalDark), sx * (w / 2 - 0.1), -drop * 0.6, depth * 0.48, 0, Math.atan2(drop * 0.4, depth), 0));
  }
  group(b, parts, x, yTop, z, yaw);
  if (walkable) {
    // Collider: sloped slab following the canvas.
    const [ox, oz] = rot(0, depth / 2, yaw);
    const cx = x + ox;
    const cz = z + oz;
    const len = Math.hypot(depth, drop);
    const slope = Math.atan2(drop, depth);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(slope, yaw, 0, "YXZ"));
    const center = new THREE.Vector3(cx, yTop - drop / 2 - 0.08, cz);
    b.physics.addOrientedBox(center, new THREE.Vector3(w / 2, 0.08, len / 2), q);
  }
}

export function fishStall(b: LevelBuilder, x: number, y: number, z: number, face: Face, variant: "coral" | "teal", w = 2.6, walkableAwning = false): void {
  const yaw = FACE_YAW[face];
  const d = 1.25;
  const counterH = 0.95;
  const parts: THREE.BufferGeometry[] = [];
  const wood = PALETTE.woodHoney;
  // counter body
  parts.push(place(lowPoly(boxUp(w, counterH - 0.12, d), (c) => (Math.sin(c.x * 9) > 0.85 ? shade(wood, 0.82) : wood), { variance: 0.05 }), 0, 0, 0));
  parts.push(place(lowPoly(box(w + 0.1, 0.1, d + 0.1), shade(wood, 1.06)), 0, counterH - 0.07, 0));
  // ice tray with fish
  parts.push(place(lowPoly(box(w - 0.2, 0.06, d - 0.25), 0xe6f1f6, { variance: 0.03 }), 0, counterH - 0.0, 0.05));
  for (let i = 0; i < 6; i++) {
    parts.push(place(displayFish(rng.pick([0xe58d82, FISH_COLORS.body, 0x9fb4c0])), -w / 2 + 0.35 + i * ((w - 0.7) / 5), counterH + 0.02, rng.range(-0.1, 0.25), Math.PI / 2 + rng.range(-0.5, 0.5)));
  }
  // posts
  const postH = 2.35;
  for (const sx of [-1, 1]) {
    parts.push(place(lowPoly(boxUp(0.12, postH, 0.12), shade(wood, 0.85)), sx * (w / 2 - 0.06), 0, -d / 2 + 0.06));
    parts.push(place(lowPoly(boxUp(0.1, postH - 0.25, 0.1), shade(wood, 0.85)), sx * (w / 2 - 0.06), 0, d / 2 + 0.25));
  }
  parts.push(place(lowPoly(box(w, 0.1, 0.1), shade(wood, 0.9)), 0, postH - 0.05, -d / 2 + 0.06));
  // hanging fish under the awning
  for (let i = 0; i < 3; i++) {
    const hx = -w / 2 + 0.5 + i * ((w - 1) / 2);
    const f = displayFish(rng.pick([FISH_COLORS.body, 0x9fb4c0]));
    place(f, 0, 0, 0, 0, 0, Math.PI / 2);
    parts.push(place(f, hx, 1.75, 0.1));
    parts.push(place(lowPoly(box(0.015, 0.25, 0.015), 0x555555), hx, 2.12, 0.1));
  }
  // crates below / beside
  group(b, parts, x, y, z, yaw);
  // awning canvas over the stall
  const [ax, az] = rot(0, -d / 2 + 0.06, yaw);
  awning(b, x + ax, y + postH + 0.05, z + az, face, w + 0.3, d + 0.5, 0.45, variant, walkableAwning);
  // lantern
  const [lx, lz] = rot(w / 2 - 0.15, d / 2 + 0.2, yaw);
  lantern(b, x + lx, y + 1.95, z + lz);
  // chalkboard
  const [cx, cz] = rot(-w / 2 - 0.35, d / 2 + 0.15, yaw);
  aFrameSign(b, x + cx, y, z + cz, yaw + 0.3);
  // collider for counter
  const [hx, hz] = Math.abs(Math.sin(yaw)) > 0.7 ? [d / 2, w / 2] : [w / 2, d / 2];
  b.collider(x - hx, x + hx, y, y + counterH, z - hz, z + hz);
}

export function lantern(b: LevelBuilder, x: number, y: number, z: number): void {
  const frame = merge([
    lowPoly(boxUp(0.22, 0.04, 0.22), PALETTE.metalDark),
    place(lowPoly(cone(0.17, 0.14, 4), PALETTE.metalDark), 0, 0.37, 0, Math.PI / 4),
    place(lowPoly(box(0.02, 0.25, 0.02), PALETTE.metalDark), 0, 0.55, 0),
    place(lowPoly(box(0.025, 0.3, 0.025), PALETTE.metalDark), 0.1, 0.17, 0.1),
    place(lowPoly(box(0.025, 0.3, 0.025), PALETTE.metalDark), -0.1, 0.17, 0.1),
    place(lowPoly(box(0.025, 0.3, 0.025), PALETTE.metalDark), 0.1, 0.17, -0.1),
    place(lowPoly(box(0.025, 0.3, 0.025), PALETTE.metalDark), -0.1, 0.17, -0.1),
  ]);
  b.add(place(frame, x, y, z));
  b.add(place(lowPoly(boxUp(0.16, 0.26, 0.16), 0xffd27a, { variance: 0.02 }), x, y + 0.04, z), "glow");
}

export function wallLamp(b: LevelBuilder, x: number, y: number, z: number, face: Face): void {
  const yaw = FACE_YAW[face];
  const arm = merge([
    lowPoly(box(0.06, 0.06, 0.45), PALETTE.metalDark),
    place(lowPoly(box(0.04, 0.3, 0.04), PALETTE.metalDark), 0, -0.12, -0.16, 0, 0.8, 0),
    place(lowPoly(box(0.18, 0.06, 0.06), PALETTE.metalDark), 0, 0, -0.22),
  ]);
  place(arm, 0, 0, 0.22);
  group(b, [arm], x, y, z, yaw);
  const [ox, oz] = rot(0, 0.42, yaw);
  lantern(b, x + ox, y - 0.42, z + oz);
}

export function lampPost(b: LevelBuilder, x: number, y: number, z: number): void {
  group(
    b,
    [
      lowPoly(cylUp(0.09, 0.14, 0.3, 6), PALETTE.metalDark),
      place(lowPoly(cylUp(0.05, 0.06, 2.1, 6), PALETTE.metalDark), 0, 0.3, 0),
      place(lowPoly(cyl(0.12, 0.08, 0.08, 6), PALETTE.metalDark), 0, 2.4, 0),
    ],
    x,
    y,
    z,
    0,
  );
  lantern(b, x, y + 2.42, z);
  b.collider(x - 0.1, x + 0.1, y, y + 2.4, z - 0.1, z + 0.1, false);
}

export function aFrameSign(b: LevelBuilder, x: number, y: number, z: number, yaw: number): void {
  const parts: THREE.BufferGeometry[] = [];
  for (const sz of [-1, 1]) {
    const board = merge([
      lowPoly(box(0.62, 0.8, 0.05), PALETTE.woodHoney),
      place(lowPoly(box(0.5, 0.62, 0.02), 0x2e3a40), 0, 0.02, sz * 0.03),
      place(lowPoly(sphere(0.1, 5, 3), 0x7fb6c2), -0.04, 0.08, sz * 0.045, 0, 0, 0, 1.8, 0.7, 0.2),
    ]);
    parts.push(place(board, 0, 0.4, sz * 0.14, 0, sz * 0.22, 0));
  }
  group(b, parts, x, y, z, yaw);
}

export function hangingSign(b: LevelBuilder, x: number, y: number, z: number, face: Face): void {
  const yaw = FACE_YAW[face];
  const parts = [
    place(lowPoly(box(0.06, 0.06, 0.9), PALETTE.metalDark), 0, 0, 0.45),
    place(lowPoly(box(0.04, 0.5, 0.04), PALETTE.metalDark), 0, -0.25, 0.85),
    place(lowPoly(box(0.04, 0.9, 0.7), PALETTE.uiNavy), 0, -0.85, 0.5),
    place(lowPoly(sphere(0.14, 5, 3), 0xf1e7d4), 0.03, -0.82, 0.5, 0, 0, 0, 0.3, 0.7, 1.6),
    place(lowPoly(box(0.05, 0.06, 0.5), 0xf1e7d4), 0.03, -1.12, 0.5),
  ];
  group(b, parts, x, y, z, yaw);
}

// --------------------------------------------------------------------- facade detail

export type ShutterColor = "teal" | "coral" | "cream";
const SHUTTER_HEX: Record<ShutterColor, number> = { teal: PALETTE.tealShutter, coral: PALETTE.coralShutter, cream: PALETTE.creamShutter };

/** Window with shutters on a wall plane. (x, y, z) is the window center on the wall surface. */
export function windowUnit(b: LevelBuilder, x: number, y: number, z: number, face: Face, shutter: ShutterColor, open: number, w = 0.9, h = 1.3, flowers = false): void {
  const yaw = FACE_YAW[face];
  const sc = SHUTTER_HEX[shutter];
  const parts: THREE.BufferGeometry[] = [
    place(lowPoly(box(w + 0.22, h + 0.22, 0.08), PALETTE.stoneCream, { variance: 0.03 }), 0, 0, 0.02),
    place(lowPoly(box(w, h, 0.06), PALETTE.windowGlass, { variance: 0.06 }), 0, 0, 0.04),
    place(lowPoly(box(0.05, h, 0.04), PALETTE.creamShutter), 0, 0, 0.09),
    place(lowPoly(box(w, 0.05, 0.04), PALETTE.creamShutter), 0, h * 0.15, 0.09),
    place(lowPoly(box(w + 0.36, 0.1, 0.22), shade(PALETTE.stoneCream, 0.95)), 0, -h / 2 - 0.12, 0.08),
  ];
  // shutters (open fraction swings them out)
  for (const sx of [-1, 1]) {
    const sh = lowPoly(box(w / 2, h, 0.05, 1, 4, 1), (c) => (Math.abs(((c.y + h) * 8) % 1) < 0.25 ? shade(sc, 0.85) : sc), { variance: 0.04 });
    // hinge on the outer edge, swing outward from the wall
    sh.translate((-sx * w) / 4, 0, 0);
    sh.rotateY(sx * open * 2.6);
    sh.translate((sx * w) / 2, 0, 0.1);
    parts.push(sh);
  }
  if (flowers) {
    parts.push(place(lowPoly(boxUp(w + 0.1, 0.22, 0.26), PALETTE.potTerracotta), 0, -h / 2 - 0.4, 0.2));
    for (let i = 0; i < 4; i++) {
      parts.push(place(lowPoly(ico(0.15, 0), PALETTE.leaf, { jitter: 0.03, seed: i }), -w / 2 + 0.15 + i * (w / 3.2), -h / 2 - 0.12, 0.22));
      parts.push(place(lowPoly(ico(0.07, 0), rng.pick([PALETTE.flowerPink, PALETTE.flowerWhite, PALETTE.flowerPeach])), -w / 2 + 0.15 + i * (w / 3.2), -h / 2 - 0.02, 0.3));
    }
  }
  group(b, parts, x, y, z, yaw);
}

export function door(b: LevelBuilder, x: number, y: number, z: number, face: Face, color: number = PALETTE.doorTeal, arched = true): void {
  const yaw = FACE_YAW[face];
  const w = 1.25;
  const h = 2.35;
  const parts: THREE.BufferGeometry[] = [
    place(lowPoly(box(w + 0.3, h + 0.2, 0.08), PALETTE.stoneSand, { variance: 0.03 }), 0, h / 2 + 0.05, 0.02),
    place(lowPoly(box(w, h, 0.08, 2, 1, 1), (c) => (Math.abs(c.x) < 0.02 ? shade(color, 0.8) : color), { variance: 0.05 }), 0, h / 2, 0.05),
    place(lowPoly(box(w + 0.4, 0.14, 0.4), PALETTE.stoneSand), 0, 0.07, 0.2),
  ];
  if (arched) parts.push(place(lowPoly(cyl(w / 2, w / 2, 0.08, 8, 1), color), 0, h, 0.05, 0, Math.PI / 2, 0, 1, 1, 1));
  group(b, parts, x, y, z, yaw);
}

export function pot(b: LevelBuilder, x: number, y: number, z: number, size = 1, plant: "flower" | "leafy" | "none" = "flower", collider = false, cream = false): void {
  const s = size;
  const col = cream ? PALETTE.potCream : PALETTE.potTerracotta;
  const parts: THREE.BufferGeometry[] = [
    lowPoly(cylUp(0.3 * s, 0.22 * s, 0.45 * s, 8), col, { variance: 0.05 }),
    place(lowPoly(cyl(0.33 * s, 0.33 * s, 0.08 * s, 8), shade(col, 1.08)), 0, 0.45 * s, 0),
  ];
  if (plant !== "none") {
    const n = plant === "leafy" ? 5 : 4;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      parts.push(place(lowPoly(ico(0.17 * s, 0), i % 2 ? PALETTE.leaf : PALETTE.leafDark, { jitter: 0.03 * s, seed: i }), Math.cos(a) * 0.12 * s, 0.6 * s + rng.range(0, 0.1) * s, Math.sin(a) * 0.12 * s));
    }
    parts.push(place(lowPoly(ico(0.2 * s, 0), PALETTE.leafLight, { jitter: 0.03 }), 0, 0.72 * s, 0));
    if (plant === "flower") {
      const fc = rng.pick([PALETTE.flowerPink, PALETTE.flowerWhite, PALETTE.flowerPeach, PALETTE.flowerMagenta]);
      for (let i = 0; i < 5; i++) {
        const a = rng.range(0, Math.PI * 2);
        parts.push(place(lowPoly(ico(0.07 * s, 0), fc), Math.cos(a) * 0.17 * s, 0.82 * s + rng.range(-0.05, 0.08) * s, Math.sin(a) * 0.17 * s));
      }
    }
  }
  group(b, parts, x, y, z, rng.range(0, 3));
  if (collider) b.collider(x - 0.3 * s, x + 0.3 * s, y, y + 0.5 * s, z - 0.3 * s, z + 0.3 * s, false);
}

export function planterBox(b: LevelBuilder, x: number, y: number, z: number, len: number, yaw: number, collider = true, color: number = PALETTE.potCream): void {
  const parts: THREE.BufferGeometry[] = [lowPoly(boxUp(len, 0.55, 0.6), color, { variance: 0.04 }), place(lowPoly(box(len + 0.08, 0.08, 0.68), shade(color, 1.05)), 0, 0.55, 0)];
  const n = Math.max(2, Math.round(len / 0.45));
  for (let i = 0; i < n; i++) {
    const px = -len / 2 + 0.25 + i * ((len - 0.5) / Math.max(1, n - 1));
    parts.push(place(lowPoly(ico(0.24, 0), i % 2 ? PALETTE.leaf : PALETTE.leafDark, { jitter: 0.05, seed: i }), px, 0.7, rng.range(-0.1, 0.1)));
    if (rng.chance(0.6)) parts.push(place(lowPoly(ico(0.08, 0), rng.pick([PALETTE.flowerPink, PALETTE.flowerWhite, PALETTE.flowerPeach])), px + 0.1, 0.9, 0.12));
  }
  group(b, parts, x, y, z, yaw);
  if (collider) {
    const [hx, hz] = Math.abs(Math.sin(yaw)) > 0.7 ? [0.3, len / 2] : [len / 2, 0.3];
    b.collider(x - hx, x + hx, y, y + 0.6, z - hz, z + hz);
  }
}

/** Bougainvillea climbing a wall: pink flower clusters + leaves. */
export function bougainvillea(b: LevelBuilder, x: number, y: number, z: number, face: Face, w: number, h: number, density = 1): void {
  const yaw = FACE_YAW[face];
  const parts: THREE.BufferGeometry[] = [];
  const n = Math.round(((w * h) / 0.35) * density);
  for (let i = 0; i < n; i++) {
    const lx = rng.range(-w / 2, w / 2);
    const ly = rng.range(0, h) * Math.pow(rng.next(), 0.3);
    const r = rng.range(0.12, 0.26);
    const flower = rng.chance(0.55);
    parts.push(place(lowPoly(ico(r, 0), flower ? rng.pick([PALETTE.flowerPink, PALETTE.flowerMagenta, 0xf27cb5]) : rng.pick([PALETTE.leaf, PALETTE.leafDark]), { jitter: r * 0.2, seed: i, variance: 0.06 }), lx, ly, 0.12 + rng.range(0, 0.15)));
  }
  // stem
  parts.push(place(lowPoly(box(0.08, h, 0.08), PALETTE.trunk), rng.range(-w / 4, w / 4), h / 2, 0.06));
  group(b, parts, x, y, z, yaw);
}

export function vine(b: LevelBuilder, x: number, y: number, z: number, face: Face, h: number): void {
  const yaw = FACE_YAW[face];
  const parts: THREE.BufferGeometry[] = [];
  const n = Math.round(h * 4);
  for (let i = 0; i < n; i++) {
    parts.push(place(lowPoly(ico(rng.range(0.1, 0.2), 0), rng.pick([PALETTE.leaf, PALETTE.leafDark, PALETTE.leafLight]), { jitter: 0.03, seed: i }), rng.range(-0.3, 0.3) + Math.sin(i) * 0.2, (i / n) * h, 0.12));
  }
  group(b, parts, x, y, z, yaw);
}

export function balcony(b: LevelBuilder, x: number, y: number, z: number, face: Face, w = 1.8, collider = true, flowers = true): void {
  const yaw = FACE_YAW[face];
  const d = 0.75;
  const parts: THREE.BufferGeometry[] = [
    place(lowPoly(box(w, 0.16, d), PALETTE.stoneCream, { variance: 0.03 }), 0, 0, d / 2),
    place(lowPoly(box(w * 0.8, 0.12, d * 0.6), shade(PALETTE.stoneCream, 0.9)), 0, -0.14, d / 3),
    place(lowPoly(box(w, 0.04, 0.04), PALETTE.metalDark), 0, 0.62, d - 0.02),
    place(lowPoly(box(0.04, 0.04, d), PALETTE.metalDark), w / 2 - 0.02, 0.62, d / 2),
    place(lowPoly(box(0.04, 0.04, d), PALETTE.metalDark), -w / 2 + 0.02, 0.62, d / 2),
  ];
  const bars = Math.round(w / 0.16);
  for (let i = 0; i <= bars; i++) parts.push(place(lowPoly(box(0.025, 0.6, 0.025), PALETTE.metalDark), -w / 2 + (i * w) / bars, 0.38, d - 0.02));
  if (flowers) {
    for (let i = 0; i < 2; i++) {
      const px = (i === 0 ? -1 : 1) * (w / 2 - 0.3);
      parts.push(place(lowPoly(cylUp(0.15, 0.11, 0.24, 7), PALETTE.potTerracotta), px, 0.08, d * 0.45));
      parts.push(place(lowPoly(ico(0.16, 0), PALETTE.leaf, { jitter: 0.03 }), px, 0.42, d * 0.45));
      parts.push(place(lowPoly(ico(0.07, 0), PALETTE.flowerPink), px + 0.06, 0.55, d * 0.5));
    }
  }
  group(b, parts, x, y, z, yaw);
  if (collider) {
    const [ox, oz] = rot(0, d / 2, yaw);
    const [hx, hz] = Math.abs(Math.sin(yaw)) > 0.7 ? [d / 2, w / 2] : [w / 2, d / 2];
    b.collider(x + ox - hx, x + ox + hx, y - 0.08, y + 0.08, z + oz - hz, z + oz + hz);
  }
}

export function acUnit(b: LevelBuilder, x: number, y: number, z: number, face: Face, collider = true, wall = false): number {
  const yaw = FACE_YAW[face];
  const w = 1.2;
  const h = 0.95;
  const d = 0.62;
  const parts: THREE.BufferGeometry[] = [
    place(lowPoly(boxUp(w, h, d), 0xe9e3d6, { variance: 0.03 }), 0, 0, 0),
    place(lowPoly(cyl(0.34, 0.34, 0.04, 10), 0x6d6a66), -0.18, h * 0.5, d / 2 + 0.01, 0, Math.PI / 2, 0),
  ];
  for (let i = -2; i <= 2; i++) parts.push(place(lowPoly(box(0.62, 0.025, 0.03), 0x9a958d), -0.18, h * 0.5 + i * 0.1, d / 2 + 0.03));
  for (let i = 0; i < 6; i++) parts.push(place(lowPoly(box(0.2, 0.03, 0.02), 0xc8c1b4), 0.38, 0.2 + i * 0.1, d / 2 + 0.01));
  if (!wall) {
    for (const sx of [-1, 1]) parts.push(place(lowPoly(box(0.08, 0.12, d + 0.1), PALETTE.metalDark), sx * 0.45, -0.06, 0));
  } else {
    parts.push(place(lowPoly(box(0.06, 0.06, 0.55), PALETTE.metalDark), -0.4, -0.08, -0.15));
    parts.push(place(lowPoly(box(0.06, 0.06, 0.55), PALETTE.metalDark), 0.4, -0.08, -0.15));
  }
  parts.push(place(lowPoly(box(0.05, 0.05, 0.4), 0x8a8f94), 0.5, 0.1, -0.3));
  group(b, parts, x, y, z, yaw);
  if (collider) {
    const [hx, hz] = Math.abs(Math.sin(yaw)) > 0.7 ? [d / 2, w / 2] : [w / 2, d / 2];
    b.collider(x - hx, x + hx, y - (wall ? 0 : 0.12), y + h, z - hz, z + hz);
  }
  return y + h;
}

export function waterTank(b: LevelBuilder, x: number, y: number, z: number, collider = true): void {
  const r = 0.85;
  const h = 1.7;
  const parts: THREE.BufferGeometry[] = [
    place(lowPoly(boxUp(1.9, 0.3, 0.35), PALETTE.stoneSand), 0, 0, -0.5),
    place(lowPoly(boxUp(1.9, 0.3, 0.35), PALETTE.stoneSand), 0, 0, 0.5),
    place(lowPoly(cylUp(r, r, h, 10, 3), (c) => (Math.abs(c.y - h * 0.33) < 0.05 || Math.abs(c.y - h * 0.66) < 0.05 ? shade(PALETTE.metalBlueGray, 0.85) : PALETTE.metalBlueGray), { variance: 0.05 }), 0, 0.3, 0),
    place(lowPoly(cone(r * 1.02, 0.32, 10), shade(PALETTE.metalBlueGray, 1.08)), 0, 0.3 + h + 0.16, 0),
    place(lowPoly(cyl(0.18, 0.18, 0.12, 8), PALETTE.metalDark), 0, 0.3 + h + 0.36, 0),
    place(lowPoly(box(0.08, 0.08, 0.5), PALETTE.rust), r + 0.1, 0.6, 0, Math.PI / 2),
  ];
  group(b, parts, x, y, z, rng.range(0, 3));
  if (collider) b.collider(x - r, x + r, y, y + h + 0.45, z - r, z + r);
}

export function antenna(b: LevelBuilder, x: number, y: number, z: number, h = 2.6): void {
  const parts: THREE.BufferGeometry[] = [
    lowPoly(boxUp(0.3, 0.12, 0.3), PALETTE.metalDark),
    place(lowPoly(cylUp(0.035, 0.045, h, 5), PALETTE.metalDark), 0, 0.1, 0),
    place(lowPoly(box(1.1, 0.04, 0.04), PALETTE.metalDark), 0, h * 0.82, 0),
  ];
  for (let i = 0; i < 6; i++) parts.push(place(lowPoly(box(0.03, 0.03, 0.5 - i * 0.04), PALETTE.metalDark), -0.5 + i * 0.2, h * 0.82, 0));
  parts.push(place(lowPoly(box(0.8, 0.035, 0.035), PALETTE.metalDark), 0, h * 0.62, 0));
  for (let i = 0; i < 4; i++) parts.push(place(lowPoly(box(0.03, 0.03, 0.36), PALETTE.metalDark), -0.36 + i * 0.24, h * 0.62, 0));
  group(b, parts, x, y, z, rng.range(0, 3));
  b.collider(x - 0.08, x + 0.08, y, y + h, z - 0.08, z + 0.08, false);
}

export function satelliteDish(b: LevelBuilder, x: number, y: number, z: number, yaw: number): void {
  const dish = lowPoly(new THREE.SphereGeometry(0.65, 9, 4, 0, Math.PI * 2, 0, Math.PI * 0.32), 0xe8e2d6, { variance: 0.04 });
  dish.rotateX(-Math.PI / 2 + 0.6);
  const parts: THREE.BufferGeometry[] = [
    lowPoly(boxUp(0.32, 0.12, 0.32), PALETTE.metalDark),
    place(lowPoly(cylUp(0.05, 0.06, 0.9, 6), PALETTE.metalDark), 0, 0.1, 0),
    place(dish, 0, 1.3, 0.05),
    place(lowPoly(box(0.04, 0.04, 0.6), PALETTE.metalDark), 0, 1.25, 0.32, 0, -0.5, 0),
    place(lowPoly(box(0.1, 0.1, 0.1), PALETTE.metalDark), 0, 1.38, 0.6),
  ];
  group(b, parts, x, y, z, yaw);
  b.collider(x - 0.15, x + 0.15, y, y + 1.0, z - 0.15, z + 0.15, false);
}

export function chimney(b: LevelBuilder, x: number, y: number, z: number, tall = false, collider = true): void {
  const h = tall ? 1.7 : 0.95;
  const parts: THREE.BufferGeometry[] = [
    lowPoly(boxUp(0.55, h, 0.55, 1, 3, 1), (c) => (c.y < h * 0.5 ? PALETTE.stoneCream : shade(PALETTE.stoneCream, 0.95)), { variance: 0.05 }),
    place(lowPoly(box(0.68, 0.12, 0.68), PALETTE.terracottaDark), 0, h + 0.06, 0),
    place(lowPoly(prism(0.6, 0.26, 0.6), PALETTE.terracotta), 0, h + 0.28, 0),
    place(lowPoly(box(0.12, 0.2, 0.62), PALETTE.terracottaDark), 0, h + 0.2, 0),
  ];
  group(b, parts, x, y, z, rng.range(-0.2, 0.2));
  if (collider) b.collider(x - 0.28, x + 0.28, y, y + h, z - 0.28, z + 0.28);
}

export function ventPipe(b: LevelBuilder, x: number, y: number, z: number): void {
  group(b, [lowPoly(cylUp(0.11, 0.11, 0.8, 7), PALETTE.metalBlueGray), place(lowPoly(cone(0.24, 0.18, 7), PALETTE.metalBlueGray), 0, 0.92, 0)], x, y, z, 0);
}

export function drainPipe(b: LevelBuilder, x: number, y0: number, y1: number, z: number, face: Face): void {
  const yaw = FACE_YAW[face];
  const h = y1 - y0;
  const parts: THREE.BufferGeometry[] = [place(lowPoly(cylUp(0.07, 0.07, h, 6), PALETTE.metalBlueGray), 0, 0, 0.12)];
  for (let yy = 0.6; yy < h; yy += 1.4) parts.push(place(lowPoly(box(0.2, 0.06, 0.16), PALETTE.metalDark), 0, yy, 0.08));
  group(b, parts, x, y0, z, yaw);
}

export function bench(b: LevelBuilder, x: number, y: number, z: number, yaw: number): void {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) parts.push(place(lowPoly(box(1.9, 0.07, 0.16), PALETTE.woodHoney), 0, 0.55, -0.18 + i * 0.18));
  for (let i = 0; i < 2; i++) parts.push(place(lowPoly(box(1.9, 0.07, 0.14), PALETTE.woodHoney), 0, 0.82 + i * 0.18, -0.32, 0, -0.2, 0));
  for (const sx of [-1, 1]) {
    parts.push(place(lowPoly(box(0.07, 0.55, 0.5), PALETTE.metalDark), sx * 0.8, 0.27, 0));
    parts.push(place(lowPoly(box(0.07, 0.5, 0.07), PALETTE.metalDark), sx * 0.8, 0.8, -0.32, 0, -0.2, 0));
  }
  group(b, parts, x, y, z, yaw);
  const [hx, hz] = Math.abs(Math.sin(yaw)) > 0.7 ? [0.3, 0.95] : [0.95, 0.3];
  b.collider(x - hx, x + hx, y, y + 0.6, z - hz, z + hz);
}

export function scooter(b: LevelBuilder, x: number, y: number, z: number, yaw: number): void {
  const teal = 0x4a9a95;
  const parts: THREE.BufferGeometry[] = [
    // body
    place(lowPoly(sphere(0.6, 8, 5), teal, { variance: 0.04 }), -0.45, 0.62, 0, 0, 0, 0, 1.25, 0.75, 0.75),
    place(lowPoly(box(1.3, 0.16, 0.5), teal), 0.15, 0.36, 0),
    // seat
    place(lowPoly(sphere(0.38, 7, 4), 0xe9dcc0), -0.45, 1.02, 0, 0, 0, 0, 1.4, 0.45, 0.85),
    // front shield + column
    place(lowPoly(box(0.18, 0.9, 0.55), teal), 0.82, 0.8, 0, 0, 0, -0.25),
    place(lowPoly(cylUp(0.05, 0.05, 0.5, 6), PALETTE.metalDark), 0.95, 1.15, 0, 0, 0, -0.2),
    place(lowPoly(box(0.08, 0.06, 0.85), PALETTE.metalDark), 1.05, 1.62, 0),
    place(lowPoly(sphere(0.12, 6, 4), 0xfff1c8), 1.1, 1.42, 0),
    // wheels
    place(lowPoly(cyl(0.32, 0.32, 0.18, 10), 0x2d2d2d), -0.55, 0.32, 0, 0, Math.PI / 2, 0),
    place(lowPoly(cyl(0.32, 0.32, 0.18, 10), 0x2d2d2d), 1.05, 0.32, 0, 0, Math.PI / 2, 0),
    place(lowPoly(cyl(0.17, 0.17, 0.2, 8), 0x9a9a9a), -0.55, 0.32, 0, 0, Math.PI / 2, 0),
    place(lowPoly(cyl(0.17, 0.17, 0.2, 8), 0x9a9a9a), 1.05, 0.32, 0, 0, Math.PI / 2, 0),
    place(lowPoly(sphere(0.36, 7, 3, ), teal), 1.05, 0.55, 0, 0, 0, 0, 1, 0.5, 0.65),
  ];
  group(b, parts, x, y, z, yaw);
  b.colliderRot(x, y + 0.55, z, 1.0, 0.55, 0.32, yaw);
}

export function tree(b: LevelBuilder, x: number, y: number, z: number, s = 1): void {
  const parts: THREE.BufferGeometry[] = [
    place(lowPoly(cylUp(0.32 * s, 0.48 * s, 2.6 * s, 7), PALETTE.trunk, { jitter: 0.04 }), 0, 0, 0),
    place(lowPoly(cylUp(0.14 * s, 0.24 * s, 1.4 * s, 6), PALETTE.trunk), 0.5 * s, 2.0 * s, 0.2 * s, 0, 0, -0.6),
    place(lowPoly(cylUp(0.14 * s, 0.22 * s, 1.3 * s, 6), PALETTE.trunk), -0.4 * s, 2.1 * s, -0.3 * s, 0, 0.3, 0.5),
  ];
  const blobs = [
    [0, 3.9, 0, 1.9],
    [1.4, 3.6, 0.4, 1.4],
    [-1.3, 3.7, -0.5, 1.45],
    [0.3, 4.9, -0.4, 1.3],
    [-0.4, 3.4, 1.2, 1.2],
    [0.6, 3.3, -1.3, 1.15],
  ];
  blobs.forEach(([bx, by, bz, r], i) => {
    parts.push(place(lowPoly(ico(r * s, 1), i % 2 === 0 ? PALETTE.leaf : PALETTE.leafLight, { jitter: 0.22 * s, seed: 70 + i, variance: 0.09 }), bx * s, by * s, bz * s));
  });
  group(b, parts, x, y, z, rng.range(0, 3));
  b.collider(x - 0.45 * s, x + 0.45 * s, y, y + 2.6 * s, z - 0.45 * s, z + 0.45 * s);
}

export function fountain(b: LevelBuilder, x: number, y: number, z: number, radius: number): void {
  const parts: THREE.BufferGeometry[] = [];
  const segs = 12;
  // basin rim
  parts.push(lowPoly(cylUp(radius, radius + 0.1, 0.55, segs, 1), PALETTE.stoneCream, { variance: 0.04 }));
  parts.push(place(lowPoly(cyl(radius + 0.18, radius + 0.18, 0.12, segs), shade(PALETTE.stoneCream, 1.05)), 0, 0.6, 0));
  // water surface
  parts.push(place(lowPoly(cyl(radius - 0.25, radius - 0.25, 0.04, segs), PALETTE.seaShallow, { variance: 0.08 }), 0, 0.42, 0));
  // pedestal + bowls
  parts.push(place(lowPoly(cylUp(0.45, 0.6, 1.1, 8), PALETTE.stoneCream), 0, 0.4, 0));
  parts.push(place(lowPoly(cylUp(1.25, 0.5, 0.35, 10), shade(PALETTE.stoneCream, 1.04)), 0, 1.45, 0));
  parts.push(place(lowPoly(cyl(1.05, 1.05, 0.05, 10), PALETTE.seaShallow), 0, 1.78, 0));
  parts.push(place(lowPoly(cylUp(0.25, 0.32, 0.7, 7), PALETTE.stoneCream), 0, 1.75, 0));
  parts.push(place(lowPoly(cylUp(0.65, 0.3, 0.25, 9), shade(PALETTE.stoneCream, 1.04)), 0, 2.4, 0));
  parts.push(place(lowPoly(ico(0.42, 1), PALETTE.stoneCream), 0, 3.0, 0));
  group(b, parts, x, y, z, 0);
  // rim collider ring as 8 boxes so cats can hop on the rim
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const cx = x + Math.cos(a) * radius;
    const cz = z + Math.sin(a) * radius;
    b.colliderRot(cx, y + 0.33, cz, 0.3, 0.33, radius * 0.42, -a);
  }
  // water floor + pedestal
  b.collider(x - radius + 0.2, x + radius - 0.2, y, y + 0.42, z - radius + 0.2, z + radius - 0.2);
  b.collider(x - 0.55, x + 0.55, y, y + 1.6, z - 0.55, z + 0.55);
  b.collider(x - 1.2, x + 1.2, y + 1.45, y + 1.8, z - 1.2, z + 1.2);
}

export function bunting(b: LevelBuilder, ax: number, ay: number, az: number, bx: number, by: number, bz: number): void {
  const parts: THREE.BufferGeometry[] = [];
  const len = Math.hypot(bx - ax, bz - az);
  const n = Math.max(3, Math.round(len / 0.8));
  const yaw = Math.atan2(bx - ax, bz - az);
  const cols = [PALETTE.awningCoral, PALETTE.clothBlue, PALETTE.awningCream, PALETTE.awningTeal];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const sag = Math.sin(t * Math.PI) * 0.5;
    const px = ax + (bx - ax) * t;
    const py = ay + (by - ay) * t - sag;
    const pz = az + (bz - az) * t;
    if (i < n) {
      const t2 = (i + 1) / n;
      const qx = ax + (bx - ax) * t2;
      const qy = ay + (by - ay) * t2 - Math.sin(t2 * Math.PI) * 0.5;
      const qz = az + (bz - az) * t2;
      const seg = Math.hypot(qx - px, qy - py, qz - pz);
      const g = lowPoly(box(0.025, 0.025, seg), 0x6b5a48);
      g.lookAt(new THREE.Vector3(qx - px, qy - py, qz - pz));
      place(g, (px + qx) / 2, (py + qy) / 2, (pz + qz) / 2);
      parts.push(g);
      const flag = lowPoly(cone(0.22, 0.5, 3), cols[i % cols.length], { variance: 0.03 });
      place(flag, 0, 0, 0, 0, Math.PI, 0, 1, 1, 0.12);
      place(flag, (px + qx) / 2, (py + qy) / 2 - 0.28, (pz + qz) / 2, yaw + Math.PI / 2);
      parts.push(flag);
    }
  }
  b.add(merge(parts));
}

export function staticLaundry(b: LevelBuilder, ax: number, ay: number, az: number, bx: number, bz: number, items: number[]): void {
  const parts: THREE.BufferGeometry[] = [];
  const yaw = Math.atan2(bx - ax, bz - az);
  const len = Math.hypot(bx - ax, bz - az);
  const rope = lowPoly(box(0.025, 0.025, len), 0xd8c8a8);
  place(rope, (ax + bx) / 2, ay, (az + bz) / 2, yaw);
  parts.push(rope);
  const step = len / (items.length + 1);
  items.forEach((col, i) => {
    const t = (step * (i + 1)) / len;
    const px = ax + (bx - ax) * t;
    const pz = az + (bz - az) * t;
    const w = rng.range(0.45, 0.8);
    const h = rng.range(0.5, 0.95);
    parts.push(place(lowPoly(box(w, h, 0.03, 2, 2, 1), col, { variance: 0.05, jitter: 0.02 }), px, ay - h / 2 - 0.02, pz, yaw + Math.PI / 2));
  });
  b.add(merge(parts));
}

export function parapet(b: LevelBuilder, x0: number, x1: number, z0: number, z1: number, y: number, h = 0.42, color: number = PALETTE.stoneCream): void {
  b.block(x0, x1, y, y + h, z0, z1, color, { variance: 0.04 });
  const len = Math.max(Math.abs(x1 - x0), Math.abs(z1 - z0));
  // cap stones
  const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
  b.add(
    lowPoly(
      place(box(alongX ? len + 0.08 : Math.abs(x1 - x0) + 0.12, 0.07, alongX ? Math.abs(z1 - z0) + 0.12 : len + 0.08, alongX ? Math.max(1, Math.round(len / 0.8)) : 1, 1, alongX ? 1 : Math.max(1, Math.round(len / 0.8))), (x0 + x1) / 2, y + h + 0.035, (z0 + z1) / 2),
      shade(color, 1.06),
      { variance: 0.05 },
    ),
  );
}

export function rock(b: LevelBuilder, x: number, y: number, z: number, s: number, collider = false): void {
  b.add(place(lowPoly(ico(s, 0), rng.pick([PALETTE.cliff, PALETTE.cliffDark, shade(PALETTE.cliff, 1.08)]), { jitter: s * 0.18, seed: Math.floor(x * 7 + z), variance: 0.07 }), x, y, z, rng.range(0, 3), 0, 0, 1, rng.range(0.7, 1.2), 1));
  if (collider) b.collider(x - s * 0.7, x + s * 0.7, y - s, y + s * 0.8, z - s * 0.7, z + s * 0.7);
}

export function boat(b: LevelBuilder, x: number, y: number, z: number, yaw: number): void {
  const hull = lowPoly(place(sphere(1, 8, 4, ), 0, 0, 0, 0, 0, 0, 0.75, 0.42, 1.9), (c) => (c.y > 0.12 ? PALETTE.awningCream : c.y > -0.05 ? PALETTE.tealShutter : 0xf3ecdf), { variance: 0.04 });
  const parts: THREE.BufferGeometry[] = [hull, place(lowPoly(box(1.2, 0.08, 0.3), PALETTE.woodHoney), 0, 0.2, 0.3), place(lowPoly(box(1.2, 0.08, 0.3), PALETTE.woodHoney), 0, 0.2, -0.6)];
  group(b, parts, x, y, z, yaw);
}

export function pergola(b: LevelBuilder, x: number, y: number, z: number, w: number, d: number, h: number): void {
  const parts: THREE.BufferGeometry[] = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(place(lowPoly(boxUp(0.16, h, 0.16), PALETTE.woodHoney), (sx * w) / 2, 0, (sz * d) / 2));
  for (const sz of [-1, 1]) parts.push(place(lowPoly(box(w + 0.5, 0.16, 0.14), PALETTE.woodHoney), 0, h, (sz * d) / 2));
  const slats = Math.round(w / 0.45);
  for (let i = 0; i <= slats; i++) parts.push(place(lowPoly(box(0.1, 0.12, d + 0.6), shade(PALETTE.woodHoney, 1.05)), -w / 2 + (i * w) / slats, h + 0.14, 0));
  // vines over the top
  for (let i = 0; i < 12; i++) parts.push(place(lowPoly(ico(rng.range(0.2, 0.35), 0), rng.pick([PALETTE.leaf, PALETTE.leafDark, PALETTE.flowerPink]), { jitter: 0.06, seed: i }), rng.range(-w / 2, w / 2), h + 0.25, rng.range(-d / 2, d / 2)));
  group(b, parts, x, y, z, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.collider(x + (sx * w) / 2 - 0.08, x + (sx * w) / 2 + 0.08, y, y + h, z + (sz * d) / 2 - 0.08, z + (sz * d) / 2 + 0.08, false);
}

export function cushionBed(b: LevelBuilder, x: number, y: number, z: number, yaw: number): void {
  const parts: THREE.BufferGeometry[] = [
    lowPoly(boxUp(2.6, 0.3, 1.3), PALETTE.woodHoney),
    place(lowPoly(boxUp(2.5, 0.22, 1.2, 3, 1, 2), PALETTE.cushionTeal, { variance: 0.06, jitter: 0.02 }), 0, 0.3, 0),
    place(lowPoly(sphere(0.32, 6, 4), PALETTE.awningCoral), -0.8, 0.62, -0.38, 0, 0, 0, 1.2, 0.6, 0.6),
    place(lowPoly(sphere(0.3, 6, 4), PALETTE.awningCream), 0.5, 0.6, -0.42, 0, 0, 0, 1.2, 0.6, 0.6),
    place(lowPoly(boxUp(2.6, 0.55, 0.18), PALETTE.woodHoney), 0, 0.3, -0.6),
  ];
  group(b, parts, x, y, z, yaw);
}

export function rug(b: LevelBuilder, x: number, y: number, z: number, w: number, d: number): void {
  b.add(place(lowPoly(box(w, 0.03, d, 4, 1, 3), (c) => (Math.abs(c.x) > w / 2 - 0.25 || Math.abs(c.z) > d / 2 - 0.25 ? PALETTE.awningCoral : PALETTE.awningCream), { variance: 0.05 }), x, y + 0.015, z));
}

/** Gable or hip-style terracotta roof over a footprint. */
export function tileRoof(b: LevelBuilder, x0: number, x1: number, z0: number, z1: number, y: number, ridgeAlongX: boolean, color: number = PALETTE.terracotta): void {
  const w = Math.abs(x1 - x0) + 0.5;
  const d = Math.abs(z1 - z0) + 0.5;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const span = ridgeAlongX ? d : w;
  const len = ridgeAlongX ? w : d;
  const h = Math.min(2.2, span * 0.35);
  const rows = Math.max(3, Math.round(span / 0.45));
  const g = lowPoly(
    prism(span, h, len),
    (c, n) => {
      if (n.z > 0.9 || n.z < -0.9) return shade(color, 0.9);
      const band = Math.floor((c.x + span) / (span / rows));
      return band % 2 === 0 ? color : shade(color, 0.88);
    },
    { variance: 0.06 },
  );
  // ridge cap
  const cap = lowPoly(box(0.22, 0.16, len + 0.1), shade(color, 0.82));
  place(cap, 0, h, 0);
  const merged = merge([g, cap]);
  place(merged, cx, y, cz, ridgeAlongX ? Math.PI / 2 : 0);
  b.add(merged);
}

export function domeTower(b: LevelBuilder, x: number, y: number, z: number): void {
  const parts: THREE.BufferGeometry[] = [
    lowPoly(boxUp(3.2, 8, 3.2, 2, 6, 2), PALETTE.stoneCream, { variance: 0.05 }),
    place(lowPoly(boxUp(3.6, 0.3, 3.6), shade(PALETTE.stoneCream, 1.06)), 0, 8, 0),
    place(lowPoly(boxUp(2.6, 2.6, 2.6), PALETTE.stoneWarm), 0, 8.3, 0),
    place(lowPoly(new THREE.SphereGeometry(1.7, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), PALETTE.domeBlue, { variance: 0.06 }), 0, 10.9, 0),
    place(lowPoly(cylUp(0.06, 0.06, 1.0, 5), PALETTE.metalDark), 0, 12.5, 0),
    place(lowPoly(box(0.5, 0.06, 0.06), PALETTE.metalDark), 0, 13.2, 0),
  ];
  // bell openings
  for (const f of ["n", "s", "e", "w"] as Face[]) {
    const yaw = FACE_YAW[f];
    const [ox, oz] = rot(0, 1.31, yaw);
    const op = lowPoly(boxUp(1.0, 1.5, 0.1), 0x3a3330);
    place(op, ox, 8.8, oz, yaw);
    parts.push(op);
  }
  group(b, parts, x, y, z, 0);
  b.collider(x - 1.6, x + 1.6, y, y + 8.3, z - 1.6, z + 1.6);
}
