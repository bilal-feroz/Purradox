import * as THREE from "three";
import { CAT_IDS, CATS, type CatId } from "../data/cats";
import { H, SPAWN, ZONES } from "../data/level";
import { PALETTE } from "../data/palette";
import { AudioManager } from "../audio/AudioManager";
import { TacticalDirector, HttpStrategyProvider } from "../ai/TacticalDirector";
import type { BehaviorFingerprint, BehaviorTag } from "../ai/BehaviorProfiler";
import type { SimResult, TraceInfo } from "../ai/CounterfactualSimulator";
import type { Coordinator } from "../ai/Coordinator";
import type { CouncilPlan } from "../ai/TacticalPlanner";
import { TelemetryTracker } from "../ai/TelemetrySummary";
import { CatActor } from "../cats/CatActor";
import { RivalBrain, type AIWorld } from "../cats/CatAI";
import { CombatSystem } from "../combat/CombatSystem";
import { FishSystem } from "../fish/Fish";
import { MAX_GRIP } from "../fish/FishGrip";
import { Interactables, type InteractHooks } from "../level/Interactable";
import { PigeonFlock } from "../level/Pigeons";
import { ResetManager } from "../level/ResetManager";
import { buildSardineStreet } from "../level/SardineStreet";
import { GoalBeacon } from "../level/GoalBeacon";
import { WaypointGraph } from "../level/WaypointGraph";
import { isElevated, zoneAt } from "../level/Zones";
import { PhysicsWorld } from "../physics/PhysicsWorld";
import { CatController } from "../player/CatController";
import { CameraController } from "../rendering/CameraController";
import { Effects } from "../rendering/Effects";
import { Lighting } from "../rendering/Lighting";
import { Materials } from "../rendering/Materials";
import { PawPrints } from "../rendering/PawPrints";
import { Renderer } from "../rendering/Renderer";
import { Sky } from "../rendering/Sky";
import { Water } from "../rendering/Water";
import { EchoController } from "../replay/EchoCat";
import { ReplayRecorder } from "../replay/ReplayRecorder";
import { emptySample, type ReplayData, type ReplaySnapshot } from "../replay/ReplayTypes";
import { WorldHistory, type Rewindable } from "../replay/WorldHistory";
import { CatSelect } from "../ui/CatSelect";
import { CouncilMap } from "../ui/CouncilMap";
import { HUD } from "../ui/HUD";
import { PauseMenu } from "../ui/PauseMenu";
import { Results } from "../ui/Results";
import { StartScreen, type Settings } from "../ui/StartScreen";
import { loadProgress, markCycleComplete } from "../ui/records";
import { Stamps } from "../ui/Stamps";
import { EventBus } from "./EventBus";
import { GameState, StateMachine } from "./GameState";
import { Input } from "./Input";
import { GameTime } from "./Time";
import { registerRunFlow } from "../flow/RunFlow";
import { registerTransitionFlow } from "../flow/TransitionFlow";
import { registerHuntFlow } from "../flow/HuntFlow";
import { DebugOverlay } from "../debug/DebugOverlay";

export interface HuntStats {
  perfectHisses: number;
  interceptAttempts: number;
  stolenAt: number | null;
  echoPerfectHisses: number;
}

const SETTINGS_KEY = "purradox.settings.v1";

function loadSettings(): Settings {
  const def: Settings = { volume: 0.8, music: 0.55, sensitivity: 1, invertY: false };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...def, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    /* storage unavailable */
  }
  return def;
}

/**
 * Top-level orchestrator: owns every system, runs the frame loop and the
 * explicit game-state machine. Round logic lives in src/flow/*.
 */
/** Round 1: seconds without a hit before the thief regains one grip. */
const GRIP_RECOVER_SECONDS = 8;

export class Game {
  readonly bus = new EventBus();
  readonly time = new GameTime();
  readonly fsm = new StateMachine();
  readonly scene = new THREE.Scene();
  readonly renderer: Renderer;
  readonly camera: CameraController;
  readonly input: Input;
  readonly materials = new Materials();
  readonly lighting: Lighting;
  readonly effects: Effects;
  readonly prints: PawPrints;
  readonly audio = new AudioManager();
  readonly resets = new ResetManager();
  readonly history = new WorldHistory(12);
  readonly telemetry = new TelemetryTracker();
  readonly director: TacticalDirector;
  readonly graph = new WaypointGraph();
  readonly debug: DebugOverlay | null;

  physics!: PhysicsWorld;
  sky!: Sky;
  water!: Water;
  beacon!: GoalBeacon;
  /** Round 1: red shaft over the spot a fish thief is running for. */
  escapeBeacon!: GoalBeacon;
  fish!: FishSystem;
  combat!: CombatSystem;
  interactables!: Interactables;
  pigeons!: PigeonFlock;
  /** Every cat in the world (any of them can be the thief). */
  readonly actors = {} as Record<CatId, CatActor>;
  /** AI brain per cat; used whenever the game (not a human) drives it. */
  readonly brains = {} as Record<CatId, RivalBrain>;
  readonly cats: CatActor[] = [];
  /** The Round 1 thief this run. It becomes Past You in Round 2. */
  runnerId: CatId = "fishcat";
  controller!: CatController;
  echo!: EchoController;
  recorder = new ReplayRecorder("fishcat", 20);

  // ui
  readonly hud: HUD;
  readonly start: StartScreen;
  readonly select: CatSelect;
  readonly results: Results;
  readonly stamps: Stamps;
  readonly councilMap: CouncilMap;
  readonly pause: PauseMenu;
  readonly fadeEl: HTMLDivElement;
  readonly temporalVignette: HTMLDivElement;

  // round state
  round: 1 | 2 = 1;
  controlled: CatActor | null = null;
  replay: ReplayData | null = null;
  /** The Alley Council plan (Counterfactual Simulator + Tactical Planner). */
  plan: CouncilPlan | null = null;
  /** Where/when Past You passes each waypoint (from the recording). */
  trace: TraceInfo | null = null;
  /** Every candidate the simulator fast-forwarded, best per strategy. */
  sim: SimResult | null = null;
  /** Round 2 ally coordinator (discrete re-planning). */
  coordinator: Coordinator | null = null;
  /** How this human played Round 1 (Behavior Profiler). */
  fingerprint: BehaviorFingerprint | null = null;
  /** Tags derived from the fingerprint, most distinctive first. */
  profileTags: BehaviorTag[] = [];
  /** In-flight explanation request (optional LLM layer); resolves to the plan. */
  planRequest: Promise<CouncilPlan> | null = null;
  hunterId: CatId | null = null;
  /** First full two-round cycle done: unlocks Choose Your Thief. */
  thiefUnlocked = loadProgress().thiefUnlocked;
  runTime = 0;
  huntTime = 0;
  huntStats: HuntStats = { perfectHisses: 0, interceptAttempts: 0, stolenAt: null, echoPerfectHisses: 0 };
  huntSuccess = false;
  paused = false;
  /** Automation can skip rendering while fast-stepping the simulation. */
  renderEnabled = true;
  /** Pause on focus loss / pointer-lock loss (disabled by automated tests). */
  autoPause = true;
  /** Debug/art-review camera override. */
  photoCamera: THREE.Camera | null = null;
  /** When true the rAF loop stops driving frames (test harness steps them). */
  manualStepping = false;
  settings: Settings;
  private lastZoneIndex = 0;
  /** Round 1: seconds the thief has carried the fish without losing grip. */
  private gripCalmT = 0;
  private lastPlayerGrip = MAX_GRIP;
  private dustTimer = 0;
  private escapePulse = 0;
  private cueTimer = 0;
  private scentT = 99;
  readonly tmp = new THREE.Vector3();
  private readonly trackPos = new THREE.Vector3();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    uiRoot: HTMLElement,
  ) {
    this.settings = loadSettings();
    this.renderer = new Renderer(canvas);
    this.camera = new CameraController(this.renderer.aspect);
    this.renderer.onResize.push(() => this.camera.setAspect(this.renderer.aspect));
    this.input = new Input(canvas);
    this.lighting = new Lighting(this.scene);
    this.effects = new Effects(this.scene);
    this.prints = new PawPrints(this.scene);
    this.scene.fog = new THREE.Fog(PALETTE.skyHorizon, 70, 260);
    this.scene.background = new THREE.Color(PALETTE.skyHorizon);

    const params = new URLSearchParams(location.search);
    const directorUrl = params.get("director") ?? (import.meta.env.VITE_DIRECTOR_URL as string | undefined) ?? null;
    // The optional LLM explanation layer gets the end-of-run beat (~5 s) to answer.
    this.director = new TacticalDirector(directorUrl ? new HttpStrategyProvider(directorUrl) : null, 5000);

    this.hud = new HUD(uiRoot);
    this.start = new StartScreen(uiRoot, this.settings);
    this.select = new CatSelect(uiRoot);
    this.results = new Results(uiRoot);
    this.stamps = new Stamps(uiRoot);
    this.councilMap = new CouncilMap(uiRoot);
    this.pause = new PauseMenu(uiRoot);
    this.temporalVignette = document.createElement("div");
    this.temporalVignette.className = "vignette-temporal";
    uiRoot.appendChild(this.temporalVignette);
    this.fadeEl = document.createElement("div");
    this.fadeEl.id = "fade";
    uiRoot.appendChild(this.fadeEl);
    this.debug = params.get("debug") === "1" ? new DebugOverlay(this, uiRoot) : null;
    this.applySettings(this.settings);
  }

  /** The cat running Round 1 (and replayed as Past You in Round 2). */
  get runner(): CatActor {
    return this.actors[this.runnerId];
  }

  /** Fish Cat specifically (menu hero shot). */
  get fishCat(): CatActor {
    return this.actors.fishcat;
  }

  /** The three cats that are not the thief: Round 1 rivals, Round 2 hunters. */
  others(): CatActor[] {
    return this.cats.filter((c) => c.id !== this.runnerId);
  }

  otherIds(): CatId[] {
    return CAT_IDS.filter((id) => id !== this.runnerId);
  }

  /** A full Round 1 + Round 2 cycle was played: remember it locally. */
  completeCycle(): void {
    if (this.thiefUnlocked) return;
    this.thiefUnlocked = true;
    markCycleComplete();
  }

  // ====================================================================== boot
  async boot(progress: (p: number, label: string) => void): Promise<void> {
    progress(0.15, "Waking the physics…");
    this.physics = await PhysicsWorld.create();
    progress(0.35, "Building Sardine Street…");
    await nextFrame();
    const sunDir = new THREE.Vector3(-34, 46, 24).normalize();
    this.sky = new Sky(this.scene, this.materials, sunDir);
    const level = buildSardineStreet(this.scene, this.physics, this.materials);
    this.water = new Water(this.scene, H.sea, level.shoreDistance);
    this.beacon = new GoalBeacon(this.scene, new THREE.Vector3(SPAWN.goal[0], SPAWN.goal[1] + 0.05, SPAWN.goal[2] - 1.2));
    this.escapeBeacon = new GoalBeacon(this.scene, new THREE.Vector3(), { color: 0xff6a4a, height: 10, rTop: 0.45, rBottom: 0.9 });
    progress(0.6, "Herding cats…");
    await nextFrame();
    this.createActors();
    progress(0.8, "Feeding pigeons…");
    await nextFrame();
    this.interactables = new Interactables(this.scene, this.materials, this.physics);
    this.pigeons = new PigeonFlock(this.scene, this.materials, this.bus, this.effects);
    this.registerResettables();
    this.wireEvents();
    registerRunFlow(this);
    registerTransitionFlow(this);
    registerHuntFlow(this);
    this.wireUI();
    this.physics.step(1 / 60);
    progress(0.95, "Polishing the fish…");
    await nextFrame();
    this.camera.setOrbit(new THREE.Vector3(-22, 0.8, 15), 9, 3.2);
    this.renderer.warmup(this.scene, this.camera.camera);
    progress(1, "Ready");
    this.fsm.transition(GameState.MENU);
  }

  private createActors(): void {
    const mats = { fur: this.materials.cat, eye: this.materials.glossy };
    const v = (p: [number, number, number]) => new THREE.Vector3(p[0], p[1], p[2]);
    CAT_IDS.forEach((id, i) => {
      const a = new CatActor(id, this.physics, mats, this.bus, v(id === this.runnerId ? SPAWN.runner.pos : SPAWN.ai[id].pos));
      this.scene.add(a.rig.root);
      this.actors[id] = a;
      this.cats.push(a);
      const brain = new RivalBrain(id, a, 923 + i * 77);
      brain.onWantInteract = (cat) => this.aiInteract(cat);
      this.brains[id] = brain;
    });
    this.fish = new FishSystem(this.scene, this.physics, this.bus, this.effects, this.materials.cat, this.materials.glossy, v(SPAWN.heroFish));
    this.combat = new CombatSystem(this.bus, this.fish, this.effects, this.time, this.camera);
    this.combat.cats = this.cats;
    this.controller = new CatController(this.input, this.camera);
    this.controller.targets = this.cats;
    this.echo = new EchoController(this.runner, this.scene, this.materials.cat, this.materials.glossy, this.effects, this.prints);
  }

  private registerResettables(): void {
    this.resets.add("fish", () => this.fish.reset());
    // The thief starts at the market; everyone else takes their AI post.
    this.resets.add("cats", () => {
      for (const c of this.cats) {
        c.resetStatus();
        c.replay = null;
        c.active = true;
        c.movement.setCollisionEnabled(true);
        if (c.id === this.runnerId) {
          c.mode = "player";
          this.brains[c.id].enabled = false;
          c.setForcedAction(null);
          c.teleport(new THREE.Vector3(...SPAWN.runner.pos), SPAWN.runner.yaw);
        } else {
          c.mode = "ai";
          this.brains[c.id].reset();
        }
      }
    });
    for (const it of this.interactables.list) this.resets.register(it);
    this.resets.register(this.pigeons);
    this.resets.add("effects", () => {
      this.effects.clear();
      this.prints.clear();
    });
    this.resets.add("echo", () => {
      this.echo.stop();
      this.echo.setEchoLook(false);
    });
    this.resets.add("time", () => {
      this.time.clearEffects();
      this.time.baseScale = 1;
    });
    // rewind history: every moving thing
    const catRewind = (a: CatActor): Rewindable => ({
      rewindId: `cat:${a.id}`,
      angleIndices: [3],
      captureRewind: () => [a.position.x, a.position.y, a.position.z, a.yaw, a.carrying ? 1 : 0],
      applyRewind: (s) => {
        a.movement.placeExternal(this.tmp.set(s[0], s[1], s[2]));
        a.movement.yaw = s[3];
        a.rig.root.position.set(s[0], s[1], s[2]);
        a.rig.root.rotation.y = s[3];
      },
    });
    for (const c of this.cats) this.history.register(catRewind(c));
    this.history.register({
      rewindId: "fish",
      captureRewind: () => {
        this.fish.model.getWorldPosition(this.tmp);
        const st = this.fish.state === "table" ? 0 : this.fish.state === "carried" ? 1 : this.fish.state === "flying" ? 2 : 3;
        return [this.tmp.x, this.tmp.y, this.tmp.z, st, this.fish.owner ? this.cats.indexOf(this.fish.owner) : -1];
      },
      applyRewind: (s) => {
        const owner = Math.round(s[4]);
        if (Math.round(s[3]) === 1 && owner >= 0 && this.cats[owner]) {
          if (this.fish.owner !== this.cats[owner]) this.fish.forceCarry(this.cats[owner], this.fish.grip.value);
        } else {
          this.fish.setWorldPose(this.tmp.set(s[0], s[1], s[2]), Math.round(s[3]) === 0 ? "table" : "loose");
        }
      },
    });
    this.history.register(this.pigeons.rewind);
    for (const it of this.interactables.list) this.history.register(it);
  }

  // ====================================================================== events
  private wireEvents(): void {
    const isRunRecording = () => this.fsm.state === GameState.FISH_RUN && this.recorder.recording;
    const snap = () => this.snapshotRunner();
    this.bus.on("jump", (e) => {
      if (e.cat === this.runnerId && isRunRecording()) {
        this.recorder.event(this.runTime, "jump", undefined, snap);
        this.telemetry.onJump();
      }
      if (this.isControlled(e.cat)) this.effects.dust(new THREE.Vector3(e.x, e.y, e.z), 5, 0.5, 0.6, 0.13);
    });
    this.bus.on("land", (e) => {
      if (e.cat === this.runnerId && isRunRecording()) this.recorder.event(this.runTime, "land", undefined, snap);
      if (e.impact > 0.25) this.effects.dust(new THREE.Vector3(e.x, e.y, e.z), Math.round(4 + e.impact * 8), 0.6 + e.impact, 0.8, 0.14 + e.impact * 0.08);
    });
    this.bus.on("pounceStart", (e) => {
      const p = new THREE.Vector3(e.x, e.y, e.z);
      this.effects.dust(p, 6, 0.7, 0.7, 0.15);
      if (e.cat === this.runnerId && isRunRecording()) {
        this.recorder.event(this.runTime, "pounce", { dirX: e.dirX, dirZ: e.dirZ }, snap);
        this.telemetry.onPounce({ t: this.runTime, x: e.x, y: e.y, z: e.z, zone: zoneAt(e.x, e.y, e.z)?.id ?? "" });
      }
      if (this.round === 2 && this.controlled && e.cat === this.controlled.id) this.huntStats.interceptAttempts++;
    });
    this.bus.on("pounceTell", (e) => {
      const cat = this.cats.find((c) => c.id === e.cat);
      if (!cat) return;
      this.effects.exclaim(cat.position);
      this.effects.ring(new THREE.Vector3(e.x, e.y + 0.04, e.z), 0.9, 0xf7cf55, 0.3);
      const me = this.controlled;
      if (me && me.team !== cat.team && me.abilities.hissReady && me.position.distanceTo(cat.position) < 8) this.hud.cue("hiss");
    });
    this.bus.on("hissStart", (e) => {
      if (e.cat === this.runnerId && isRunRecording()) {
        this.recorder.event(this.runTime, "hiss", { dirX: e.dirX, dirZ: e.dirZ }, snap);
        this.telemetry.onHiss({ t: this.runTime, x: e.x, y: e.y, z: e.z, zone: zoneAt(e.x, e.y, e.z)?.id ?? "" });
      }
    });
    this.bus.on("interact", (e) => {
      if (e.cat === this.runnerId && isRunRecording()) {
        this.recorder.event(this.runTime, "interact", { target: e.target }, snap);
        this.telemetry.onInteract({ t: this.runTime, x: e.x, y: e.y, z: e.z, zone: zoneAt(e.x, e.y, e.z)?.id ?? "", target: e.target });
      }
    });
    this.bus.on("fishPickup", (e) => {
      // Stealing from the stall rings the fishmonger's bell: the whole alley knows.
      if (this.round === 1 && e.cat === this.runnerId && !e.recovered && !e.stolen && this.fsm.is(GameState.FISH_RUN)) {
        this.bus.emit("sound", { type: "bell", x: e.x, y: e.y, z: e.z, radius: 220, intensity: 1, source: "world" });
      }
      if (e.cat === this.runnerId && isRunRecording()) this.recorder.event(this.runTime, "fishPickup", undefined, snap);
      // Alerts
      const byRunner = e.cat === this.runnerId;
      if (this.round === 1) {
        if (!byRunner && e.stolen) this.alert("FISH STOLEN!", "stolen");
        else if (byRunner && (e.recovered || e.stolen)) this.alert("FISH RECOVERED!", "recovered");
        if (byRunner) this.hud.pingObjective(this.time.realTime, 4);
      } else {
        if (byRunner && e.recovered) this.alert("PAST YOU RECOVERED!", "recovered");
        if (this.controlled && e.cat === this.controlled.id) this.alert("FISH STOLEN!", "stolen");
      }
    });
    this.bus.on("fishDrop", (e) => {
      if (e.cat === this.runnerId && isRunRecording()) {
        this.recorder.event(this.runTime, "fishDrop", undefined, snap);
        this.telemetry.onFishDrop();
      }
      this.alert("FISH DROPPED!", "dropped");
      this.bus.emit("sound", { type: "fishDrop", x: e.x, y: e.y, z: e.z, radius: 16, intensity: 1, source: e.cat });
      this.time.slowMo(0.45, 0.3);
      this.camera.addTrauma(0.3);
      // nearby cats notice
      for (const a of this.cats) {
        if (a.mode === "ai" && a.position.distanceTo(this.fish.position) < 14) a.lookTarget = this.fish.position;
      }
    });
    this.bus.on("gripChanged", (e) => {
      if (e.cat !== this.runnerId) return;
      const lost = e.grip < this.lastPlayerGrip;
      this.lastPlayerGrip = e.grip;
      if (lost) this.gripCalmT = 0;
      if (lost && isRunRecording()) {
        const p = this.runner.position;
        this.telemetry.onGripLoss({ t: this.runTime, x: p.x, y: p.y, z: p.z, zone: zoneAt(p.x, p.y, p.z)?.id ?? "" });
      }
    });
    this.bus.on("perfectHiss", (e) => {
      const involvesPlayer = this.controlled && (e.hisser === this.controlled.id || e.attacker === this.controlled.id);
      if (involvesPlayer || this.round === 2) this.alert("PERFECT HISS!", "perfect");
      if (this.round === 2 && this.controlled && e.hisser === this.controlled.id) this.huntStats.perfectHisses++;
      if (this.round === 2 && e.hisser === this.runnerId) this.huntStats.echoPerfectHisses++;
      if (this.round === 1 && e.hisser === this.runnerId) {
        this.huntStats.perfectHisses++;
        if (isRunRecording()) this.telemetry.onPerfectHiss();
      }
    });
    // The thief's paws give it away to cats close by (sprinting is louder).
    this.bus.on("footstep", (e) => {
      if (e.cat !== this.runnerId) return;
      const r = this.runner;
      const reach = e.sprint ? 9 : 5;
      for (const c of this.cats) {
        if (c.mode === "ai" && Math.hypot(c.position.x - e.x, c.position.z - e.z) < reach && Math.abs(c.position.y - e.y) < 2) {
          this.brains[c.id].hearQuarry(r.position, r.velocity);
        }
      }
    });
    // AI hearing: every game-driven cat within earshot decides how to react
    this.bus.on("sound", (e) => {
      for (const c of this.cats) if (c.mode === "ai") this.brains[c.id].hear(e);
    });
    this.bus.on("respawn", (e) => {
      if (e.cat === this.runnerId && isRunRecording()) this.recorder.cut(this.runTime, snap);
    });
    this.audio.subscribe(this.bus, (cat) => this.isControlled(cat));
  }

  private wireUI(): void {
    this.start.onStart = () => {
      this.audio.unlock();
      this.audio.play("ui");
      // Request pointer lock inside the click gesture (browsers require it).
      if (this.fsm.state !== GameState.MENU) return;
      if (this.thiefUnlocked) {
        this.fsm.transition(GameState.THIEF_SELECTION);
      } else {
        // First-ever run: Fish Cat, no choice, the twist stays intact.
        this.input.requestPointerLock();
        this.runnerId = "fishcat";
        this.fsm.transition(GameState.INTRO);
      }
    };
    this.start.onSettings = (s) => this.applySettings(s);
    this.select.onPick = (id) => {
      this.audio.play("ui");
      this.input.requestPointerLock();
      if (this.fsm.state === GameState.THIEF_SELECTION) {
        this.runnerId = id;
        this.fsm.transition(GameState.INTRO);
      } else if (this.fsm.state === GameState.CAT_SELECTION && id !== this.runnerId) {
        this.hunterId = id;
        this.fsm.transition(GameState.HUNT);
      }
    };
    this.select.onHover = (id) => {
      if (id) {
        this.actors[id].meow();
        this.audio.play("ui", { pitch: 1.2 });
      }
    };
    this.select.onBack = () => {
      this.audio.play("ui");
      if (this.fsm.state === GameState.THIEF_SELECTION) this.fsm.transition(GameState.MENU);
    };
    this.results.onRunItBack = () => {
      this.audio.play("ui");
      if (this.fsm.state === GameState.RESULTS) this.fsm.transition(GameState.REWIND);
    };
    this.results.onNewRun = () => {
      this.audio.play("ui");
      if (this.fsm.state !== GameState.RESULTS) return;
      if (this.thiefUnlocked) this.fsm.transition(GameState.THIEF_SELECTION);
      else this.fsm.transition(GameState.INTRO);
    };
    this.pause.onResume = () => this.setPaused(false);
    this.pause.onRestart = () => {
      this.setPaused(false);
      if (this.fsm.state === GameState.FISH_RUN) this.fsm.transition(GameState.INTRO);
      else if (this.fsm.state === GameState.HUNT) this.fsm.transition(GameState.REWIND);
    };
    this.pause.onQuit = () => {
      this.setPaused(false);
      if (this.fsm.canTransition(GameState.MENU)) this.fsm.transition(GameState.MENU);
    };
    this.canvas.addEventListener("click", () => {
      this.audio.unlock();
      if (this.isGameplay() && !this.paused) this.input.requestPointerLock();
    });
    this.input.onPointerLockChange((locked) => {
      if (!locked && this.autoPause && this.isGameplay() && !this.paused && this.time.realTime > 1) this.setPaused(true);
    });
    window.addEventListener("keydown", (e) => {
      if (e.code === "Escape" && this.isGameplay()) this.setPaused(!this.paused);
      if (e.code === "KeyF" && !this.isGameplay()) document.documentElement.requestFullscreen?.().catch(() => undefined);
    });
    window.addEventListener("blur", () => {
      if (this.autoPause && this.isGameplay() && !this.paused) this.setPaused(true);
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && this.autoPause && this.isGameplay() && !this.paused) this.setPaused(true);
    });
    this.fsm.onChange((to) => {
      this.debug?.log(`state → ${to}`);
    });
  }

  applySettings(s: Settings): void {
    this.settings = s;
    this.input.sensitivity = s.sensitivity;
    this.input.invertY = s.invertY;
    this.audio.setVolume(s.volume);
    this.audio.setMusicVolume(s.music);
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    } catch {
      /* ignore */
    }
  }

  isGameplay(): boolean {
    return this.fsm.is(GameState.FISH_RUN, GameState.HUNT);
  }

  isControlled(cat: CatId): boolean {
    return this.controlled !== null && this.controlled.id === cat;
  }

  setPaused(on: boolean): void {
    if (on === this.paused) return;
    this.paused = on;
    this.time.paused = on;
    this.pause.show(on);
    this.audio.setMuffle(on ? 0.25 : 1, 0.1);
    if (on) {
      this.input.exitPointerLock();
      this.input.resetAll();
    } else {
      this.input.requestPointerLock();
      this.time.resync(performance.now());
    }
  }

  alert(text: string, kind: "stolen" | "dropped" | "recovered" | "perfect" | "info"): void {
    this.hud.alert(text, kind);
  }

  // ====================================================================== world helpers
  /** Exact world reset (no page reload). */
  resetWorld(): void {
    this.resets.resetAll();
    for (const c of this.cats) {
      c.team = c.id === this.runnerId ? 0 : 1;
      c.rig.root.visible = true;
    }
    this.combat.rules = { gripFloor: () => 0, isLocal: (c) => c === this.controlled };
    this.combat.resetStats();
    this.fish.canPickup = () => true;
    this.fish.pickupGrip = (c) => (c.id === this.runnerId ? 3 : 1);
    this.input.clearBuffers();
    this.lastZoneIndex = 0;
    this.gripCalmT = 0;
    this.lastPlayerGrip = MAX_GRIP;
    this.scentT = 99;
    this.physics.step(1 / 60);
  }

  snapshotRunner(): Omit<ReplaySnapshot, "t"> {
    const a = this.runner;
    return {
      position: [a.position.x, a.position.y, a.position.z],
      rotationY: a.yaw,
      velocity: [a.velocity.x, a.velocity.y, a.velocity.z],
      grounded: a.grounded,
      carryingFish: this.fish.owner === a,
      fishGrip: this.fish.owner === a ? this.fish.grip.value : 0,
      animationState: a.animLabel,
      action: a.action,
      actionTime: a.abilities.pounceState !== "idle" ? a.abilities.pounceT : a.abilities.hissT,
    };
  }

  aiWorld(round: 1 | 2): AIWorld {
    // Round 1: the live thief. Round 2: the same cat, replayed as Past You.
    const q = this.runner;
    const z = zoneAt(q.position.x, q.position.y, q.position.z);
    return {
      round,
      graph: this.graph,
      physics: this.physics,
      fish: this.fish,
      quarry: q,
      quarryZone: z ? z.index : this.lastZoneIndex,
      rivalsMayCarry: round === 1,
      // What a cat can infer from watching: current position and motion.
      // (Even in Round 2 the agents never peek at Past You's recorded future;
      // only the planner, before the round, studies the whole trace.)
      predict: (ahead, out) => {
        const v = q.mode === "replay" && q.replay ? q.replay.velocity : q.velocity;
        return out.copy(q.position).addScaledVector(v, ahead).setY(q.position.y);
      },
    };
  }

  private readonly echoTmp = emptySample();
  /** Past You's authoritative position at replay time t (pure lookup). */
  echoSampleAt(t: number): [number, number, number] {
    if (!this.echo.player) return [0, 0, 0];
    this.echo.player.sample(Math.min(t, this.echo.player.duration), this.echoTmp);
    return [this.echoTmp.position[0], this.echoTmp.position[1], this.echoTmp.position[2]];
  }

  interactHooks(source: CatActor | null): InteractHooks {
    return {
      burstPigeons: (p, r) => this.pigeons.burst(p, r),
      distract: (p, radius, kind, seconds, only) => {
        for (const a of this.cats) {
          if (only && a.id !== only) continue;
          if (a.mode !== "ai" || a === source) continue;
          if (a.position.distanceTo(p) > radius) continue;
          this.brains[a.id].distract(seconds, p, kind);
        }
      },
      distractNearest: (p, radius, kind, seconds) => {
        let best: CatActor | null = null;
        let bestD = radius;
        for (const a of this.cats) {
          if (a.mode !== "ai" || a === source) continue;
          const d = a.position.distanceTo(p);
          if (d < bestD) {
            bestD = d;
            best = a;
          }
        }
        if (best) this.brains[best.id].distract(seconds, p, kind);
      },
      tangle: (p, radius, seconds, skip) => {
        for (const c of this.cats) {
          if (c === source || c.mode === "replay" || !c.active) continue;
          if (source && c.team === source.team) continue;
          if (skip?.has(c.id)) continue;
          if (Math.hypot(c.position.x - p.x, c.position.z - p.z) < radius && Math.abs(c.position.y - p.y) < 1.5) {
            c.tangledT = seconds;
            c.abilities.cancelAll();
            skip?.add(c.id);
          }
        }
      },
      sound: (type, p, radius, intensity) => {
        this.bus.emit("sound", { type, x: p.x, y: p.y, z: p.z, radius, intensity, source: source ? source.id : "world" });
      },
    };
  }

  /**
   * Round 2 environment trap: an ally springs a prop as Past You passes. It
   * wears Past You's grip like a helper pounce (never the final point).
   */
  trapPastYou(by: CatActor, propId: string): void {
    const it = this.interactables.list.find((i) => i.id === propId);
    if (!it || !this.interactables.trigger(propId, by, this.interactHooks(by), this.effects, this.bus)) return;
    const past = this.runner;
    if (this.round !== 2 || past.mode !== "replay") return;
    if (Math.hypot(past.position.x - it.position.x, past.position.z - it.position.z) > 5.2) return;
    if (this.fish.owner === past) this.fish.damageGrip(past, by, 1);
    past.flinch(this.tmp.subVectors(past.position, it.position).setY(0), 0.6);
    this.effects.ring(it.position.clone().setY(it.position.y + 0.05), 2.2, 0xf7cf55, 0.5);
    this.alert("COUNCIL TRAP!", "info");
  }

  /** Player pressed E. */
  tryInteract(cat: CatActor): boolean {
    const it = this.interactables.nearest(cat);
    if (!it) return false;
    return this.interactables.trigger(it.id, cat, this.interactHooks(cat), this.effects, this.bus);
  }

  private aiInteract(cat: CatActor): void {
    const it = this.interactables.list.find((i) => !i.used && i.position.distanceTo(cat.position) < 3.2);
    if (it) this.interactables.trigger(it.id, cat, this.interactHooks(cat), this.effects, this.bus);
  }

  // ====================================================================== per-frame
  /** Shared gameplay simulation step used by FISH_RUN and HUNT. */
  simulate(dt: number, round: 1 | 2): void {
    if (dt <= 0) return;
    this.controller.actor = this.controlled;
    this.controller.update();
    const ctl = this.controlled;
    if (ctl && this.controller.interactPressed) this.tryInteract(ctl);
    if (ctl && round === 2 && this.controller.scentPressed && ctl.abilities.tryScent()) this.scentMemory();
    const world = this.aiWorld(round);
    for (const c of this.cats) {
      if (c.mode === "ai") this.brains[c.id].update(dt, world);
    }
    if (round === 2) this.echo.update(dt, this.time.realTime);
    for (const c of this.cats) {
      if (c.mode === "player" || c.mode === "ai") c.update(dt);
    }
    this.physics.step(dt);
    this.combat.update();
    this.fish.update(dt, this.cats, this.time.simTime);
    if (round === 1) this.updateGripRecovery(dt);
    this.interactables.update(dt, this.time.simTime);
    this.pigeons.update(dt, this.cats);
    // in-world cue: props you could use twinkle as you approach
    this.cueTimer -= dt;
    if (ctl && this.cueTimer <= 0) {
      this.cueTimer = 0.45;
      for (const it of this.interactables.list) {
        if (it.used) continue;
        const d = Math.hypot(it.position.x - ctl.position.x, it.position.z - ctl.position.z);
        if (d > 7 || Math.abs(it.position.y - ctl.position.y) > 2) continue;
        const lift = it.id === "laundry" ? 1.8 : 0.85;
        this.effects.twinkle(this.tmp.set(it.position.x + (Math.random() - 0.5) * 0.6, it.position.y + lift + Math.random() * 0.4, it.position.z + (Math.random() - 0.5) * 0.6), 0xfff3b0, 0.12);
      }
    }
    // pounces into props knock them over
    for (const c of this.cats) {
      if (c.abilities.pounceState !== "active") continue;
      for (const it of this.interactables.list) {
        if ((it.id === "trashCan" || it.id === "bottle") && !it.used && it.position.distanceTo(c.position) < 1.0) {
          if (c.mode === "replay") continue;
          this.interactables.trigger(it.id, c, this.interactHooks(c), this.effects, this.bus);
        }
      }
    }
    // sprint dust + camera sprint feel
    if (ctl) {
      const sp = Math.hypot(ctl.velocity.x, ctl.velocity.z);
      const sprinting = ctl.movement.sprinting && sp > 6;
      this.camera.sprintBlend += ((sprinting ? 1 : 0) - this.camera.sprintBlend) * Math.min(1, dt * 4);
      this.dustTimer -= dt;
      if (sprinting && ctl.grounded && this.dustTimer <= 0) {
        this.dustTimer = 0.07;
        this.effects.trailDust(ctl.position, this.tmp.set(-Math.sin(ctl.yaw), 0, -Math.cos(ctl.yaw)));
      }
      const z = zoneAt(ctl.position.x, ctl.position.y, ctl.position.z);
      if (z && z.index !== this.lastZoneIndex) {
        this.lastZoneIndex = z.index;
        this.bus.emit("zoneEnter", { cat: ctl.id, zone: z.id, index: z.index });
        this.hud.pingObjective(this.time.realTime, 3);
      }
    }
    this.scentT += dt;
  }

  /** Scent Memory: reveal the next ~2.6s of Past You's recorded path. */
  scentMemory(): void {
    if (!this.echo.player) return;
    this.scentT = 0;
    const path = this.echo.player.futurePath(this.echo.time, 2.6, 0.12);
    let side = 1;
    path.forEach((p, i) => {
      if (!p.grounded) return;
      const ahead = p.t - this.echo.time;
      const intensity = Math.max(0.18, 1 - ahead / 2.9);
      const ox = Math.cos(p.yaw) * 0.11 * side;
      const oz = -Math.sin(p.yaw) * 0.11 * side;
      side *= -1;
      this.prints.add(p.x + ox, p.y, p.z + oz, p.yaw, intensity, 3.4, i * 0.035, 1.5);
    });
    this.effects.ring(this.controlled ? this.controlled.position : this.runner.position, 2.2, PALETTE.seaGlass, 0.6);
    this.audio.play("scent", { volume: 0.5 });
    this.bus.emit("scentMemory", { duration: 2.6 });
  }

  /** Round 1: the rival currently running off with the fish (if any). */
  escapingThief(): { cat: CatActor; escape: { label: string; pos: [number, number, number] } } | null {
    if (this.round !== 1 || !this.fsm.is(GameState.FISH_RUN)) return null;
    const owner = this.fish.owner;
    if (!owner || owner === this.runner || owner.mode !== "ai") return null;
    const e = this.brains[owner.id].escapePoint;
    return e ? { cat: owner, escape: e } : null;
  }

  /** Update HUD widgets from the current gameplay state. */
  updateHUD(): void {
    const ctl = this.controlled;
    const now = this.time.realTime;
    this.hud.setLockHint(this.isGameplay() && !this.input.pointerLocked && !this.paused && !this.manualStepping);
    if (ctl) {
      const ab = ctl.abilities;
      this.hud.setAbility("pounce", ab.pounceState !== "idle" ? 0 : ab.pounceCooldown / ab.pounceCooldownMax, ab.pounceState === "windup" || ab.pounceState === "active");
      this.hud.setAbility("hiss", ab.hissActive ? 0 : ab.hissCooldown / ab.hissCooldownMax, ab.hissActive);
      this.hud.setAbility("scent", ab.scentCooldown / ab.scentCooldownMax, this.scentT < 0.9);
      const it = this.interactables.nearest(ctl);
      this.hud.setPrompt(it ? it.label : null);
    }
    const runner = this.runner;
    if (this.round === 1) {
      const carrying = this.fish.owner === runner;
      this.hud.setGrip(carrying ? this.fish.grip.value : 0, carrying);
      const goal = this.tmp.set(...SPAWN.goal);
      if (this.fish.state === "table") {
        const d = Math.round(runner.position.distanceTo(this.fish.position));
        this.hud.setObjective("STEAL THE FISH", `${d}m`, true, false, "fish");
      } else if (carrying) {
        const d = Math.round(runner.position.distanceTo(goal));
        const still = Math.hypot(runner.velocity.x, runner.velocity.z) < 0.5;
        this.hud.setObjective("SAFE ROOFTOP", `${d}m`, this.hud.objectiveWanted(now) || still, false, "bowl");
      } else if (this.fish.owner && this.fish.owner !== runner) {
        // a rival is running for its escape point: stop it!
        const d = Math.round(runner.position.distanceTo(this.fish.owner.position));
        this.hud.setObjective(`STOP ${this.fish.owner.def.name.toUpperCase()}!`, `${d}m`, true, true, "fish");
      } else {
        const d = Math.round(runner.position.distanceTo(this.fish.position));
        this.hud.setObjective("RECOVER THE FISH", `${d}m`, true, true, "fish");
      }
    } else {
      const echoCarry = this.fish.owner === runner;
      this.hud.setGrip(echoCarry ? this.fish.grip.value : 0, echoCarry);
      const left = Math.max(0, this.echo.duration - this.echo.time);
      this.hud.setTimeline(this.echo.progress, left);
      if (ctl && (this.fish.state === "loose" || this.fish.state === "flying")) {
        const d = Math.round(ctl.position.distanceTo(this.fish.position));
        this.hud.setObjective("GRAB THE FISH", `${d}m`, true, true, "fish");
      } else {
        this.hud.setObjective("", "", false);
      }
    }
  }

  /** Round 1 forgiveness: the thief tightens its grip after a clean stretch. */
  private updateGripRecovery(dt: number): void {
    const f = this.fish;
    if (f.owner !== this.runner || f.grip.value >= MAX_GRIP) {
      this.gripCalmT = 0;
      return;
    }
    this.gripCalmT += dt;
    if (this.gripCalmT < GRIP_RECOVER_SECONDS) return;
    this.gripCalmT = 0;
    f.grip.reset(f.grip.value + 1);
    this.bus.emit("gripChanged", { cat: this.runnerId, grip: f.grip.value });
    this.effects.sparkle(this.tmp.copy(this.runner.position).setY(this.runner.position.y + 0.6), 8, 0xfff3b0, 1.4, 0.45);
    this.audio.play("pickup", { volume: 0.25, pitch: 1.2 });
  }

  /** Project the fish (or its holder) into the HUD tracker. */
  private updateTracker(): void {
    let variant: "rival" | "echo" | "loose" | null = null;
    const f = this.fish;
    const p = this.trackPos;
    if (this.fsm.is(GameState.FISH_RUN, GameState.HUNT) && !this.photoCamera) {
      if (f.state === "carried" && f.owner && f.owner !== this.controlled) {
        variant = this.round === 2 && f.owner === this.runner ? "echo" : "rival";
        p.copy(f.owner.position).setY(f.owner.position.y + 0.95);
      } else if (f.state === "loose" || f.state === "flying") {
        variant = "loose";
        p.copy(f.position).setY(f.position.y + 0.5);
      }
    }
    if (!variant) {
      this.hud.setTracker(0, 0, false, 0, null);
      return;
    }
    const cam = this.camera.camera;
    cam.updateMatrixWorld();
    p.applyMatrix4(cam.matrixWorldInverse);
    const behind = p.z > -0.2;
    p.applyMatrix4(cam.projectionMatrix);
    let x = behind ? -p.x : p.x;
    let y = behind ? -p.y : p.y;
    const W = window.innerWidth;
    const H = window.innerHeight;
    if (!behind && Math.abs(x) < 0.94 && Math.abs(y) < 0.86) {
      this.hud.setTracker((x * 0.5 + 0.5) * W, (-y * 0.5 + 0.5) * H, false, 0, variant);
      return;
    }
    if (Math.hypot(x, y) < 1e-3) y = -1;
    // pin to an inset rectangle along the direction of the target
    const k = 1 / Math.max(Math.abs(x) / 0.86, Math.abs(y) / 0.7);
    x *= k;
    y *= k;
    this.hud.setTracker((x * 0.5 + 0.5) * W, (-y * 0.5 + 0.5) * H, true, Math.atan2(-y * H, x * W), variant);
  }

  /** Follow-camera on the controlled cat. */
  updateFollowCamera(dt: number): void {
    const ctl = this.controlled;
    if (!ctl) return;
    this.camera.mode = "follow";
    if (this.input.pointerLocked) this.camera.applyMouse(this.input.mouseDX, this.input.mouseDY);
    else if (this.input.idleLook > 1.2) this.camera.autoFollow(ctl.yaw, Math.hypot(ctl.velocity.x, ctl.velocity.z), dt);
    const target = this.tmp.copy(ctl.position);
    target.y += 0.78;
    this.camera.update(dt, target, this.physics, 10 + this.camera.sprintBlend * 6);
  }

  /** Called each frame by main.ts */
  frame(nowMs: number): void {
    this.time.tick(nowMs);
    this.input.beginFrame(this.time.realTime);
    const dt = this.time.simDt;
    this.fsm.update(this.time.realDt);
    this.water.update(this.time.realTime);
    this.sky.update(this.time.realDt);
    this.beacon.update(this.time.realTime, this.camera.camera.position, this.fsm.is(GameState.INTRO, GameState.FISH_RUN, GameState.HUNT), this.round === 2);
    const thief = this.escapingThief();
    if (thief) {
      this.escapeBeacon.setPosition(this.tmp.set(...thief.escape.pos));
      // pulsing red rings on the floor where the thief means to vanish
      this.escapePulse -= this.time.realDt;
      if (this.escapePulse <= 0) {
        this.escapePulse = 0.55;
        this.effects.ring(this.tmp.set(thief.escape.pos[0], thief.escape.pos[1] + 0.05, thief.escape.pos[2]), 1.7, 0xff6a4a, 0.5);
      }
    }
    this.escapeBeacon.update(this.time.realTime, this.camera.camera.position, thief !== null, false, true);
    this.effects.update(this.fsm.is(GameState.REWIND) ? this.time.realDt : dt, this.camera.camera);
    this.prints.update(dt, this.time.realTime);
    this.lighting.setFocus(this.controlled ? this.controlled.position : this.camera.pivot);
    this.lighting.update(this.time.realDt);
    this.audio.setListener(this.camera.camera.position);
    this.audio.update(this.time.realDt, !this.fsm.is(GameState.BOOT));
    this.debug?.update();
    this.updateTracker();
    if (this.renderEnabled) this.renderer.render(this.scene, this.photoCamera ?? this.camera.camera, this.time.realTime);
    this.input.endFrame(this.time.realDt);
  }

  // ====================================================================== misc helpers
  zoneOf(c: CatActor) {
    return zoneAt(c.position.x, c.position.y, c.position.z);
  }

  elevated(c: CatActor): boolean {
    return isElevated(this.zoneOf(c), c.position.y);
  }

  catName(id: CatId): string {
    return CATS[id].name;
  }

  zones() {
    return ZONES;
  }

  fade(on: boolean, ms = 250): void {
    this.fadeEl.style.transition = `opacity ${ms}ms ease`;
    this.fadeEl.style.opacity = on ? "1" : "0";
  }
}

/** Yield to the browser (rAF, with a timer fallback for hidden tabs). */
function nextFrame(): Promise<void> {
  return new Promise((r) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      r();
    };
    requestAnimationFrame(finish);
    setTimeout(finish, 60);
  });
}
