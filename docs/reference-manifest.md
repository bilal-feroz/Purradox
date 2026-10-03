# PURRADOX — Reference Manifest

Internal asset map for the approved PURRADOX reference pack. Every image was
opened and identified by **content**, not filename. Images live in
[`docs/reference/`](reference/) with their original filenames.

> **Pack status:** the brief describes 18 approved references. The Desktop
> folder contained **16** PNGs. The two missing references are the
> **Final Climb / Safe Rooftop gameplay view** (#16) and the
> **Temporal System / Rewind / VFX Bible** (#17). No substitutes were
> invented; how their decisions were covered is noted at the end.

## Source-of-truth order

1. The build brief (game rules, scope, engineering requirements)
2. Sardine Street Technical Blueprint
3. Sardine Street Master Level Overview
4. Gameplay environment views
5. Character turnarounds
6. Fish / pigeon / prop sheets
7. Temporal VFX direction
8. Final UI / HUD bible

## Map

| # | Actual filename | Represents | Category | Implementation decisions it controls |
|---|---|---|---|---|
| 1 | `Low-Poly Ginger Cat Character Sheet.png` | **Fish Cat** turnaround: orange + cream, green-hazel eyes, dark-orange tail tip | Character | `CATS.fishcat` colors/proportions (`src/data/cats.ts`); `fishcat` paint pattern in `src/cats/CatModel.ts` (cream chest/muzzle/socks, faint dorsal stripes, dark tail tip) |
| 2 | `ChatGPT Image Oct 3, 2026, 11_52_58 AM.png` | **Mochi** turnaround: warm white with orange patches, amber eyes, taller/slimmer | Character | `CATS.mochi` (longer legs, slimmer body, orange cap + back patches, dark tail tip); `calico` paint pattern |
| 3 | `ChatGPT Image Oct 3, 2026, 11_55_19 AM.png` | **Soot** turnaround: charcoal, smoky chest/socks, yellow-green eyes, lean | Character | `CATS.soot` (lowest stance, longest body, stern brows); `smoky` paint pattern |
| 4 | `Low-Poly Tabby Cat Character Sheet.png` | **Beans** turnaround: gray tabby, turquoise eyes, smallest body, huge ears, curly tail | Character | `CATS.beans` (scale 0.86, big head + ears, high tail curl, higher jump); `tabby` stripe pattern |
| 5 | `Purradox Low-Poly Fish Turnaround Sheet.png` | **Hero fish**: deep-teal back, blue-gray body, cream belly, golden eyes, coral gill + open mouth, forked dark-teal tail; carried sideways in the mouth | Hero object | `buildHeroFish()` in `src/fish/Fish.ts`; `FISH_COLORS`; sideways mouth attachment (`FishSystem.attachTo`); ground flop + air spin states |
| 6 | `Low-Poly Pigeon Character Reference Sheet.png` | **Pigeon**: slate body, blue-gray head, teal neck, charcoal wing bands, orange-red eyes, coral feet; pecking/alert/startled/takeoff/flying poses; flock reference | Creature | `src/level/Pigeons.ts` geometry + `PIGEON_COLORS`; peck bob, wing flap, flock burst → perch → return |
| 7 | `Low-Poly Prop Interaction Reference Sheet.png` | **Interactive prop kit**: trash can (knocked over), glass bottle (rolled), pigeon seed box (spilled), laundry line + sheet (dropped), fish scraps tray (spilled), market crate | Prop | `src/level/Interactable.ts` — each prop's idle and "interacted" states match the sheet |
| 8 | `Low-Poly Fish Market Asset Sheet.png` | **Fish market prop kit**: fish stall, coral/teal striped awnings with scalloped edge, display table with ice, baskets, barrel, A-frame + hanging signboards, canvas shades, clutter; scale vs cat | Prop | `fishStall`, `awning`, `displayTable`, `basket`, `barrel`, `aFrameSign`, `hangingSign`, `lantern` in `src/level/Props.ts`; prop heights (stall ≈2× cat, table ≈1× cat) |
| 9 | `ChatGPT Image Oct 3, 2026, 12_09_20 PM.png` | **Street + rooftop prop kit**: scooter, flower pots, windows with teal/coral/cream shutters, balcony, AC unit, water tank, antenna + dish, chimneys/vents, street lamps, pipe kit, rooftop & street clutter; scale vs cat | Prop | `scooter`, `pot`, `windowUnit`, `balcony`, `acUnit`, `waterTank`, `antenna`, `satelliteDish`, `chimney`, `ventPipe`, `wallLamp`, `lampPost`, `drainPipe`, `bench`, `planterBox` |
| 10 | `Sardine Street Level Overview.png` | **Master level overview**: the 8 zones in route order, dome bell tower, fountain courtyard, laundry rooftops, sea cliffs with dock and boats | World | Overall architecture and spatial identity in `src/level/SardineStreet.ts` (market SW, courtyard center, rooftops N, safe rooftop NE, sea E); bell tower, sea arch, dock, boats |
| 11 | `0deb7fb8-ef1d-4e2b-b183-1ec5733e7897.png` | **Technical level blueprint** (source of truth): top-down plan, vertical side profile, traversal graph with Shortcut A (awnings 2→4) and B (rooftops 4→6), jump measurements, interception zones (Mochi/Soot/Beans starts, Ambush A/B/C, interaction props) | World | Zone order + heights (`H`, `ZONES` in `src/data/level.ts`); both shortcuts; jump distances (≤2 cat lengths, ≤1.5 cat heights); nav graph (`NAV_NODES/EDGES`); rival start regions + Round 2 hunter starts; interactable placement |
| 12 | `Mediterranean Market Cat Adventure.png` | **Fish Market gameplay view**: low third-person camera behind Fish Cat, sparkling hero fish on the display table, Mochi on the steps ahead, bottle on the ground | Gameplay | Camera height/distance (`CameraController`), table sparkle twinkles, Mochi's early-pressure start, market density |
| 13 | `Sunlit Mediterranean Cat Market Alley.png` | **First alley / awning route gameplay view**: Fish Cat carrying the fish past coral awnings, steps up to an arch, Mochi ahead, trash can, AC units, hanging fish | Gameplay | Market exit steps + archway, awning silhouettes, wall-mounted AC/pipes/lamps, carried-fish read from behind |
| 14 | `Cat’s Mediterranean Fountain Adventure.png` | **Pigeon courtyard gameplay view**: central tiered fountain, pigeons pecking around a spilled seed crate, low-poly tree, bench, blue-awning shop, stairs and arch beyond | Gameplay | Courtyard layout (fountain center, tree NW, benches), pigeon placement around the fountain, pigeon-feed crate next to the fountain |
| 15 | `Mediterranean Rooftop Cat Chase.png` | **Laundry rooftops gameplay view**: big cream sheet + coral/blue laundry on wooden posts, water tank, antennas, satellite dish, plank bridge, a dark cat lying in wait on a ledge, bay and distant town | Gameplay | Rooftop dressing + interactive sheet, plank bridge, distant coastal town in `Sky.ts`, Soot's rooftop ambush behavior |
| 16 | *(missing)* | **Final Climb / Safe Rooftop gameplay view** | Gameplay | Covered by blueprint jump #6 (final roof → pergola, 0.8 cat high, 1.8 gap) and Level Overview panel 8 (pergola, cushions, flowers, ocean) |
| 17 | *(missing)* | **Temporal System / Rewind / VFX Bible** | VFX | Covered by the brief's temporal rules (≈85–90% normal Fish Cat, thin sea-glass rim, small afterimages, motes, faint paw residue, subtle chromatic split; no hologram/ghost/glitch) and the UI bible's Round 2 sea-glass cues |
| 18 | `615924b0-f984-4805-8c43-9698521e56df.png` | **Final UI / HUD / game-flow bible**: Round 1/2 HUD, Fish Grip (3 fish = grip on ONE fish), ability icons + states, objective pill, Round 2 timeline, alerts, state typography, cat select, start + results screens, motion states, do/don't | UI | Everything in `src/ui/*` + `styles.css`: layout, palette (cream/navy/teal/coral/sky), Luckiest Guy + Fredoka type, sticker alerts, brush stamps, timeline, results stats, button bounce/squash; "don'ts" (no minimap, HP bars, quest log, XP) |
| 19 | `home-screen-reference.webp` *(added later)* | **Home screen**: torn-paper logo card, teal "SARDINE STREET" plank sign, handwritten tagline strip, big orange STEAL THE FISH button, LEVEL SELECT, keycap controls row, Settings/Fullscreen with orange underline swooshes, bougainvillea corner, Fish Cat holding the fish with a pigeon in the foreground | UI | `src/ui/StartScreen.ts`, the start-screen block of `styles.css`, the menu camera and staged foreground pigeon in `src/flow/RunFlow.ts`. One intentional difference: the logo spells out the full **PURRADOX** next to the cat emblem instead of using the cat head as the "P". Supersedes the start-screen section of #18. |

## Decisions derived from multiple sheets

- **Scale.** 1 cat body length = 1 world unit (blueprint). Crates ≈0.75, stalls ≈2× cat height, AC ≈1.5×, water tank ≈2.5× (prop sheets).
- **Palette.** Sampled into `src/data/palette.ts` from the character, fish, pigeon and UI swatches; world colors from the gameplay views (cream stone, terracotta, faded teal, muted coral, honey wood, blue-gray metal).
- **Faceting.** Every surface is non-indexed geometry with per-face color variation plus flat shading (`src/rendering/LowPoly.ts`), matching the subtle triangle faceting visible in all sheets.
- **Round 2 temporal look** (missing VFX bible): `EchoController` gives Past You a fresnel sea-glass rim, three delayed afterimages (sea-glass / pink / deep sea-glass, which reads as a chromatic split while moving), motes and faint residue paw prints. The world keeps its sunlight, with a slightly cooler fill and a light edge treatment (`Renderer` temporal pass, `uEdge`).
- **Safe Rooftop** (missing gameplay view): a pergola with vines, a cushion bed, rug, lantern, flower pots, a parapet on three sides and an open south edge for the final jump. The goal triggers on landing on the roof while carrying the fish.
