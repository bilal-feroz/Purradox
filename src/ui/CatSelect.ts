import { CATS, RIVAL_IDS, type RivalId } from "../data/cats";
import { formatClock } from "../core/math";
import { el } from "./dom";

/** WHO WANTS THE FISH? — pick Mochi, Soot or Beans for Round 2. */
export class CatSelect {
  readonly root: HTMLDivElement;
  onPick: ((id: RivalId) => void) | null = null;
  onHover: ((id: RivalId | null) => void) | null = null;
  private readonly cards = new Map<RivalId, HTMLDivElement>();
  private readonly recap: HTMLDivElement;
  private focus = 0;
  private enabled = false;

  constructor(parent: HTMLElement) {
    this.root = el("div", "screen");
    this.root.id = "select-screen";
    const head = el("div", "");
    head.style.textAlign = "center";
    head.innerHTML = `<div class="select-title brush">WHO WANTS THE FISH?</div><div class="select-sub">ROUND 2 — CHOOSE WHO HUNTS PAST YOU</div>`;
    const cards = el("div", "cards");
    RIVAL_IDS.forEach((id, i) => {
      const d = CATS[id];
      const c = el("div", "card interactive");
      c.innerHTML = `<div class="name">${d.title}</div><div class="role">${d.role.toUpperCase()}</div><div class="blurb">${d.blurb}</div><div class="num">${i + 1}</div>`;
      c.addEventListener("click", () => this.pick(id));
      c.addEventListener("mouseenter", () => {
        this.focus = i;
        this.refreshFocus();
        this.onHover?.(id);
      });
      this.cards.set(id, c);
      cards.appendChild(c);
    });
    this.recap = el("div", "select-recap", "");
    this.root.append(head, cards, this.recap);
    parent.appendChild(this.root);
    window.addEventListener("keydown", (e) => {
      if (!this.enabled) return;
      if (e.code === "Digit1") this.pick("mochi");
      else if (e.code === "Digit2") this.pick("soot");
      else if (e.code === "Digit3") this.pick("beans");
      else if (e.code === "ArrowLeft" || e.code === "KeyA") {
        this.focus = (this.focus + 2) % 3;
        this.refreshFocus();
        this.onHover?.(RIVAL_IDS[this.focus]);
      } else if (e.code === "ArrowRight" || e.code === "KeyD") {
        this.focus = (this.focus + 1) % 3;
        this.refreshFocus();
        this.onHover?.(RIVAL_IDS[this.focus]);
      } else if (e.code === "Enter" || e.code === "Space") this.pick(RIVAL_IDS[this.focus]);
    });
  }

  private refreshFocus(): void {
    RIVAL_IDS.forEach((id, i) => this.cards.get(id)?.classList.toggle("focus", i === this.focus));
  }

  private pick(id: RivalId): void {
    if (!this.enabled) return;
    this.enabled = false;
    this.onPick?.(id);
  }

  show(on: boolean, runTime = 0): void {
    this.root.classList.toggle("show", on);
    this.enabled = on;
    if (on) {
      this.focus = 1;
      this.refreshFocus();
      this.recap.textContent = `Past You will replay your exact ${formatClock(runTime)} run — every jump, pounce and hiss.`;
    }
  }
}
