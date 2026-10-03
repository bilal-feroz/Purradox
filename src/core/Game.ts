import * as THREE from "three";
import { CATS, RIVAL_IDS, type CatId, type RivalId } from "../data/cats";
import { H, SPAWN, ZONES } from "../data/level";
import { PALETTE } from "../data/palette";
import { AudioManager } from "../audio/AudioManager";
import { TacticalDirector, HttpStrategyProvider } from "../ai/TacticalDirector";
import type { TacticalPlan } from "../ai/TacticalFallback";
import { TelemetryTracker } from "../ai/TelemetrySummary";
import { CatActor } from "../cats/CatActor";
import { RivalBrain, type AIWorld } from "../cats/CatAI";
import { CombatSystem } from "../combat/CombatSystem";
import { FishSystem } from "../fish/Fish";
import { Interactables, type InteractHooks } from "../level/Interactable";
import { PigeonFlock } from "../level/Pigeons";
import { ResetManager } from "../level/ResetManager";
import { buildSardineStreet } from "../level/SardineStreet";
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
import { HUD } from "../ui/HUD";
import { PauseMenu } from "../ui/PauseMenu";
import { Results } from "../ui/Results";
import { StartScreen, type Settings } from "../ui/StartScreen";
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
  fish!: FishSystem;
  combat!: CombatSystem;
  interactables!: Interactables;
  pigeons!: PigeonFlock;
  fishCat!: CatActor;
  readonly rivals = {} as Record<RivalId, CatActor>;
  readonly brains = {} as Record<RivalId, RivalBrain>;
  readonly cats: CatActor[] = [];
  controller!: CatController;
  echo!: EchoController;
  recorder = new ReplayRecorder("fishcat", 20);

  // ui
  readonly hud: HUD;
  readonly start: StartScreen;
  readonly select: CatSelect;
  readonly results: Results;
  readonly stamps: Stamps;
  readonly pause: PauseMenu;
  readonly fadeEl: HTMLDivElement;
  readonly temporalVignette: HTMLDivElement;

  // round state
  round: 1 | 2 = 1;
  controlled: CatActor | null = null;
  replay: ReplayData | null = null;
  plan: TacticalPlan | null = null;
  hunterId: RivalId | null = null;
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
  private dustTimer = 0;
  private scentT = 99;
  readonly tmp = new THREE.Vector3();

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
    const directorUrl = params.get("director");
    this.director = new TacticalDirector(directorUrl ? new HttpStrategyProvider(directorUrl) : import.meta.env.VITE_DIRECTOR_URL ? new HttpStrategyProvider(import.meta.env.VITE_DIRECTOR_URL as string) : null);

    this.hud = new HUD(uiRoot);
    this.start = new StartScreen(uiRoot, this.settings);
    this.select = new CatSelect(uiRoot);
    this.results = new Results(uiRoot);
    this.stamps = new Stamps(uiRoot);
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
    this.fishCat = new CatActor("fishcat", this.physics, mats, this.bus, v(SPAWN.fishCat.pos));
    this.scene.add(this.fishCat.rig.root);
    this.cats.push(this.fishCat);
    RIVAL_IDS.forEach((id, i) => {
      const a = new CatActor(id, this.physics, mats, this.bus, v(SPAWN.rivals[id].pos));
      this.scene.add(a.rig.root);
      this.rivals[id] = a;
      this.cats.push(a);
      const brain = new RivalBrain(id, a, 1000 + i * 77);
      brain.onWantInteract = (cat) => this.aiInteract(cat);
      this.brains[id] = brain;
    });
    this.fish = new FishSystem(this.scene, this.physics, this.bus, this.effects, this.materials.cat, this.materials.glossy, v(SPAWN.heroFish));
    this.combat = new CombatSystem(this.bus, this.fish, this.effects, this.time, this.camera);
    this.combat.cats = this.cats;
    this.controller = new CatController(this.input, this.camera);
    this.controller.targets = this.cats;
    this.echo = new EchoController(this.fishCat, this.scene, this.materials.cat, this.materials.glossy, this.effects, this.prints);
  }

  private registerResettables(): void {
    this.resets.add("fish", () => this.fish.reset());
    this.resets.add("fishcat", () => {
      this.fishCat.resetStatus();
      this.fishCat.mode = "player";
      this.fishCat.replay = null;
      this.fishCat.active = true;
      this.fishCat.movement.setCollisionEnabled(true);
      this.fishCat.teleport(new THREE.Vector3(...SPAWN.fishCat.pos), SPAWN.fishCat.yaw);
    });
    for (const id of RIVAL_IDS) {
      this.resets.add(`rival:${id}`, () => {
        const a = this.rivals[id];
        a.resetStatus();
        a.mode = "ai";
        a.active = true;
        this.brains[id].reset();
      });
    }
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
    const snap = () => this.snapshotFishCat();
    this.bus.on("jump", (e) => {
      if (e.cat === "fishcat" && isRunRecording()) {
        this.recorder.event(this.runTime, "jump", undefined, snap);
        this.telemetry.onJump();
      }
      if (this.isControlled(e.cat)) this.effects.dust(new THREE.Vector3(e.x, e.y, e.z), 5, 0.5, 0.6, 0.13);
    });
    this.bus.on("land", (e) => {
      if (e.cat === "fishcat" && isRunRecording()) this.recorder.event(this.runTime, "land", undefined, snap);
      if (e.impact > 0.25) this.effects.dust(new THREE.Vector3(e.x, e.y, e.z), Math.round(4 + e.impact * 8), 0.6 + e.impact, 0.8, 0.14 + e.impact * 0.08);
    });
    this.bus.on("pounceStart", (e) => {
      const p = new THREE.Vector3(e.x, e.y, e.z);
      this.effects.dust(p, 6, 0.7, 0.7, 0.15);
      if (e.cat === "fishcat" && isRunRecording()) {
        this.recorder.event(this.runTime, "pounce", { dirX: e.dirX, dirZ: e.dirZ }, snap);
        this.telemetry.onPounce({ t: this.runTime, x: e.x, y: e.y, z: e.z, zone: zoneAt(e.x, e.y, e.z)?.id ?? "" });
      }
      if (this.round === 2 && this.controlled && e.cat === this.controlled.id) this.huntStats.interceptAttempts++;
    });
    this.bus.on("hissStart", (e) => {
      if (e.cat === "fishcat" && isRunRecording()) {
        this.recorder.event(this.runTime, "hiss", { dirX: e.dirX, dirZ: e.dirZ }, snap);
        this.telemetry.onHiss({ t: this.runTime, x: e.x, y: e.y, z: e.z, zone: zoneAt(e.x, e.y, e.z)?.id ?? "" });
      }
    });
    this.bus.on("interact", (e) => {
      if (e.cat === "fishcat" && isRunRecording()) {
        this.recorder.event(this.runTime, "interact", { target: e.target }, snap);
        this.telemetry.onInteract({ t: this.runTime, x: e.x, y: e.y, z: e.z, zone: zoneAt(e.x, e.y, e.z)?.id ?? "", target: e.target });
      }
    });
    this.bus.on("fishPickup", (e) => {
      if (e.cat === "fishcat" && isRunRecording()) this.recorder.event(this.runTime, "fishPickup", undefined, snap);
      // Alerts
      if (this.round === 1) {
        if (e.cat !== "fishcat" && e.stolen) this.alert("FISH STOLEN!", "stolen");
        else if (e.cat === "fishcat" && e.recovered) this.alert("FISH RECOVERED!", "recovered");
        else if (e.cat === "fishcat" && e.stolen) this.alert("FISH RECOVERED!", "recovered");
        if (e.cat === "fishcat") this.hud.pingObjective(this.time.realTime, 4);
      } else {
        if (e.cat === "fishcat" && e.recovered) this.alert("PAST YOU RECOVERED!", "recovered");
        if (this.controlled && e.cat === this.controlled.id) this.alert("FISH STOLEN!", "stolen");
      }
    });
    this.bus.on("fishDrop", (e) => {
      if (e.cat === "fishcat" && isRunRecording()) {
        this.recorder.event(this.runTime, "fishDrop", undefined, snap);
        this.telemetry.onFishDrop();
      }
      this.alert("FISH DROPPED!", "dropped");
      this.time.slowMo(0.45, 0.3);
      this.camera.addTrauma(0.3);
      // nearby cats notice
      for (const id of RIVAL_IDS) {
        const a = this.rivals[id];
        if (a.mode === "ai" && a.position.distanceTo(this.fish.position) < 14) a.lookTarget = this.fish.position;
      }
    });
    this.bus.on("gripChanged", (e) => {
      if (e.cat === "fishcat" && isRunRecording() && e.grip < 3) {
        this.telemetry.onGripLoss({ t: this.runTime, x: this.fishCat.position.x, y: this.fishCat.position.y, z: this.fishCat.position.z, zone: zoneAt(this.fishCat.position.x, this.fishCat.position.y, this.fishCat.position.z)?.id ?? "" });
      }
    });
    this.bus.on("perfectHiss", (e) => {
      const involvesPlayer = this.controlled && (e.hisser === this.controlled.id || e.attacker === this.controlled.id);
      if (involvesPlayer || this.round === 2) this.alert("PERFECT HISS!", "perfect");
      if (this.round === 2 && this.controlled && e.hisser === this.controlled.id) this.huntStats.perfectHisses++;
      if (this.round === 2 && e.hisser === "fishcat") this.huntStats.echoPerfectHisses++;
      if (this.round === 1 && e.hisser === "fishcat") this.huntStats.perfectHisses++;
    });
    this.bus.on("respawn", (e) => {
      if (e.cat === "fishcat" && isRunRecording()) this.recorder.cut(this.runTime, snap);
    });
    this.audio.subscribe(this.bus, (cat) => this.isControlled(cat));
  }

  private wireUI(): void {
    this.start.onStart = () => {
      this.audio.unlock();
      this.audio.play("ui");
      if (this.fsm.state === GameState.MENU) this.fsm.transition(GameState.INTRO);
    };
    this.start.onSettings = (s) => this.applySettings(s);
    this.select.onPick = (id) => {
      this.audio.play("ui");
      this.hunterId = id;
      if (this.fsm.state === GameState.CAT_SELECTION) this.fsm.transition(GameState.HUNT);
    };
    this.select.onHover = (id) => {
      if (id) {
        this.rivals[id].meow();
        this.audio.play("ui", { pitch: 1.2 });
      }
    };
    this.results.onRunItBack = () => {
      this.audio.play("ui");
      if (this.fsm.state === GameState.RESULTS) this.fsm.transition(GameState.REWIND);
    };
    this.results.onNewRun = () => {
      this.audio.play("ui");
      if (this.fsm.state === GameState.RESULTS) this.fsm.transition(GameState.INTRO);
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
      c.team = c.id === "fishcat" ? 0 : 1;
      c.rig.root.visible = true;
    }
    this.combat.rules = { gripFloor: () => 0, isLocal: (c) => c === this.controlled };
    this.combat.resetStats();
    this.fish.canPickup = () => true;
    this.fish.pickupGrip = (c) => (c.id === "fishcat" ? 3 : 1);
    this.input.clearBuffers();
    this.lastZoneIndex = 0;
    this.scentT = 99;
    this.physics.step(1 / 60);
  }

  snapshotFishCat(): Omit<ReplaySnapshot, "t"> {
    const a = this.fishCat;
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
    const q = round === 1 ? this.fishCat : this.fishCat;
    const z = zoneAt(q.position.x, q.position.y, q.position.z);
    return {
      round,
      graph: this.graph,
      physics: this.physics,
      fish: this.fish,
      quarry: q,
      quarryZone: z ? z.index : this.lastZoneIndex,
      rivalsMayCarry: round === 1,
      predict: (ahead, out) => {
        if (round === 2 && this.echo.player) {
          const s = this.echoSampleAt(this.echo.time + ahead);
          return out.set(s[0], s[1], s[2]);
        }
        return out.copy(q.position).addScaledVector(q.velocity, ahead).setY(q.position.y);
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
        for (const id of RIVAL_IDS) {
          if (only && id !== only) continue;
          const a = this.rivals[id];
          if (a.mode !== "ai" || a === source) continue;
          if (a.position.distanceTo(p) > radius) continue;
          this.brains[id].distract(seconds, p, kind);
        }
      },
      tangle: (p, radius, seconds) => {
        for (const c of this.cats) {
          if (c === source || c.mode === "replay" || !c.active) continue;
          if (source && c.team === source.team) continue;
          if (Math.hypot(c.position.x - p.x, c.position.z - p.z) < radius && Math.abs(c.position.y - p.y) < 1.5) {
            c.tangledT = seconds;
            c.abilities.cancelAll();
          }
        }
      },
    };
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
    for (const id of RIVAL_IDS) {
      if (this.rivals[id].mode === "ai") this.brains[id].update(dt, world);
    }
    if (round === 2) this.echo.update(dt, this.time.realTime);
    for (const c of this.cats) {
      if (c.mode === "player" || c.mode === "ai") c.update(dt);
    }
    this.physics.step(dt);
    this.combat.update();
    this.fish.update(dt, this.cats, this.time.simTime);
    this.interactables.update(dt, this.time.simTime);
    this.pigeons.update(dt, this.cats);
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
    this.effects.ring(this.controlled ? this.controlled.position : this.fishCat.position, 2.2, PALETTE.seaGlass, 0.6);
    this.audio.play("scent", { volume: 0.5 });
    this.bus.emit("scentMemory", { duration: 2.6 });
  }

  /** Update HUD widgets from the current gameplay state. */
  updateHUD(): void {
    const ctl = this.controlled;
    const now = this.time.realTime;
    if (ctl) {
      const ab = ctl.abilities;
      this.hud.setAbility("pounce", ab.pounceState !== "idle" ? 0 : ab.pounceCooldown / ab.pounceCooldownMax, ab.pounceState === "windup" || ab.pounceState === "active");
      this.hud.setAbility("hiss", ab.hissActive ? 0 : ab.hissCooldown / ab.hissCooldownMax, ab.hissActive);
      this.hud.setAbility("scent", ab.scentCooldown / ab.scentCooldownMax, this.scentT < 0.9);
      const it = this.interactables.nearest(ctl);
      this.hud.setPrompt(it ? it.label : null);
    }
    if (this.round === 1) {
      const carrying = this.fish.owner === this.fishCat;
      this.hud.setGrip(carrying ? this.fish.grip.value : 0, carrying);
      const goal = this.tmp.set(...SPAWN.goal);
      if (this.fish.state === "table") {
        const d = Math.round(this.fishCat.position.distanceTo(this.fish.position));
        this.hud.setObjective("STEAL THE FISH", `${d}m`, true, false, "fish");
      } else if (carrying) {
        const d = Math.round(this.fishCat.position.distanceTo(goal));
        const still = Math.hypot(this.fishCat.velocity.x, this.fishCat.velocity.z) < 0.5;
        this.hud.setObjective("SAFE ROOFTOP", `${d}m`, this.hud.objectiveWanted(now) || still, false, "bowl");
      } else {
        const d = Math.round(this.fishCat.position.distanceTo(this.fish.position));
        this.hud.setObjective("RECOVER THE FISH", `${d}m`, true, true, "fish");
      }
    } else {
      const echoCarry = this.fish.owner === this.fishCat;
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
    this.effects.update(this.fsm.is(GameState.REWIND) ? this.time.realDt : dt, this.camera.camera);
    this.prints.update(dt, this.time.realTime);
    this.lighting.setFocus(this.controlled ? this.controlled.position : this.camera.pivot);
    this.lighting.update(this.time.realDt);
    this.audio.setListener(this.camera.camera.position);
    this.audio.update(this.time.realDt, !this.fsm.is(GameState.BOOT));
    this.debug?.update();
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
