import * as THREE from "three";
import { PALETTE } from "../data/palette";
import { Random } from "../core/Random";

type Kind = "dust" | "star" | "spark" | "mote" | "line" | "feather" | "seed" | "scrap" | "puff";

interface Particle {
  kind: Kind;
  alive: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  size0: number;
  size1: number;
  rot: number;
  rotVel: number;
  gravity: number;
  drag: number;
  floorY: number;
  color: THREE.Color;
  /** Time-reversed playback: particles fly inward (rewind). */
  reverse: boolean;
}

interface Pool {
  mesh: THREE.InstancedMesh;
  particles: Particle[];
  billboard: boolean;
  stretch: boolean;
  additive: boolean;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _z = new THREE.Vector3(0, 0, 1);
const _dir = new THREE.Vector3();
const _roll = new THREE.Quaternion();
const _col = new THREE.Color();
const _eul = new THREE.Euler();

/** Comic burst with a "!" (UI bible palette). */
function exclaimTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.translate(64, 64);
  g.beginPath();
  const spikes = 9;
  for (let i = 0; i < spikes * 2; i++) {
    const a = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 === 0 ? 58 : 40;
    if (i === 0) g.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  g.closePath();
  g.fillStyle = "#f7cf55";
  g.fill();
  g.lineWidth = 7;
  g.strokeStyle = "#22384a";
  g.stroke();
  g.fillStyle = "#22384a";
  g.beginPath();
  g.moveTo(-9, -32);
  g.lineTo(9, -32);
  g.lineTo(5, 10);
  g.lineTo(-5, 10);
  g.closePath();
  g.fill();
  g.beginPath();
  g.arc(0, 24, 8, 0, Math.PI * 2);
  g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function starGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const pts = 4;
  for (let i = 0; i < pts * 2; i++) {
    const a = (i / (pts * 2)) * Math.PI * 2 + Math.PI / 2;
    const r = i % 2 === 0 ? 1 : 0.32;
    if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
}

/**
 * Pooled instanced particles: dust, impact stars and lines, sparkles,
 * feathers, seeds and temporal motes. Opaque kinds shrink to fade; additive
 * kinds dim to black. Everything is allocation-free after construction.
 */
export class Effects {
  private readonly pools = new Map<Kind, Pool>();
  private readonly rng = new Random(9001);
  private readonly camQuat = new THREE.Quaternion();
  readonly group = new THREE.Group();
  /** Arc meshes for hiss shockwaves. */
  private readonly arcs: Array<{ mesh: THREE.Mesh; life: number; max: number; perfect: boolean }> = [];
  /** Expanding ground rings (landing, fish pickup, temporal). */
  private readonly rings: Array<{ mesh: THREE.Mesh; life: number; max: number; scale: number }> = [];
  /** Comic "!" bursts telegraphing rival pounces. */
  private readonly exclaims: Array<{ sprite: THREE.Sprite; life: number; max: number; follow: THREE.Vector3 | null }> = [];

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
    const dustMat = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 1 });
    const basic = (additive: boolean) =>
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: additive,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        depthWrite: !additive,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
    this.addPool("dust", new THREE.IcosahedronGeometry(1, 0), dustMat, 160, false, false, false);
    this.addPool("puff", new THREE.IcosahedronGeometry(1, 0), dustMat.clone(), 60, false, false, false);
    this.addPool("star", starGeometry(), basic(false), 60, true, false, false);
    this.addPool("spark", new THREE.OctahedronGeometry(1, 0), basic(true), 160, false, false, true);
    this.addPool("mote", new THREE.OctahedronGeometry(1, 0), basic(true), 220, false, false, true);
    const lineGeo = new THREE.BoxGeometry(0.06, 0.06, 1);
    this.addPool("line", lineGeo, basic(true), 60, false, true, true);
    const featherGeo = new THREE.PlaneGeometry(0.16, 0.06);
    this.addPool("feather", featherGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide, flatShading: true }), 90, false, false, false);
    this.addPool("seed", new THREE.BoxGeometry(0.07, 0.05, 0.07), new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true }), 140, false, false, false);
    this.addPool("scrap", new THREE.TetrahedronGeometry(0.11, 0), new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true }), 40, false, false, false);

    // Hiss shockwave arcs
    for (let i = 0; i < 6; i++) {
      const geo = new THREE.RingGeometry(0.75, 1, 18, 1, -Math.PI * 0.36, Math.PI * 0.72);
      geo.rotateX(-Math.PI / 2);
      geo.rotateY(Math.PI / 2);
      const mat = new THREE.MeshBasicMaterial({
        color: 0xfff1d0,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      this.group.add(mesh);
      this.arcs.push({ mesh, life: 0, max: 0.35, perfect: false });
    }
    const exTex = exclaimTexture();
    for (let i = 0; i < 4; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: exTex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
      sprite.visible = false;
      sprite.renderOrder = 20;
      this.group.add(sprite);
      this.exclaims.push({ sprite, life: 1, max: 1, follow: null });
    }
    for (let i = 0; i < 6; i++) {
      const geo = new THREE.RingGeometry(0.8, 1, 24);
      geo.rotateX(-Math.PI / 2);
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      this.group.add(mesh);
      this.rings.push({ mesh, life: 0, max: 0.5, scale: 1 });
    }
  }

  private addPool(kind: Kind, geo: THREE.BufferGeometry, mat: THREE.Material, count: number, billboard: boolean, stretch: boolean, additive: boolean): void {
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    this.group.add(mesh);
    const particles: Particle[] = [];
    for (let i = 0; i < count; i++) {
      particles.push({
        kind,
        alive: false,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        life: 0,
        maxLife: 1,
        size0: 0.1,
        size1: 0,
        rot: 0,
        rotVel: 0,
        gravity: 0,
        drag: 0,
        floorY: -1e9,
        color: new THREE.Color(1, 1, 1),
        reverse: false,
      });
    }
    this.pools.set(kind, { mesh, particles, billboard, stretch, additive });
  }

  private spawn(kind: Kind): Particle | null {
    const pool = this.pools.get(kind);
    if (!pool) return null;
    let oldest: Particle | null = null;
    for (const p of pool.particles) {
      if (!p.alive) {
        p.alive = true;
        p.reverse = false;
        p.floorY = -1e9;
        return p;
      }
      if (!oldest || p.life / p.maxLife > oldest.life / oldest.maxLife) oldest = p;
    }
    if (oldest) {
      oldest.reverse = false;
      oldest.floorY = -1e9;
    }
    return oldest;
  }

  // ------------------------------------------------------------------ emitters

  dust(pos: THREE.Vector3, count: number, spread = 0.6, upward = 1.2, size = 0.16, color = 0xe8d6b8): void {
    for (let i = 0; i < count; i++) {
      const p = this.spawn("dust");
      if (!p) return;
      const a = this.rng.range(0, Math.PI * 2);
      const s = this.rng.range(0.3, 1) * spread;
      p.pos.set(pos.x + Math.cos(a) * 0.15, pos.y + 0.05, pos.z + Math.sin(a) * 0.15);
      p.vel.set(Math.cos(a) * s * 2.2, this.rng.range(0.2, 1) * upward, Math.sin(a) * s * 2.2);
      p.life = 0;
      p.maxLife = this.rng.range(0.35, 0.6);
      p.size0 = size * this.rng.range(0.7, 1.3);
      p.size1 = 0;
      p.rot = this.rng.range(0, 6);
      p.rotVel = this.rng.range(-3, 3);
      p.gravity = -0.6;
      p.drag = 3.5;
      p.color.setHex(color);
    }
  }

  /** Directional dust kicked behind a moving cat. */
  trailDust(pos: THREE.Vector3, back: THREE.Vector3, size = 0.12): void {
    const p = this.spawn("dust");
    if (!p) return;
    p.pos.set(pos.x + this.rng.range(-0.12, 0.12), pos.y + 0.04, pos.z + this.rng.range(-0.12, 0.12));
    p.vel.set(back.x * 1.4 + this.rng.range(-0.3, 0.3), this.rng.range(0.3, 0.9), back.z * 1.4 + this.rng.range(-0.3, 0.3));
    p.life = 0;
    p.maxLife = this.rng.range(0.3, 0.5);
    p.size0 = size * this.rng.range(0.7, 1.2);
    p.size1 = 0;
    p.rot = 0;
    p.rotVel = 2;
    p.gravity = -0.4;
    p.drag = 4;
    p.color.setHex(0xe9d9bc);
  }

  impact(pos: THREE.Vector3, strong = false): void {
    const n = strong ? 7 : 5;
    for (let i = 0; i < n; i++) {
      const p = this.spawn("star");
      if (!p) break;
      const a = (i / n) * Math.PI * 2 + this.rng.range(-0.3, 0.3);
      const up = this.rng.range(0.4, 1);
      p.pos.copy(pos);
      p.vel.set(Math.cos(a) * 3.2, 2.2 + up * 2.2, Math.sin(a) * 3.2);
      p.life = 0;
      p.maxLife = this.rng.range(0.4, 0.6);
      p.size0 = (strong ? 0.2 : 0.15) * this.rng.range(0.8, 1.2);
      p.size1 = 0.02;
      p.rot = this.rng.range(0, 6);
      p.rotVel = this.rng.range(-10, 10);
      p.gravity = -7;
      p.drag = 2.5;
      p.color.setHex(i % 2 === 0 ? 0xffd34d : 0xfff4c8);
    }
    const lines = strong ? 10 : 7;
    for (let i = 0; i < lines; i++) {
      const p = this.spawn("line");
      if (!p) break;
      const a = (i / lines) * Math.PI * 2;
      const e = this.rng.range(-0.5, 0.7);
      _dir.set(Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e)).normalize();
      p.pos.copy(pos).addScaledVector(_dir, 0.3);
      p.vel.copy(_dir).multiplyScalar(this.rng.range(6, 9));
      p.life = 0;
      p.maxLife = 0.18;
      p.size0 = 0.55;
      p.size1 = 0.1;
      p.gravity = 0;
      p.drag = 6;
      p.color.setHex(0xfff2c0);
    }
    this.ring(pos, strong ? 1.6 : 1.1, 0xfff0c8, 0.3);
  }

  sparkle(pos: THREE.Vector3, count: number, color = 0xfff3b0, speed = 2.5, life = 0.7): void {
    for (let i = 0; i < count; i++) {
      const p = this.spawn("spark");
      if (!p) return;
      const a = this.rng.range(0, Math.PI * 2);
      const e = this.rng.range(-0.2, 1.2);
      p.pos.copy(pos);
      p.vel.set(Math.cos(a) * Math.cos(e) * speed, Math.sin(e) * speed + 0.5, Math.sin(a) * Math.cos(e) * speed);
      p.life = 0;
      p.maxLife = this.rng.range(life * 0.6, life * 1.2);
      p.size0 = this.rng.range(0.04, 0.08);
      p.size1 = 0;
      p.rot = this.rng.range(0, 6);
      p.rotVel = this.rng.range(-6, 6);
      p.gravity = -1.5;
      p.drag = 2.4;
      p.color.setHex(color);
    }
  }

  /** Single twinkle (fish idle sparkle). */
  twinkle(pos: THREE.Vector3, color = 0xfff6c9, size = 0.09): void {
    const p = this.spawn("star");
    if (!p) return;
    p.pos.copy(pos);
    p.vel.set(0, 0.25, 0);
    p.life = 0;
    p.maxLife = 0.55;
    p.size0 = size;
    p.size1 = 0;
    p.rot = 0;
    p.rotVel = 3;
    p.gravity = 0;
    p.drag = 0;
    p.color.setHex(color);
  }

  motes(pos: THREE.Vector3, count: number, radius = 0.5, color: number = PALETTE.seaGlass, rise = 0.6): void {
    for (let i = 0; i < count; i++) {
      const p = this.spawn("mote");
      if (!p) return;
      p.pos.set(pos.x + this.rng.range(-radius, radius), pos.y + this.rng.range(0, radius * 1.4), pos.z + this.rng.range(-radius, radius));
      p.vel.set(this.rng.range(-0.15, 0.15), this.rng.range(0.2, 1) * rise, this.rng.range(-0.15, 0.15));
      p.life = 0;
      p.maxLife = this.rng.range(0.6, 1.3);
      p.size0 = this.rng.range(0.025, 0.05);
      p.size1 = 0;
      p.rot = this.rng.range(0, 6);
      p.rotVel = this.rng.range(-3, 3);
      p.gravity = 0;
      p.drag = 0.8;
      p.color.setHex(color);
    }
  }

  /** Motes that converge into a point — used while time runs backwards. */
  reverseMotes(target: THREE.Vector3, count: number, radius = 2.5): void {
    for (let i = 0; i < count; i++) {
      const p = this.spawn("mote");
      if (!p) return;
      const a = this.rng.range(0, Math.PI * 2);
      const r = this.rng.range(radius * 0.4, radius);
      p.pos.set(target.x + Math.cos(a) * r, target.y + this.rng.range(-0.5, 2), target.z + Math.sin(a) * r);
      p.vel.set(target.x - p.pos.x, target.y + 0.5 - p.pos.y, target.z - p.pos.z).multiplyScalar(1.4);
      p.life = 0;
      p.maxLife = this.rng.range(0.5, 0.9);
      p.size0 = this.rng.range(0.03, 0.07);
      p.size1 = 0.0;
      p.rot = 0;
      p.rotVel = 4;
      p.gravity = 0;
      p.drag = 0;
      p.color.setHex(this.rng.chance(0.25) ? PALETTE.temporalPink : PALETTE.seaGlass);
      p.reverse = true;
    }
  }

  feathers(pos: THREE.Vector3, count: number): void {
    for (let i = 0; i < count; i++) {
      const p = this.spawn("feather");
      if (!p) return;
      const a = this.rng.range(0, Math.PI * 2);
      p.pos.set(pos.x, pos.y + 0.2, pos.z);
      p.vel.set(Math.cos(a) * this.rng.range(0.5, 2.2), this.rng.range(1, 3.2), Math.sin(a) * this.rng.range(0.5, 2.2));
      p.life = 0;
      p.maxLife = this.rng.range(1.2, 2.2);
      p.size0 = this.rng.range(0.8, 1.3);
      p.size1 = 0.4;
      p.rot = this.rng.range(0, 6);
      p.rotVel = this.rng.range(-8, 8);
      p.gravity = -1.1;
      p.drag = 2.2;
      p.floorY = pos.y + 0.02;
      p.color.setHex(this.rng.pick([0x8a8b94, 0x9c9da5, 0x55565d, 0xb5b6bd]));
    }
  }

  seeds(pos: THREE.Vector3, count: number, floorY: number): void {
    for (let i = 0; i < count; i++) {
      const p = this.spawn("seed");
      if (!p) return;
      const a = this.rng.range(0, Math.PI * 2);
      const s = this.rng.range(0.5, 2.6);
      p.pos.set(pos.x, pos.y + 0.25, pos.z);
      p.vel.set(Math.cos(a) * s, this.rng.range(1.5, 3.5), Math.sin(a) * s);
      p.life = 0;
      p.maxLife = this.rng.range(5, 7);
      p.size0 = 1;
      p.size1 = 0.9;
      p.rot = this.rng.range(0, 6);
      p.rotVel = this.rng.range(-8, 8);
      p.gravity = -12;
      p.drag = 0.6;
      p.floorY = floorY + 0.025;
      p.color.setHex(this.rng.pick([0xe9b949, 0xd99d36, 0xf2cf6b]));
    }
  }

  scraps(pos: THREE.Vector3, count: number, floorY: number): void {
    for (let i = 0; i < count; i++) {
      const p = this.spawn("scrap");
      if (!p) return;
      const a = this.rng.range(0, Math.PI * 2);
      const s = this.rng.range(0.6, 2);
      p.pos.set(pos.x, pos.y + 0.2, pos.z);
      p.vel.set(Math.cos(a) * s, this.rng.range(1.5, 3), Math.sin(a) * s);
      p.life = 0;
      p.maxLife = this.rng.range(4, 6);
      p.size0 = 1;
      p.size1 = 0.8;
      p.rot = this.rng.range(0, 6);
      p.rotVel = this.rng.range(-8, 8);
      p.gravity = -12;
      p.drag = 0.6;
      p.floorY = floorY + 0.05;
      p.color.setHex(this.rng.pick([0xe07a6a, 0xf0e2c8, 0x3f6f86]));
    }
  }

  puff(pos: THREE.Vector3, count: number, color = 0xf5ede0, size = 0.35): void {
    for (let i = 0; i < count; i++) {
      const p = this.spawn("puff");
      if (!p) return;
      const a = this.rng.range(0, Math.PI * 2);
      p.pos.set(pos.x + Math.cos(a) * 0.3, pos.y + this.rng.range(0, 0.4), pos.z + Math.sin(a) * 0.3);
      p.vel.set(Math.cos(a) * 1.6, this.rng.range(0.4, 1.6), Math.sin(a) * 1.6);
      p.life = 0;
      p.maxLife = this.rng.range(0.4, 0.7);
      p.size0 = size * this.rng.range(0.7, 1.2);
      p.size1 = 0;
      p.rot = this.rng.range(0, 6);
      p.rotVel = this.rng.range(-2, 2);
      p.gravity = 0.5;
      p.drag = 3;
      p.color.setHex(color);
    }
  }

  hissWave(pos: THREE.Vector3, yaw: number, perfect: boolean): void {
    const arc = this.arcs.find((a) => a.life >= a.max) ?? this.arcs[0];
    arc.life = 0;
    arc.max = perfect ? 0.45 : 0.32;
    arc.perfect = perfect;
    arc.mesh.position.set(pos.x, pos.y + 0.45, pos.z);
    arc.mesh.rotation.set(0, yaw - Math.PI / 2, 0);
    const mat = arc.mesh.material as THREE.MeshBasicMaterial;
    mat.color.setHex(perfect ? 0xffd34d : 0xfff1d0);
    arc.mesh.visible = true;
  }

  /** Pop a "!" above a cat (follows `follow` if given). */
  exclaim(follow: THREE.Vector3, life = 0.42): void {
    const e = this.exclaims.find((x) => x.life >= x.max) ?? this.exclaims[0];
    e.life = 0;
    e.max = life;
    e.follow = follow;
    e.sprite.visible = true;
  }

  ring(pos: THREE.Vector3, scale: number, color: number, life = 0.45): void {
    const r = this.rings.find((x) => x.life >= x.max) ?? this.rings[0];
    r.life = 0;
    r.max = life;
    r.scale = scale;
    r.mesh.position.set(pos.x, pos.y + 0.06, pos.z);
    (r.mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
    r.mesh.visible = true;
  }

  clear(): void {
    for (const pool of this.pools.values()) {
      for (const p of pool.particles) p.alive = false;
      pool.mesh.count = 0;
    }
    for (const a of this.arcs) {
      a.life = a.max;
      a.mesh.visible = false;
    }
    for (const r of this.rings) {
      r.life = r.max;
      r.mesh.visible = false;
    }
    for (const e of this.exclaims) {
      e.life = e.max;
      e.follow = null;
      e.sprite.visible = false;
    }
  }

  /** Reverse every live particle's motion (used when the rewind starts). */
  reverseAll(): void {
    for (const pool of this.pools.values()) {
      for (const p of pool.particles) {
        if (!p.alive) continue;
        p.vel.multiplyScalar(-1);
        p.gravity = -p.gravity;
        p.floorY = -1e9;
      }
    }
  }

  update(dt: number, camera: THREE.Camera): void {
    camera.getWorldQuaternion(this.camQuat);
    for (const pool of this.pools.values()) {
      let n = 0;
      for (const p of pool.particles) {
        if (!p.alive) continue;
        p.life += dt;
        if (p.life >= p.maxLife) {
          p.alive = false;
          continue;
        }
        p.vel.y += p.gravity * dt;
        p.vel.multiplyScalar(Math.exp(-p.drag * dt));
        p.pos.addScaledVector(p.vel, dt);
        if (p.pos.y < p.floorY) {
          p.pos.y = p.floorY;
          p.vel.set(0, 0, 0);
          p.rotVel = 0;
          p.gravity = 0;
        }
        p.rot += p.rotVel * dt;
        const t = p.life / p.maxLife;
        let size = p.size0 + (p.size1 - p.size0) * t;
        if (p.kind === "seed" || p.kind === "scrap") size = t > 0.85 ? p.size0 * (1 - (t - 0.85) / 0.15) : p.size0;
        if (p.kind === "dust" || p.kind === "puff") size = p.size0 * Math.sin(Math.min(1, t * 1.6 + 0.15) * Math.PI) * (1 - t * 0.4);
        if (size <= 0.0001) continue;

        if (pool.billboard) {
          _roll.setFromAxisAngle(_z, p.rot);
          _q.copy(this.camQuat).multiply(_roll);
          _s.setScalar(size);
        } else if (pool.stretch) {
          _dir.copy(p.vel);
          const sp = _dir.length();
          if (sp > 1e-4) _dir.divideScalar(sp);
          else _dir.set(0, 1, 0);
          _q.setFromUnitVectors(_z, _dir);
          _s.set(1, 1, size);
        } else {
          _q.setFromEuler(_eul.set(p.rot, p.rot * 0.7, p.rot * 0.3));
          _s.setScalar(size);
        }
        _p.copy(p.pos);
        _m.compose(_p, _q, _s);
        pool.mesh.setMatrixAt(n, _m);
        if (pool.additive) {
          const fade = p.reverse ? Math.sin(t * Math.PI) : 1 - t;
          _col.copy(p.color).multiplyScalar(fade);
        } else {
          _col.copy(p.color);
        }
        pool.mesh.setColorAt(n, _col);
        n++;
      }
      pool.mesh.count = n;
      pool.mesh.instanceMatrix.needsUpdate = true;
      if (pool.mesh.instanceColor) pool.mesh.instanceColor.needsUpdate = true;
    }
    for (const a of this.arcs) {
      if (a.life >= a.max) continue;
      a.life += dt;
      const t = Math.min(1, a.life / a.max);
      const s = 0.6 + t * (a.perfect ? 3.4 : 2.6);
      a.mesh.scale.set(s, s, s);
      (a.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - t) * (a.perfect ? 0.95 : 0.6);
      if (a.life >= a.max) a.mesh.visible = false;
    }
    for (const e of this.exclaims) {
      if (e.life >= e.max) continue;
      e.life += dt;
      const t = Math.min(1, e.life / e.max);
      const pop = t < 0.25 ? 0.4 + (t / 0.25) * 0.75 : 1.15 - (t - 0.25) * 0.2;
      if (e.follow) e.sprite.position.set(e.follow.x, e.follow.y + 1.15 + t * 0.15, e.follow.z);
      e.sprite.scale.setScalar(0.62 * pop);
      (e.sprite.material as THREE.SpriteMaterial).opacity = t > 0.8 ? (1 - t) / 0.2 : 1;
      if (e.life >= e.max) e.sprite.visible = false;
    }
    for (const r of this.rings) {
      if (r.life >= r.max) continue;
      r.life += dt;
      const t = Math.min(1, r.life / r.max);
      const s = 0.2 + t * r.scale;
      r.mesh.scale.set(s, s, s);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - t) * 0.7;
      if (r.life >= r.max) r.mesh.visible = false;
    }
  }
}
