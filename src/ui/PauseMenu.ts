import { el } from "./dom";
import type { Settings } from "./StartScreen";

/**
 * Esc from any screen: RESUME, RESTART ROUND (only while a round is being
 * played), SETTINGS (volume, music, mouse) and MAIN MENU.
 */
export class PauseMenu {
  readonly root: HTMLDivElement;
  onResume: (() => void) | null = null;
  onRestart: (() => void) | null = null;
  onQuit: (() => void) | null = null;
  onSettings: ((s: Settings) => void) | null = null;
  private readonly restartBtn: HTMLButtonElement;
  private readonly settingsEl: HTMLDivElement;
  private settings: Settings | null = null;

  constructor(parent: HTMLElement) {
    this.root = el("div", "screen");
    this.root.id = "pause-screen";
    this.root.innerHTML = `
      <div class="pause-card interactive">
        <h2>PAUSED</h2>
        <p>The fish can wait. Probably.</p>
        <button class="btn orange interactive" data-act="resume">RESUME</button>
        <button class="btn interactive" data-act="restart">RESTART ROUND</button>
        <button class="btn ghost interactive" data-act="settings">SETTINGS</button>
        <div class="pause-settings">
          <label>Volume <input type="range" min="0" max="1" step="0.05" data-s="volume"></label>
          <label>Music <input type="range" min="0" max="1" step="0.05" data-s="music"></label>
          <label>Mouse sensitivity <input type="range" min="0.3" max="2.5" step="0.05" data-s="sensitivity"></label>
          <label>Invert Y <input type="checkbox" data-s="invertY"></label>
        </div>
        <button class="btn ghost interactive" data-act="quit">MAIN MENU</button>
      </div>`;
    parent.appendChild(this.root);
    this.restartBtn = this.root.querySelector('[data-act="restart"]') as HTMLButtonElement;
    this.settingsEl = this.root.querySelector(".pause-settings") as HTMLDivElement;
    this.root.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest("[data-act]") as HTMLElement | null;
      if (!b) return;
      if (b.dataset.act === "resume") this.onResume?.();
      if (b.dataset.act === "restart") this.onRestart?.();
      if (b.dataset.act === "quit") this.onQuit?.();
      if (b.dataset.act === "settings") this.settingsEl.classList.toggle("show");
    });
    for (const input of this.settingsEl.querySelectorAll("input")) {
      input.addEventListener("input", () => {
        if (!this.settings) return;
        const key = input.dataset.s as keyof Settings;
        const next = { ...this.settings, [key]: input.type === "checkbox" ? input.checked : Number(input.value) } as Settings;
        this.settings = next;
        this.onSettings?.(next);
      });
    }
  }

  /** Keep the sliders in step with the game's settings. */
  setSettings(s: Settings): void {
    this.settings = { ...s };
    for (const input of this.settingsEl.querySelectorAll("input")) {
      const key = input.dataset.s as keyof Settings;
      if (input.type === "checkbox") input.checked = Boolean(s[key]);
      else input.value = String(s[key]);
    }
  }

  show(on: boolean, canRestart = false): void {
    this.root.classList.toggle("show", on);
    this.restartBtn.style.display = canRestart ? "" : "none";
    if (!on) this.settingsEl.classList.remove("show");
  }
}
