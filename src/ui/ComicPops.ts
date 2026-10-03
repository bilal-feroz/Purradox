import * as THREE from "three";

export type PopKind = "meow" | "hiss" | "notice";

interface Pop {
  el: HTMLDivElement;
  pos: THREE.Vector3;
  t: number;
  follow: () => THREE.Vector3 | null;
  /** Beyond this camera distance the word is hidden (m). */
  range: number;
}

const LIFE = 0.95;
const MAX_ON_SCREEN = 3;

/**
 * Little comic words that pop over a cat ("MRRP!", "HSSS!", "!"). Rate
 * limited per key, capped on screen and distance culled, so they stay
 * occasional personality beats instead of clutter.
 */
export class ComicPops {
  private readonly root: HTMLDivElement;
  private readonly pops: Pop[] = [];
  private readonly last = new Map<string, number>();
  private readonly v = new THREE.Vector3();
  private time = 0;
  enabled = true;

  constructor(parent: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "comic-pops";
    parent.appendChild(this.root);
  }

  /** Pop `text` over a target; repeats of the same `key` wait `every` seconds. */
  pop(text: string, follow: () => THREE.Vector3 | null, kind: PopKind, key: string, every = 2.5): void {
    if (!this.enabled || this.pops.length >= MAX_ON_SCREEN) return;
    if (this.time - (this.last.get(key) ?? -Infinity) < every) return;
    const at = follow();
    if (!at) return;
    this.last.set(key, this.time);
    const el = document.createElement("div");
    el.className = `comic-pop ${kind}`;
    const span = document.createElement("span");
    span.textContent = text;
    span.style.setProperty("--rot", `${(Math.random() * 14 - 7).toFixed(1)}deg`);
    el.appendChild(span);
    el.style.display = "none";
    this.root.appendChild(el);
    // a rival spotting you is worth seeing from further away
    this.pops.push({ el, pos: at.clone(), t: 0, follow, range: kind === "notice" ? 36 : 24 });
  }

  update(dt: number, camera: THREE.Camera): void {
    this.time += dt;
    if (this.pops.length === 0) return;
    const w = this.root.clientWidth;
    const h = this.root.clientHeight;
    for (let i = this.pops.length - 1; i >= 0; i--) {
      const p = this.pops[i];
      p.t += dt;
      if (p.t >= LIFE) {
        p.el.remove();
        this.pops.splice(i, 1);
        continue;
      }
      const f = p.follow();
      if (f) p.pos.copy(f);
      this.v.copy(p.pos);
      this.v.y += 0.75 + p.t * 0.45;
      const d = this.v.distanceTo(camera.position);
      this.v.project(camera);
      const visible = d < p.range && this.v.z < 1 && Math.abs(this.v.x) < 1.05 && Math.abs(this.v.y) < 1.05;
      p.el.style.display = visible ? "" : "none";
      if (!visible) continue;
      const x = (this.v.x * 0.5 + 0.5) * w;
      const y = (-this.v.y * 0.5 + 0.5) * h;
      const s = Math.max(0.6, Math.min(1.25, 8 / Math.max(1, d)));
      p.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${s.toFixed(2)})`;
    }
  }

  clear(): void {
    for (const p of this.pops) p.el.remove();
    this.pops.length = 0;
  }
}
