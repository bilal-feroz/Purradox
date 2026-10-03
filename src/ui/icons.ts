// Inline SVG icon set in the UI bible's chunky, custom style.

export const ICONS = {
  fish: (fill = "#4f86b4", back = "#2c5165", belly = "#eadfca") => `
<svg viewBox="0 0 64 36" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M6 18 L1 6 L14 13 Z M6 18 L1 30 L14 23 Z" fill="${back}" stroke="#1d2a33" stroke-width="2.4" stroke-linejoin="round"/>
  <path d="M12 18 C 20 4, 44 2, 58 15 C 60 17, 60 19, 58 21 C 44 34, 20 32, 12 18 Z" fill="${fill}" stroke="#1d2a33" stroke-width="2.6" stroke-linejoin="round"/>
  <path d="M14 19 C 24 28, 44 30, 57 21 C 44 26, 26 25, 14 19 Z" fill="${belly}"/>
  <path d="M18 14 C 28 6, 44 6, 54 13 C 42 9, 28 10, 18 14 Z" fill="${back}"/>
  <path d="M30 6 L36 1 L40 7 Z" fill="${back}" stroke="#1d2a33" stroke-width="2" stroke-linejoin="round"/>
  <path d="M42 11 C 44 15, 44 21, 42 25" fill="none" stroke="#e07a6a" stroke-width="2.2" stroke-linecap="round"/>
  <circle cx="49" cy="15" r="4.6" fill="#f2c14e" stroke="#1d2a33" stroke-width="2"/>
  <circle cx="50" cy="15" r="2.2" fill="#1d1a17"/>
  <circle cx="51" cy="13.6" r="0.9" fill="#fff"/>
</svg>`,
  pounce: `
<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M8 44 C 14 40, 20 36, 26 34 L 34 24 C 36 20, 40 16, 46 15 L 48 9 L 51 15 L 55 11 L 55 19 C 57 22, 56 26, 52 28 L 44 30 C 40 34, 38 38, 36 44 L 41 50 L 35 50 L 30 44 C 26 46, 22 46, 18 45 L 12 52 L 8 52 L 13 44 Z" fill="#fff"/>
  <path d="M8 44 C 2 42, 2 36, 6 33" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round"/>
</svg>`,
  hiss: `
<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M12 18 L 18 6 L 26 16 C 30 15, 34 15, 38 16 L 46 6 L 52 18 C 56 24, 56 34, 52 42 C 46 52, 18 52, 12 42 C 8 34, 8 24, 12 18 Z" fill="#fff"/>
  <path d="M20 26 L 28 30 M 44 26 L 36 30" stroke="#d6453c" stroke-width="3.6" stroke-linecap="round"/>
  <path d="M22 38 C 26 34, 38 34, 42 38 L 40 44 L 36 40 L 32 45 L 28 40 L 24 44 Z" fill="#d6453c"/>
</svg>`,
  scent: `
<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <g fill="#fff">
    <ellipse cx="22" cy="40" rx="8" ry="6.5"/><circle cx="13" cy="31" r="3.2"/><circle cx="19" cy="27" r="3.2"/><circle cx="26" cy="27" r="3.2"/><circle cx="31" cy="31" r="3.2"/>
    <ellipse cx="44" cy="24" rx="6.2" ry="5"/><circle cx="37" cy="17" r="2.5"/><circle cx="42" cy="14" r="2.5"/><circle cx="47.5" cy="14" r="2.5"/><circle cx="51.5" cy="17" r="2.5"/>
  </g>
</svg>`,
  pin: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22 C 12 22, 4 13.5, 4 9 A 8 8 0 0 1 20 9 C 20 13.5, 12 22, 12 22 Z" fill="#f2c14e" stroke="#1d2a33" stroke-width="1.8"/><circle cx="12" cy="9" r="3" fill="#1d2a33"/></svg>`,
  bowl: `<svg viewBox="0 0 32 24" aria-hidden="true"><path d="M3 10 H 29 C 29 18, 23 22, 16 22 C 9 22, 3 18, 3 10 Z" fill="#f2c14e" stroke="#1d2a33" stroke-width="2"/><path d="M9 9 C 12 3, 20 3, 23 9" fill="#4f86b4" stroke="#1d2a33" stroke-width="1.6"/></svg>`,
  flag: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 22 V 3" stroke="#1d2a33" stroke-width="2.4" stroke-linecap="round"/><path d="M6 4 H 19 L 16 8 L 19 12 H 6 Z" fill="#1d2a33"/></svg>`,
  play: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4 L 20 12 L 7 20 Z" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>`,
  gear: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm9 4.5-.1-1 2-1.6-2-3.4-2.4.9a8 8 0 0 0-1.7-1L16.4 4h-4l-.5 2.6a8 8 0 0 0-1.7 1l-2.4-.9-2 3.4 2 1.6a8 8 0 0 0 0 2l-2 1.6 2 3.4 2.4-.9a8 8 0 0 0 1.7 1l.5 2.6h4l.5-2.6a8 8 0 0 0 1.7-1l2.4.9 2-3.4-2-1.6.1-1Z" transform="translate(-2.2 -2) scale(1.08)"/></svg>`,
  fullscreen: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9 V 4 H 9 M 15 4 H 20 V 9 M 20 15 V 20 H 15 M 9 20 H 4 V 15" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  catHead: (fill: string) => `<svg viewBox="0 0 40 34" aria-hidden="true"><path d="M5 12 L 7 1 L 15 8 C 18 7, 22 7, 25 8 L 33 1 L 35 12 C 38 17, 37 24, 33 28 C 27 34, 13 34, 7 28 C 3 24, 2 17, 5 12 Z" fill="${fill}" stroke="#1d2a33" stroke-width="2.4" stroke-linejoin="round"/><circle cx="14" cy="18" r="2.6" fill="#1d2a33"/><circle cx="26" cy="18" r="2.6" fill="#1d2a33"/><path d="M18 23 L 20 25 L 22 23" fill="none" stroke="#1d2a33" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  chevron: `<svg viewBox="0 0 16 24" aria-hidden="true"><path d="M4 3 L13 12 L4 21" fill="none" stroke="currentColor" stroke-width="3.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  paw: (fill: string) =>
    `<svg viewBox="0 0 32 32" aria-hidden="true"><g fill="${fill}"><path d="M16 14.5 C 21 14.5, 24.5 19, 24.5 22.5 C 24.5 26, 21 26.5, 16 25.5 C 11 26.5, 7.5 26, 7.5 22.5 C 7.5 19, 11 14.5, 16 14.5 Z"/><ellipse cx="7" cy="13" rx="2.9" ry="3.7" transform="rotate(-22 7 13)"/><ellipse cx="12.6" cy="7.6" rx="2.9" ry="3.8" transform="rotate(-8 12.6 7.6)"/><ellipse cx="19.4" cy="7.6" rx="2.9" ry="3.8" transform="rotate(8 19.4 7.6)"/><ellipse cx="25" cy="13" rx="2.9" ry="3.7" transform="rotate(22 25 13)"/></g></svg>`,
  /** Hand-painted orange underline. */
  swoosh: `<svg class="swoosh" viewBox="0 0 120 14" preserveAspectRatio="none" aria-hidden="true"><path d="M3 9 C 30 4, 72 2.5, 116 5 C 118.5 6, 118 8.6, 115.5 8.8 C 76 8, 40 9, 6 12.4 C 2 12.8, 0.6 10, 3 9 Z" fill="#f0812f"/></svg>`,
  /** Three little orange "pop" marks. */
  dashes: `<svg viewBox="0 0 30 30" aria-hidden="true"><g stroke="#f0812f" stroke-width="4.2" stroke-linecap="round"><path d="M3.5 23 L10 19.5"/><path d="M13 12.5 L15 4.5"/><path d="M20.5 17 L27.5 14"/></g></svg>`,
  /** Low-poly bougainvillea spilling into the top-left corner. */
  foliage: buildFoliage(),
  logoCat: `<svg viewBox="0 0 120 110" aria-hidden="true">
  <path d="M14 40 L 18 4 L 44 24 C 54 21, 66 21, 76 24 L 102 4 L 106 40 C 116 54, 114 76, 102 88 C 84 108, 36 108, 18 88 C 6 76, 4 54, 14 40 Z" fill="#1d1a17"/>
  <ellipse cx="44" cy="58" rx="12" ry="13" fill="#f2a63a"/><ellipse cx="76" cy="58" rx="12" ry="13" fill="#f2a63a"/>
  <ellipse cx="46" cy="60" rx="5" ry="8" fill="#1d1a17"/><ellipse cx="74" cy="60" rx="5" ry="8" fill="#1d1a17"/>
  <circle cx="48" cy="55" r="2.4" fill="#fff"/><circle cx="76" cy="55" r="2.4" fill="#fff"/>
  <path d="M54 76 L 60 81 L 66 76" fill="none" stroke="#f2a63a" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`,
};

function buildFoliage(): string {
  const greens: Array<[string, string]> = [
    ["#4f9e43", "#3a7f35"],
    ["#5daa4c", "#43893b"],
    ["#3f8a3a", "#2e6c2e"],
    ["#68b354", "#4b9442"],
  ];
  const leaf = (x: number, y: number, rot: number, s: number, c: number): string => {
    const [hi, lo] = greens[c % greens.length];
    return `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${s})"><path d="M0 0 L18 -9 L44 -11 L70 0 Z" fill="${hi}"/><path d="M0 0 L70 0 L44 10 L18 8 Z" fill="${lo}"/></g>`;
  };
  const pinks = ["#e8408c", "#f86aa8", "#c82a72", "#f0569a", "#d93580", "#ff86ba"];
  const gem = (cx: number, cy: number, r: number, turn: number): string => {
    let out = "";
    for (let k = 0; k < 6; k++) {
      const a0 = turn + (k * Math.PI) / 3;
      const a1 = turn + ((k + 1) * Math.PI) / 3;
      const p = (a: number) => `${(cx + Math.cos(a) * r).toFixed(1)} ${(cy + Math.sin(a) * r).toFixed(1)}`;
      out += `<path d="M${cx} ${cy} L${p(a0)} L${p(a1)} Z" fill="${pinks[k]}"/>`;
    }
    return out;
  };
  const bloom = (x: number, y: number, s: number): string =>
    gem(x, y, 13 * s, 0.2) + gem(x + 14 * s, y + 6 * s, 11 * s, 0.7) + gem(x + 3 * s, y + 15 * s, 10 * s, 1.1);
  const L: Array<[number, number, number, number, number]> = [
    [-6, 8, 8, 1.1, 0], [34, -4, 22, 1.0, 1], [84, -8, 12, 1.15, 2], [136, 2, 28, 0.95, 3],
    [186, -10, 16, 1.05, 0], [242, -6, 34, 0.9, 1], [296, -4, 18, 0.8, 2], [344, -12, 38, 0.75, 3],
    [-4, 58, 66, 1.1, 1], [4, 118, 78, 1.0, 2], [-8, 176, 62, 1.05, 3], [6, 236, 84, 0.95, 0],
    [-2, 296, 58, 0.95, 1], [-8, 356, 74, 0.9, 2], [2, 416, 80, 0.8, 3], [-4, 468, 68, 0.7, 0],
    [26, 34, 44, 0.9, 2], [58, 64, 54, 0.8, 3], [18, 138, 38, 0.85, 1], [40, 198, 50, 0.8, 2],
    [116, 26, 58, 0.85, 0], [24, 300, 46, 0.75, 3], [168, 22, 40, 0.7, 2],
  ];
  const B: Array<[number, number, number]> = [
    [52, 22, 1.1], [150, 14, 0.95], [26, 102, 1.05], [232, 10, 0.85], [40, 244, 0.95], [16, 362, 0.85], [98, 78, 0.8], [312, 8, 0.7],
  ];
  return `<svg viewBox="0 0 400 520" preserveAspectRatio="xMinYMin meet" aria-hidden="true">${L.map((l) => leaf(...l)).join("")}${B.map((b) => bloom(...b)).join("")}</svg>`;
}
