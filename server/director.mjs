// PURRADOX — optional Alley Council server.
//
// The browser game can ask this endpoint for a Round 2 counter-strategy.
// It only ever receives a compact numeric telemetry summary, asks Claude
// for a schema-constrained JSON answer, validates it, and returns it.
// The game treats any error, timeout or odd answer as "use the built-in
// deterministic director" — gameplay never waits on this server.
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

const STRATEGIES = ["rooftop_trap", "the_choke", "the_rush", "the_bait", "shortcut_snare", "the_patient_wall"];

const PLAN_SCHEMA = {
  type: "object",
  properties: {
    strategy: { type: "string", enum: STRATEGIES },
    line: { type: "string" },
    reasons: { type: "array", items: { type: "string" } },
  },
  required: ["strategy", "line", "reasons"],
  additionalProperties: false,
};

const SYSTEM = `You are the Alley Council: three scheming street cats (Mochi the sprinter, Soot the ambusher, Beans the chaos kitten) in the cozy game PURRADOX.
A player just escaped across Sardine Street with a stolen fish. You receive a JSON summary of HOW they played Round 1. In Round 2 the cats will hunt a perfect replay of that exact run.
Pick exactly ONE counter-strategy:
- rooftop_trap: the player spent lots of time off the ground or used the rooftop shortcut.
- shortcut_snare: the player used the awning shortcut, so the council waits where it comes out.
- the_bait: the player used distractions (pigeon feed, trash can, scraps, laundry).
- the_rush: the player was fast and sprint-heavy.
- the_choke: the player funneled through the narrow alleys.
- the_patient_wall: the player hissed a lot, so the council will wait the hisses out.
"line": one playful sentence, at most 110 characters, in the council's voice, telling the player what is coming. No markup.
"reasons": one to three short reasons, each quoting a number from the telemetry.`;

const client = new Anthropic({ maxRetries: 0, timeout: 9_000 });

/** Accept only the small, flat, numeric summary the game sends. */
function readTelemetry(raw) {
  if (!raw || typeof raw !== "object" || typeof raw.telemetry !== "object" || raw.telemetry === null) return null;
  const t = raw.telemetry;
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 100) / 100 : 0);
  const bool = (v) => v === true;
  const zoneSeconds = {};
  if (t.zoneSeconds && typeof t.zoneSeconds === "object") {
    for (const [k, v] of Object.entries(t.zoneSeconds).slice(0, 16)) {
      if (/^[a-z0-9]{1,12}$/.test(k)) zoneSeconds[k] = num(v);
    }
  }
  const interactions = Array.isArray(t.interactions)
    ? t.interactions.filter((s) => typeof s === "string" && /^[a-zA-Z]{1,16}$/.test(s)).slice(0, 12)
    : [];
  return {
    runSeconds: num(t.runSeconds),
    avgSpeed: num(t.avgSpeed),
    sprintRatio: num(t.sprintRatio),
    elevatedRatio: num(t.elevatedRatio),
    awningShortcut: bool(t.awningShortcut),
    rooftopShortcut: bool(t.rooftopShortcut),
    pounces: num(t.pounces),
    hisses: num(t.hisses),
    interactions,
    fishDrops: num(t.fishDrops),
    zoneSeconds,
  };
}

function validPlan(p) {
  return (
    p &&
    typeof p === "object" &&
    STRATEGIES.includes(p.strategy) &&
    typeof p.line === "string" &&
    p.line.length > 0 &&
    p.line.length <= 140 &&
    !/[<>{}]/.test(p.line) &&
    Array.isArray(p.reasons) &&
    p.reasons.every((r) => typeof r === "string" && r.length <= 120)
  );
}

async function askCouncil(telemetry) {
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 4096,
    // Server-side fallback if a safety classifier ever declines.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema: PLAN_SCHEMA } },
    system: SYSTEM,
    messages: [{ role: "user", content: `Round 1 telemetry:\n${JSON.stringify(telemetry)}` }],
  });
  if (response.stop_reason === "refusal") throw new Error("council declined");
  const text = response.content.find((b) => b.type === "text")?.text;
  if (!text) throw new Error("no text block");
  const plan = JSON.parse(text);
  if (!validPlan(plan)) throw new Error("plan failed validation");
  return { strategy: plan.strategy, line: plan.line.trim(), reasons: plan.reasons.slice(0, 3) };
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
    let telemetry;
    try {
      telemetry = readTelemetry(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    } catch {
      telemetry = null;
    }
    if (!telemetry) {
      send(res, 400, { error: "bad telemetry" }, origin);
      return;
    }
    try {
      const plan = await askCouncil(telemetry);
      send(res, 200, plan, origin);
    } catch (err) {
      if (err instanceof Anthropic.RateLimitError) console.warn("[council] rate limited");
      else if (err instanceof Anthropic.APIError) console.warn(`[council] API error ${err.status}`);
      else console.warn(`[council] ${err instanceof Error ? err.message : "error"}`);
      // The game falls back to its deterministic director on any non-200.
      send(res, 502, { error: "council unavailable" }, origin);
    }
  });
});

server.listen(PORT, () => {
  console.log(`[council] listening on http://localhost:${PORT}/director (allowed origins: ${ALLOWED_ORIGINS.join(", ")})`);
});
