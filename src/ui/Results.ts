import { el } from "./dom";
import { ICONS } from "./icons";

export interface ResultStats {
  success: boolean;
  rows: Array<[string, string]>;
}

/** Two clear outcomes with key stats only. */
export class Results {
  readonly root: HTMLDivElement;
  onRunItBack: (() => void) | null = null;
  onNewRun: (() => void) | null = null;

  constructor(parent: HTMLElement) {
    this.root = el("div", "screen");
    this.root.id = "results-screen";
    parent.appendChild(this.root);
    this.root.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest("[data-act]") as HTMLElement | null;
      if (!b) return;
      if (b.dataset.act === "back") this.onRunItBack?.();
      if (b.dataset.act === "new") this.onNewRun?.();
    });
  }

  show(stats: ResultStats | null): void {
    if (!stats) {
      this.root.classList.remove("show");
      return;
    }
    const title = stats.success ? "TIMELINE<br>BROKEN" : "PAST YOU<br>WAS TOO GOOD";
    this.root.innerHTML = `
      <div class="result-card interactive">
        <div class="result-ribbon ${stats.success ? "success" : "failure"}">${stats.success ? "SUCCESS" : "FAILURE"}</div>
        <div class="result-title">${title}</div>
        <div class="stats">${stats.rows.map(([k, v]) => `<div class="row"><span>${k}</span><span>${v}</span></div>`).join("")}</div>
        <div class="result-buttons">
          <button class="btn interactive" data-act="back">RUN IT BACK</button>
          <button class="btn blue interactive" data-act="new"><span>NEW RUN</span>${ICONS.play}</button>
        </div>
      </div>`;
    this.root.classList.add("show");
  }
}
