import * as THREE from "three";
import { damp } from "../core/math";

/**
 * Warm late-afternoon sun + sky/ground hemisphere fill. The sun's shadow
 * frustum follows the action and is snapped to shadow-map texels so edges
 * do not shimmer while the camera moves.
 */
export class Lighting {
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly ambient: THREE.AmbientLight;
  private readonly sunOffset = new THREE.Vector3(-34, 46, 24);
  private readonly focus = new THREE.Vector3();
  private readonly shadowSize = 34;
  private readonly mapSize = 2048;
  /** 0 = Round 1 warm, 1 = Round 2 slightly cooler fill. */
  temporalBlend = 0;
  private readonly warmHemiSky = new THREE.Color(0xb9d8f2);
  private readonly coolHemiSky = new THREE.Color(0xa8e6ee);
  private readonly warmSun = new THREE.Color(0xffd6a0);
  private readonly coolSun = new THREE.Color(0xffe6c8);

  constructor(scene: THREE.Scene) {
    this.hemi = new THREE.HemisphereLight(0xb9d8f2, 0xd9b48a, 0.95);
    scene.add(this.hemi);
    this.ambient = new THREE.AmbientLight(0xfff1de, 0.12);
    scene.add(this.ambient);

    this.sun = new THREE.DirectionalLight(0xffd6a0, 2.5);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(this.mapSize, this.mapSize);
    const cam = this.sun.shadow.camera;
    cam.left = -this.shadowSize;
    cam.right = this.shadowSize;
    cam.top = this.shadowSize;
    cam.bottom = -this.shadowSize;
    cam.near = 1;
    cam.far = 160;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.035;
    this.sun.shadow.radius = 2.2;
    scene.add(this.sun);
    scene.add(this.sun.target);
  }

  setFocus(p: THREE.Vector3, snap = false): void {
    if (snap) this.focus.copy(p);
    else this.focus.lerp(p, 0.2);
  }

  update(dt: number): void {
    // Snap focus to texel grid in light space to avoid shadow swimming.
    const texel = (this.shadowSize * 2) / this.mapSize;
    const sunDir = this.sunOffset.clone().normalize();
    const up = Math.abs(sunDir.y) > 0.99 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(up, sunDir).normalize();
    const lup = new THREE.Vector3().crossVectors(sunDir, right).normalize();
    const fx = Math.round(this.focus.dot(right) / texel) * texel;
    const fy = Math.round(this.focus.dot(lup) / texel) * texel;
    const fz = this.focus.dot(sunDir);
    const snapped = new THREE.Vector3().addScaledVector(right, fx).addScaledVector(lup, fy).addScaledVector(sunDir, fz);
    this.sun.position.copy(snapped).add(this.sunOffset);
    this.sun.target.position.copy(snapped);
    this.sun.target.updateMatrixWorld();

    const t = this.temporalBlend;
    this.hemi.color.copy(this.warmHemiSky).lerp(this.coolHemiSky, t);
    this.sun.color.copy(this.warmSun).lerp(this.coolSun, t);
    this.hemi.intensity = damp(this.hemi.intensity, 0.95 + t * 0.12, 4, dt);
  }
}
