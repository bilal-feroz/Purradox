import * as THREE from "three";
import { PALETTE } from "../data/palette";

interface Print {
  alive: boolean;
  pos: THREE.Vector3;
  yaw: number;
  life: number;
  maxLife: number;
  delay: number;
  intensity: number;
  scale: number;
}

function pawGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const pad = new THREE.CircleGeometry(0.075, 7);
  pad.scale(1.15, 1, 1);
  parts.push(pad);
  const toes: Array<[number, number]> = [
    [-0.075, 0.085],
    [-0.027, 0.115],
    [0.027, 0.115],
    [0.075, 0.085],
  ];
  for (const [x, y] of toes) {
    const t = new THREE.CircleGeometry(0.028, 6);
    t.translate(x, y, 0);
    parts.push(t);
  }
  const merged = new THREE.BufferGeometry();
  const positions: number[] = [];
  for (const p of parts) {
    const g = p.index ? p.toNonIndexed() : p;
    const arr = g.getAttribute("position").array as Float32Array;
    for (let i = 0; i < arr.length; i++) positions.push(arr[i]);
  }
  merged.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  merged.rotateX(-Math.PI / 2);
  merged.rotateY(Math.PI); // toes point along +Z (the cat's forward)
  return merged;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _up = new THREE.Vector3(0, 1, 0);

/**
 * Sea-glass glowing pawprints (Scent Memory + Past You residue) on one
 * additive instanced mesh. Intensity encodes fade (additive black = gone).
 */
export class PawPrints {
  readonly mesh: THREE.InstancedMesh;
  private readonly prints: Print[] = [];
  private readonly color = new THREE.Color(PALETTE.seaGlass);

  constructor(scene: THREE.Scene, count = 128) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    this.mesh = new THREE.InstancedMesh(pawGeometry(), mat, count);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color(0, 0, 0));
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    scene.add(this.mesh);
    for (let i = 0; i < count; i++) {
      this.prints.push({ alive: false, pos: new THREE.Vector3(), yaw: 0, life: 0, maxLife: 1, delay: 0, intensity: 1, scale: 1 });
    }
  }

  add(x: number, y: number, z: number, yaw: number, intensity: number, life: number, delay = 0, scale = 1): void {
    let p = this.prints.find((q) => !q.alive);
    if (!p) {
      p = this.prints.reduce((a, b) => (a.life / a.maxLife > b.life / b.maxLife ? a : b));
    }
    p.alive = true;
    p.pos.set(x, y + 0.035, z);
    p.yaw = yaw;
    p.life = 0;
    p.maxLife = life;
    p.delay = delay;
    p.intensity = intensity;
    p.scale = scale;
  }

  clear(): void {
    for (const p of this.prints) p.alive = false;
    this.mesh.count = 0;
  }

  update(dt: number, time: number): void {
    let n = 0;
    for (const p of this.prints) {
      if (!p.alive) continue;
      if (p.delay > 0) {
        p.delay -= dt;
        continue;
      }
      p.life += dt;
      if (p.life >= p.maxLife) {
        p.alive = false;
        continue;
      }
      const t = p.life / p.maxLife;
      const fadeIn = Math.min(1, p.life / 0.18);
      const fadeOut = 1 - Math.pow(t, 2.2);
      const shimmer = 0.85 + Math.sin(time * 7 + p.pos.x * 3 + p.pos.z * 2) * 0.15;
      const k = p.intensity * fadeIn * fadeOut * shimmer;
      _q.setFromAxisAngle(_up, p.yaw);
      const pop = 0.75 + 0.25 * Math.min(1, p.life / 0.22);
      _s.setScalar(p.scale * pop);
      _m.compose(p.pos, _q, _s);
      this.mesh.setMatrixAt(n, _m);
      _c.copy(this.color).multiplyScalar(k * 1.6);
      this.mesh.setColorAt(n, _c);
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
