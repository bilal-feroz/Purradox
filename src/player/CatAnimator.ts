import * as THREE from "three";
import type { CatRig, LegRig } from "../cats/CatModel";
import { angleDelta, clamp, clamp01, damp, dampFactor, lerp, smoothstep } from "../core/math";

export type CatAction =
  | "none"
  | "pounceWindup"
  | "pounce"
  | "pounceRecover"
  | "hiss"
  | "stagger"
  | "hesitate"
  | "victory"
  | "crouch"
  | "eat"
  | "tangled"
  | "sit";

export interface AnimInput {
  speed: number;
  velY: number;
  grounded: boolean;
  sprinting: boolean;
  turnRate: number;
  action: CatAction;
  actionTime: number;
  carrying: boolean;
  lookTarget: THREE.Vector3 | null;
  airTime: number;
  meow: number;
  /** Seconds the hiss pose should puff for (scales arch strength). */
  rootYaw: number;
  rootPos: THREE.Vector3;
}

interface Gait {
  duty: number;
  offsets: { FL: number; FR: number; BL: number; BR: number };
  lift: number;
}

const WALK: Gait = { duty: 0.62, offsets: { BL: 0, FL: 0.25, BR: 0.5, FR: 0.75 }, lift: 0.055 };
const TROT: Gait = { duty: 0.5, offsets: { FL: 0, BR: 0, FR: 0.5, BL: 0.5 }, lift: 0.08 };
const GALLOP: Gait = { duty: 0.36, offsets: { BL: 0, BR: 0.08, FL: 0.48, FR: 0.58 }, lift: 0.11 };

type LegKey = "FL" | "FR" | "BL" | "BR";
const LEG_KEYS: LegKey[] = ["FL", "FR", "BL", "BR"];

const _v = new THREE.Vector3();

/**
 * Procedural animation: two-bone leg IK on a gait cycle (walk → trot →
 * gallop by speed), body bob/pitch/lean, squash & stretch, head tracking,
 * ear flicks, blinking and a traveling-wave tail, plus authored poses for
 * pounce, hiss, stagger, hesitation and the smug victory sit.
 */
export class CatAnimator {
  private phase = Math.random();
  private time = Math.random() * 10;
  private squash = 1;
  private squashVel = 0;
  private stretchZ = 1;
  private bodyDrop = 0;
  private pitch = 0;
  private roll = 0;
  private headYaw = 0;
  private headPitch = 0;
  private neckPitch = 0;
  private jawOpen = 0;
  private earBack = 0;
  private tailPuff = 1;
  private blinkTimer = 2 + Math.random() * 3;
  private blink = 1;
  private earTwitch = 0;
  private earTwitchSide = 1;
  private earTwitchTimer = 3 + Math.random() * 4;

  /** A sound off to one side (1 = the cat's left): flick that ear toward it. */
  flickEar(side: 1 | -1): void {
    this.earTwitch = 1;
    this.earTwitchSide = side;
    this.earTwitchTimer = Math.max(this.earTwitchTimer, 1.2);
  }
  private sitBlend = 0;
  private wasGrounded = true;
  private gaitW = { walk: 1, trot: 0, gallop: 0 };
  private readonly legBlend: Record<LegKey, { y: number; z: number }> = {
    FL: { y: 0, z: 0 },
    FR: { y: 0, z: 0 },
    BL: { y: 0, z: 0 },
    BR: { y: 0, z: 0 },
  };
  /** Exposed for footstep sounds: legs that touched down this frame. */
  readonly footDown: LegKey[] = [];
  private prevStance: Record<LegKey, boolean> = { FL: true, FR: true, BL: true, BR: true };

  constructor(private readonly rig: CatRig) {}

  /** Inject a landing impact (0..1). */
  land(impact: number): void {
    this.squash = Math.min(this.squash, 1 - 0.28 * clamp01(impact));
    this.squashVel = 0;
  }

  /** Kick the squash spring outward (takeoff stretch). */
  takeoff(): void {
    this.squashVel += 3.2;
  }

  update(dt: number, inp: AnimInput): void {
    const rig = this.rig;
    const P = rig.def.proportions;
    this.time += dt;
    this.footDown.length = 0;

    // ------------------------------------------------------------ gait mix
    const speed = inp.speed;
    const wWalk = 1 - smoothstep(1.8, 3.0, speed);
    const wGallop = smoothstep(6.4, 7.4, speed);
    const wTrot = Math.max(0, 1 - wWalk - wGallop);
    const k = dampFactor(10, dt);
    this.gaitW.walk += (wWalk - this.gaitW.walk) * k;
    this.gaitW.trot += (wTrot - this.gaitW.trot) * k;
    this.gaitW.gallop += (wGallop - this.gaitW.gallop) * k;
    const gw = this.gaitW;
    const strideMax = 0.24 + P.legLength * 0.95;
    const duty = WALK.duty * gw.walk + TROT.duty * gw.trot + GALLOP.duty * gw.gallop;
    const baseFreq = 1.7;
    const stride = Math.min((speed * duty) / baseFreq, strideMax);
    const freq = Math.max(baseFreq, (speed * duty) / Math.max(strideMax, 0.01));
    const moving = speed > 0.25 && inp.grounded;
    if (moving) this.phase = (this.phase + dt * freq) % 1;

    const action = inp.action;
    const at = inp.actionTime;

    // ------------------------------------------------------------ targets
    let targetDrop = 0;
    let targetPitch = 0;
    let targetStretch = 1;
    let targetNeck = 0;
    let targetJaw = 0;
    let targetEarBack = 0;
    let targetPuff = 1;
    let rollExtra = 0;
    let sit = 0;

    if (moving) {
      targetNeck = 0.12 * gw.trot + 0.28 * gw.gallop;
      const bobPhase = this.phase * Math.PI * 2;
      targetDrop = -(Math.cos(bobPhase * 2) * 0.012 * gw.trot + Math.sin(bobPhase) * 0.035 * gw.gallop);
      targetPitch = Math.sin(bobPhase + 1.3) * 0.11 * gw.gallop;
      targetEarBack = 0.35 * gw.gallop;
    } else if (inp.grounded) {
      // idle breathing
      targetDrop = Math.sin(this.time * 2.2) * 0.006;
    }

    if (!inp.grounded) {
      const rising = inp.velY > 0.5;
      targetPitch = rising ? -0.2 : clamp(-inp.velY * 0.03, -0.1, 0.22);
      targetNeck = rising ? -0.1 : 0.1;
    }
    if (inp.carrying) {
      targetNeck -= 0.22;
      targetJaw = 0.14;
    }

    switch (action) {
      case "pounceWindup": {
        targetDrop = 0.09;
        targetPitch = 0.12;
        targetEarBack = 0.6;
        targetNeck = 0.15;
        break;
      }
      case "pounce": {
        targetPitch = -0.12;
        targetStretch = 1.24;
        targetEarBack = 1;
        targetNeck = 0.05;
        targetJaw = inp.carrying ? 0.14 : 0.32;
        break;
      }
      case "pounceRecover": {
        targetDrop = 0.04;
        targetEarBack = 0.3;
        break;
      }
      case "hiss": {
        targetDrop = -0.035;
        targetPitch = 0.06;
        targetEarBack = 1;
        targetJaw = inp.carrying ? 0.2 : 0.62;
        targetPuff = 1.8;
        targetNeck = 0.32;
        break;
      }
      case "stagger": {
        rollExtra = Math.sin(at * 26) * 0.28 * Math.max(0, 1 - at / 0.7);
        targetDrop = 0.05;
        targetEarBack = 0.8;
        targetNeck = 0.25;
        break;
      }
      case "tangled": {
        rollExtra = Math.sin(at * 14) * 0.18;
        targetDrop = 0.1;
        targetEarBack = 1;
        break;
      }
      case "hesitate": {
        targetPitch = -0.12;
        targetDrop = 0.03;
        targetEarBack = 0.9;
        targetNeck = -0.15;
        break;
      }
      case "crouch": {
        targetDrop = 0.11;
        targetPitch = 0.06;
        targetNeck = 0.2;
        targetEarBack = 0.2;
        break;
      }
      case "eat": {
        targetNeck = 1.05 + Math.sin(at * 9) * 0.12;
        targetDrop = 0.04;
        targetJaw = Math.max(0, Math.sin(at * 9)) * 0.3;
        break;
      }
      case "victory":
      case "sit": {
        sit = 1;
        targetNeck = -0.3;
        break;
      }
      default:
        break;
    }
    if (inp.meow > 0) {
      targetJaw = Math.max(targetJaw, Math.sin(clamp01(inp.meow / 0.45) * Math.PI) * 0.55);
      targetNeck -= 0.2;
    }

    this.sitBlend = damp(this.sitBlend, sit, 7, dt);
    const sb = this.sitBlend;
    targetDrop = lerp(targetDrop, 0.06, sb);
    targetPitch = lerp(targetPitch, -0.62, sb);

    this.bodyDrop = damp(this.bodyDrop, targetDrop, 14, dt);
    this.pitch = damp(this.pitch, targetPitch, action === "pounce" ? 22 : 10, dt);
    const turnLean = clamp(-inp.turnRate * Math.min(speed, 8) * 0.018, -0.24, 0.24);
    this.roll = damp(this.roll, turnLean + rollExtra, 9, dt);
    this.stretchZ = damp(this.stretchZ, targetStretch, action === "pounce" ? 28 : 12, dt);
    this.neckPitch = damp(this.neckPitch, targetNeck, 9, dt);
    this.jawOpen = damp(this.jawOpen, targetJaw, 18, dt);
    this.earBack = damp(this.earBack, targetEarBack, 14, dt);
    this.tailPuff = damp(this.tailPuff, targetPuff, 12, dt);

    // squash spring
    if (inp.grounded && !this.wasGrounded) this.squashVel -= 0.4;
    this.wasGrounded = inp.grounded;
    const spring = 300;
    const damping = 17;
    this.squashVel += (-(this.squash - 1) * spring - this.squashVel * damping) * dt;
    this.squash += this.squashVel * dt;
    this.squash = clamp(this.squash, 0.62, 1.35);
    const sq = this.squash;
    const sz = this.stretchZ;
    const sy = sq * (sz > 1 ? 1 - (sz - 1) * 0.45 : 1);
    const sxz = 1 / Math.sqrt(Math.max(sq, 0.5));
    rig.visual.scale.set(sxz * (sz > 1 ? 1 - (sz - 1) * 0.3 : 1), sy, sxz * sz);

    // body transform
    const body = rig.body;
    body.position.y = rig.bodyY - this.bodyDrop - sb * 0.0;
    body.position.z = -sb * 0.05;
    body.rotation.x = this.pitch;
    body.rotation.z = this.roll;

    // ------------------------------------------------------------ legs
    for (const key of LEG_KEYS) {
      const leg = rig.legs[key];
      const t = this.legTarget(key, leg, inp, stride, gw, sb);
      const b = this.legBlend[key];
      const kk = dampFactor(action === "pounce" || !inp.grounded ? 16 : 30, dt);
      b.y += (t.y - b.y) * kk;
      b.z += (t.z - b.z) * kk;
      this.solveLeg(leg, b.y, b.z);
    }

    // ------------------------------------------------------------ head
    let wantYaw = 0;
    let wantPitch = 0;
    if (inp.lookTarget && action !== "eat") {
      const dx = inp.lookTarget.x - inp.rootPos.x;
      const dz = inp.lookTarget.z - inp.rootPos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 0.4) {
        wantYaw = clamp(angleDelta(inp.rootYaw, Math.atan2(dx, dz)), -0.95, 0.95);
        wantPitch = clamp(Math.atan2(inp.lookTarget.y - (inp.rootPos.y + 0.6), dist), -0.4, 0.5);
      }
    } else if (!moving && action === "none") {
      wantYaw = Math.sin(this.time * 0.37) * 0.35 + Math.sin(this.time * 1.13) * 0.08;
      wantPitch = Math.sin(this.time * 0.29) * 0.08;
    }
    if (sb > 0.5) wantPitch = Math.max(wantPitch, 0.22);
    this.headYaw = damp(this.headYaw, wantYaw, 6, dt);
    this.headPitch = damp(this.headPitch, wantPitch, 6, dt);
    rig.neck.rotation.x = this.neckPitch - this.pitch * 0.6;
    rig.neck.rotation.z = -this.roll * 0.5;
    const shake = action === "stagger" ? Math.sin(at * 30) * 0.25 * Math.max(0, 1 - at / 0.6) : 0;
    rig.head.rotation.set(-this.headPitch, this.headYaw + shake, sb * 0.12 + (inp.meow > 0 ? 0.12 : 0));
    rig.jaw.rotation.x = this.jawOpen;

    // ears
    this.earTwitchTimer -= dt;
    if (this.earTwitchTimer <= 0) {
      this.earTwitchTimer = 2.5 + Math.random() * 5;
      this.earTwitch = 1;
      this.earTwitchSide = Math.random() < 0.5 ? 1 : -1;
    }
    this.earTwitch = Math.max(0, this.earTwitch - dt * 5);
    const tw = Math.sin(this.earTwitch * Math.PI) * 0.45;
    const eb = this.earBack;
    rig.earL.rotation.set(-0.08 - eb * 0.75 - (this.earTwitchSide > 0 ? tw : 0), 0.2 + eb * 0.3, -0.34 - eb * 0.55);
    rig.earR.rotation.set(-0.08 - eb * 0.75 - (this.earTwitchSide < 0 ? tw : 0), -0.2 - eb * 0.3, 0.34 + eb * 0.55);

    // blink
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0) {
      this.blinkTimer = 2.2 + Math.random() * 3.5;
      this.blink = 0;
    }
    this.blink = Math.min(1, this.blink + dt * 9);
    let eyeY = this.blink < 0.5 ? 1 - this.blink * 1.8 : (this.blink - 0.5) * 2;
    eyeY = Math.max(eyeY, 0.1);
    if (sb > 0.5) eyeY = Math.min(eyeY, 0.45);
    if (action === "stagger") eyeY = Math.min(eyeY, 0.35);
    if (action === "hiss") eyeY = Math.min(eyeY, 0.75);
    rig.eyeL.scale.set(1, eyeY, 1);
    rig.eyeR.scale.set(1, eyeY, 1);

    // ------------------------------------------------------------ tail
    this.updateTail(dt, inp, gw, sb);
  }

  private legTarget(key: LegKey, leg: LegRig, inp: AnimInput, stride: number, gw: { walk: number; trot: number; gallop: number }, sit: number): { y: number; z: number } {
    const front = leg.front;
    const hipZ = leg.hip.position.z;
    let z = front ? 0.03 : 0.02;
    let y = 0;
    const action = inp.action;
    if (!inp.grounded && action !== "pounce") {
      const rising = inp.velY > 0.5;
      if (front) {
        z = rising ? 0.2 : 0.13;
        y = rising ? 0.17 : 0.03;
      } else {
        z = rising ? -0.2 : 0.06;
        y = rising ? 0.08 : 0.07;
      }
    } else if (action === "pounce") {
      z = front ? 0.34 : -0.38;
      y = front ? 0.14 : 0.1;
    } else if (inp.speed > 0.25 && inp.grounded) {
      let accZ = 0;
      let accY = 0;
      const gaits: Array<[Gait, number]> = [
        [WALK, gw.walk],
        [TROT, gw.trot],
        [GALLOP, gw.gallop],
      ];
      for (const [g, w] of gaits) {
        if (w < 0.001) continue;
        const p = (this.phase + g.offsets[key]) % 1;
        let fz: number;
        let fy: number;
        if (p < g.duty) {
          fz = stride / 2 - stride * (p / g.duty);
          fy = 0;
        } else {
          const s = (p - g.duty) / (1 - g.duty);
          fz = -stride / 2 + stride * (s * s * (3 - 2 * s));
          fy = Math.sin(s * Math.PI) * (g.lift + stride * 0.08);
        }
        accZ += fz * w;
        accY += fy * w;
      }
      z += accZ;
      y += accY;
      const stance = accY < 0.004;
      if (stance && !this.prevStance[key]) this.footDown.push(key);
      this.prevStance[key] = stance;
    }
    if (sit > 0.01) {
      // Back legs fold under the haunches, front legs plant forward.
      if (front) {
        z = lerp(z, 0.06, sit);
        y = lerp(y, 0, sit);
      } else {
        z = lerp(z, 0.16, sit);
        y = lerp(y, 0.0, sit);
      }
    }
    if (action === "hiss") {
      y = 0;
      z = front ? 0.06 : -0.04;
    }
    // Ground point in cat space → body space → hip-relative.
    const body = this.rig.body;
    const gx = 0;
    const gy = y + leg.pawDrop;
    const gz = hipZ + z + body.position.z;
    _v.set(gx, gy - body.position.y, gz - body.position.z);
    // inverse body pitch
    const c = Math.cos(-body.rotation.x);
    const s = Math.sin(-body.rotation.x);
    const by = _v.y * c - _v.z * s;
    const bz = _v.y * s + _v.z * c;
    return { y: by - leg.hip.position.y, z: bz - leg.hip.position.z };
  }

  private solveLeg(leg: LegRig, ty: number, tz: number): void {
    const U = leg.upperLen;
    const Lo = leg.lowerLen;
    let d = Math.hypot(ty, tz);
    d = clamp(d, Math.abs(U - Lo) + 0.002, U + Lo - 0.001);
    const theta = Math.atan2(-tz, -ty);
    const alpha = Math.acos(clamp((U * U + d * d - Lo * Lo) / (2 * U * d), -1, 1));
    const beta = Math.acos(clamp((U * U + Lo * Lo - d * d) / (2 * U * Lo), -1, 1));
    const bend = Math.PI - beta;
    if (leg.front) {
      leg.hip.rotation.x = theta + alpha;
      leg.knee.rotation.x = -bend;
    } else {
      leg.hip.rotation.x = theta - alpha;
      leg.knee.rotation.x = bend;
    }
  }

  private updateTail(dt: number, inp: AnimInput, gw: { walk: number; trot: number; gallop: number }, sit: number): void {
    const rig = this.rig;
    const P = rig.def.proportions;
    const n = rig.tail.length;
    const action = inp.action;
    const moving = inp.speed > 0.25;
    // Relaxed "J": the tail leaves the rump slightly low, then curls up.
    const idleCurl = 0.2 + 0.14 * P.tailCurl;
    let base = moving ? 0.2 * gw.walk + 0.1 * gw.trot + 0.04 * gw.gallop : -0.22;
    let curl = moving ? (0.11 * gw.walk + 0.03 * gw.trot) * (1 + P.tailCurl) : idleCurl;
    let swayAmp = moving ? 0.1 + 0.08 * gw.trot : 0.18;
    let swayFreq = moving ? 3 + inp.speed * 0.6 : 1.3;
    if (!inp.grounded) {
      base = 0.55;
      curl = 0.05;
      swayAmp = 0.06;
    }
    if (action === "pounce" || action === "pounceWindup") {
      base = action === "pounce" ? 0.08 : 0.35;
      curl = 0;
      swayAmp = action === "pounceWindup" ? 0.5 : 0.05;
      swayFreq = 18;
    } else if (action === "hiss") {
      base = 1.25;
      curl = -0.14;
      swayAmp = 0.04;
    } else if (action === "crouch") {
      base = 0.1;
      curl = 0.08;
      swayAmp = 0.12;
      swayFreq = 6;
    } else if (action === "stagger" || action === "tangled") {
      swayAmp = 0.4;
      swayFreq = 10;
    }
    for (let i = 0; i < n; i++) {
      const seg = rig.tail[i];
      const u = i / (n - 1);
      let rx = i === 0 ? base : curl * (0.55 + u * 0.7);
      let ry = Math.sin(this.time * swayFreq - i * 0.65) * swayAmp * (0.35 + u);
      if (action === "crouch" && i >= n - 2) ry += Math.sin(this.time * 14) * 0.35;
      if (sit > 0.01) {
        rx = lerp(rx, i === 0 ? -0.55 : 0.02, sit);
        ry = lerp(ry, i === 0 ? 0.35 : 0.38 + Math.sin(this.time * 1.4) * 0.05 * u, sit);
      }
      seg.rotation.x = damp(seg.rotation.x, rx, 12, dt);
      seg.rotation.y = damp(seg.rotation.y, ry, 14, dt);
      const puff = 1 + (this.tailPuff - 1) * (0.5 + u * 0.5);
      rig.tailMeshes[i].scale.set(puff, puff, 1);
    }
  }
}
