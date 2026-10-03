# Optional: Claude explanation layer for the Alley Council

PURRADOX always works without this. Round 2 is planned entirely inside the
game: the **Counterfactual Simulator** (`src/ai/CounterfactualSimulator.ts`)
fast-forwards hundreds of council plans against the recorded run, and the
deterministic **Tactical Planner** (`src/ai/TacticalPlanner.ts`) picks and
explains one.

This tiny server only lets Claude **name and explain** that already-chosen
plan: a punchier strategy name, a one-sentence council line, short role
wording and a taunt. It never picks the strategy, never moves cats and never
decides frame-level actions. It is a separate package, so the game itself has
no AI dependency.

## How it stays safe

- The browser sends **only numbers and the chosen plan**: the behavior fingerprint (rounded), up to three scored candidates, the chosen plan's roles and zones, and a small telemetry summary. Nothing personal, no free text from the player.
- The API key lives **only on the server** (environment variable or an `ant auth login` profile). Nothing secret is in the client bundle.
- Claude answers through a **JSON schema** (`name`, `line`, `roles`, `taunt`), validated again server-side and in the game (`parseExplanation`), which also rejects markup and unknown cats.
- The game asks the moment the run ends, while the end-of-run beats play. **Any timeout, error, refusal or invalid answer keeps the deterministic wording instantly.** Gameplay never waits on the network.
- Strict origin allow-list (CORS) and an 8 KB request cap.

## Run it

```bash
cd server
npm install
export ANTHROPIC_API_KEY=sk-ant-...      # or: ant auth login
npm start                                # → http://localhost:8787/director
```

Then open the game with the provider enabled:

```
http://localhost:5173/?director=http://localhost:8787/director
```

or build with `VITE_DIRECTOR_URL=https://your-host/director`.

Configuration: `PORT` (default 8787) and `ALLOWED_ORIGINS` (comma-separated; defaults to the local dev and preview origins).

Model: `claude-opus-5-5` at low effort with structured output. Server-side refusal fallback is enabled (`fallbacks: "default"`).
