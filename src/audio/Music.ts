// Procedural soundtrack. Round 1: playful, fast mandolin-pluck theme over
// light percussion. Round 2: the same motif reversed, an octave lower,
// through a tape-wobble delay — "the same tune, from the other side of time".

const R1_MELODY = [74, 78, 81, 83, 81, 78, 76, 0, 74, 76, 78, 79, 81, 0, 79, 78, 76, 79, 83, 81, 79, 76, 74, 0, 72, 74, 76, 78, 76, 74, 72, 0];
const R1_BASS = [50, 50, 57, 57, 55, 55, 50, 50, 52, 52, 55, 55, 48, 48, 50, 50];

function midi(n: number): number {
  return 440 * Math.pow(2, (n - 69) / 12);
}

export type MusicMode = "off" | "menu" | "round1" | "round2";

export class Music {
  private mode: MusicMode = "off";
  private timer: number | null = null;
  private step = 0;
  private nextTime = 0;
  private readonly out: GainNode;
  private readonly delay: DelayNode;
  private readonly delayFb: GainNode;
  private readonly delayWet: GainNode;
  private readonly wobble: OscillatorNode;
  private readonly wobbleGain: GainNode;
  private intensity = 1;

  constructor(
    private readonly ctx: AudioContext,
    dest: AudioNode,
    private readonly noise: AudioBuffer,
  ) {
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(dest);
    this.delay = ctx.createDelay(1.5);
    this.delay.delayTime.value = 0.32;
    this.delayFb = ctx.createGain();
    this.delayFb.gain.value = 0.38;
    this.delayWet = ctx.createGain();
    this.delayWet.gain.value = 0;
    this.delay.connect(this.delayFb);
    this.delayFb.connect(this.delay);
    this.delay.connect(this.delayWet);
    this.delayWet.connect(this.out);
    this.wobble = ctx.createOscillator();
    this.wobble.frequency.value = 0.6;
    this.wobbleGain = ctx.createGain();
    this.wobbleGain.gain.value = 0;
    this.wobble.connect(this.wobbleGain);
    this.wobbleGain.connect(this.delay.delayTime);
    this.wobble.start();
  }

  setMode(mode: MusicMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setTargetAtTime(mode === "off" ? 0 : mode === "menu" ? 0.5 : 0.85, t, 0.4);
    this.delayWet.gain.setTargetAtTime(mode === "round2" ? 0.55 : mode === "menu" ? 0.2 : 0.1, t, 0.3);
    this.wobbleGain.gain.setTargetAtTime(mode === "round2" ? 0.004 : 0, t, 0.3);
    if (mode === "off") {
      if (this.timer !== null) window.clearInterval(this.timer);
      this.timer = null;
      return;
    }
    if (this.timer === null) {
      this.step = 0;
      this.nextTime = this.ctx.currentTime + 0.08;
      this.timer = window.setInterval(() => this.schedule(), 25);
    }
  }

  /** 0..1 — thins the arrangement during tense beats. */
  setIntensity(v: number): void {
    this.intensity = v;
  }

  duck(seconds: number): void {
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setTargetAtTime(0.05, t, 0.05);
    this.out.gain.setTargetAtTime(this.mode === "off" ? 0 : 0.85, t + seconds, 0.6);
  }

  private get bpm(): number {
    return this.mode === "round2" ? 112 : this.mode === "menu" ? 104 : 136;
  }

  private schedule(): void {
    const ctx = this.ctx;
    if (ctx.state !== "running") return;
    const eighth = 60 / this.bpm / 2;
    while (this.nextTime < ctx.currentTime + 0.12) {
      this.playStep(this.step, this.nextTime, eighth);
      this.nextTime += eighth;
      this.step = (this.step + 1) % 32;
    }
  }

  private playStep(step: number, t: number, eighth: number): void {
    const r2 = this.mode === "round2";
    const menu = this.mode === "menu";
    const melody = r2 ? R1_MELODY[31 - step] : R1_MELODY[step];
    if (melody > 0 && (step % 2 === 0 || this.intensity > 0.5 || menu)) {
      this.pluck(midi(melody - (r2 ? 12 : 0)), t, eighth * (r2 ? 1.8 : 0.9), r2 ? 0.1 : 0.13, r2);
    }
    if (step % 2 === 0) {
      const b = R1_BASS[(step / 2) % 16];
      if (!r2 || step % 4 === 0) this.bass(midi(b - 12), t, eighth * (r2 ? 3.6 : 1.8));
    }
    if (menu) {
      if (step % 8 === 0) this.kick(t, 0.25);
      return;
    }
    if (step % 4 === 0) this.kick(t, r2 ? 0.35 : 0.5);
    if (!r2) {
      if (step % 8 === 4) this.clap(t);
      this.shaker(t, step % 2 === 1 ? 0.06 : 0.03);
    } else if (step % 8 === 6) {
      this.reverseSwell(t, eighth * 2);
    }
  }

  private pluck(freq: number, t: number, dur: number, vol: number, temporal: boolean): void {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const o2 = ctx.createOscillator();
    o.type = "triangle";
    o2.type = "square";
    o.frequency.value = freq;
    o2.frequency.value = freq * 2.003;
    const g = ctx.createGain();
    const g2 = ctx.createGain();
    g2.gain.value = 0.18;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = temporal ? 1400 : 2600;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    o2.connect(g2);
    g2.connect(g);
    g.connect(lp);
    lp.connect(this.out);
    lp.connect(this.delay);
    o.start(t);
    o2.start(t);
    o.stop(t + dur + 0.05);
    o2.stop(t + dur + 0.05);
  }

  private bass(freq: number, t: number, dur: number): void {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private kick(t: number, vol: number): void {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(g);
    g.connect(this.out);
    o.start(t);
    o.stop(t + 0.2);
  }

  private noiseHit(t: number, vol: number, dur: number, type: BiquadFilterType, freq: number): void {
    const ctx = this.ctx;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f);
    f.connect(g);
    g.connect(this.out);
    s.start(t, Math.random() * 1.5);
    s.stop(t + dur + 0.02);
  }

  private clap(t: number): void {
    this.noiseHit(t, 0.18, 0.09, "bandpass", 1600);
    this.noiseHit(t + 0.012, 0.12, 0.07, "bandpass", 1900);
  }

  private shaker(t: number, vol: number): void {
    this.noiseHit(t, vol, 0.04, "highpass", 7000);
  }

  private reverseSwell(t: number, dur: number): void {
    const ctx = this.ctx;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.setValueAtTime(400, t);
    f.frequency.exponentialRampToValueAtTime(3200, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.09, t + dur * 0.95);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f);
    f.connect(g);
    g.connect(this.out);
    g.connect(this.delay);
    s.start(t, Math.random());
    s.stop(t + dur + 0.02);
  }
}
