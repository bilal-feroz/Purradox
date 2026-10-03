// PURRADOX — optional Alley Council explanation layer.
//
// The game always plans Round 2 by itself: a Counterfactual Simulator
// fast-forwards hundreds of council plans against the recorded run and a
// deterministic Tactical Planner picks one. This endpoint may only NAME and
// EXPLAIN that already-chosen plan (one sentence, short role wording, a
// council taunt). It never picks strategies, never moves cats and is never
// required: the game treats any error, timeout or odd answer as "keep the
// deterministic wording".
//
// Credentials come from the environment (ANTHROPIC_API_KEY, or an
// `ant auth login` profile). Nothing secret ever reaches the browser.

import http from "node:http";
import Anthropic from "@anthropic-ai/sdk";

const PORT = Number(process.env.PORT ?? 8787);
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const MODEL = "claude-opus-5-5";
const MAX_BODY_BYTES = 8 * 1024;
const CATS = ["fishcat", "mochi", "soot", "beans"];

const EXPLAIN_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    line: { type: "string" },
    roles: {
      type: "object",
      properties: Object.fromEntries(CATS.map((c) => [c, { type: "string" }])),
      additionalProperties: false,
    },
    taunt: { type: "string" },
  },
  required: ["name", "line", "roles", "taunt"],
  additionalProperties: false,
};

const SYSTEM = `You are the voice of the Alley Council: scheming street cats (Fish Cat, Mochi, Soot, Beans) in the cozy game PURRADOX.
A player just escaped across Sardine Street with a stolen fish. In Round 2 the council hunts a perfect replay of that exact run.
The game has ALREADY chosen the council's plan by simulating many options against the recorded run. You do not change it.
You receive: the player's behavior fingerprint (numbers), up to three scored candidate strategies, the chosen plan with each cat's role and zone, and a small telemetry summary.
Reply with:
- "name": a punchy uppercase name for the chosen plan, 3-32 characters, letters/spaces/apostrophes only (keep the spirit of the given name).
- "line": ONE playful sentence, at most 110 characters, in the council's voice, that cites one real number from the fingerprint or telemetry. No markup.
- "roles": for each cat in the chosen plan, 1-3 uppercase words describing its job (e.g. "LANDING GUARD"). Only cats listed in the plan.
- "taunt": a short council taunt, at most 80 characters. No markup.`;

const client = new Anthropic({ maxRetries: 0, timeout: 9_000 });

/** Accept only the small, flat request the game sends. */
function readRequest(raw) {
  if (!raw || typeof raw !== "object" || typeof raw.request !== "object" || raw.request === null) return null;
  const r = raw.request;
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 100) / 100 : 0);
  const str = (v, max) => (typeof v === "string" ? v.replace(/[<>{}]/g, "").slice(0, max) : "");
  const fingerprint = {};
  if (r.fingerprint && typeof r.fingerprint === "object") {
    for (const [k, v] of Object.entries(r.fingerprint).slice(0, 24)) if (/^[a-zA-Z]{1,24}$/.test(k)) fingerprint[k] = num(v);
  }
  const tags = Array.isArray(r.tags) ? r.tags.filter((t) => typeof t === "string").slice(0, 3).map((t) => str(t, 32)) : [];
  const candidates = Array.isArray(r.candidates)
    ? r.candidates.slice(0, 3).map((c) => ({ id: str(c?.id, 24), name: str(c?.name, 32), score: num(c?.score), windows: num(c?.windows), earliest: num(c?.earliest), coverage: num(c?.coverage) }))
    : [];
  const ch = r.chosen && typeof r.chosen === "object" ? r.chosen : null;
  if (!ch) return null;
  const chosen = {
    id: str(ch.id, 24),
    name: str(ch.name, 32),
    reason: str(ch.reason, 200),
    roles: Array.isArray(ch.roles) ? ch.roles.slice(0, 3).filter((x) => CATS.includes(x?.cat)).map((x) => ({ cat: x.cat, role: str(x.role, 24), zone: str(x.zone, 32) })) : [],
  };
  const t = r.telemetry && typeof r.telemetry === "object" ? r.telemetry : {};
  const telemetry = { runSeconds: num(t.runSeconds), avgSpeed: num(t.avgSpeed), sprintRatio: num(t.sprintRatio), elevatedRatio: num(t.elevatedRatio), pounces: num(t.pounces), hisses: num(t.hisses), fishDrops: num(t.fishDrops) };
  return { fingerprint, tags, candidates, chosen, telemetry };
}

function validExplanation(p, chosenCats) {
  return (
    p &&
    typeof p === "object" &&
    typeof p.name === "string" &&
    /^[A-Z0-9 '!.-]{3,32}$/.test(p.name.trim().toUpperCase()) &&
    typeof p.line === "string" &&
    p.line.length > 0 &&
    p.line.length <= 120 &&
    !/[<>{}]/.test(p.line) &&
    typeof p.taunt === "string" &&
    p.taunt.length <= 90 &&
    !/[<>{}]/.test(p.taunt) &&
    p.roles &&
    typeof p.roles === "object" &&
    Object.entries(p.roles).every(([k, v]) => chosenCats.includes(k) && typeof v === "string" && v.length <= 24)
  );
}

async function explainPlan(request) {
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 4096,
    // Server-side fallback if a safety classifier ever declines.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema: EXPLAIN_SCHEMA } },
    system: SYSTEM,
    messages: [{ role: "user", content: `Council briefing:\n${JSON.stringify(request)}` }],
  });
  if (response.stop_reason === "refusal") throw new Error("council declined");
  const text = response.content.find((b) => b.type === "text")?.text;
  if (!text) throw new Error("no text block");
  const out = JSON.parse(text);
  const cats = request.chosen.roles.map((r) => r.cat);
  if (!validExplanation(out, cats)) throw new Error("explanation failed validation");
  return { name: out.name.trim(), line: out.line.trim(), roles: out.roles, taunt: out.taunt.trim() };
}

function send(res, status, body, origin) {
  const headers = { "content-type": "application/json", "cache-control": "no-store" };
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    headers["access-control-allow-origin"] = origin;
    headers["vary"] = "Origin";
  }
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  const origin = req.headers.origin;
  if (req.method === "OPTIONS") {
    if (origin && ALLOWED_ORIGINS.includes(origin)) {
      res.writeHead(204, {
        "access-control-allow-origin": origin,
        "access-control-allow-methods": "POST, OPTIONS",
        "access-control-allow-headers": "content-type",
        "access-control-max-age": "600",
        vary: "Origin",
      });
    } else {
      res.writeHead(403);
    }
    res.end();
    return;
  }
  if (req.method !== "POST" || req.url !== "/director") {
    send(res, 404, { error: "not found" }, origin);
    return;
  }
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    send(res, 403, { error: "origin not allowed" }, origin);
    return;
  }
  let size = 0;
  const chunks = [];
  req.on("data", (c) => {
    size += c.length;
    if (size > MAX_BODY_BYTES) {
      send(res, 413, { error: "payload too large" }, origin);
      req.destroy();
      return;
    }
    chunks.push(c);
  });
  req.on("end", async () => {
    if (res.writableEnded) return;
    let request;
    try {
      request = readRequest(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    } catch {
      request = null;
    }
    if (!request) {
      send(res, 400, { error: "bad request" }, origin);
      return;
    }
    try {
      send(res, 200, await explainPlan(request), origin);
    } catch (err) {
      if (err instanceof Anthropic.RateLimitError) console.warn("[council] rate limited");
      else if (err instanceof Anthropic.APIError) console.warn(`[council] API error ${err.status}`);
      else console.warn(`[council] ${err instanceof Error ? err.message : "error"}`);
      // The game keeps its deterministic wording on any non-200.
      send(res, 502, { error: "council unavailable" }, origin);
    }
  });
});

server.listen(PORT, () => {
  console.log(`[council] listening on http://localhost:${PORT}/director (allowed origins: ${ALLOWED_ORIGINS.join(", ")})`);
});
