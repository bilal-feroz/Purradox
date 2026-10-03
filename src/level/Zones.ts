import { ZONES, type ZoneDef } from "../data/level";

/** Zone lookup by world position (first matching AABB wins). */
export function zoneAt(x: number, y: number, z: number, zones: readonly ZoneDef[] = ZONES): ZoneDef | null {
  for (const zd of zones) {
    if (x >= zd.min[0] && x <= zd.max[0] && y >= zd.min[1] && y <= zd.max[1] && z >= zd.min[2] && z <= zd.max[2]) return zd;
  }
  return null;
}

/** True when the cat is above its zone's floor (awnings, crates, roofs). */
export function isElevated(zone: ZoneDef | null, y: number): boolean {
  if (!zone) return false;
  if (zone.elevated) return true;
  return y > zone.floor + 0.6;
}
