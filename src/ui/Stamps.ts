import { el } from "./dom";

export type StampKind = "complete" | "recorded" | "watching" | "rewinding" | "council" | "strategy" | "hunt";

/**
 * Big hand-painted game-state typography (RUN COMPLETE, RUN RECORDED,
 * BUT SOMEONE ELSE WAS WATCHING, REWINDING…, Alley Council strategies).
 */
export class Stamps {
  readonly root: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.root = el("div");
    this.root.id = "stamps";
    parent.appendChild(this.root);
  }

  show(text: string, kind: StampKind, small = false, sub?: string): HTMLDivElement {
    const s = el("div", `stamp brush ${kind}${small ? " small" : ""}`);
    s.textContent = text;
    this.root.appendChild(s);
    if (sub) {
      const p = el("div", "strategy-sub", sub);
      this.root.appendChild(p);
    }
    return s;
  }

  clear(animated = true): void {
    if (!animated) {
      this.root.innerHTML = "";
      return;
    }
    const kids = [...this.root.children] as HTMLElement[];
    for (const k of kids) {
      k.classList.add("out");
      setTimeout(() => k.remove(), 360);
    }
  }
}
