// Character definitions derived from the four approved turnaround sheets.
// All cats share one construction language; proportions, markings and
// stats give each a distinct silhouette and play style.

export type CatId = "fishcat" | "mochi" | "soot" | "beans";
export type RivalId = Exclude<CatId, "fishcat">;
export const RIVAL_IDS: readonly RivalId[] = ["mochi", "soot", "beans"];

export type CatPattern = "fishcat" | "calico" | "smoky" | "tabby";

export interface CatColors {
  main: number;
  light: number;
  dark: number;
  eye: number;
  nose: number;
  innerEar: number;
  paw: number;
}

export interface CatProportions {
  scale: number;
  bodyLength: number;
  bodyRadius: number;
  bodyHeight: number;
  legLength: number;
  legThickness: number;
  headSize: number;
  earHeight: number;
  earWidth: number;
  tailLength: number;
  tailThickness: number;
  tailCurl: number;
  eyeSize: number;
  neckLift: number;
  muzzleSize: number;
  browAngle: number;
}

export interface CatStats {
  runSpeed: number;
  sprintSpeed: number;
  groundAccel: number;
  airAccel: number;
  jumpHeight: number;
  pounceSpeed: number;
  pounceLift: number;
  pounceDuration: number;
  pounceCooldown: number;
  hissCooldown: number;
  hissRange: number;
  hitRadius: number;
}

export interface CatDef {
  id: CatId;
  name: string;
  title: string;
  role: string;
  blurb: string;
  pattern: CatPattern;
  colors: CatColors;
  proportions: CatProportions;
  stats: CatStats;
}

const BASE_STATS: CatStats = {
  runSpeed: 5.6,
  sprintSpeed: 8.1,
  groundAccel: 46,
  airAccel: 20,
  jumpHeight: 1.95,
  pounceSpeed: 15.5,
  pounceLift: 3.2,
  pounceDuration: 0.3,
  pounceCooldown: 1.6,
  hissCooldown: 2.2,
  hissRange: 3.3,
  hitRadius: 0.78,
};

export const CATS: Record<CatId, CatDef> = {
  fishcat: {
    id: "fishcat",
    name: "Fish Cat",
    title: "FISH CAT",
    role: "The Thief",
    blurb: "Compact, quick and absolutely not giving that fish back.",
    pattern: "fishcat",
    colors: {
      main: 0xe07b39,
      light: 0xf2d9b5,
      dark: 0xa84a25,
      eye: 0x8a8f34,
      nose: 0xc2766a,
      innerEar: 0xd59b8b,
      paw: 0xf2d9b5,
    },
    proportions: {
      scale: 1,
      bodyLength: 0.6,
      bodyRadius: 0.19,
      bodyHeight: 1,
      legLength: 0.3,
      legThickness: 0.075,
      headSize: 0.215,
      earHeight: 0.17,
      earWidth: 0.085,
      tailLength: 0.72,
      tailThickness: 0.052,
      tailCurl: 0.25,
      eyeSize: 0.054,
      neckLift: 0.1,
      muzzleSize: 0.085,
      browAngle: 0.18,
    },
    stats: { ...BASE_STATS },
  },
  mochi: {
    id: "mochi",
    name: "Mochi",
    title: "MOCHI",
    role: "Early Pressure",
    blurb: "The sprinter. Fast, direct, pounces first and thinks later.",
    pattern: "calico",
    colors: {
      main: 0xe57f3b,
      light: 0xf6e8d6,
      dark: 0xb0532a,
      eye: 0xe3a83e,
      nose: 0xcf7f73,
      innerEar: 0xd4968a,
      paw: 0xf6e8d6,
    },
    proportions: {
      scale: 1.04,
      bodyLength: 0.62,
      bodyRadius: 0.172,
      bodyHeight: 1,
      legLength: 0.35,
      legThickness: 0.067,
      headSize: 0.205,
      earHeight: 0.19,
      earWidth: 0.082,
      tailLength: 0.8,
      tailThickness: 0.046,
      tailCurl: 0.35,
      eyeSize: 0.05,
      neckLift: 0.13,
      muzzleSize: 0.08,
      browAngle: 0.28,
    },
    stats: {
      ...BASE_STATS,
      runSpeed: 6.0,
      sprintSpeed: 8.7,
      groundAccel: 52,
      pounceCooldown: 1.35,
    },
  },
  soot: {
    id: "soot",
    name: "Soot",
    title: "SOOT",
    role: "Mid-Route Ambush",
    blurb: "The ambusher. Low, patient, always waiting where you land.",
    pattern: "smoky",
    colors: {
      main: 0x3e3a39,
      light: 0x7a726d,
      dark: 0x2a2726,
      eye: 0xc2c23c,
      nose: 0x6b5655,
      innerEar: 0xb98585,
      paw: 0x7a726d,
    },
    proportions: {
      scale: 1.02,
      bodyLength: 0.7,
      bodyRadius: 0.175,
      bodyHeight: 0.92,
      legLength: 0.27,
      legThickness: 0.069,
      headSize: 0.2,
      earHeight: 0.165,
      earWidth: 0.08,
      tailLength: 0.84,
      tailThickness: 0.05,
      tailCurl: 0.15,
      eyeSize: 0.05,
      neckLift: 0.06,
      muzzleSize: 0.078,
      browAngle: 0.34,
    },
    stats: {
      ...BASE_STATS,
      runSpeed: 5.5,
      sprintSpeed: 8.2,
      pounceSpeed: 17.5,
      pounceDuration: 0.34,
      pounceCooldown: 1.7,
      hissCooldown: 2.0,
    },
  },
  beans: {
    id: "beans",
    name: "Beans",
    title: "BEANS",
    role: "Rooftop Chaos",
    blurb: "The chaos cat. Tiny, springy, and sure that everything is a toy.",
    pattern: "tabby",
    colors: {
      main: 0x837b76,
      light: 0xcfc6bb,
      dark: 0x55504d,
      eye: 0x3fb8b0,
      nose: 0xc2877e,
      innerEar: 0xcf8d82,
      paw: 0xd8d0c5,
    },
    proportions: {
      scale: 0.86,
      bodyLength: 0.52,
      bodyRadius: 0.168,
      bodyHeight: 1,
      legLength: 0.28,
      legThickness: 0.067,
      headSize: 0.225,
      earHeight: 0.26,
      earWidth: 0.115,
      tailLength: 0.7,
      tailThickness: 0.048,
      tailCurl: 0.75,
      eyeSize: 0.064,
      neckLift: 0.12,
      muzzleSize: 0.08,
      browAngle: 0.05,
    },
    stats: {
      ...BASE_STATS,
      runSpeed: 5.8,
      sprintSpeed: 8.3,
      groundAccel: 56,
      airAccel: 26,
      jumpHeight: 2.35,
      hitRadius: 0.72,
    },
  },
};
