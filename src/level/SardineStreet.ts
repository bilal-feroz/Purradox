import * as THREE from "three";
import { PALETTE } from "../data/palette";
import { COASTLINE, FOUNTAIN, H, SPAWN } from "../data/level";
import { Random, hash3 } from "../core/Random";
import { archFrame, box, flatPoly, lowPoly, place, shade, type ColorFn } from "../rendering/LowPoly";
import type { Materials } from "../rendering/Materials";
import type { PhysicsWorld } from "../physics/PhysicsWorld";
import { LevelBuilder } from "./LevelBuilder";
import * as P from "./Props";
import type { Face, ShutterColor } from "./Props";

const rng = new Random(20261003);

const FACADES = [PALETTE.stoneCream, PALETTE.stoneWarm, PALETTE.stoneSand, PALETTE.plasterPeach, PALETTE.stoneCream, PALETTE.plasterOchre, PALETTE.stoneWarm, PALETTE.plasterCoral];
const SHUTTERS: ShutterColor[] = ["teal", "teal", "coral", "cream", "teal"];

/** Stone block coloring for walls (per-cell variation + base course). */
function stone(base: number, groundY: number): ColorFn {
  return (c, n) => {
    if (n.y > 0.6) return shade(base, 1.03);
    if (n.y < -0.6) return shade(base, 0.85);
    const u = Math.abs(n.x) > 0.5 ? c.z : c.x;
    const row = Math.floor((c.y - groundY) / 0.55);
    const col = Math.floor((u + (row % 2) * 0.55) / 1.1);
    const h = hash3(col, row, base & 255);
    let k = 0.92 + h * 0.13;
    if (c.y - groundY < 0.6) k *= 0.88; // darker base course
    return shade(base, k);
  };
}

interface BuildingOpts {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  base: number;
  top: number;
  color?: number;
  roof?: "tileX" | "tileZ" | "flat" | "none";
  faces?: Face[];
  ground?: "windows" | "doors" | "none";
  vines?: boolean;
  lamps?: boolean;
}

export interface SardineStreetInfo {
  builder: LevelBuilder;
  /** Distance from a sea point to the nearest shoreline (for water shading). */
  shoreDistance: (x: number, z: number) => number;
}

/**
 * Builds the continuous Sardine Street level: geometry + colliders for all
 * eight zones and both shortcuts, laid out from data/level.ts.
 */
export function buildSardineStreet(scene: THREE.Scene, physics: PhysicsWorld, mats: Materials): SardineStreetInfo {
  const b = new LevelBuilder(physics);

  // ------------------------------------------------------------------ helpers
  const building = (o: BuildingOpts): void => {
    const color = o.color ?? rng.pick(FACADES);
    b.block(o.x0, o.x1, o.base - 3, o.top, o.z0, o.z1, stone(color, o.base), { cell: 1.7 });
    // cornice
    b.block(o.x0 - 0.12, o.x1 + 0.12, o.top - 0.18, o.top, o.z0 - 0.12, o.z1 + 0.12, shade(color, 1.06), { collider: false });
    const roof = o.roof ?? "flat";
    if (roof === "tileX" || roof === "tileZ") P.tileRoof(b, o.x0, o.x1, o.z0, o.z1, o.top, roof === "tileX");
    else if (roof === "flat") {
      // low parapet lip on flat non-walkable roofs
      b.block(o.x0, o.x1, o.top, o.top + 0.3, o.z0, o.z0 + 0.25, shade(color, 1.04), { collider: false });
      b.block(o.x0, o.x1, o.top, o.top + 0.3, o.z1 - 0.25, o.z1, shade(color, 1.04), { collider: false });
      if (rng.chance(0.5)) P.chimney(b, o.x0 + (o.x1 - o.x0) * rng.range(0.2, 0.8), o.top, o.z0 + (o.z1 - o.z0) * rng.range(0.3, 0.7), rng.chance(0.5), false);
    }
    for (const f of o.faces ?? []) facade(o, f);
  };

  const facade = (o: BuildingOpts, f: Face): void => {
    const alongX = f === "n" || f === "s";
    const a0 = alongX ? o.x0 : o.z0;
    const a1 = alongX ? o.x1 : o.z1;
    const len = a1 - a0;
    const plane = f === "s" ? o.z1 : f === "n" ? o.z0 : f === "e" ? o.x1 : o.x0;
    const at = (u: number): [number, number] => (alongX ? [u, plane] : [plane, u]);
    const cols = Math.max(1, Math.floor((len - 1.2) / 2.4));
    const spacing = len / cols;
    const startRow = o.ground === "windows" ? 0 : 1;
    const shutter = rng.pick(SHUTTERS);
    for (let r = startRow; ; r++) {
      const wy = o.base + 1.55 + r * 2.75;
      if (wy + 0.9 > o.top - 0.35) break;
      for (let c = 0; c < cols; c++) {
        const u = a0 + spacing * (c + 0.5);
        const [wx, wz] = at(u);
        if (rng.chance(0.12)) continue;
        if (r >= 1 && rng.chance(0.22)) {
          P.balcony(b, wx, wy - 0.95, wz, f, 1.7, false, true);
          P.door(b, wx, wy - 0.88, wz, f, rng.pick([PALETTE.doorTeal, PALETTE.windowGlass]), false);
        } else {
          P.windowUnit(b, wx, wy, wz, f, rng.chance(0.75) ? shutter : rng.pick(SHUTTERS), rng.pick([0, 0.35, 1, 1]), 0.9, 1.3, rng.chance(0.35));
        }
      }
    }
    if (o.ground === "doors") {
      const n = Math.max(1, Math.floor(len / 6));
      for (let i = 0; i < n; i++) {
        const u = a0 + (len / n) * (i + 0.5) + rng.range(-0.6, 0.6);
        const [dx, dz] = at(u);
        P.door(b, dx, o.base, dz, f, rng.pick([PALETTE.doorTeal, PALETTE.coralShutter, PALETTE.woodHoney]));
        if (rng.chance(0.6)) {
          const [px, pz] = at(u + 1.2);
          const [ox, oz] = f === "s" ? [0, 0.4] : f === "n" ? [0, -0.4] : f === "e" ? [0.4, 0] : [-0.4, 0];
          P.pot(b, px + ox, o.base, pz + oz, rng.range(0.8, 1.1), rng.chance(0.6) ? "flower" : "leafy", true);
        }
      }
    }
    if (o.vines && rng.chance(0.85)) {
      const u = a0 + len * rng.range(0.15, 0.85);
      const [vx, vz] = at(u);
      P.bougainvillea(b, vx, o.base + 0.2, vz, f, rng.range(1.4, 2.6), Math.min(o.top - o.base - 0.5, rng.range(3.5, 6.5)), 0.9);
    }
    if (o.lamps) {
      const [lx, lz] = at(a0 + len * 0.5 + rng.range(-1, 1));
      P.wallLamp(b, lx, o.base + 2.9, lz, f);
    }
    if (rng.chance(0.4)) {
      const [px, pz] = at(a0 + 0.35);
      P.drainPipe(b, px, o.base, o.top - 0.2, pz, f);
    }
  };

  const flagstones = (x0: number, x1: number, z0: number, z1: number, y: number, tile = 1.05, base: number = PALETTE.cobble): void => {
    const geos: THREE.BufferGeometry[] = [];
    const nx = Math.max(1, Math.round((x1 - x0) / tile));
    const nz = Math.max(1, Math.round((z1 - z0) / tile));
    const tx = (x1 - x0) / nx;
    const tz = (z1 - z0) / nz;
    const gap = 0.055;
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        const cx = x0 + (i + 0.5) * tx;
        const cz = z0 + (j + 0.5) * tz + (i % 2) * 0.0;
        const jit = (k: number) => (hash3(cx * 1.7 + k, cz * 2.3, k) - 0.5) * 0.18;
        const hx = tx / 2 - gap;
        const hz = tz / 2 - gap;
        const pts: Array<[number, number]> = [
          [cx - hx + jit(1), cz - hz + jit(2)],
          [cx + hx + jit(3), cz - hz + jit(4)],
          [cx + hx + jit(5), cz + hz + jit(6)],
          [cx - hx + jit(7), cz + hz + jit(8)],
        ];
        const k = 0.9 + hash3(cx, cz, 9) * 0.16;
        geos.push(lowPoly(flatPoly(pts, y + 0.012 + hash3(cz, cx, 3) * 0.012), shade(base, k), { variance: 0.03 }));
      }
    }
    for (const g of geos) b.add(g);
  };

  const slab = (x0: number, x1: number, z0: number, z1: number, top: number, color: number = PALETTE.grout, bottom = H.sea - 1): void => {
    const cliff = stone(PALETTE.cliff, bottom);
    b.block(x0, x1, bottom, top, z0, z1, (c, n, f) => (n.y > 0.5 ? color : cliff(c, n, f)), { cell: 3.2 });
  };

  // =================================================================== 1. FISH MARKET (y = 0)
  slab(-42, -4, 4, 28, H.market);
  flagstones(-40, -4, 5, 27, H.market);
  // west
  building({ x0: -50, x1: -40, z0: -4, z1: 9, base: 0, top: 10, roof: "tileZ", faces: ["e"], ground: "windows", vines: true });
  building({ x0: -50, x1: -40, z0: 9, z1: 20, base: 0, top: 9, faces: ["e"], ground: "doors", vines: true, lamps: true });
  building({ x0: -50, x1: -40, z0: 20, z1: 34, base: 0, top: 11.5, roof: "tileZ", faces: ["e"], ground: "windows" });
  // south row
  building({ x0: -40, x1: -29, z0: 27, z1: 36, base: 0, top: 8.5, roof: "tileX", faces: ["n"], ground: "none", vines: true });
  building({ x0: -29, x1: -17, z0: 27, z1: 36, base: 0, top: 10.5, faces: ["n"], ground: "none", lamps: true });
  building({ x0: -17, x1: -6, z0: 27, z1: 36, base: 0, top: 9, roof: "tileX", faces: ["n"], ground: "none", vines: true });
  building({ x0: -6, x1: 1, z0: 20, z1: 36, base: 0, top: 8.6, faces: ["n", "w"], ground: "none", vines: true });
  // north row
  building({ x0: -42, x1: -28, z0: -6, z1: 5, base: 0, top: 9, roof: "tileX", faces: ["s"], ground: "none", vines: true });
  building({ x0: -28, x1: -16, z0: -6, z1: 5, base: 0, top: 11, faces: ["s"], ground: "none", lamps: true });
  building({ x0: -16, x1: -4, z0: -6, z1: 5, base: 0, top: 9.5, roof: "tileX", faces: ["s"], ground: "none", vines: true });

  // stalls
  P.fishStall(b, -35, 0, 6.7, "s", "coral", 2.8, true);
  P.fishStall(b, -29.5, 0, 6.7, "s", "teal", 2.6, true);
  P.fishStall(b, -23.6, 0, 6.7, "s", "coral", 2.8, true);
  P.fishStall(b, -11.5, 0, 6.7, "s", "teal", 2.6, true);
  P.fishStall(b, -34.5, 0, 25.3, "n", "teal", 2.8, true);
  P.fishStall(b, -27.5, 0, 25.3, "n", "coral", 2.6, true);
  P.fishStall(b, -19.5, 0, 25.3, "n", "teal", 2.8, true);
  P.fishStall(b, -8.5, 0, 25.3, "n", "coral", 2.4, true);
  // display tables (hero fish table first)
  P.displayTable(b, SPAWN.heroTable[0], 0, SPAWN.heroTable[2], 0, 2.0, 1.0, false);
  P.displayTable(b, -27, 0, 11.2, 0.12);
  P.displayTable(b, -15.5, 0, 20.6, -0.1);
  // clutter
  P.crate(b, -17.5, 0, 7.6);
  P.crateStack(b, -38.6, 0, 9.8, 2);
  P.barrel(b, -38.8, 0, 12.2);
  P.barrel(b, -38.5, 0, 21.4);
  P.crate(b, -38.4, 0, 23.3, 0.3);
  P.basket(b, -31.4, 0, 9.3, "lemons");
  P.basket(b, -30.6, 0, 22.7, "fish");
  P.basket(b, -22.6, 0, 22.9, "lemons");
  P.basket(b, -14.8, 0, 9.2, "fish");
  P.bucket(b, -25.6, 0, 9.4);
  P.bucket(b, -16.6, 0, 23.3, PALETTE.tealShutter);
  P.bowlCeramic(b, -6.6, 0, 22.8);
  P.crate(b, -6.3, 0, 10.8, 0.4);
  P.crateStack(b, -5.6, 0, 6.6, 2, 0.1);
  P.barrel(b, -12.8, 0, 23.4);
  P.lampPost(b, -30.5, 0, 13);
  P.lampPost(b, -13, 0, 14.5);
  P.pot(b, -39, 0, 16.2, 1.1, "leafy", true);
  P.pot(b, -39, 0, 6.2, 1, "flower", true);
  P.bunting(b, -40, 6.4, 8, -40, 6.4, 24);
  P.bunting(b, -26, 7.2, 5, -24, 7.2, 27);
  P.bunting(b, -12, 6.8, 5, -10, 6.8, 27);
  P.hangingSign(b, -16, 4.4, 5, "s");
  P.hangingSign(b, -28.5, 4.2, 27, "n");

  // =================================================================== 2. MARKET EXIT (steps 0 → 1.0)
  b.stairs(-4, 0, 12, 20, H.market, H.exit, "x+", PALETTE.stoneCream, shade(PALETTE.stoneCream, 0.94));
  slab(0, 28, -6.5, 23, H.exit);
  flagstones(0, 12, 8, 23, H.exit);
  flagstones(12, 28, 12, 23, H.exit);
  flagstones(0, 12, -4, 8, H.exit);
  building({ x0: -10, x1: 0, z0: -6.5, z1: 12, base: 0, top: 10, roof: "flat", faces: ["e", "s"], ground: "none", vines: true });
  building({ x0: 1, x1: 18, z0: 23, z1: 31, base: H.exit, top: 9.5, roof: "tileX", faces: ["n"], ground: "doors", vines: true, lamps: true });
  // archway over the exit steps
  const arch = lowPoly(archFrame(9, 6.2, 1.2, 8, 4.8), stone(PALETTE.stoneWarm, 0), { variance: 0.04 });
  place(arch, -1.6, H.market, 16, Math.PI / 2);
  b.add(arch);
  b.collider(-2.2, -1.0, 4.8, 6.2, 11.5, 20.5);
  P.bougainvillea(b, -1.0, 0.2, 20.6, "e", 1.6, 5.5);
  P.wallLamp(b, -1, 3.4, 11.9, "e");
  P.crate(b, 10.4, H.exit, 21.6, 0.2);
  P.barrel(b, 8.6, H.exit, 22.1);
  P.pot(b, 0.9, H.exit, 22.2, 1, "flower", true);
  P.bunting(b, 0, 7, 9, 12, 7.4, 23);

  // =================================================================== 3. FIRST ALLEY — ground route + awning yard
  building({ x0: 18, x1: 32, z0: 23, z1: 31, base: H.exit, top: 9, faces: ["n"], ground: "doors", vines: true });
  building({ x0: 28, x1: 37, z0: -6, z1: 23, base: H.exit, top: 8, roof: "tileZ", faces: ["w"], ground: "doors", vines: true, lamps: true });
  building({ x0: 12, x1: 18, z0: -6, z1: 12, base: H.exit, top: 9.5, roof: "flat", faces: ["e", "s", "w"], ground: "none", vines: true });
  // alley ramp + broad steps up to the courtyard
  b.ramp(18, 28, 0, 12, H.exit, 1.6, "z-", PALETTE.cobble);
  b.stairs(18, 28, -6.5, 0, 1.6, H.court, "z-", PALETTE.stoneCream, shade(PALETTE.stoneCream, 0.94));
  P.scooter(b, 24.8, H.exit, 19.6, 0.5);
  P.crate(b, 26.6, H.exit, 13.2, 0.2);
  P.crateStack(b, 26.8, 1.2, 4.6, 2, -0.2);
  P.pot(b, 18.8, 1.25, 7.4, 1, "flower", true);
  P.pot(b, 26.9, 1.55, 1.2, 1.1, "leafy", true);
  P.hangingSign(b, 18, 4.6, 7, "e");
  P.awning(b, 18, 3.5, 3.2, "e", 2.6, 1.0, 0.35, "teal", false);
  P.staticLaundry(b, 18.2, 6.6, 15, 27.8, 15, [PALETTE.sheetCream, PALETTE.clothBlue, PALETTE.clothCoral, PALETTE.sheetCream]);
  P.staticLaundry(b, 18.2, 7.1, 5, 27.8, 5, [PALETTE.clothCoral, PALETTE.sheetCream, PALETTE.clothBlue]);

  // Awning yard (Shortcut A): crates → coral awning → teal awning → terrace
  P.crateStack(b, 1.1, H.exit, 6.4, 1, 0.1, 0.8);
  P.crate(b, 2.2, H.exit, 3.8, 0.05, 0.86);
  P.barrel(b, 0.9, H.exit, 1.6);
  P.crateStack(b, 10.8, H.exit, 6.6, 2, 0.15);
  P.barrel(b, 10.9, H.exit, 4.6);
  P.crate(b, 1.0, H.exit, -2.6, 0.3);
  // stall under the coral awning (counter is solid)
  b.block(3.8, 6.6, H.exit, H.exit + 0.9, 3.0, 4.3, PALETTE.woodHoney);
  P.awning(b, 5.2, 2.62, 1.2, "s", 3.4, 2.6, 0.55, "coral", true);
  for (const px of [3.6, 6.8]) b.block(px - 0.06, px + 0.06, H.exit, 2.6, 1.15, 1.27, PALETTE.woodDark, { collider: false });
  P.awning(b, 8.9, 3.3, -2.1, "s", 3.2, 2.6, 0.5, "teal", true);
  for (const px of [7.4, 10.4]) b.block(px - 0.06, px + 0.06, H.exit, 3.3, -2.16, -2.04, PALETTE.woodDark, { collider: false });
  // terrace wall separating the yard from the courtyard
  b.block(-2, 12, H.exit - 0.2, 3.4, -6.5, -4, stone(PALETTE.stoneWarm, H.exit), { cell: 1.7 });
  flagstones(-2, 12, -6.5, -4, 3.4, 0.9, PALETTE.stoneCream);
  P.pot(b, -1.2, 3.4, -5.3, 0.9, "flower", true);
  P.pot(b, 11.2, 3.4, -5.3, 0.9, "leafy", true);
  P.bougainvillea(b, 4, H.exit, -4, "s", 3, 2.2, 0.8);
  P.lantern(b, 6, 2.2, 0.4);

  // =================================================================== 4. FOUNTAIN + PIGEON COURTYARD (y = 2.2)
  slab(-6, 38, -37, -6.5, H.court);
  flagstones(-6, 37.6, -37, -6.5, H.court, 1.15);
  building({ x0: -14, x1: -6, z0: -24, z1: -6.5, base: H.court, top: 11, roof: "tileZ", faces: ["e"], ground: "doors", vines: true, lamps: true });
  building({ x0: -14, x1: -6, z0: -37, z1: -24, base: H.court, top: 12, faces: ["e"], ground: "windows", vines: true });
  P.fountain(b, FOUNTAIN.center[0], H.court, FOUNTAIN.center[2], FOUNTAIN.radius);
  P.tree(b, -1.8, H.court, -31.2, 1.05);
  b.block(-4.2, 0.6, H.court, H.court + 0.5, -33.6, -28.8, PALETTE.stoneCream, { collider: true });
  P.bench(b, 3.6, H.court, -15.5, Math.PI / 2);
  P.bench(b, 25.5, H.court, -29.6, Math.PI);
  P.bench(b, 9, H.court, -29.6, Math.PI);
  P.planterBox(b, -5.2, H.court, -16, 3.2, Math.PI / 2);
  P.pot(b, 10.2, H.court, -7.4, 1, "flower", true);
  P.pot(b, 17.4, H.court, -7.1, 1.1, "leafy", true);
  P.pot(b, 33.6, H.court, -26.6, 1, "flower", true);
  P.pot(b, 36.6, H.court, -7.5, 1, "flower", true);
  P.crate(b, 31.9, H.court, -31.2, 0.25, 0.86);
  P.crate(b, 33.2, H.court, -9.1, 0.1);
  P.lampPost(b, 6.5, H.court, -24);
  P.lampPost(b, 24, H.court, -13);
  P.lampPost(b, 30, H.court, -24.6);
  // sea-view parapet + arch on the east edge
  P.parapet(b, 37.4, 38, -28, -6.5, H.court, 0.55);
  const eastArch = lowPoly(archFrame(7, 5.4, 0.8, 5, 4.2), stone(PALETTE.stoneCream, H.court), { variance: 0.04 });
  place(eastArch, 37.7, H.court, -17, Math.PI / 2);
  b.add(eastArch);
  b.collider(37.3, 38.1, H.court, H.court + 5.4, -20.5, -19.5);
  b.collider(37.3, 38.1, H.court, H.court + 5.4, -14.5, -13.5);
  P.bougainvillea(b, 37.4, H.court + 0.4, -20.3, "w", 1.2, 4.5);
  // shop awnings on the north facade
  P.awning(b, 12, 4.35, -37, "s", 3.2, 1.2, 0.4, "teal", false);
  P.awning(b, 22.5, 4.35, -37, "s", 3.2, 1.2, 0.4, "coral", false);
  P.door(b, 12, H.court, -37, "s", PALETTE.doorTeal);
  P.door(b, 22.5, H.court, -37, "s", PALETTE.coralShutter);
  P.door(b, 30.5, H.court, -37, "s", PALETTE.woodHoney);
  for (const wx of [7.5, 16.5, 27]) P.windowUnit(b, wx, H.court + 1.55, -37, "s", "teal", 1, 0.9, 1.25, true);
  P.wallLamp(b, 17.2, H.court + 2.4, -37, "s");
  P.bunting(b, -6, 7.6, -14, 28, 7.6, -37);
  P.bunting(b, 0, 7.4, -36.5, 36, 7.4, -8);
  P.bougainvillea(b, 33.2, H.court, -37, "s", 2.2, 2.6);

  // =================================================================== 5. SECOND ALLEY (2.2 → 3.6 → roof)
  building({ x0: -14, x1: -5, z0: -66, z1: -37, base: H.court, top: 11, roof: "flat", faces: ["e"], ground: "windows", vines: true, lamps: true });
  b.stairs(-5, 6, -46, -37, H.court, H.alley2, "z-", PALETTE.stoneCream, shade(PALETTE.stoneCream, 0.94));
  slab(-5, 6, -66, -46, H.alley2);
  flagstones(-5, 6, -64, -46, H.alley2, 0.95);
  // climb: crate → AC unit → roof edge
  P.crate(b, 3.3, H.alley2, -51, 0.1, 0.84);
  P.acUnit(b, 5.35, H.alley2 + 0.75, -53.8, "w", true, true);
  P.balcony(b, -5, 5.2, -52.5, "e", 1.8, true, true);
  P.door(b, -5, 5.28, -52.5, "e", PALETTE.doorTeal, false);
  // broad stairs at the north end up to the rooftops
  b.stairs(-3.5, 6, -64, -60.2, H.alley2, H.roof, "x+", PALETTE.stoneCream, shade(PALETTE.stoneCream, 0.94));
  P.pot(b, -4.3, H.alley2, -47, 1, "flower", true);
  P.pot(b, -4.3, H.alley2, -58.5, 1.1, "leafy", true);
  P.vine(b, -5, H.alley2, -56, "e", 5);
  P.staticLaundry(b, -5, 8.2, -41, 6, -41, [PALETTE.clothBlue, PALETTE.sheetCream, PALETTE.clothCoral]);
  P.staticLaundry(b, -5, 8.6, -56.5, 6, -56.5, [PALETTE.sheetCream, PALETTE.clothCoral]);
  building({ x0: -14, x1: 8, z0: -74, z1: -64, base: H.alley2, top: 10, roof: "tileX", faces: ["s"], ground: "windows", vines: true });
  P.domeTower(b, -9.5, H.court, -44.5);

  // =================================================================== 6. LAUNDRY ROOFTOPS (y = 5.0)
  const roofColor = PALETTE.stoneCream;
  b.block(6, 39, H.court - 3, H.roof, -64, -37, stone(PALETTE.stoneWarm, H.court), { cell: 1.7 });
  b.block(39, 47, H.court - 3, H.roof, -64, -47, stone(PALETTE.plasterPeach, H.court), { cell: 1.7 });
  flagstones(6, 39, -64, -37, H.roof, 1.3, roofColor);
  flagstones(39, 47, -64, -47, H.roof, 1.3, roofColor);
  // west face facade (second alley side)
  for (const wz of [-40, -44.5, -58.5]) P.windowUnit(b, 6, H.court + 2.7, wz, "w", "teal", 1, 0.9, 1.2, wz === -44.5);
  P.bougainvillea(b, 6, H.alley2, -48, "w", 1.6, 1.4);
  // parapets
  P.parapet(b, 6, 34, -37.4, -37, H.roof, 0.45);
  P.parapet(b, 6, 6.4, -47.6, -37.4, H.roof, 0.45);
  P.parapet(b, 6, 6.4, -60.2, -55.2, H.roof, 0.45);
  // north wall of taller buildings
  building({ x0: 8, x1: 47, z0: -74, z1: -64, base: H.roof, top: 9.2, faces: ["s"], ground: "doors", vines: true, lamps: true });
  // tower block
  building({ x0: 26, x1: 31.5, z0: -64, z1: -59, base: H.roof, top: 9.5, roof: "tileX", faces: ["s", "e", "w"], ground: "doors", vines: true });
  // roof dressing
  P.waterTank(b, 13.5, H.roof, -61);
  P.waterTank(b, 38.5, H.roof, -61.5);
  P.acUnit(b, 18.5, H.roof, -61.8, "s");
  P.acUnit(b, 33.5, H.roof, -39.6, "n");
  P.satelliteDish(b, 35.6, H.roof, -60.5, 0.6);
  P.chimney(b, 9.2, H.roof, -45.5, true);
  P.chimney(b, 23.6, H.roof, -62.6);
  P.chimney(b, 36.4, H.roof, -44.6, true);
  P.ventPipe(b, 16.2, H.roof, -39.2);
  P.ventPipe(b, 29.5, H.roof, -40.2);
  P.antenna(b, 43.2, H.roof, -48.6, 2.8);
  P.antenna(b, 45, H.roof, -50.8, 2.3);
  P.antenna(b, 42.4, H.roof, -51.6, 3.1);
  P.antenna(b, 20.5, H.roof, -63, 2.5);
  P.crate(b, 16.8, H.roof, -54.6, 0.3);
  P.crateStack(b, 34.2, H.roof, -56.2, 2, 0.1);
  P.crate(b, 25.2, H.roof, -42.2, -0.2);
  for (const [px, pz] of [
    [7.2, -38.4],
    [11.5, -38.3],
    [19.5, -38.3],
    [27.5, -38.3],
    [33, -38.4],
    [8.2, -62.5],
    [44.5, -62.4],
    [46, -56],
  ] as Array<[number, number]>) {
    P.pot(b, px, H.roof, pz, rng.range(0.85, 1.15), rng.chance(0.6) ? "flower" : "leafy", true, rng.chance(0.3));
  }
  P.planterBox(b, 14.5, H.roof, -44.4, 2.6, 0, true, PALETTE.tealShutter);
  // laundry posts (the interactive sheet hangs between the middle pair)
  for (const [ax, az, bx, bz, items] of [
    [10, -42, 18, -42, [PALETTE.sheetCream, PALETTE.clothBlue, PALETTE.clothCoral]],
    [32, -45, 40, -45, [PALETTE.clothCoral, PALETTE.sheetCream, PALETTE.clothBlue, PALETTE.sheetCream]],
    [12, -58.5, 22, -58.5, [PALETTE.clothBlue, PALETTE.sheetCream, PALETTE.clothCoral]],
  ] as Array<[number, number, number, number, number[]]>) {
    b.block(ax - 0.09, ax + 0.09, H.roof, H.roof + 2.4, az - 0.09, az + 0.09, PALETTE.woodHoney, { collider: true, blocksCamera: false });
    b.block(bx - 0.09, bx + 0.09, H.roof, H.roof + 2.4, bz - 0.09, bz + 0.09, PALETTE.woodHoney, { collider: true, blocksCamera: false });
    P.staticLaundry(b, ax, H.roof + 2.3, az, bx, bz, items);
  }

  // =================================================================== Shortcut B — low roofs
  b.block(34, 40, H.court - 3, 3.4, -38, -28, stone(PALETTE.plasterOchre, H.court), { cell: 1.7 });
  flagstones(34, 40, -38, -28, 3.4, 1.0, PALETTE.terracottaLight);
  b.block(39, 47, H.court - 3, 4.3, -47, -37.5, stone(PALETTE.stoneSand, H.court), { cell: 1.7 });
  flagstones(39, 47, -47, -37.5, 4.3, 1.0, PALETTE.terracottaLight);
  P.parapet(b, 39.6, 40, -37.5, -28, 3.4, 0.4);
  P.parapet(b, 46.6, 47, -47, -37.5, 4.3, 0.4);
  P.pot(b, 38.8, 3.4, -29, 0.9, "flower", true);
  P.door(b, 34, H.court, -31.5, "w", PALETTE.doorTeal);
  P.windowUnit(b, 34, H.court + 1.6, -35.4, "w", "coral", 1, 0.8, 0.9, false);
  P.vine(b, 34, H.court, -28.6, "w", 1.1);

  // =================================================================== 7. FINAL CLIMB
  b.block(47, 58, H.sea - 1, H.roof, -72, -47, stone(PALETTE.stoneCream, H.court), { cell: 1.7 });
  flagstones(47, 58, -72, -47, H.roof, 1.3, roofColor);
  b.block(48.5, 56.5, H.roof, H.climb, -64, -55.5, stone(PALETTE.plasterPeach, H.roof), { cell: 1.6 });
  flagstones(48.5, 56.5, -64, -55.5, H.climb, 1.0, PALETTE.terracottaLight);
  P.crate(b, 47.3, H.roof, -58.6, 0.05, 0.86);
  P.acUnit(b, 51, H.climb, -57.4, "s");
  P.antenna(b, 55.6, H.climb, -56.4, 2.4);
  P.pot(b, 55.5, H.climb, -63, 0.9, "flower", true);
  // ledge + plank to the final jump
  b.block(51, 55, H.roof, 6.1, -69, -66.5, stone(PALETTE.stoneWarm, H.roof), { cell: 1.4 });
  const plankLen = Math.hypot(2.5, 0.2);
  const plank = lowPoly(box(1.3, 0.12, plankLen, 3, 1, 3), (c) => (Math.abs(c.x) % 0.43 < 0.04 ? PALETTE.woodDark : PALETTE.woodHoney), { variance: 0.06 });
  place(plank, 53, (H.climb + 6.1) / 2, -65.25, 0, Math.atan2(0.2, 2.5));
  b.add(plank);
  b.physics.addOrientedBox(
    new THREE.Vector3(53, (H.climb + 6.1) / 2 - 0.06, -65.25),
    new THREE.Vector3(0.65, 0.06, plankLen / 2 + 0.05),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.atan2(0.2, 2.5), 0, 0)),
  );
  P.parapet(b, 57.6, 58, -72, -47, H.roof, 0.45);
  P.parapet(b, 47, 57.6, -47.4, -47, H.roof, 0.45);
  P.wallLamp(b, 51, 5.2, -66.5, "s");

  // =================================================================== 8. SAFE ROOFTOP (y = 6.6)
  b.block(49, 65, H.sea - 1, H.safe, -85, -70.5, stone(PALETTE.stoneCream, H.court), { cell: 1.8 });
  flagstones(49, 65, -85, -70.5, H.safe, 1.2, PALETTE.potCream);
  P.parapet(b, 49, 65, -85, -84.6, H.safe, 0.5);
  P.parapet(b, 64.6, 65, -84.6, -70.5, H.safe, 0.5);
  P.parapet(b, 49, 49.4, -84.6, -70.5, H.safe, 0.5);
  P.pergola(b, 57, H.safe, -78, 5.6, 4, 2.5);
  P.rug(b, 57, H.safe, -77.5, 4.6, 3.2);
  P.cushionBed(b, 57, H.safe, -80, 0);
  for (const [px, pz, s] of [
    [50.5, -71.6, 1.1],
    [63.6, -71.6, 1],
    [63.6, -83.4, 1.15],
    [50.5, -83.4, 1],
    [53.5, -83.6, 0.9],
    [61, -83.6, 0.85],
  ] as Array<[number, number, number]>) {
    P.pot(b, px, H.safe, pz, s, "flower", true, rng.chance(0.4));
  }
  P.planterBox(b, 63.4, H.safe, -77, 3, Math.PI / 2, true, PALETTE.tealShutter);
  P.lantern(b, 59.4, H.safe + 2.1, -76.2);
  // facade under the safe rooftop (visible from the climb)
  for (const wx of [52, 56.5, 61]) P.windowUnit(b, wx, H.safe - 1.3, -70.5, "s", "teal", 1, 0.9, 1.1, wx !== 56.5);

  // =================================================================== Sea, cliffs, harbor
  // landmass skirt below the courtyard/alley east edge
  b.block(37.4, 41, H.sea - 1, H.court - 1.1, -28, 23, stone(PALETTE.cliff, H.sea), { cell: 3.2 });
  for (let i = 0; i < 26; i++) {
    const z = -30 + i * 2.2;
    P.rock(b, 41.5 + rng.range(-0.6, 1.5), H.sea + rng.range(-0.4, 0.6), z + rng.range(-0.8, 0.8), rng.range(1.0, 2.0), false);
  }
  for (let i = 0; i < 14; i++) {
    P.rock(b, 58 + rng.range(0, 6), H.sea + rng.range(-0.3, 0.8), -44 + rng.range(-8, 4) - i * 0.4, rng.range(1.0, 2.2), false);
  }
  for (let i = 0; i < 12; i++) P.rock(b, 66 + rng.range(-1, 2), H.sea + rng.range(-0.3, 0.5), -86 + i * 3.4, rng.range(1.2, 2.4), false);
  for (let i = 0; i < 10; i++) P.rock(b, 50 + i * 1.8, H.sea + rng.range(-0.2, 0.4), -87 + rng.range(-1, 1), rng.range(1.0, 2.0), false);
  // dock + boat in the inlet
  b.block(41, 48, H.sea + 0.3, H.sea + 0.55, -14, -11.5, PALETTE.woodHoney, { collider: false });
  for (const px of [42, 45, 47.6]) b.block(px - 0.12, px + 0.12, H.sea - 1.5, H.sea + 0.55, -14.1, -13.8, PALETTE.woodDark, { collider: false });
  P.boat(b, 46.5, H.sea + 0.25, -8.4, 0.25);
  P.boat(b, 52, H.sea + 0.2, -24, -0.6);
  // offshore rocks
  for (const [rx, rz, rs] of [
    [52, -2, 2.4],
    [58, -14, 1.8],
    [72, -40, 2.6],
    [76, -70, 2.2],
    [62, 10, 2.0],
  ] as Array<[number, number, number]>) {
    P.rock(b, rx, H.sea, rz, rs);
  }

  // Background skyline beyond the walls (fills the horizon, no colliders)
  const skyline: Array<[number, number, number, number, number]> = [
    [-62, -50, -20, 10, 13],
    [-62, -50, 10, 40, 11],
    [-30, -14, 38, 50, 12],
    [-14, 4, 36, 48, 10],
    [4, 20, 33, 45, 13],
    [20, 34, 33, 44, 10.5],
    [-30, -14, -24, -8, 14],
    [-26, -14, -50, -24, 15],
    [-26, -14, -78, -50, 13],
    [-14, 10, -86, -74, 12],
    [10, 30, -86, -74, 11],
    [30, 47, -86, -74, 12.5],
  ];
  for (const [x0, x1, z0, z1, top] of skyline) {
    const col = rng.pick(FACADES);
    b.block(x0, x1, -3, top, z0, z1, stone(col, 0), { collider: false, cell: 3.6 });
    if (rng.chance(0.6)) P.tileRoof(b, x0, x1, z0, z1, top, rng.chance(0.5));
  }

  // Wayfinding: painted fish arrow signs at every route decision.
  P.arrowSign(b, -8.2, H.market + 1.65, 18.6, Math.PI / 2, true);
  P.arrowSign(b, 6.2, H.exit + 1.65, 9.3, Math.PI, true, 0.35);
  P.arrowSign(b, 10.4, H.exit + 1.65, 20.6, Math.PI / 2, true);
  P.arrowSign(b, 26.6, H.exit + 1.65, 16.6, Math.PI, true);
  P.arrowSign(b, 20.6, H.court + 1.65, -8.4, Math.atan2(-19.5, -27.5), true);
  P.arrowSign(b, 4.8, H.court + 1.65, -34.6, Math.PI, true, 0.3);
  P.arrowSign(b, 29.2, H.court + 1.65, -26.6, Math.atan2(1, -1), true, 0.35);
  P.arrowSign(b, -3.4, H.alley2 + 1.65, -49.6, Math.PI / 2, true, 0.35);
  P.arrowSign(b, 23.6, H.roof + 1.65, -46.4, Math.PI / 2, true);
  P.arrowSign(b, 45.4, H.roof + 1.65, -55.4, Math.atan2(1, -1.2), true, 0.25);

  // shoreline distance for water shading
  const shoreDistance = (x: number, z: number): number => {
    let best = Infinity;
    for (let i = 0; i < COASTLINE.length; i++) {
      const [ax, az] = COASTLINE[i];
      const [bx, bz] = COASTLINE[(i + 1) % COASTLINE.length];
      const dx = bx - ax;
      const dz = bz - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
      const px = ax + dx * t;
      const pz = az + dz * t;
      best = Math.min(best, Math.hypot(x - px, z - pz));
    }
    return best;
  };

  b.finalize(scene, mats);
  return { builder: b, shoreDistance };
}
