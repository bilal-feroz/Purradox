// Replay data model. Snapshots are authoritative transforms sampled from
// the real simulation (not raw input), so playback can never drift.

import type { CatId } from "../data/cats";

export type Vec3Tuple = [number, number, number];

export type ReplaySnapshot = {
  t: number;
  position: Vec3Tuple;
  rotationY: number;
  velocity: Vec3Tuple;
  grounded: boolean;
  carryingFish: boolean;
  fishGrip: number;
  animationState: string;
  /** Gameplay action pose (pounce / hiss / stagger …). */
  action: string;
  actionTime: number;
  /** Discontinuity (respawn): never interpolate into this snapshot. */
  cut?: boolean;
};

export type ReplayEventType = "jump" | "land" | "pounce" | "hiss" | "interact" | "fishDrop" | "fishPickup" | "respawn";

export type ReplayEvent = {
  t: number;
  type: ReplayEventType;
  payload?: {
    dirX?: number;
    dirZ?: number;
    target?: string;
    x?: number;
    y?: number;
    z?: number;
  };
};

export interface ReplayData {
  version: 1;
  catId: CatId;
  hz: number;
  duration: number;
  snapshots: ReplaySnapshot[];
  events: ReplayEvent[];
  /** True when the run ended at the Safe Rooftop. */
  finished: boolean;
}

/** Interpolated state produced by ReplayPlayer.sample(). */
export interface SampledState {
  t: number;
  position: Vec3Tuple;
  rotationY: number;
  velocity: Vec3Tuple;
  grounded: boolean;
  carryingFish: boolean;
  fishGrip: number;
  animationState: string;
  action: string;
  actionTime: number;
  index: number;
}

export function emptySample(): SampledState {
  return {
    t: 0,
    position: [0, 0, 0],
    rotationY: 0,
    velocity: [0, 0, 0],
    grounded: true,
    carryingFish: false,
    fishGrip: 3,
    animationState: "idle",
    action: "none",
    actionTime: 0,
    index: 0,
  };
}
