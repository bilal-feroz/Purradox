import { el } from "./dom";
import { ICONS } from "./icons";
import { downloadCard, type ShareInfo } from "./ShareCard";

export interface ResultStats {
  success: boolean;
  rows: Array<[string, string]>;
  /** One line of context under the title ("AS SOOT · VS PAST FISH CAT"). */
  subtitle?: string;
  /** What the optional share card says. */
  share?: ShareInfo;
}

/** Two clear outcomes with a handful of real stats, and an optional share card. */
export class Results {
  readonly root: HTMLDivElement;
  onRunItBack: (() => void) | null = null;
  onNewRun: (() => void) | null = null;
  /** Renders the share card (the game supplies the backdrop). */
  onShare: ((info: ShareInfo) => Promise<HTMLCanvasElement>) | null = null;
  private current: ResultStats | null = null;
  private card: HTMLCanvasElement | null = null;
  private busy = false;

  constructor(parent: HTMLElement) {
    this.root = el("div", "screen");
    this.root.id = "results-screen";
    parent.appendChild(this.root);
    this.root.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest("[data-act]") as HTMLElement | null;
      if (!b) return;
      if (b.dataset.act === "back") this.onRunItBack?.();
      if (b.dataset.act === "new") this.onNewRun?.();
      if (b.dataset.act === "share") void this.openShare();
      if (b.dataset.act === "download" && this.card) downloadCard(this.card);
      if (b.dataset.act === "close") this.root.querySelector(".result-card")?.classList.remove("sharing");
    });
  }

  show(stats: ResultStats | null): void {
    this.current = stats;
    this.card = null;
    if (!stats) {
      this.root.classList.remove("show");
      return;
    }
    const title = stats.success ? "TIMELINE<br>BROKEN" : "PAST YOU<br>WAS TOO GOOD";
    this.root.innerHTML = `
      <div class="result-card interactive">
        <div class="result-ribbon ${stats.success ? "success" : "failure"}">${stats.success ? "SUCCESS" : "FAILURE"}</div>
        <div class="result-title">${title}</div>
        ${stats.subtitle ? `<div class="result-sub">${stats.subtitle}</div>` : ""}
        <div class="result-main">
          <div class="stats">${stats.rows.map(([k, v]) => `<div class="row"><span>${k}</span><span>${v}</span></div>`).join("")}</div>
          <div class="result-buttons">
            <button class="btn interactive" data-act="back">RUN IT BACK</button>
            <button class="btn blue interactive" data-act="new"><span>NEW RUN</span>${ICONS.play}</button>
          </div>
          ${stats.share ? `<button class="share-link interactive" data-act="share">MAKE A SHARE CARD</button>` : ""}
        </div>
        <div class="share-panel">
          <div class="share-preview"><span>DRAWING YOUR CARD…</span></div>
          <div class="result-buttons">
            <button class="btn orange interactive" data-act="download">DOWNLOAD IMAGE</button>
            <button class="btn ghost interactive" data-act="close">BACK</button>
          </div>
        </div>
      </div>`;
    this.root.classList.add("show");
  }

  private async openShare(): Promise<void> {
    const info = this.current?.share;
    const cardEl = this.root.querySelector(".result-card");
    if (!info || !cardEl || !this.onShare || this.busy) return;
    cardEl.classList.add("sharing");
    if (this.card) return;
    this.busy = true;
    try {
      const canvas = await this.onShare(info);
      if (this.current?.share !== info) return; // results changed meanwhile
      this.card = canvas;
      const preview = this.root.querySelector(".share-preview");
      if (preview) {
        const img = new Image();
        img.alt = info.headline;
        img.src = canvas.toDataURL("image/png");
        preview.replaceChildren(img);
      }
    } finally {
      this.busy = false;
    }
  }
}
