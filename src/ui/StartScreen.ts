import { el } from "./dom";
import { ICONS } from "./icons";

export interface Settings {
  volume: number;
  music: number;
  sensitivity: number;
  invertY: boolean;
}

/** Title screen: logo, STEAL THE FISH, controls, settings, fullscreen. */
export class StartScreen {
  readonly root: HTMLDivElement;
  onStart: (() => void) | null = null;
  onSettings: ((s: Settings) => void) | null = null;
  private readonly settings: Settings;
  private readonly panel: HTMLDivElement;

  constructor(parent: HTMLElement, initial: Settings) {
    this.settings = { ...initial };
    this.root = el("div", "screen", "");
    this.root.id = "start-screen";
    this.root.innerHTML = `
      <div class="logo-block">
        <div class="logo"><span class="logo-p">${ICONS.logoCat}</span>URRADOX</div>
        <div class="logo-sub">SARDINE STREET</div>
        <div class="tagline">Outrun the alley. Then hunt yourself.</div>
      </div>
      <div class="start-center">
        <button class="btn orange cta interactive" data-act="start">${ICONS.play}<span>STEAL THE FISH</span></button>
        <div class="keys">
          <div class="key"><b>WASD</b>MOVE</div>
          <div class="key"><b>SPACE</b>JUMP</div>
          <div class="key"><b>SHIFT</b>SPRINT</div>
          <div class="key"><b>LMB</b>POUNCE</div>
          <div class="key"><b>RMB / Q</b>HISS</div>
          <div class="key"><b>E</b>INTERACT</div>
        </div>
      </div>
      <div class="start-footer">
        <button class="footer-btn interactive" data-act="settings">${ICONS.gear}<span>SETTINGS</span></button>
        <button class="footer-btn interactive" data-act="fullscreen">${ICONS.fullscreen}<span>FULLSCREEN</span></button>
      </div>`;
    this.panel = el("div", "settings-panel interactive");
    this.panel.innerHTML = `
      <label>Volume <input type="range" min="0" max="1" step="0.05" data-s="volume"></label>
      <label>Music <input type="range" min="0" max="1" step="0.05" data-s="music"></label>
      <label>Mouse sensitivity <input type="range" min="0.3" max="2.5" step="0.05" data-s="sensitivity"></label>
      <label>Invert Y <input type="checkbox" data-s="invertY"></label>`;
    this.root.appendChild(this.panel);
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
      else if (act === "settings") this.panel.classList.toggle("show");
      else if (act === "fullscreen") toggleFullscreen();
    });
  }

  show(on: boolean): void {
    this.root.classList.toggle("show", on);
    if (!on) this.panel.classList.remove("show");
  }
}

export function toggleFullscreen(): void {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen?.().catch(() => undefined);
}
