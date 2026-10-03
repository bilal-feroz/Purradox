import { el } from "./dom";

export class PauseMenu {
  readonly root: HTMLDivElement;
  onResume: (() => void) | null = null;
  onRestart: (() => void) | null = null;
  onQuit: (() => void) | null = null;

  constructor(parent: HTMLElement) {
    this.root = el("div", "screen");
    this.root.id = "pause-screen";
    this.root.innerHTML = `
      <div class="pause-card interactive">
        <h2>PAUSED</h2>
        <p>The fish can wait. Probably.</p>
        <button class="btn orange interactive" data-act="resume">RESUME</button>
        <button class="btn interactive" data-act="restart">RESTART ROUND</button>
        <button class="btn ghost interactive" data-act="quit">MAIN MENU</button>
      </div>`;
    parent.appendChild(this.root);
    this.root.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest("[data-act]") as HTMLElement | null;
      if (!b) return;
      if (b.dataset.act === "resume") this.onResume?.();
      if (b.dataset.act === "restart") this.onRestart?.();
      if (b.dataset.act === "quit") this.onQuit?.();
    });
  }

  show(on: boolean): void {
    this.root.classList.toggle("show", on);
  }
}
