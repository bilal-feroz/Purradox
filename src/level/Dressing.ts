import { PALETTE } from "../data/palette";
import { H } from "../data/level";
import type { LevelBuilder } from "./LevelBuilder";
import * as P from "./Props";
import * as X from "./PropsExtra";

/**
 * Set dressing from the market / street / rooftop reference sheets, placed
 * after the rest of the street so nothing already built moves. Everything
 * solid sits against walls, under shades or on rooftop corners, clear of
 * the routes cats run and the jumps they make.
 */
export function dressSardineStreet(b: LevelBuilder): void {
  market(b);
  marketExit(b);
  firstAlley(b);
  courtyard(b);
  secondAlley(b);
  rooftops(b);
  skyline(b);
  harbor(b);
}

// ---------------------------------------------------------------- 1. fish market
function market(b: LevelBuilder): void {
  const y = H.market;
  // a sagging teal shade over the clutter between the south stalls
  X.canvasShade(b, -18, y, 6.9, 0, 3.6, 2.4, 2.45, 2.75, "teal", 0.28);
  X.shallowTray(b, -17.5, y + 0.736, 7.6, 0.1, true);
  X.ropeCoil(b, -19.3, y, 6.1);
  P.barrel(b, -16.3, y, 6.0);
  X.foldedCloth(b, -16.3, y + 0.84, 6.0, 0.3);
  // chalkboards in front of two stalls
  X.smallChalkboard(b, -33.0, y, 8.7, 0.15);
  X.smallChalkboard(b, -26.2, y, 23.4, Math.PI - 0.1);
  // between the north stalls
  X.barrelOnSide(b, -24.4, y, 24.4, 0.4);
  P.bucket(b, -36.6, y, 23.0);
  // west wall: lemons on the barrel, rope, a tray up on the crates, a pot
  X.lemonPile(b, -38.5, y + 0.84, 21.4);
  X.ropeCoil(b, -38.9, y, 18.3);
  X.shallowTray(b, -38.6, y + 1.472, 9.8, 0.2);
  X.ceramicPot(b, -39.1, y, 14.0);
  // east end
  X.foldedCloth(b, -6.3, y + 0.736, 10.8, 0.3);
}

// ---------------------------------------------------------------- 2. market exit
function marketExit(b: LevelBuilder): void {
  const y = H.exit;
  P.scooter(b, 15.0, y, 12.9, 0);
  X.bollard(b, 0.5, y, 11.3);
  X.bollard(b, 0.5, y, 20.7);
  X.utilityBox(b, 0.2, y, 9.6, Math.PI / 2);
  X.ceramicPot(b, 5.0, y, 22.45, 1.05);
  X.broom(b, 16.6, y, 22.8, Math.PI);
  P.lampPost(b, 11.4, y, 9.6);
}

// ---------------------------------------------------------------- 3. first alley
function firstAlley(b: LevelBuilder): void {
  // the alley floor ramps from 1.0 (z = 12) to 1.6 (z = 0)
  const ground = (z: number) => H.exit + ((12 - z) / 12) * 0.6;
  X.pipeRun(b, [
    [18.1, 7.6, 10.4],
    [18.1, 7.6, 8.6],
    [18.1, ground(8.6) + 0.12, 8.6],
  ], { outlet: [1, 0] });
  X.pipeRun(b, [
    [27.9, 7.2, 14.8],
    [27.9, 6.3, 14.8],
    [27.9, 6.3, 13.2],
    [27.9, H.exit + 0.1, 13.2],
  ], { outlet: [-1, 0] });
  P.acUnit(b, 27.95, 3.4, 6.5, "w", false, true);
  X.pallet(b, 26.9, ground(9.6), 9.6, Math.PI / 2, true);
  X.broom(b, 27.75, H.exit, 20.6, -Math.PI / 2);
  X.cableCoil(b, 19.2, H.exit, 21.8);
}

// ---------------------------------------------------------------- 4. courtyard
function courtyard(b: LevelBuilder): void {
  const y = H.court;
  // little café under a sagging coral shade in the south-east corner
  X.canvasShade(b, 33.6, y, -11.2, Math.PI, 3.4, 2.8, 2.5, 2.7, "coral", 0.3);
  X.cafeTable(b, 33.6, y, -11.4);
  X.chair(b, 32.8, y, -11.4, Math.PI / 2);
  X.chair(b, 34.4, y, -11.4, -Math.PI / 2);
  X.ceramicPot(b, 35.6, y, -12.9, 0.9);
  // shopfronts on the north side
  for (const dx of [12, 22.5, 30.5]) X.doormat(b, dx, y, -36.55, 0);
  X.ceramicPot(b, 14.1, y, -36.45, 1);
  X.ceramicPot(b, 24.5, y, -36.45, 0.9);
  X.ceramicPot(b, 32.5, y, -36.4, 1.1);
  P.hangingSign(b, 30.5, 4.6, -37, "s");
  P.basket(b, 20.6, y, -36.2, "lemons");
  X.broom(b, 10.6, y, -36.75, 0);
  X.utilityBox(b, -5.84, y, -10.8, Math.PI / 2);
}

// ---------------------------------------------------------------- 5. second alley
function secondAlley(b: LevelBuilder): void {
  X.pipeRun(b, [
    [-4.9, 9.8, -48.6],
    [-4.9, 9.8, -49.4],
    [-4.9, H.alley2 + 0.12, -49.4],
  ], { outlet: [1, 0] });
  P.acUnit(b, -4.95, 7.2, -58.8, "e", false, true);
}

// ---------------------------------------------------------------- 6–8. rooftops
function rooftops(b: LevelBuilder): void {
  const y = H.roof;
  // laundry rooftops
  X.pallet(b, 8.7, y, -55.9, 0.2, true);
  X.mat(b, 23.4, y, -38.3, 0, 1.3, 0.7);
  X.chair(b, 22.6, y, -39.3, 0);
  X.chair(b, 24.3, y, -39.3, 0);
  X.cableCoil(b, 17.1, y, -62.8);
  X.planks(b, 24.9, y, -63.3, 0);
  X.ventBox(b, 10.3, y, -63.1, 0);
  P.bucket(b, 35.3, y, -57.5);
  X.broom(b, 25.85, y, -60.6, -Math.PI / 2);
  X.tarp(b, 33.4, y, -62.6, 0.3);
  // low roofs
  X.ventBox(b, 34.8, 3.4, -28.9, 0.2);
  X.cableCoil(b, 46.0, 4.3, -38.4);
  // final climb
  P.satelliteDish(b, 49.3, y, -48.6, -0.8);
  X.pallet(b, 56.4, y, -50.2, 0.4);
  P.chimney(b, 49.9, H.climb, -62.8, false, true);
  // safe rooftop: a table for two
  X.cafeTable(b, 52.4, H.safe, -80.6);
  X.chair(b, 51.6, H.safe, -80.6, Math.PI / 2);
  X.chair(b, 53.2, H.safe, -80.6, -Math.PI / 2);
  X.ceramicPot(b, 63.8, H.safe, -73.6, 1.1);
}

// ---------------------------------------------------------------- skyline (roofs nobody walks on)
function skyline(b: LevelBuilder): void {
  // market rooftops
  P.waterTank(b, -22, 11, -2.5, false);
  P.antenna(b, -18, 11, 0, 2.4);
  P.satelliteDish(b, -45, 9, 14.5, 1.2);
  P.waterTank(b, -23, 10.5, 31.5, false);
  P.antenna(b, -2.5, 8.6, 28, 2.2);
  // courtyard west block
  P.waterTank(b, -10, 12, -30.5, false);
  P.satelliteDish(b, -9, 12, -27, 0.9);
  // second alley west block
  P.antenna(b, -9.5, 11, -60, 2.8);
  X.ventBox(b, -8, 11, -51, 0.4);
  // behind the laundry rooftops
  P.waterTank(b, 16, 9.2, -69.5, false);
  P.satelliteDish(b, 33, 9.2, -68, 2.6);
  P.antenna(b, 40.5, 9.2, -70, 2.6);
  X.ventBox(b, 22, 9.2, -70, 0);
}

// ---------------------------------------------------------------- harbor
function harbor(b: LevelBuilder): void {
  const y = H.sea + 0.55;
  X.bollard(b, 42.4, y, -11.9);
  X.bollard(b, 46.6, y, -11.9);
  X.ropeCoil(b, 44.5, y, -12.8, PALETTE.woodLight);
}
