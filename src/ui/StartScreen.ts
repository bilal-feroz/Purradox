import { formatClock } from "../core/math";
import { Random } from "../core/Random";
import levelThumb from "../../docs/screenshots/02-round1-market-exit.jpg";
import { el } from "./dom";
import { ICONS } from "./icons";
import { loadRecords } from "./records";

export interface Settings {
  volume: number;
  music: number;
  sensitivity: number;
  invertY: boolean;
}

const CONTROLS: Array<[string, string]> = [
  ["W A S D", "MOVE"],
  ["SPACE", "JUMP"],
  ["SHIFT", "SPRINT"],
  ["LMB", "POUNCE"],
  ["RMB / Q", "HISS"],
  ["E", "INTERACT"],
];

/**
 * Title screen (home-screen reference): torn-paper PURRADOX logo with the
 * Sardine Street plank sign, STEAL THE FISH, Level Select, controls,
 * settings and fullscreen over the blurred market diorama.
 */
export class StartScreen {
  readonly root: HTMLDivElement;
  onStart: (() => void) | null = null;
  onSettings: ((s: Settings) => void) | null = null;
  private readonly settings: Settings;
  private readonly panel: HTMLDivElement;
  private readonly levels: HTMLDivElement;

  constructor(parent: HTMLElement, initial: Settings) {
    this.settings = { ...initial };
    this.root = el("div", "screen", "");
    this.root.id = "start-screen";
    this.root.innerHTML = `
      <div class="menu-veil" aria-hidden="true"></div>
      <div class="menu-foliage" aria-hidden="true">${ICONS.foliage}</div>
      <div class="menu-col">
        <div class="logo-card">
          <div class="logo-top">
            <div class="paper logo-paper" style="clip-path:${tornEdge(7, 1.1, 4.2)}"></div>
            <h1 class="logo" aria-label="PURRADOX">
              <span class="logo-cat">${ICONS.logoCat}</span><span class="logo-word">PURRADOX</span>
            </h1>
            <span class="dash d-ears">${ICONS.dashes}</span>
            <span class="dash d-logo">${ICONS.dashes}</span>
            <div class="plank"><span class="plank-text">SARDINE STREET</span><span class="plank-fish">${ICONS.fish("#cfe8e6", "#9fc9c7", "#eef6f2")}</span></div>
          </div>
          <div class="tag-strip">
            <div class="paper" style="clip-path:${tornEdge(31, 1.6, 9)}"></div>
            <span class="tag-paw">${ICONS.paw("#b8692e")}</span>
            <span class="tag-text">Outrun the <span class="u">alley${ICONS.swoosh}</span>. Then hunt yourself.</span>
          </div>
        </div>
        <div class="cta-group">
          <button class="cta-big interactive" data-act="start">
            <span class="cta-play">${ICONS.play}</span><span class="cta-label">STEAL THE FISH</span>
            <span class="dash d-cta">${ICONS.dashes}</span>
            <span class="cta-paws">${ICONS.paw("rgba(150, 62, 16, 0.55)")}${ICONS.paw("rgba(150, 62, 16, 0.55)")}</span>
          </button>
          <button class="btn-level interactive" data-act="levels">
            <span class="lv-map">${ICONS.map}</span><span class="lv-label">LEVEL SELECT</span><span class="lv-chev">${ICONS.chevron}</span>
          </button>
        </div>
        <div class="controls">
          <div class="controls-title"><i></i><span>CONTROLS</span><i></i></div>
          <div class="keycaps">${CONTROLS.map(([k, l]) => `<div class="keycap"><b>${k}</b><span>${l}</span></div>`).join("")}</div>
        </div>
        <div class="touch-note">Best played on a computer with keyboard &amp; mouse.</div>
      </div>
      <div class="start-footer">
        <button class="footer-btn interactive" data-act="settings">${ICONS.gear}<span class="fb-label">SETTINGS${ICONS.swoosh}</span><span class="dash d-foot">${ICONS.dashes}</span></button>
        <button class="footer-btn interactive" data-act="fullscreen">${ICONS.fullscreen}<span class="fb-label">FULLSCREEN${ICONS.swoosh}</span><span class="dash d-foot">${ICONS.dashes}</span></button>
      </div>`;

    this.panel = el("div", "settings-panel interactive");
    this.panel.innerHTML = `
      <div class="panel-title">SETTINGS</div>
      <label>Volume <input type="range" min="0" max="1" step="0.05" data-s="volume"></label>
      <label>Music <input type="range" min="0" max="1" step="0.05" data-s="music"></label>
      <label>Mouse sensitivity <input type="range" min="0.3" max="2.5" step="0.05" data-s="sensitivity"></label>
      <label>Invert Y <input type="checkbox" data-s="invertY"></label>`;
    this.root.appendChild(this.panel);

    this.levels = el("div", "level-panel interactive");
    this.levels.setAttribute("role", "dialog");
    this.levels.setAttribute("aria-label", "Level select");
    this.levels.innerHTML = `
      <div class="panel-title">LEVEL SELECT</div>
      <div class="lp-card">
        <img class="lp-thumb" src="${levelThumb}" alt="Sardine Street market exit" />
        <div class="lp-info">
          <div class="lp-name">SARDINE STREET</div>
          <div class="lp-route">Fish Market → Safe Rooftop · 8 zones · 2 rounds</div>
          <div class="lp-stats">
            <div><span>BEST ESCAPE</span><b data-rec="escape">—</b></div>
            <div><span>FASTEST STEAL</span><b data-rec="steal">—</b></div>
          </div>
        </div>
      </div>
      <div class="lp-buttons">
        <button class="btn ghost" data-act="levels-close">BACK</button>
        <button class="btn orange" data-act="start">PLAY ${ICONS.chevron}</button>
      </div>`;
    this.root.appendChild(this.levels);
    parent.appendChild(this.root);

    for (const input of this.panel.querySelectorAll("input")) {
      const key = input.dataset.s as keyof Settings;
      if (input.type === "checkbox") input.checked = Boolean(this.settings[key]);
      else input.value = String(this.settings[key]);
      input.addEventListener("input", () => {
        if (input.type === "checkbox") (this.settings as unknown as Record<string, unknown>)[key] = input.checked;
        else (this.settings as unknown as Record<string, unknown>)[key] = Number(input.value);
        this.onSettings?.({ ...this.settings });
      });
    }
    this.root.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest("[data-act]") as HTMLElement | null;
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === "start") this.onStart?.();
      else if (act === "settings") {
        this.levels.classList.remove("show");
        this.panel.classList.toggle("show");
      } else if (act === "levels") {
        this.panel.classList.remove("show");
        this.refreshRecords();
        this.levels.classList.toggle("show");
      } else if (act === "levels-close") this.levels.classList.remove("show");
      else if (act === "fullscreen") toggleFullscreen();
    });
  }

  show(on: boolean): void {
    this.root.classList.toggle("show", on);
    if (!on) {
      this.panel.classList.remove("show");
      this.levels.classList.remove("show");
    }
  }

  private refreshRecords(): void {
    const r = loadRecords();
    const set = (k: string, v: number | null) => {
      const b = this.levels.querySelector(`[data-rec="${k}"]`);
      if (b) b.textContent = v === null ? "—" : formatClock(v);
    };
    set("escape", r.bestEscape);
    set("steal", r.fastestSteal);
  }
}

export function toggleFullscreen(): void {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen?.().catch(() => undefined);
}

/** Ragged torn-paper outline as a clip-path polygon (percentages). */
function tornEdge(seed: number, jitterX: number, jitterY: number): string {
  const rng = new Random(seed);
  const pts: string[] = [];
  const pt = (x: number, y: number) => pts.push(`${x.toFixed(1)}% ${y.toFixed(1)}%`);
  for (let x = 0; x < 100; x += rng.range(1.6, 3.6)) pt(x, rng.range(0, jitterY));
  for (let y = 0; y < 100; y += rng.range(5, 11)) pt(100 - rng.range(0, jitterX), y);
  for (let x = 100; x > 0; x -= rng.range(1.6, 3.6)) pt(x, 100 - rng.range(0, jitterY));
  for (let y = 100; y > 0; y -= rng.range(5, 11)) pt(rng.range(0, jitterX), y);
  return `polygon(${pts.join(", ")})`;
}
