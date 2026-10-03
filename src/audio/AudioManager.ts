import * as THREE from "three";
import type { EventBus } from "../core/EventBus";
import type { CatId } from "../data/cats";
import { Music, type MusicMode } from "./Music";

export type SoundName =
  | "step"
  | "jump"
  | "land"
  | "pounce"
  | "hit"
  | "hiss"
  | "perfect"
  | "meow"
  | "pickup"
  | "drop"
  | "recovered"
  | "stolen"
  | "pigeons"
  | "trash"
  | "bottle"
  | "laundry"
  | "scraps"
  | "rewind"
  | "victory"
  | "fail"
  | "ui"
  | "stamp"
  | "seagull"
  | "scent"
  | "whoosh"
  | "tell"
  | "bell"
  | "yowl";

interface PlayOpts {
  at?: THREE.Vector3 | { x: number; y: number; z: number };
  volume?: number;
  pitch?: number;
  cat?: CatId;
  duration?: number;
}

const MEOW_PITCH: Record<CatId, number> = { fishcat: 1, mochi: 1.12, soot: 0.82, beans: 1.32 };

/**
 * Centralized procedural audio. Everything is synthesized with WebAudio so
 * there are no asset dependencies; sounds are spatially attenuated against
 * the listener (the camera) and easy to swap for recorded files later.
 */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private amb!: GainNode;
  private musicBus!: GainNode;
  private filter!: BiquadFilterNode;
  private noise!: AudioBuffer;
  private music: Music | null = null;
  private hum: { stop: () => void } | null = null;
  private ambience: { stop: () => void } | null = null;
  private readonly listener = new THREE.Vector3();
  private gullTimer = 6;
  private distantTimer = 11;
  volume = 0.8;
  musicVolume = 0.55;
  private lastPlayed = new Map<string, number>();

  get ready(): boolean {
    return this.ctx !== null && this.ctx.state === "running";
  }

  /** Must be called from a user gesture. */
  unlock(): void {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.volume;
      this.filter = ctx.createBiquadFilter();
      this.filter.type = "lowpass";
      this.filter.frequency.value = 20000;
      this.filter.Q.value = 0.6;
      this.master.connect(this.filter);
      this.filter.connect(ctx.destination);
      this.sfx = ctx.createGain();
      this.sfx.connect(this.master);
      this.amb = ctx.createGain();
      this.amb.gain.value = 0.7;
      this.amb.connect(this.master);
      this.musicBus = ctx.createGain();
      this.musicBus.gain.value = this.musicVolume;
      this.musicBus.connect(this.master);
      const len = ctx.sampleRate * 2;
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.music = new Music(ctx, this.musicBus, this.noise);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  setMusicVolume(v: number): void {
    this.musicVolume = v;
    if (this.ctx) this.musicBus.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  setListener(p: THREE.Vector3): void {
    this.listener.copy(p);
  }

  setMusic(mode: MusicMode): void {
    this.music?.setMode(mode);
  }

  /** Muffle everything (freeze beats, pause). 1 = open, 0 = heavily filtered. */
  setMuffle(open: number, time = 0.2): void {
    if (!this.ctx) return;
    const f = 300 + Math.pow(Math.max(0, Math.min(1, open)), 2) * 19700;
    this.filter.frequency.setTargetAtTime(f, this.ctx.currentTime, time);
  }

  duckMusic(seconds: number): void {
    this.music?.duck(seconds);
  }

  /** 0..1: how hard the moment is (rivals closing in, the final climb). */
  setMusicPressure(v: number): void {
    this.music?.setPressure(v);
  }

  update(dt: number, ambientOn: boolean): void {
    if (!this.ready) return;
    if (ambientOn && !this.ambience) this.ambience = this.startAmbience();
    if (!ambientOn && this.ambience) {
      this.ambience.stop();
      this.ambience = null;
    }
    if (ambientOn) {
      this.gullTimer -= dt;
      if (this.gullTimer <= 0) {
        this.gullTimer = 7 + Math.random() * 9;
        this.play("seagull", { volume: 0.18 + Math.random() * 0.1 });
      }
      // the rest of the town, far off: a church bell, a scooter going by
      this.distantTimer -= dt;
      if (this.distantTimer <= 0) {
        this.distantTimer = 16 + Math.random() * 18;
        if (Math.random() < 0.45) this.distantBell();
        else this.distantScooter();
      }
    }
  }

  setTemporalHum(on: boolean): void {
    if (!this.ready) return;
    if (on && !this.hum) this.hum = this.startHum();
    if (!on && this.hum) {
      this.hum.stop();
      this.hum = null;
    }
  }

  subscribe(bus: EventBus, isLocal: (cat: CatId) => boolean): void {
    bus.on("footstep", (e) => {
      if (!isLocal(e.cat) && Math.random() < 0.6) return;
      this.play("step", { at: e, volume: (e.sprint ? 0.16 : 0.11) * (0.6 + e.volume * 0.6), pitch: 0.9 + Math.random() * 0.25 });
    });
    bus.on("jump", (e) => this.play("jump", { at: e, volume: isLocal(e.cat) ? 0.22 : 0.12 }));
    bus.on("land", (e) => this.play("land", { at: e, volume: 0.1 + e.impact * 0.25 }));
    bus.on("pounceStart", (e) => this.play("pounce", { at: e, volume: isLocal(e.cat) ? 0.42 : 0.3 }));
    bus.on("pounceTell", (e) => this.play("tell", { at: e, volume: 0.42 }));
    bus.on("sound", (e) => {
      if (e.type === "bell") this.play("bell", { at: e, volume: 0.5 });
    });
    bus.on("pounceHit", (e) => this.play("hit", { at: e, volume: e.gripDamage ? 0.7 : 0.55 }));
    bus.on("hissStart", (e) => this.play("hiss", { at: e, volume: 0.5, cat: e.cat }));
    bus.on("perfectHiss", (e) => this.play("perfect", { at: e, volume: 0.7 }));
    bus.on("meow", (e) => this.play(e.aggressive ? "yowl" : "meow", { volume: e.aggressive ? 0.38 : 0.45, cat: e.cat }));
    bus.on("fishPickup", (e) => this.play(e.recovered ? "recovered" : e.stolen ? "stolen" : "pickup", { at: e, volume: 0.5 }));
    bus.on("fishDrop", (e) => this.play("drop", { at: e, volume: 0.55 }));
    bus.on("pigeonsBurst", (e) => this.play("pigeons", { at: e, volume: Math.min(0.7, 0.25 + e.count * 0.04) }));
    bus.on("interact", (e) => {
      const map: Record<string, SoundName> = { trashCan: "trash", bottle: "bottle", laundry: "laundry", fishScraps: "scraps", pigeonFeed: "scraps" };
      const s = map[e.target];
      if (s) this.play(s, { at: e, volume: 0.6 });
    });
  }

  play(name: SoundName, opts: PlayOpts = {}): void {
    if (!this.ready || !this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    // tiny rate limit for spammy sounds
    const last = this.lastPlayed.get(name) ?? -1;
    if ((name === "step" && now - last < 0.035) || (name === "land" && now - last < 0.06)) return;
    this.lastPlayed.set(name, now);
    let vol = opts.volume ?? 0.5;
    if (opts.at) {
      const d = Math.hypot(opts.at.x - this.listener.x, opts.at.y - this.listener.y, opts.at.z - this.listener.z);
      vol *= 1 / (1 + Math.max(0, d - 4) * 0.12);
      if (vol < 0.01) return;
    }
    const p = opts.pitch ?? 1;
    const out = ctx.createGain();
    out.gain.value = vol;
    out.connect(this.sfx);
    switch (name) {
      case "step":
        this.noiseBurst(out, now, 0.045, "bandpass", 900 * p + Math.random() * 600, 1.2, 0.9);
        break;
      case "jump":
        this.sweep(out, now, "sine", 320 * p, 640 * p, 0.12, 0.35);
        this.noiseBurst(out, now, 0.12, "highpass", 2500, 0.7, 0.25);
        break;
      case "land":
        this.sweep(out, now, "sine", 130, 55, 0.12, 0.8);
        this.noiseBurst(out, now, 0.08, "lowpass", 500, 0.8, 0.6);
        break;
      case "pounce":
      case "whoosh":
        this.noiseSweep(out, now, 0.26, 500, 3600, 0.9);
        break;
      case "hit":
        this.sweep(out, now, "sine", 170, 48, 0.16, 1);
        this.noiseBurst(out, now, 0.07, "lowpass", 2800, 0.9, 0.8);
        this.tone(out, now, "triangle", 540, 0.07, 0.35);
        break;
      case "hiss":
        this.hissSound(out, now, opts.cat);
        break;
      case "perfect":
        this.hissSound(out, now, undefined, 0.6);
        this.tone(out, now + 0.02, "sine", 1320, 0.5, 0.35);
        this.tone(out, now + 0.02, "sine", 1980, 0.4, 0.2);
        this.tone(out, now + 0.1, "sine", 2640, 0.35, 0.15);
        this.sweep(out, now, "sine", 160, 50, 0.18, 0.8);
        break;
      case "meow":
        this.meowSound(out, now, MEOW_PITCH[opts.cat ?? "fishcat"]);
        break;
      case "yowl":
        this.yowlSound(out, now, MEOW_PITCH[opts.cat ?? "fishcat"]);
        break;
      case "pickup":
        [1047, 1319, 1568].forEach((f, i) => this.tone(out, now + i * 0.055, "triangle", f, 0.18, 0.4));
        break;
      case "recovered":
        [784, 988, 1175, 1568].forEach((f, i) => this.tone(out, now + i * 0.06, "triangle", f, 0.2, 0.4));
        break;
      case "stolen":
        [880, 740, 587].forEach((f, i) => this.tone(out, now + i * 0.08, "square", f, 0.14, 0.18));
        break;
      case "drop":
        this.sweep(out, now, "sine", 900, 260, 0.22, 0.5);
        this.noiseBurst(out, now + 0.18, 0.1, "lowpass", 900, 0.8, 0.5);
        break;
      case "pigeons":
        for (let i = 0; i < 16; i++) this.noiseBurst(out, now + i * (0.025 + Math.random() * 0.03), 0.035, "bandpass", 900 + Math.random() * 900, 2, 0.7);
        this.coo(out, now + 0.1);
        this.coo(out, now + 0.45);
        break;
      case "trash": {
        [523, 787, 1121, 1533, 1907].forEach((f, i) => this.tone(out, now + i * 0.004, i % 2 ? "square" : "triangle", f * (0.97 + Math.random() * 0.06), 0.35 + Math.random() * 0.2, 0.12));
        this.noiseBurst(out, now, 0.25, "highpass", 1800, 0.7, 0.7);
        this.sweep(out, now, "sine", 120, 45, 0.2, 0.8);
        for (let i = 0; i < 5; i++) this.tone(out, now + 0.25 + i * 0.09, "triangle", 1800 + Math.random() * 600, 0.05, 0.1);
        break;
      }
      case "bottle":
        this.tone(out, now, "sine", 2200, 0.25, 0.4);
        this.tone(out, now + 0.01, "sine", 3310, 0.2, 0.2);
        for (let i = 0; i < 8; i++) this.tone(out, now + 0.2 + i * 0.12, "sine", 1900 + Math.random() * 500, 0.04, 0.08);
        break;
      case "laundry":
        this.noiseSweep(out, now, 0.45, 2200, 300, 0.7);
        break;
      case "scraps":
        this.noiseBurst(out, now, 0.18, "lowpass", 700, 0.8, 0.8);
        this.sweep(out, now + 0.05, "sine", 400, 180, 0.12, 0.3);
        break;
      case "rewind": {
        const dur = opts.duration ?? 3;
        this.tapeRewind(out, now, dur);
        break;
      }
      case "victory":
        [784, 1047, 1319, 1568, 2093].forEach((f, i) => this.tone(out, now + i * 0.085, "triangle", f, i === 4 ? 0.6 : 0.2, 0.42));
        this.noiseSweep(out, now + 0.35, 0.5, 4000, 9000, 0.2);
        break;
      case "fail":
        [523, 494, 466, 392].forEach((f, i) => this.wah(out, now + i * 0.22, f, i === 3 ? 0.6 : 0.2));
        break;
      case "ui":
        this.tone(out, now, "sine", 880 * p, 0.07, 0.35);
        this.tone(out, now + 0.03, "sine", 1320 * p, 0.05, 0.18);
        break;
      case "stamp":
        this.sweep(out, now, "sine", 110, 40, 0.18, 0.9);
        this.noiseBurst(out, now, 0.1, "lowpass", 1400, 0.8, 0.7);
        break;
      case "seagull":
        this.gull(out, now);
        break;
      case "bell":
        // brass shop bell: bright strike + long shimmering tail
        for (const [f, v, d] of [
          [1318, 0.32, 1.4],
          [1976, 0.2, 1.1],
          [2637, 0.12, 0.8],
          [3520, 0.06, 0.5],
        ] as const) {
          this.tone(out, now, "sine", f, d, v);
          this.tone(out, now + 0.32, "sine", f * 1.002, d * 0.8, v * 0.75);
        }
        break;
      case "tell":
        // rising "here it comes" wind-up, timed to the rival's crouch
        this.tone(out, now, "square", 1320, 0.05, 0.1);
        this.sweep(out, now, "triangle", 260, 980, 0.24, 0.32);
        this.noiseBurst(out, now + 0.02, 0.08, "bandpass", 1400, 1.4, 0.25);
        break;
      case "scent":
        [660, 990, 1320, 1760].forEach((f, i) => this.tone(out, now + i * 0.07, "sine", f, 0.4, 0.18));
        this.noiseSweep(out, now, 0.6, 3000, 600, 0.25);
        break;
    }
    setTimeout(() => out.disconnect(), 4000 + (opts.duration ?? 0) * 1000);
  }

  // ---------------------------------------------------------------- synth primitives
  /** Two soft, far-off chimes from somewhere up the hill. */
  private distantBell(): void {
    const ctx = this.ctx!;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 1400;
    lp.connect(this.amb);
    const now = ctx.currentTime + 0.05;
    for (const [i, f] of [392, 294].entries()) {
      this.tone(lp, now + i * 0.9, "sine", f, 2.6, 0.035);
      this.tone(lp, now + i * 0.9, "sine", f * 2.76, 1.4, 0.012);
    }
    setTimeout(() => lp.disconnect(), 5000);
  }

  /** A scooter buzzing along a street you can't see. */
  private distantScooter(): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + 0.05;
    const dur = 3.2;
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(88, t);
    o.frequency.linearRampToValueAtTime(118, t + dur * 0.45);
    o.frequency.linearRampToValueAtTime(82, t + dur);
    const wob = ctx.createOscillator();
    wob.frequency.value = 23;
    const wobGain = ctx.createGain();
    wobGain.gain.value = 6;
    wob.connect(wobGain);
    wobGain.connect(o.frequency);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 650;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.03, t + dur * 0.45);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(lp);
    lp.connect(g);
    g.connect(this.amb);
    o.start(t);
    wob.start(t);
    o.stop(t + dur + 0.05);
    wob.stop(t + dur + 0.05);
  }

  private tone(out: AudioNode, t: number, type: OscillatorType, f: number, dur: number, vol: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private sweep(out: AudioNode, t: number, type: OscillatorType, f0: number, f1: number, dur: number, vol: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private noiseBurst(out: AudioNode, t: number, dur: number, type: BiquadFilterType, freq: number, q: number, vol: number): void {
    const ctx = this.ctx!;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f);
    f.connect(g);
    g.connect(out);
    s.start(t, Math.random() * 1.5);
    s.stop(t + dur + 0.02);
  }

  private noiseSweep(out: AudioNode, t: number, dur: number, f0: number, f1: number, vol: number): void {
    const ctx = this.ctx!;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.Q.value = 1.2;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f);
    f.connect(g);
    g.connect(out);
    s.start(t, Math.random());
    s.stop(t + dur + 0.02);
  }

  private hissSound(out: AudioNode, t: number, cat?: CatId, vol = 0.9): void {
    const ctx = this.ctx!;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = cat === "soot" ? 2000 : 2600;
    const bp = ctx.createBiquadFilter();
    bp.type = "peaking";
    bp.frequency.value = cat === "beans" ? 6200 : 4800;
    bp.gain.value = 9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.035);
    g.gain.setValueAtTime(vol * 0.85, t + 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    s.connect(hp);
    hp.connect(bp);
    bp.connect(g);
    g.connect(out);
    s.start(t, Math.random());
    s.stop(t + 0.55);
  }

  /** The rival's "MRAOW!": lower, longer, wavering, with a growl underneath. */
  private yowlSound(out: AudioNode, t: number, pitch: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    const base = 330 * pitch;
    o.frequency.setValueAtTime(base * 0.8, t);
    o.frequency.linearRampToValueAtTime(base * 1.45, t + 0.22);
    o.frequency.linearRampToValueAtTime(base * 1.2, t + 0.5);
    o.frequency.linearRampToValueAtTime(base * 0.7, t + 0.78);
    const vib = ctx.createOscillator();
    vib.frequency.value = 9;
    const vibGain = ctx.createGain();
    vibGain.gain.value = base * 0.05;
    vib.connect(vibGain);
    vibGain.connect(o.frequency);
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.Q.value = 4;
    f.frequency.setValueAtTime(600, t);
    f.frequency.linearRampToValueAtTime(1300, t + 0.25);
    f.frequency.linearRampToValueAtTime(650, t + 0.75);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.8, t + 0.08);
    g.gain.setValueAtTime(0.7, t + 0.55);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.82);
    o.connect(f);
    f.connect(g);
    g.connect(out);
    o.start(t);
    vib.start(t);
    o.stop(t + 0.86);
    vib.stop(t + 0.86);
    this.noiseBurst(out, t + 0.04, 0.6, "lowpass", 380, 1.2, 0.35);
  }

  private meowSound(out: AudioNode, t: number, pitch: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    const base = 480 * pitch;
    o.frequency.setValueAtTime(base * 0.9, t);
    o.frequency.linearRampToValueAtTime(base * 1.35, t + 0.14);
    o.frequency.linearRampToValueAtTime(base * 1.1, t + 0.3);
    o.frequency.linearRampToValueAtTime(base * 0.8, t + 0.48);
    const f1 = ctx.createBiquadFilter();
    f1.type = "bandpass";
    f1.Q.value = 6;
    f1.frequency.setValueAtTime(500, t);
    f1.frequency.linearRampToValueAtTime(1100, t + 0.16);
    f1.frequency.linearRampToValueAtTime(700, t + 0.45);
    const f2 = ctx.createBiquadFilter();
    f2.type = "bandpass";
    f2.Q.value = 5;
    f2.frequency.setValueAtTime(1500, t);
    f2.frequency.linearRampToValueAtTime(2600, t + 0.18);
    f2.frequency.linearRampToValueAtTime(1300, t + 0.45);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.9, t + 0.05);
    g.gain.setValueAtTime(0.8, t + 0.32);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.52);
    o.connect(f1);
    o.connect(f2);
    f1.connect(g);
    f2.connect(g);
    g.connect(out);
    o.start(t);
    o.stop(t + 0.55);
  }

  private coo(out: AudioNode, t: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(360, t);
    o.frequency.linearRampToValueAtTime(420, t + 0.12);
    o.frequency.linearRampToValueAtTime(330, t + 0.3);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 22;
    const lg = ctx.createGain();
    lg.gain.value = 18;
    lfo.connect(lg);
    lg.connect(o.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.25, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    o.connect(g);
    g.connect(out);
    o.start(t);
    lfo.start(t);
    o.stop(t + 0.35);
    lfo.stop(t + 0.35);
  }

  private gull(out: AudioNode, t: number): void {
    const ctx = this.ctx!;
    for (let k = 0; k < 2 + Math.floor(Math.random() * 2); k++) {
      const tt = t + k * 0.32;
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(1500, tt);
      o.frequency.exponentialRampToValueAtTime(2500, tt + 0.08);
      o.frequency.exponentialRampToValueAtTime(1300, tt + 0.26);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, tt);
      g.gain.exponentialRampToValueAtTime(0.18, tt + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.27);
      o.connect(g);
      g.connect(out);
      o.start(tt);
      o.stop(tt + 0.3);
    }
  }

  private wah(out: AudioNode, t: number, f: number, dur: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = f;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 8;
    lp.frequency.setValueAtTime(400, t);
    lp.frequency.exponentialRampToValueAtTime(1600, t + dur * 0.4);
    lp.frequency.exponentialRampToValueAtTime(300, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.3, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(lp);
    lp.connect(g);
    g.connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private tapeRewind(out: AudioNode, t: number, dur: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(900, t + dur * 0.55);
    o.frequency.exponentialRampToValueAtTime(70, t + dur);
    const trem = ctx.createOscillator();
    trem.frequency.value = 18;
    const tg = ctx.createGain();
    tg.gain.value = 0.35;
    const g = ctx.createGain();
    g.gain.value = 0.0;
    trem.connect(tg);
    tg.connect(g.gain);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 1800;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(0.22, t + 0.25);
    env.gain.setValueAtTime(0.22, t + dur - 0.3);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(lp);
    lp.connect(g);
    g.connect(env);
    env.connect(out);
    o.start(t);
    trem.start(t);
    o.stop(t + dur + 0.05);
    trem.stop(t + dur + 0.05);
    this.noiseSweep(out, t, dur, 6000, 300, 0.35);
    // reversed chimes
    for (let i = 0; i < 6; i++) {
      const tt = t + (i / 6) * dur;
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = [1568, 1319, 1175, 988, 784, 659][i];
      const gg = ctx.createGain();
      gg.gain.setValueAtTime(0.0001, tt);
      gg.gain.exponentialRampToValueAtTime(0.12, tt + 0.35);
      gg.gain.exponentialRampToValueAtTime(0.0001, tt + 0.38);
      osc.connect(gg);
      gg.connect(out);
      osc.start(tt);
      osc.stop(tt + 0.4);
    }
  }

  private startHum(): { stop: () => void } {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.value = 0;
    g.gain.setTargetAtTime(0.05, ctx.currentTime, 0.8);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 700;
    const oscs = [110, 110.6, 220.4, 329.6].map((f, i) => {
      const o = ctx.createOscillator();
      o.type = i === 3 ? "triangle" : "sine";
      o.frequency.value = f;
      const og = ctx.createGain();
      og.gain.value = i === 3 ? 0.08 : 0.3;
      o.connect(og);
      og.connect(lp);
      o.start();
      return o;
    });
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.18;
    const lg = ctx.createGain();
    lg.gain.value = 0.02;
    lfo.connect(lg);
    lg.connect(g.gain);
    lfo.start();
    lp.connect(g);
    g.connect(this.amb);
    return {
      stop: () => {
        g.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
        setTimeout(() => {
          for (const o of oscs) o.stop();
          lfo.stop();
          g.disconnect();
        }, 2000);
      },
    };
  }

  private startAmbience(): { stop: () => void } {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.value = 0;
    g.gain.setTargetAtTime(1, ctx.currentTime, 1.5);
    // waves: lowpassed noise with slow swell
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 520;
    const wg = ctx.createGain();
    wg.gain.value = 0.05;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.14;
    const lg = ctx.createGain();
    lg.gain.value = 0.035;
    lfo.connect(lg);
    lg.connect(wg.gain);
    s.connect(lp);
    lp.connect(wg);
    wg.connect(g);
    // market murmur: band-limited noise with jittery amplitude
    const s2 = ctx.createBufferSource();
    s2.buffer = this.noise;
    s2.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 420;
    bp.Q.value = 0.8;
    const mg = ctx.createGain();
    mg.gain.value = 0.018;
    s2.connect(bp);
    bp.connect(mg);
    mg.connect(g);
    g.connect(this.amb);
    s.start();
    s2.start(0, 0.7);
    lfo.start();
    return {
      stop: () => {
        g.gain.setTargetAtTime(0, ctx.currentTime, 0.5);
        setTimeout(() => {
          s.stop();
          s2.stop();
          lfo.stop();
          g.disconnect();
        }, 2500);
      },
    };
  }
}
