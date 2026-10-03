import type { CatId } from "../data/cats";
import { el } from "./dom";
import { ICONS } from "./icons";

/** What a selection screen shows: CHOOSE YOUR THIEF or WHO WANTS THE FISH? */
export interface SelectScreen {
  ids: CatId[];
  title: string;
  sub: string;
  recap: string;
  /** Card text for each cat. */
  card: (id: CatId) => { name: string; role: string; blurb: string };
  /** Card focused when the screen opens. */
  focus?: number;
  /** Offer a BACK button (and Esc). */
  back?: boolean;
}

/** Card picker over the 3D line-up of cats (keyboard: digits, arrows, Enter). */
export class CatSelect {
  readonly root: HTMLDivElement;
  onPick: ((id: CatId) => void) | null = null;
  onHover: ((id: CatId | null) => void) | null = null;
  onBack: (() => void) | null = null;
  /** True while input should be ignored (the pause menu is open). */
  blocked: (() => boolean) | null = null;
  private readonly titleEl: HTMLDivElement;
  private readonly subEl: HTMLDivElement;
  private readonly cardsEl: HTMLDivElement;
  private readonly recapEl: HTMLDivElement;
  private readonly backEl: HTMLButtonElement;
  private ids: CatId[] = [];
  private cards: HTMLDivElement[] = [];
  private focus = 0;
  private enabled = false;
  private allowBack = false;

  constructor(parent: HTMLElement) {
    this.root = el("div", "screen");
    this.root.id = "select-screen";
    const head = el("div", "");
    head.style.textAlign = "center";
    this.titleEl = el("div", "select-title brush", "");
    this.subEl = el("div", "select-sub", "");
    head.append(this.titleEl, this.subEl);
    this.cardsEl = el("div", "cards");
    this.recapEl = el("div", "select-recap", "");
    this.backEl = document.createElement("button");
    this.backEl.className = "btn ghost select-back interactive";
    this.backEl.innerHTML = `<span class="flip">${ICONS.chevron}</span><span>BACK</span>`;
    this.backEl.addEventListener("click", () => {
      if (this.enabled && this.allowBack) this.onBack?.();
    });
    this.root.append(head, this.cardsEl, this.recapEl, this.backEl);
    parent.appendChild(this.root);
    window.addEventListener("keydown", (e) => {
      if (!this.enabled || this.ids.length === 0 || this.blocked?.()) return;
      const n = this.ids.length;
      const digit = Number.parseInt(e.key, 10);
      if (digit >= 1 && digit <= n) this.pick(this.ids[digit - 1]);
      else if (e.code === "ArrowLeft" || e.code === "KeyA") this.moveFocus(n - 1);
      else if (e.code === "ArrowRight" || e.code === "KeyD") this.moveFocus(1);
      else if (e.code === "Enter" || e.code === "Space") this.pick(this.ids[this.focus]);
    });
  }

  private moveFocus(step: number): void {
    this.focus = (this.focus + step) % this.ids.length;
    this.refreshFocus();
    this.onHover?.(this.ids[this.focus]);
  }

  private refreshFocus(): void {
    this.cards.forEach((c, i) => c.classList.toggle("focus", i === this.focus));
  }

  private pick(id: CatId): void {
    if (!this.enabled) return;
    this.enabled = false;
    this.onPick?.(id);
  }

  show(on: boolean, screen?: SelectScreen): void {
    this.root.classList.toggle("show", on);
    this.enabled = on;
    if (!on || !screen) return;
    this.ids = [...screen.ids];
    this.allowBack = Boolean(screen.back);
    this.backEl.style.display = this.allowBack ? "" : "none";
    this.titleEl.textContent = screen.title;
    this.subEl.textContent = screen.sub;
    this.recapEl.textContent = screen.recap;
    this.cardsEl.classList.toggle("four", this.ids.length === 4);
    this.cardsEl.innerHTML = "";
    this.cards = this.ids.map((id, i) => {
      const t = screen.card(id);
      const c = el("div", "card interactive");
      c.innerHTML = `<div class="name">${t.name}</div><div class="role">${t.role}</div><div class="blurb">${t.blurb}</div><div class="num">${i + 1}</div>`;
      c.addEventListener("click", () => this.pick(id));
      c.addEventListener("mouseenter", () => {
        this.focus = i;
        this.refreshFocus();
        this.onHover?.(id);
      });
      this.cardsEl.appendChild(c);
      return c;
    });
    this.focus = Math.min(screen.focus ?? 0, this.ids.length - 1);
    this.refreshFocus();
  }
}
