import "@fontsource/luckiest-guy";
import "@fontsource/fredoka/400.css";
import "@fontsource/fredoka/500.css";
import "@fontsource/fredoka/600.css";
import "@fontsource/fredoka/700.css";
import "@fontsource/patrick-hand";
import "./ui/styles.css";
import { Game } from "./core/Game";

declare global {
  interface Window {
    __purradox?: Game;
    /** Advance the game by N frames of `dt` seconds (testing / automation). */
    __purradoxStep?: (frames: number, dt?: number) => string;
  }
}

async function main(): Promise<void> {
  const canvas = document.getElementById("game-canvas") as HTMLCanvasElement;
  const ui = document.getElementById("ui-root") as HTMLDivElement;
  const boot = document.getElementById("boot-screen") as HTMLDivElement;
  const fill = boot.querySelector(".boot-fill") as HTMLDivElement;
  const label = boot.querySelector(".boot-label") as HTMLDivElement;
  let game: Game;
  try {
    game = new Game(canvas, ui);
  } catch (err) {
    console.error(err);
    label.textContent = "PURRADOX needs WebGL. Try a recent Chrome, Edge or Firefox with hardware acceleration enabled.";
    return;
  }
  window.__purradox = game;
  try {
    await game.boot((p, text) => {
      fill.style.width = `${Math.round(p * 100)}%`;
      label.textContent = text;
    });
  } catch (err) {
    console.error(err);
    label.textContent = "Something went wrong while loading Sardine Street. Please refresh.";
    return;
  }
  boot.classList.add("hidden");
  setTimeout(() => boot.remove(), 800);
  window.__purradoxStep = (frames: number, dt = 1 / 60) => {
    for (let i = 0; i < frames; i++) game.frame(game.time.lastStamp + dt * 1000);
    return game.fsm.state;
  };
  const params = new URLSearchParams(location.search);
  if (params.get("debug") === "1") {
    const { Autopilot } = await import("./debug/Autopilot");
    const { TestHarness } = await import("./debug/TestHarness");
    const ap = new Autopilot(game);
    (window as unknown as { __autopilot: unknown }).__autopilot = ap;
    (window as unknown as { __test: unknown }).__test = new TestHarness(game, ap);
  }
  if (params.get("autopause") === "0") game.autoPause = false;
  let frameErrors = 0;
  const loop = (now: number) => {
    requestAnimationFrame(loop);
    // Automated tests can take over the clock (manual stepping).
    if (game.manualStepping) return;
    try {
      game.frame(now);
    } catch (err) {
      // Keep the loop alive; report the first few failures only.
      if (frameErrors++ < 5) console.error(err);
    }
  };
  requestAnimationFrame(loop);
}

void main();
