# PURRADOX

**Outrun the alley. Then hunt yourself.**

PURRADOX is a stylized low-poly 3D browser game about a cat, a stolen fish, and
a replay engine. In Round 1 you are **Fish Cat**: steal the hero fish from
Sardine Street's market and escape across alleys, a pigeon courtyard and the
rooftops while three rival cats try to take it. Everything you do is recorded.
In Round 2 time rewinds, and you play as one of the rivals, hunting **Past You**:
Fish Cat replaying your exact run, with the same route, jumps, pounces and hisses.

> **Your first run creates your second opponent.**

▶ **Play:** <https://bilal-feroz.github.io/Purradox/> (desktop Chrome, keyboard + mouse)

![Start screen](docs/screenshots/01-start-screen.jpg)

| Round 1: the escape | The rewind | Round 2: hunting Past You |
|---|---|---|
| ![Round 1](docs/screenshots/02-round1-market-exit.jpg) | ![Rewind](docs/screenshots/05-rewind.jpg) | ![Round 2](docs/screenshots/06-round2-scent-memory.jpg) |

## Controls

| Input | Action |
|---|---|
| **WASD** | Move (camera-relative) |
| **Mouse** | Camera (click the game to capture the mouse) |
| **Shift** | Sprint (no stamina) |
| **Space** | Jump (coyote time + jump buffering; hold for higher) |
| **Left mouse** | Pounce: a lunge that knocks rivals over or loosens the carrier's Fish Grip |
| **Right mouse / Q** | Hiss: a frontal cone (you snap to face a rival that is winding up). Rivals flash a yellow **!** just before they lunge; a pounce that hits you mid-hiss is a **Perfect Hiss** and the attacker bounces off |
| **E** | Interact (trash can, pigeon feed, fish scraps, bottle, laundry) |
| **R** | Scent Memory (Round 2 only): reveals the next 2–3 s of Past You's path as sea-glass paw prints |
| **Esc** | Pause / release the mouse |

Pounce beats bad positioning. Hiss beats a predictable pounce. Waiting beats a premature hiss.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
```

```bash
npm run verify     # TypeScript check + 43 unit tests + production build
npm run build      # static build in dist/ (relative paths, host anywhere)
npm run preview    # serve the production build
```

Requirements: Node 20+ to build. To play: a desktop browser with WebGL2 and WebAssembly (Chrome/Edge recommended, Firefox and Safari work). Built for 16:9 laptop and desktop screens with keyboard + mouse.

## How it works

```
src/
  core/       Game orchestrator, explicit GameState machine, Input, Time, EventBus
  flow/       Round 1 (RunFlow), complete → council → rewind → select (TransitionFlow), Round 2 (HuntFlow)
  player/     CatMovement (Rapier kinematic controller), CatAbilities, CatAnimator (procedural IK), CatController
  cats/       Procedural low-poly cat models, CatActor, rival AI state machines (CatAI)
  replay/     ReplayRecorder, ReplayPlayer, EchoCat (Past You), WorldHistory (rewind)
  combat/     Pounce / Hiss / Perfect Hiss / Fish Grip resolution
  fish/       Hero fish model + ownership/ballistics, FishGrip rules
  level/      Sardine Street builder, prop kit, zones, waypoint graph, interactables, pigeons, ResetManager
  ai/         Telemetry → TacticalDirector (+ deterministic TacticalFallback)
  rendering/  Renderer + temporal post pass, camera, lighting, sky, sea, particles, paw prints
  ui/         HUD, start screen, cat select, stamps, results, pause
  audio/      Procedural WebAudio SFX + adaptive music
  data/       Palette, cat definitions, level layout (from the technical blueprint)
```

Stack: **TypeScript · Vite · Three.js · Rapier 3D · Web Audio · HTML/CSS UI**. No React and no backend. Every mesh is built procedurally in code (flat-shaded, vertex-colored low-poly geometry), so the whole game ships with no 3D asset files.

### 1. Deterministic player replay engine

`ReplayRecorder` does **not** record keyboard input. It samples the simulation's **authoritative state** (position, rotation, velocity, grounded, fish grip, animation and action state) at **20 Hz**. It also records discrete **events** (`jump`, `land`, `pounce`, `hiss`, `interact`, `fishPickup`, `fishDrop`, `respawn`), and each event forces an extra snapshot at its exact timestamp, so sharp moments such as takeoff, landing or a pounce launch survive.

`ReplayPlayer.sample(t)` is a pure function of time. It uses non-uniform cubic Hermite interpolation with velocities taken from neighbouring samples, keeps the ground height linear while grounded, and never interpolates across a respawn cut. Events are delivered exactly once, in order, at their recorded timestamp, whatever the frame rate. The test suite checks this at 30, 60 and 144 Hz and at jittery frame rates, and also checks that the recorded hiss fires at its recorded time.

### 2. Live simulation: Past You

In Round 2 the same Fish Cat actor switches to replay mode (`EchoController`). Its transform always comes from the recording, so collisions and hits can never knock the timeline off course; a hit only adds a visual flinch that springs back. Recorded events turn back into gameplay:

- a recorded **hiss** opens a real hiss window, so pouncing Past You at that moment gets you **Perfect-Hissed** by your own past self;
- recorded **pounces** can knock the hunter down;
- recorded **interactions** happen again at the same moment (pigeons scatter, the trash can falls);
- the fish follows **live** rules: hunters wear down Past You's Fish Grip, the fish flies loose at zero, and Past You can re-grab it if its recorded route runs back over it.

Scent Memory samples the recording ahead of time to place paw prints on the surfaces Past You is *about* to use. The Round 2 timeline shows recorded hiss and pounce markers.

### 3. AI Tactical Director ("The Alley Council")

`TelemetryTracker` summarizes Round 1: zone entry times, route choices (awning shortcut, rooftop shortcut), elevated vs ground time, average speed, sprint ratio, pounces, hisses, interactions, grip losses and close calls. The Tactical Director turns that summary into a high-level counter-strategy such as **THE ROOFTOP TRAP**, **THE RUSH**, **THE BAIT**, **THE CHOKE** or **THE SHORTCUT SNARE**.

The plan is then made concrete **against the actual recording**. For each helper cat, `planMissions` finds when Past You enters that cat's assigned zone, checks travel time on the waypoint graph, and sends the cat there early enough to be waiting. Helpers can wear Past You's grip down to 1, but only the player can knock the fish loose.

The game runs on the deterministic heuristic by default. An optional LLM provider can be plugged in server-side (see [`server/README.md`](server/README.md)). It only ever receives the compact numeric summary, must return schema-validated JSON, and any timeout, error or invalid answer falls back to the heuristic immediately. Gameplay never waits on the network.

### Why this is a Game Tech project

The playable game is the demonstration. Under it are three layers: a **frame-rate-independent replay engine** that captures how a real person played, a **live simulation** that brings that person back as a fair, interactive opponent without ever desynchronizing, and an **AI director** that reads the player's habits and coordinates other agents around their real route.

## Debug mode

Open `?debug=1` to see FPS, draw calls, game state, zone and grounded state, the nav graph, zone boxes, the recorded route and events, and Past You's authoritative position. **F2** toggles the physics colliders. Debug mode also exposes `window.__test` / `window.__autopilot`, a scripted harness that plays whole runs through the real input path (used to verify the loop end-to-end).

## Credits

Design, art direction and reference pack: the PURRADOX team (see [`docs/reference-manifest.md`](docs/reference-manifest.md)).
Fonts: Luckiest Guy (Apache 2.0) and Fredoka (OFL) via Fontsource. Physics: Rapier (Apache 2.0). Rendering: Three.js (MIT).
