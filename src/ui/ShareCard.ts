import { CATS, type CatId } from "../data/cats";
import { ICONS } from "./icons";

export interface ShareInfo {
  success: boolean;
  /** Big line, e.g. "I STOLE A FISH FROM MYSELF IN 24.1 SECONDS." */
  headline: string;
  /** Small facts under it ("FISH RUN 00:31.4", "COUNCIL PLAN THE CHOKE"…). */
  facts: string[];
  /** The cat the player hunted with (shown as a badge). */
  cat: CatId | null;
}

const W = 1200;
const H = 630;
const INK = "#1d2a33";
const CREAM = "#f4ecdd";

const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;

function loadSvg(svg: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

/** Greedy word wrap to `max` px. */
function wrap(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > max && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

function outlined(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, fill: string, stroke = INK, width = 10): void {
  ctx.lineJoin = "round";
  ctx.lineWidth = width;
  ctx.strokeStyle = stroke;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

/**
 * A 1200×630 share image made locally: the game's own current frame as the
 * backdrop, the run's headline, a few real facts and the logo. No network.
 */
export async function renderShareCard(info: ShareInfo, backdrop: CanvasImageSource | null): Promise<HTMLCanvasElement> {
  try {
    await Promise.all([document.fonts.load('64px "Luckiest Guy"'), document.fonts.load('600 28px "Fredoka"')]);
  } catch {
    // fonts unavailable: the canvas falls back to system fonts
  }
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  // backdrop: the street as it looks right now (cover-fit), or a sky gradient
  if (backdrop) {
    const bw = (backdrop as HTMLCanvasElement).width || W;
    const bh = (backdrop as HTMLCanvasElement).height || H;
    const s = Math.max(W / bw, H / bh);
    ctx.drawImage(backdrop, (W - bw * s) / 2, (H - bh * s) / 2, bw * s, bh * s);
  } else {
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, "#8fc6d4");
    sky.addColorStop(1, "#f3eadb");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);
  }
  // legibility veil on the left
  const veil = ctx.createLinearGradient(0, 0, W * 0.75, 0);
  veil.addColorStop(0, "rgba(20, 34, 44, 0.82)");
  veil.addColorStop(0.65, "rgba(20, 34, 44, 0.45)");
  veil.addColorStop(1, "rgba(20, 34, 44, 0)");
  ctx.fillStyle = veil;
  ctx.fillRect(0, 0, W, H);

  // logo
  ctx.textBaseline = "alphabetic";
  ctx.font = '64px "Luckiest Guy", Fredoka, sans-serif';
  outlined(ctx, "PURRADOX", 64, 112, CREAM, INK, 12);
  ctx.font = '600 22px Fredoka, sans-serif';
  ctx.fillStyle = "#7ff3dc";
  ctx.fillText("YOUR FIRST RUN CREATES YOUR SECOND OPPONENT.", 68, 150);

  // ribbon
  const ribbon = info.success ? "TIMELINE BROKEN" : "PAST YOU WAS TOO GOOD";
  ctx.font = '30px "Luckiest Guy", Fredoka, sans-serif';
  const rw = ctx.measureText(ribbon).width + 44;
  ctx.save();
  ctx.translate(64, 196);
  ctx.rotate(-0.03);
  ctx.fillStyle = info.success ? "#3f9a5a" : "#d4483f";
  ctx.strokeStyle = INK;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.roundRect(0, 0, rw, 54, 12);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#fff";
  ctx.fillText(ribbon, 22, 40);
  ctx.restore();

  // headline
  ctx.font = '62px "Luckiest Guy", Fredoka, sans-serif';
  const lines = wrap(ctx, info.headline, 700).slice(0, 3);
  lines.forEach((l, i) => outlined(ctx, l, 64, 322 + i * 70, "#ffd166", INK, 12));

  // facts
  ctx.font = '600 26px Fredoka, sans-serif';
  const fy = 322 + lines.length * 70 + 18;
  info.facts.slice(0, 3).forEach((f, i) => {
    ctx.fillStyle = CREAM;
    ctx.fillText(f, 68, fy + i * 36);
  });

  // cat badge
  if (info.cat) {
    const img = await loadSvg(ICONS.catHead(hex(CATS[info.cat].colors.main)).replace("<svg", '<svg width="200" height="170" xmlns="http://www.w3.org/2000/svg"'));
    const bx = W - 250;
    const by = H - 250;
    ctx.fillStyle = CREAM;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(bx + 100, by + 100, 104, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (img) ctx.drawImage(img, bx + 22, by + 30, 156, 132);
    ctx.font = '30px "Luckiest Guy", Fredoka, sans-serif';
    ctx.textAlign = "center";
    outlined(ctx, CATS[info.cat].name.toUpperCase(), bx + 100, by + 236, CREAM, INK, 8);
    ctx.textAlign = "left";
  }
  return canvas;
}

/** Save the card as a PNG (a normal browser download the player asked for). */
export function downloadCard(canvas: HTMLCanvasElement, filename = "purradox-run.png"): void {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }, "image/png");
}
