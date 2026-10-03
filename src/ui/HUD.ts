import { formatClock } from "../core/math";
import { el } from "./dom";
import { ICONS } from "./icons";

export type AlertKind = "stolen" | "dropped" | "recovered" | "perfect" | "info";

interface AbilityView {
  root: HTMLDivElement;
  cd: HTMLDivElement;
  ready: boolean;
  active: boolean;
}

/**
 * Minimal in-game HUD per the UI bible: Round tag + Fish Grip (top-left),
 * objective / Past You timeline (top-center), ability rings (bottom-right),
 * punchy alerts. Nothing else.
 */
export class HUD {
  readonly root: HTMLDivElement;
  private readonly roundTag: HTMLDivElement;
  private readonly grip: HTMLDivElement;
  private readonly gripFish: HTMLDivElement[] = [];
  private readonly gripLabel: HTMLDivElement;
  private readonly objective: HTMLDivElement;
  private readonly objTitle: HTMLSpanElement;
  private readonly objValue: HTMLSpanElement;
  private readonly objIcon: HTMLSpanElement;
  private readonly timeline: HTMLDivElement;
  private readonly tlPast: HTMLDivElement;
  private readonly tlCat: HTMLDivElement;
  private readonly tlLabel: HTMLDivElement;
  private readonly tlDots: HTMLElement[] = [];
  private readonly tlEvents: HTMLDivElement;
  private readonly abilities: Record<"pounce" | "hiss" | "scent", AbilityView>;
  private readonly prompt: HTMLDivElement;
  private readonly promptText: HTMLSpanElement;
  private readonly alerts: HTMLDivElement;
  private lastGrip = 3;
  private objectiveVisibleUntil = 0;

  constructor(parent: HTMLElement) {
    this.root = el("div", "screen");
    this.root.id = "hud";
    parent.appendChild(this.root);

    const tl = el("div", "hud-tl");
    this.roundTag = el("div", "round-tag", "ROUND 1");
    this.grip = el("div", "grip");
    for (let i = 0; i < 3; i++) {
      const f = el("div", "gfish", ICONS.fish());
      this.gripFish.push(f);
      this.grip.appendChild(f);
    }
    this.gripLabel = el("div", "grip-label", "FISH GRIP");
    tl.append(this.roundTag, this.grip, this.gripLabel);
    this.root.appendChild(tl);

    const tc = el("div", "hud-tc");
    this.timeline = el("div", "timeline");
    this.timeline.innerHTML = `<div class="tl-track"></div><div class="tl-past"></div><div class="tl-dots"></div><div class="tl-events"></div><div class="tl-flag">${ICONS.flag}</div><div class="tl-cat">${ICONS.catHead("#f0812f")}</div><div class="tl-label">PAST YOU</div>`;
    this.tlPast = this.timeline.querySelector(".tl-past") as HTMLDivElement;
    this.tlCat = this.timeline.querySelector(".tl-cat") as HTMLDivElement;
    this.tlLabel = this.timeline.querySelector(".tl-label") as HTMLDivElement;
    this.tlEvents = this.timeline.querySelector(".tl-events") as HTMLDivElement;
    const dots = this.timeline.querySelector(".tl-dots") as HTMLDivElement;
    for (let i = 0; i < 12; i++) {
      const d = el("i");
      dots.appendChild(d);
      this.tlDots.push(d);
    }
    this.objective = el("div", "objective hide");
    this.objIcon = el("span", "", ICONS.pin);
    const txt = el("span", "obj-text");
    this.objTitle = el("span", "obj-title", "SAFE ROOFTOP");
    this.objValue = el("span", "obj-value", "—");
    txt.append(this.objTitle, this.objValue);
    this.objective.append(this.objIcon, txt);
    tc.append(this.timeline, this.objective);
    this.root.appendChild(tc);

    const br = el("div", "hud-br");
    const mk = (cls: string, icon: string, label: string, key: string): AbilityView => {
      const root = el("div", `ability ${cls}`);
      root.innerHTML = `<div class="ring">${icon}<div class="cd"></div></div><div class="label outline-text">${label}</div><div class="keyhint">${key}</div>`;
      br.appendChild(root);
      return { root, cd: root.querySelector(".cd") as HTMLDivElement, ready: true, active: false };
    };
    this.abilities = {
      scent: mk("scent", ICONS.scent, "SCENT<br>MEMORY", "R"),
      hiss: mk("hiss", ICONS.hiss, "HISS", "RMB"),
      pounce: mk("pounce", ICONS.pounce, "POUNCE", "LMB"),
    };
    this.root.appendChild(br);

    this.prompt = el("div", "prompt hide");
    this.prompt.innerHTML = `<b>E</b>`;
    this.promptText = el("span", "", "");
    this.prompt.appendChild(this.promptText);
    this.root.appendChild(this.prompt);

    this.alerts = el("div", "alerts");
    this.root.appendChild(this.alerts);

    this.lockHint = el("div", "click-hint", "CLICK TO STEER THE CAMERA WITH YOUR MOUSE");
    this.lockHint.style.display = "none";
    this.root.appendChild(this.lockHint);
  }

  private readonly lockHint: HTMLDivElement;

  setLockHint(show: boolean): void {
    const want = show ? "block" : "none";
    if (this.lockHint.style.display !== want) this.lockHint.style.display = want;
  }

  show(on: boolean): void {
    this.root.classList.toggle("show", on);
  }

  setRound(round: 1 | 2): void {
    this.roundTag.textContent = round === 1 ? "ROUND 1" : "ROUND 2";
    this.timeline.style.display = round === 2 ? "block" : "none";
    this.abilities.scent.root.style.display = round === 2 ? "flex" : "none";
    this.gripLabel.textContent = round === 2 ? "PAST YOU'S GRIP" : "FISH GRIP";
  }

  setGrip(value: number, visible: boolean): void {
    this.grip.classList.toggle("empty", !visible);
    for (let i = 0; i < 3; i++) {
      const f = this.gripFish[i];
      const has = visible && i < value;
      const wasLost = f.classList.contains("lost");
      f.classList.toggle("lost", !has);
      if (!has && !wasLost && this.lastGrip > value) {
        f.classList.remove("hit");
        void f.offsetWidth;
        f.classList.add("hit");
      }
      if (has && wasLost) {
        f.classList.remove("restore");
        void f.offsetWidth;
        f.classList.add("restore");
      }
    }
    this.lastGrip = visible ? value : 0;
  }

  /** Objective pill (shown briefly when useful). */
  setObjective(title: string, value: string, visible: boolean, urgent = false, icon: "pin" | "fish" | "bowl" = "pin"): void {
    this.objTitle.textContent = title;
    this.objValue.textContent = value;
    this.objective.classList.toggle("hide", !visible);
    this.objective.classList.toggle("urgent", urgent);
    const want = icon === "fish" ? "fish" : icon === "bowl" ? "bowl" : "pin";
    if (this.objIcon.dataset.icon !== want) {
      this.objIcon.dataset.icon = want;
      this.objIcon.innerHTML = want === "fish" ? ICONS.fish() : want === "bowl" ? ICONS.bowl : ICONS.pin;
    }
  }

  pingObjective(now: number, seconds = 3.5): void {
    this.objectiveVisibleUntil = Math.max(this.objectiveVisibleUntil, now + seconds);
  }

  objectiveWanted(now: number): boolean {
    return now < this.objectiveVisibleUntil;
  }

  /** Round 2 timeline: progress 0..1 over Past You's recorded run. */
  setTimeline(progress: number, timeLeft: number): void {
    const p = Math.max(0, Math.min(1, progress));
    const trackW = this.timeline.clientWidth - 38;
    this.tlPast.style.width = `${p * trackW}px`;
    this.tlCat.style.left = `${8 + p * trackW}px`;
    this.tlLabel.style.left = `${8 + p * trackW}px`;
    this.tlLabel.textContent = `PAST YOU · ${formatClock(timeLeft)}`;
    const n = this.tlDots.length;
    for (let i = 0; i < n; i++) this.tlDots[i].classList.toggle("past", i / (n - 1) <= p);
  }

  /** Small markers on the timeline for recorded hisses/pounces. */
  setTimelineEvents(events: Array<{ at: number; kind: "hiss" | "pounce" }>): void {
    this.tlEvents.innerHTML = "";
    const trackW = Math.max(200, this.timeline.clientWidth - 38);
    for (const e of events) {
      const d = el("div", `tl-event ${e.kind}`);
      d.style.left = `${8 + e.at * trackW}px`;
      this.tlEvents.appendChild(d);
    }
  }

  setAbility(which: "pounce" | "hiss" | "scent", cooldownFrac: number, active: boolean): void {
    const a = this.abilities[which];
    const ready = cooldownFrac <= 0.001;
    a.cd.style.setProperty("--cd", `${Math.round(Math.max(0, Math.min(1, cooldownFrac)) * 100)}%`);
    a.root.classList.toggle("cooldown", !ready && !active);
    a.root.classList.toggle("active", active);
    if (ready && !a.ready && !active) {
      a.root.classList.remove("ready-pop");
      void a.root.offsetWidth;
      a.root.classList.add("ready-pop");
    }
    a.ready = ready;
    a.active = active;
  }

  setPrompt(text: string | null): void {
    if (text) this.promptText.textContent = text;
    this.prompt.classList.toggle("hide", !text);
  }

  alert(text: string, kind: AlertKind): void {
    const a = el("div", `alert brush ${kind}`);
    const icon = kind === "perfect" ? ICONS.hiss.replace('fill="#fff"', 'fill="#e05a4f"') : ICONS.fish();
    a.innerHTML = `${kind === "info" ? "" : icon}<span>${text}</span>`;
    if (kind === "perfect") {
      const svg = a.querySelector("svg");
      if (svg) {
        svg.setAttribute("width", "44");
        svg.setAttribute("height", "44");
      }
    }
    this.alerts.appendChild(a);
    while (this.alerts.children.length > 3) this.alerts.firstElementChild?.remove();
    setTimeout(() => a.remove(), 1700);
  }

  clearAlerts(): void {
    this.alerts.innerHTML = "";
  }
}
