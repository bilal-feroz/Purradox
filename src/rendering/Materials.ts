import * as THREE from "three";
import { PALETTE } from "../data/palette";

/**
 * Shared materials. Almost everything uses one vertex-colored, flat-shaded,
 * matte material so the static level batches into a handful of draw calls.
 */
export class Materials {
  readonly world: THREE.MeshStandardMaterial;
  readonly cat: THREE.MeshStandardMaterial;
  readonly glossy: THREE.MeshStandardMaterial;
  readonly glow: THREE.MeshStandardMaterial;
  readonly glass: THREE.MeshStandardMaterial;
  readonly foliage: THREE.MeshStandardMaterial;
  readonly cloth: THREE.MeshStandardMaterial;

  constructor() {
    this.world = new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      roughness: 0.93,
      metalness: 0,
    });
    this.foliage = new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      roughness: 0.85,
      metalness: 0,
    });
    this.cat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      roughness: 0.82,
      metalness: 0,
    });
    this.glossy = new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      roughness: 0.32,
      metalness: 0,
    });
    this.glow = new THREE.MeshStandardMaterial({
      color: PALETTE.lampGlow,
      emissive: 0xffb347,
      emissiveIntensity: 1.6,
      flatShading: true,
      roughness: 0.6,
    });
    this.glass = new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      roughness: 0.25,
      metalness: 0.05,
    });
    this.cloth = new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      roughness: 0.95,
      metalness: 0,
      side: THREE.DoubleSide,
    });
  }
}
