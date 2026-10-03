import * as THREE from "three";
import { CATS } from "../data/cats";
import { PALETTE } from "../data/palette";
import type { CatActor } from "../cats/CatActor";
import { applyPose, buildCat, capturePose, poseSize, type CatRig } from "../cats/CatModel";
import type { CatAction } from "../player/CatAnimator";
import type { Effects } from "../rendering/Effects";
import type { PawPrints } from "../rendering/PawPrints";
import { ReplayPlayer } from "./ReplayPlayer";
import { emptySample, type ReplayData, type ReplayEvent } from "./ReplayTypes";

const RIM_UNIFORMS = {
  rimColor: { value: new THREE.Color(PALETTE.seaGlass) },
  rimStrength: { value: 0.4 },
};

/** Clone a material and add a thin sea-glass fresnel rim (Past You look). */
function withRim(base: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  const m = base.clone();
  m.onBeforeCompile = (shader) => {
    shader.uniforms.rimColor = RIM_UNIFORMS.rimColor;
    shader.uniforms.rimStrength = RIM_UNIFORMS.rimStrength;
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 rimColor;\nuniform float rimStrength;")
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
         float rimF = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 3.8);
         totalEmissiveRadiance += rimColor * rimF * rimStrength;`,
      );
  };
  m.customProgramCacheKey = () => "purradox-echo-rim";
  return m;
}

interface Ghost {
  rig: CatRig;
  delay: number;
  frames: number;
  mat: THREE.MeshBasicMaterial;
}

/**
 * Drives Fish Cat as "Past You" from a recorded run. The transform is
 * always the authoritative replay sample; hits only add a visual flinch
 * that springs back, so the timeline can never be pushed off course.
 */
export class EchoController {
  player: ReplayPlayer | null = null;
  time = 0;
  running = false;
  finished = false;
  readonly authoritative = new THREE.Vector3();
  private readonly sample = emptySample();
  private readonly ghosts: Ghost[] = [];
  private readonly poseRing: Float32Array[] = [];
  private ringHead = 0;
  private moteTimer = 0;
  private readonly echoFur: THREE.MeshStandardMaterial;
  private readonly echoEye: THREE.MeshStandardMaterial;
  private looks = false;
  onEvent: ((ev: ReplayEvent) => void) | null = null;
  readonly tmp = new THREE.Vector3();

  constructor(
    readonly actor: CatActor,
    private readonly scene: THREE.Scene,
    furMat: THREE.MeshStandardMaterial,
    eyeMat: THREE.MeshStandardMaterial,
    private readonly effects: Effects,
    private readonly prints: PawPrints,
  ) {
    this.echoFur = withRim(furMat);
    this.echoEye = withRim(eyeMat);
    for (const m of actor.rig.meshes) m.userData.baseMat = m.material;
    // Two faint, offset afterimages (sea-glass + pink) read as a subtle
    // chromatic split while Past You moves — never a full ghost.
    const tints = [PALETTE.seaGlass, PALETTE.temporalPink];
    const delays = [0.09, 0.17];
    for (let i = 0; i < 2; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: tints[i],
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      });
      const rig = buildCat(CATS.fishcat, { fur: mat, eye: mat });
      for (const m of rig.meshes) {
        m.castShadow = false;
        m.receiveShadow = false;
      }
      rig.root.visible = false;
      scene.add(rig.root);
      this.ghosts.push({ rig, delay: delays[i], frames: 5 + i * 5, mat });
    }
    const size = poseSize(actor.rig);
    for (let i = 0; i < 16; i++) this.poseRing.push(new Float32Array(size));
  }

  load(data: ReplayData): void {
    this.player = new ReplayPlayer(data);
    this.time = 0;
    this.finished = false;
    this.running = false;
  }

  get duration(): number {
    return this.player ? this.player.duration : 0;
  }

  get progress(): number {
    return this.player ? Math.min(1, this.time / Math.max(0.001, this.player.duration)) : 0;
  }

  /** Place Past You at the recording's first frame without starting. */
  prime(): void {
    if (!this.player) return;
    this.player.reset();
    this.time = 0;
    this.finished = false;
    this.player.sample(0, this.sample);
    this.applySample(0);
    this.actor.teleport(this.authoritative, this.sample.rotationY);
  }

  start(): void {
    if (!this.player) return;
    this.running = true;
  }

  stop(): void {
    this.running = false;
  }

  setEchoLook(on: boolean): void {
    this.looks = on;
    for (const m of this.actor.rig.meshes) {
      const base = m.userData.baseMat as THREE.Material;
      if (!on) m.material = base;
      else m.material = (base as THREE.MeshStandardMaterial).roughness < 0.5 ? this.echoEye : this.echoFur;
    }
    for (const g of this.ghosts) g.rig.root.visible = on;
    if (!on) for (const g of this.ghosts) g.mat.opacity = 0;
  }

  private applySample(dt: number): void {
    const s = this.sample;
    this.authoritative.set(s.position[0], s.position[1], s.position[2]);
    const r = this.actor.replay ?? {
      position: new THREE.Vector3(),
      yaw: 0,
      velocity: new THREE.Vector3(),
      grounded: true,
      action: "none" as CatAction,
      actionTime: 0,
    };
    r.position.copy(this.authoritative);
    r.yaw = s.rotationY;
    r.velocity.set(s.velocity[0], s.velocity[1], s.velocity[2]);
    r.grounded = s.grounded;
    r.action = (s.action as CatAction) || "none";
    r.actionTime = s.actionTime;
    this.actor.replay = r;
    void dt;
  }

  update(dt: number, time: number): void {
    if (!this.player) return;
    if (this.running && !this.finished) {
      this.time += dt;
      if (this.time >= this.player.duration) {
        this.time = this.player.duration;
        this.finished = true;
      }
    }
    this.player.sample(this.time, this.sample);
    this.applySample(dt);
    const ab = this.actor.abilities;
    if (ab.pounceState === "active" && this.sample.action !== "pounce") ab.endPounce();
    if (this.running) {
      for (const ev of this.player.poll(this.time)) this.onEvent?.(ev);
    }
    this.actor.update(dt);

    if (!this.looks) return;
    // pose history for afterimages
    capturePose(this.actor.rig, this.poseRing[this.ringHead]);
    const head = this.ringHead;
    this.ringHead = (this.ringHead + 1) % this.poseRing.length;
    const speed = Math.hypot(this.sample.velocity[0], this.sample.velocity[2]);
    const fade = Math.min(1, Math.max(0, (speed - 2.5) / 4));
    for (const g of this.ghosts) {
      const idx = (head - g.frames + this.poseRing.length * 4) % this.poseRing.length;
      applyPose(g.rig, this.poseRing[idx]);
      const tPast = Math.max(0, this.time - g.delay);
      this.player.sample(tPast, this.ghostSample);
      g.rig.root.position.set(this.ghostSample.position[0], this.ghostSample.position[1], this.ghostSample.position[2]);
      g.rig.root.rotation.y = this.ghostSample.rotationY;
      g.mat.opacity = fade * (g.delay < 0.12 ? 0.085 : 0.06);
    }
    // keep the main sample cursor consistent after ghost sampling
    this.player.sample(this.time, this.sample);

    // temporal motes + faint residue prints
    this.moteTimer -= dt;
    if (this.moteTimer <= 0) {
      this.moteTimer = 0.11;
      this.effects.motes(this.tmp.copy(this.actor.position).setY(this.actor.position.y + 0.35), 1, 0.4, PALETTE.seaGlass, 0.45);
    }
    if (this.actor.grounded) {
      for (const _leg of this.actor.animator.footDown) {
        const yaw = this.actor.yaw;
        const side = Math.random() < 0.5 ? 1 : -1;
        const px = this.actor.position.x + Math.cos(yaw) * 0.1 * side;
        const pz = this.actor.position.z - Math.sin(yaw) * 0.1 * side;
        this.prints.add(px, this.actor.position.y, pz, yaw, 0.22, 1.4);
        void _leg;
      }
    }
    RIM_UNIFORMS.rimStrength.value = 0.38 + Math.sin(time * 3.1) * 0.07;
  }

  private readonly ghostSample = emptySample();

  dispose(): void {
    for (const g of this.ghosts) this.scene.remove(g.rig.root);
  }
}
