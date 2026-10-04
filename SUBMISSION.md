# PURRADOX — Hackathon Submission

**Track:** Game Tech

## Title

**PURRADOX**

## Tagline

**Outrun the alley. Then hunt yourself.**

## One-liner

A player-behavior replay game where your first run becomes the opponent you hunt in the second.

**Play:** <https://bilal-feroz.github.io/Purradox/> · **Code:** <https://github.com/bilal-feroz/Purradox>

![Round 1](docs/screenshots/02-round1-market-exit.jpg)

## Problem / idea

Game AI usually only pretends to know you: a rival sees the same scripted level every time and reacts to whatever is happening right now. PURRADOX turns that around. The most interesting opponent you can face is yourself: your actual route, your timing, your habits, even your panic-hisses. So the game records how you really played, and in Round 2 you fight that recording, alongside cats whose AI has studied it and planned against it.

## Gameplay

1. **Round 1 — Steal the fish.** As **Fish Cat** (after your first full run, **Choose Your Thief** from all four cats), grab the hero fish in the Fish Market and escape through eight connected zones of Sardine Street (Market Exit, the First Alley route split, the Pigeon Courtyard, the Second Alley climb, the Laundry Rooftops and the Final Climb) to the **Safe Rooftop**. The other three cats start from three fixed spots, and the moment the fishmonger's bell rings they all come for you: Mochi charges in from the market, Soot races to the chokepoint ahead of you and springs out as you slip past, Beans comes down off the roofs to cause chaos. Whichever of them is your thief, Fish Cat takes its spot and its job, so every thief meets the same three threats. They see (field of view, line of sight, short memory), hear (footsteps, crashing props, the bell) and, once the bell has rung, smell the fish in your mouth through walls, so a rival that loses sight of you keeps on your trail. Get in their face and they hiss at you (a brief flinch); only two press in at once while the third circles, and their lunges come one at a time. Rival pounces cost **Fish Grip** (3 → 0); at zero the fish flies loose, and a rival that grabs it runs for an escape point: catch it or the round is lost (**FISH LOST**, try again). Sprinting costs stamina, for you and the rivals alike, so you sprint in bursts. Every rival lunge is telegraphed by a yellow **!**: hiss on it to bounce them off, and go 8 seconds clean to tighten your grip again. Five props (fish scraps, bottle, trash can, pigeon feed, laundry line) distract or tangle the rivals.
2. **RUN RECORDED**, then a wordless cut: the rivals were watching from the roof the whole time.
3. **The Alley Council** profiles your run, simulates about 2,200 counter-plans against your recording and shows its pick on a little map of Sardine Street: your route, each cat racing to its intercept, and two short lines (*YOU: ROOFTOP RUNNER*, *THE PLAN: THE ROOFTOP TRAP*). Then: **THEY KNOW YOUR ROUTE.**
4. **Rewind.** The whole street runs backwards in a diorama shot while your recorded route glows and shrinks back to the market.
5. **Round 2 — Hunt Past You.** Pick one of the other three cats; the remaining two are AI allies carrying out the council's plan: an ally that can reach Past You early goes straight at it (Mochi meets it at the market), and every ally drops its post to chase and pounce a Past You it sees close by. Past You replays your exact run, and its grip tightens again after 12 seconds without a hit, so the team has to keep at it. Use **Scent Memory** to preview the next few seconds of its path, predict its shortcuts, intercept, and pounce its grip away. Watch out: if you pounce while Past You is replaying one of your hisses, **Past You Perfect-Hisses you** (it flashes the same yellow **!** a moment before, so you can hold back). Steal the fish (or let an ally snatch it while you're in the fight) to see **TIMELINE BROKEN**; if Past You reaches the rooftop first, it's **PAST YOU WAS TOO GOOD**.

Core rules: pounce beats bad positioning, hiss beats a predictable pounce, waiting beats a premature hiss.

## Game Tech innovation

**1. Deterministic player replay engine.** We record authoritative simulation state (transform, velocity, grounded, grip, animation and action) at 20 Hz, not keyboard input. Discrete events (jump, land, pounce, hiss, interact, fish pickup and drop, respawn) are stored at exact timestamps, and each forces an extra snapshot so sharp moments survive. Playback is a pure function of time: non-uniform cubic Hermite interpolation with ground-height locking and respawn cuts, and events fire exactly once regardless of frame rate. Unit tests cover sampling rate, smoothness, accuracy to the true path, frame-rate independence (30/60/144 Hz and jittered) and exact event timing.

**2. Live simulation of a recorded human.** Past You is a fully interactive actor whose position can never be pushed off its recording; hits only add a spring-back visual flinch. Recorded actions become live gameplay: recorded hisses open real Perfect-Hiss windows, recorded pounces can knock the hunter down, and recorded interactions happen again. Fish ownership runs on live rules on top of the fixed trajectory. The whole world, including rivals, pigeons, the fish and knocked-over props, is also logged at 12 Hz so the rewind can visibly play everything backwards before an exact reset with no page reload.

**3. AI that plans against a human-authored future.** Most game AI reacts to the current state. Because Round 1 becomes a deterministic trace, PURRADOX's AI knows where Past You will be at every moment of Round 2 and plans against it:

- **Behavior Profiler:** telemetry becomes a fingerprint (speed, sprint and rooftop ratios, shortcut and prop use, hiss / pounce rates, risk, route entropy, hesitation, backtracking) and evidence-backed tags (*ROOFTOP RUNNER — 43% OF YOUR RUN WAS ABOVE STREET LEVEL*).
- **Counterfactual Simulator:** six strategy templates × every assignment of the three council cats to roles × candidate waypoints = about **2,200 complete plans**, each fast-forwarded against the recording (graph travel time plus reaction delay vs when Past You really passes) and scored on intercept quality, coverage, route advantage, role fit, fingerprint fit and fairness penalties, in about 20–35 ms.
- **Tactical Planner:** turns the winner into roles, ambush zones and prop traps, and explains it with evidence (*"You used 2 of 2 shortcuts. Both route splits are covered: Mochi at the Pigeon Courtyard, Soot at the Low Roofs."*).
- **Multi-Agent Coordinator:** the two AI allies get missions and re-plan only at discrete moments. They still have to walk there, see Past You and wind up their pounces; nothing snaps to a future position. Allies chase and pounce Past You whenever they see it close by, and can knock the fish loose and take it themselves, but only with you in the fight (within 12 m): far from you they stop at the last grip point, so the round is never won without you.

Different players get different plans. In our recorded test runs a street run drew **THE ROOFTOP TRAP**, the same route with three distractions drew **THE BAIT**, and a both-shortcuts run drew **THE DOUBLE CUT**. With the optional **Alley Memory** the council also remembers your last five runs (in your browser only): after three street runs in a row it switches to **THE CHOKE** and marks the plan "3 RUNS IN A ROW". Add `?aiDebug=1` to the URL to watch every candidate, score, assignment and predicted intercept live. Full write-up: [`docs/game-tech.md`](docs/game-tech.md).

## Tech stack

TypeScript · Vite · Three.js (WebGL2) · Rapier 3D (WASM kinematic character controller) · Web Audio API · HTML/CSS UI · Vitest. No game engine, no React, no backend, and **zero 3D or audio asset files**: every cat, prop, building, pigeon, fish, sound effect and the soundtrack is generated in code to match the approved reference sheets.

## AI use

- **In the game:** the Alley Council's planning (profiling, counterfactual simulation, tactical planning, coordination) is deterministic code that runs in the browser. Optionally, a small server-side endpoint (`server/`) asks **Claude** (`claude-opus-5-5`, low effort, JSON-schema output) to **name and explain** the plan the simulator already chose. It never picks the strategy or moves a cat, receives only rounded numbers and the chosen plan, the API key never touches the client, the answer is schema-validated twice, and any timeout (1.4 s), error or refusal keeps the deterministic wording instantly. Gameplay never depends on the network.
- **Rival cats** use deterministic real-time AI: explicit state machines on an authored waypoint graph with scripted jump arcs, with vision (field of view, line of sight, memory), hearing (typed sound events) and, after the theft, smell (the fish in the thief's mouth). No LLM steers characters.
- **Development:** the game was built with Claude Code from the team's art-direction reference pack (see `docs/reference-manifest.md`).

## What makes it different

- **Your first run creates your second opponent.** The challenge of Round 2 is literally your own play.
- **The AI studied how you played and planned a counter-strategy.** It simulated about 2,200 ways to stop your recorded run before choosing one, and it tells you why.
- The "wait… *that hiss was recorded*" moment: your past self counters you with a move you made a minute ago.
- Readable combat: rivals flash a yellow **!** before every lunge (hiss on it for a Perfect Hiss), and a fish marker with an off-screen arrow always shows who holds the fish.
- A replay system that is the core mechanic itself, not just a ghost or a spectator feature, with determinism tested in CI.
- A polished, cohesive art style (procedural low-poly Mediterranean diorama) running at 60 FPS in a browser with no installs.

## Demo flow (≈3 minutes)

1. **STEAL THE FISH.** Grab the sparkling fish from the market table.
2. Mochi gives chase. **Pounce** to knock it over, then hiss the moment the yellow **!** pops over its head for a **PERFECT HISS!**
3. Spill the **pigeon feed** in the courtyard: the flock bursts and the rivals get distracted.
4. Take the **awning shortcut** (crates → coral awning → teal awning → terrace).
5. Climb the second alley, cross the laundry rooftops and make the final jump to the **Safe Rooftop**.
6. **RUN RECORDED** … the cats on the roof … the Alley Council maps your route and picks its counter-plan (for example **THE ROOFTOP TRAP**) … **THEY KNOW YOUR ROUTE.**
7. **Rewind** diorama, then choose **Soot**.
8. Past You starts the exact run. Press **R** for Scent Memory and cut it off at the route split you remember.
9. Pounce just as Past You replays your hiss → **Past You Perfect-Hisses you.** *That hiss was recorded.*
10. Intercept again, knock the grip to zero, grab the fish → **TIMELINE BROKEN**.
11. **MAKE A SHARE CARD**: "I STOLE A FISH FROM MYSELF IN … SECONDS."

## Repository / build details

```bash
npm install
npm run dev       # play locally at http://localhost:5173
npm run verify    # type check + 74 unit tests + production build
npm run build     # static build in dist/ (deployable anywhere)
```

- Deployed automatically to GitHub Pages by `.github/workflows/deploy.yml` on every push to `main` (which runs `npm run verify` first).
- `?debug=1` adds FPS, state, nav graph, zones, the replay path and Past You's authoritative position, plus a scripted autopilot used to test the full loop.
- `?aiDebug=1` is judge mode: fingerprint, zone timings, every scored strategy, the selected plan, assignments and predicted intercepts (marked in the world), and the Round 2 coordinator's live re-plans.
- Game tech write-up: [docs/game-tech.md](docs/game-tech.md). Architecture overview: [README.md](README.md). Reference asset map: [docs/reference-manifest.md](docs/reference-manifest.md).
