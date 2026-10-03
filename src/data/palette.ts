// Colors sampled from the approved reference sheets (docs/reference-manifest.md).
// Strong color blocking, matte, warm Mediterranean late afternoon.

export const PALETTE = {
  // World — stone, plaster, roofs
  stoneCream: 0xead6b3,
  stoneWarm: 0xe2c49a,
  stoneSand: 0xd9b88a,
  stoneShadow: 0xc9a77c,
  plasterPeach: 0xe9b98e,
  plasterOchre: 0xe3b45f,
  plasterCoral: 0xe39a7c,
  cobble: 0xddc49c,
  cobbleDark: 0xbfa27a,
  grout: 0xa88b66,
  terracotta: 0xc8613f,
  terracottaDark: 0xa84b32,
  terracottaLight: 0xdb7a55,
  cliff: 0xcdb08a,
  cliffDark: 0xa98d6c,

  // Accents
  tealShutter: 0x3f8c93,
  tealDeep: 0x2f6f78,
  coralShutter: 0xd96a4f,
  creamShutter: 0xeedfc4,
  windowGlass: 0x4f7896,
  doorTeal: 0x2f7c86,

  // Wood + metal
  woodHoney: 0xc27a3e,
  woodLight: 0xd59556,
  woodDark: 0x8a5a30,
  metalBlueGray: 0x6f8494,
  metalDark: 0x4a5560,
  metalLight: 0x9aa8b3,
  rust: 0xa5603a,
  lampGlow: 0xffd27a,

  // Fabric
  awningCoral: 0xe0675a,
  awningTeal: 0x2f7f8f,
  awningCream: 0xf3e6cf,
  sheetCream: 0xf1e7d4,
  clothBlue: 0x5d8fc4,
  clothCoral: 0xe9776b,
  cushionTeal: 0x3c8a9a,

  // Plants
  leaf: 0x6fae3d,
  leafLight: 0x8cc456,
  leafDark: 0x3f7a34,
  flowerPink: 0xe9579b,
  flowerMagenta: 0xd43f84,
  flowerWhite: 0xf6efe4,
  flowerPeach: 0xf39a76,
  trunk: 0x8b5a33,
  potTerracotta: 0xc96a43,
  potCream: 0xe9dcc4,
  lemon: 0xf2cd3a,

  // Water + sky
  seaDeep: 0x1f7fa6,
  seaShallow: 0x37c0cf,
  seaFoam: 0xe8fbff,
  skyTop: 0x5fb2ea,
  skyHorizon: 0xcfe9f5,
  cloud: 0xffffff,
  domeBlue: 0x3b7fa8,

  // Temporal / sea-glass
  seaGlass: 0x7ff3dc,
  seaGlassDeep: 0x2fd3c0,
  temporalPink: 0xffa8c8,

  // UI
  uiCream: 0xf4ecdd,
  uiNavy: 0x22384a,
  uiTeal: 0x2d8c8c,
  uiCoral: 0xef6f5b,
  uiSky: 0x8fc6d4,
  uiOrange: 0xf0812f,
} as const;

export const FISH_COLORS = {
  back: 0x2c5165,
  body: 0x5a86a3,
  belly: 0xeadfca,
  fins: 0x33676a,
  eye: 0xe2b347,
  pupil: 0x1d1a17,
  gill: 0xd97c6e,
} as const;

export const PIGEON_COLORS = {
  body: 0x7b7c85,
  head: 0x4e5868,
  bands: 0x48484e,
  neck: 0x3e8079,
  eye: 0xd5492e,
  feet: 0xe3816f,
  beak: 0xada49b,
  wingLight: 0x92939b,
} as const;
