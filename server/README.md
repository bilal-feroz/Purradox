# Optional: Claude-powered Alley Council

PURRADOX always works without this. By default, the **Tactical Director** that
plans Round 2 ("THE ALLEY COUNCIL IS PLOTTING…") is a deterministic heuristic
inside the game (`src/ai/TacticalFallback.ts`).

This tiny server lets Claude pick the strategy and write the council's line
instead. It is a separate package, so the game itself has no AI dependency.

## How it stays safe

- The browser sends **only a compact numeric summary** of Round 1: run time, speed, sprint and elevated ratios, shortcut flags, hiss, pounce and drop counts, interaction ids, and seconds per zone. Nothing personal, and no free text.
- The API key lives **only on the server** (environment variable or an `ant auth login` profile). Nothing secret is in the client bundle.
- Claude answers through a **JSON schema** (`strategy` enum + `line` + `reasons`), and the answer is validated again both server-side and in the game (`parsePlan`).
- The game requests the plan the moment the run ends, while the "RUN COMPLETE / RUN RECORDED" beats play. **Any timeout, error, refusal or invalid answer means the heuristic plan is used instantly.** Gameplay never waits on the network.
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
