// Round 1 behavior telemetry → compact summary for the Tactical Director.

export interface ZoneVisit {
  zone: string;
  index: number;
  t: number;
}

export interface TelemetryPoint {
  t: number;
  x: number;
  y: number;
  z: number;
  zone: string;
}

export interface TelemetrySummary {
  runDuration: number;
  averageSpeed: number;
  sprintRatio: number;
  elevatedRatio: number;
  groundTime: number;
  elevatedTime: number;
  zoneEntryTimes: Record<string, number>;
  zoneTime: Record<string, number>;
  routeChoice: { awningShortcut: boolean; rooftopShortcut: boolean };
  pounces: TelemetryPoint[];
  hisses: TelemetryPoint[];
  interactions: Array<TelemetryPoint & { target: string }>;
  gripLosses: TelemetryPoint[];
  fishDrops: number;
  dangerEncounters: number;
  jumps: number;
  longestStandStill: number;
}

/**
 * Accumulates telemetry while Round 1 is played. Pure data: the game calls
 * `sample` every frame and the `on*` hooks from gameplay events.
 */
export class TelemetryTracker {
  private s: TelemetrySummary = TelemetryTracker.empty();
  private lastZone = "";
  private distance = 0;
  private lastPos: [number, number, number] | null = null;
  private stillTime = 0;
  private dangerCooldown = 0;

  static empty(): TelemetrySummary {
    return {
      runDuration: 0,
      averageSpeed: 0,
      sprintRatio: 0,
      elevatedRatio: 0,
      groundTime: 0,
      elevatedTime: 0,
      zoneEntryTimes: {},
      zoneTime: {},
      routeChoice: { awningShortcut: false, rooftopShortcut: false },
      pounces: [],
      hisses: [],
      interactions: [],
      gripLosses: [],
      fishDrops: 0,
      dangerEncounters: 0,
      jumps: 0,
      longestStandStill: 0,
    };
  }

  reset(): void {
    this.s = TelemetryTracker.empty();
    this.lastZone = "";
    this.distance = 0;
    this.lastPos = null;
    this.stillTime = 0;
    this.dangerCooldown = 0;
  }

  sample(t: number, dt: number, x: number, y: number, z: number, zone: string, elevated: boolean, sprinting: boolean, nearestThreat: number): void {
    const s = this.s;
    s.runDuration = t;
    if (zone && zone !== this.lastZone) {
      if (s.zoneEntryTimes[zone] === undefined) s.zoneEntryTimes[zone] = t;
      this.lastZone = zone;
      if (zone === "yard") s.routeChoice.awningShortcut = true;
      if (zone === "lowroofs") s.routeChoice.rooftopShortcut = true;
    }
    if (zone) s.zoneTime[zone] = (s.zoneTime[zone] ?? 0) + dt;
    if (elevated) s.elevatedTime += dt;
    else s.groundTime += dt;
    if (sprinting) s.sprintRatio += dt;
    if (this.lastPos) {
      const d = Math.hypot(x - this.lastPos[0], z - this.lastPos[2]);
      if (d < 20) this.distance += d;
      if (d / Math.max(dt, 1e-4) < 0.3) {
        this.stillTime += dt;
        s.longestStandStill = Math.max(s.longestStandStill, this.stillTime);
      } else this.stillTime = 0;
    }
    this.lastPos = [x, y, z];
    this.dangerCooldown -= dt;
    if (nearestThreat < 3 && this.dangerCooldown <= 0) {
      s.dangerEncounters++;
      this.dangerCooldown = 2.5;
    }
  }

  onPounce(p: TelemetryPoint): void {
    this.s.pounces.push(p);
  }
  onHiss(p: TelemetryPoint): void {
    this.s.hisses.push(p);
  }
  onInteract(p: TelemetryPoint & { target: string }): void {
    this.s.interactions.push(p);
  }
  onGripLoss(p: TelemetryPoint): void {
    this.s.gripLosses.push(p);
  }
  onFishDrop(): void {
    this.s.fishDrops++;
  }
  onJump(): void {
    this.s.jumps++;
  }

  summary(): TelemetrySummary {
    const s = structuredClone(this.s);
    const total = Math.max(0.001, s.runDuration);
    s.averageSpeed = this.distance / total;
    s.sprintRatio = s.sprintRatio / total;
    s.elevatedRatio = s.elevatedTime / Math.max(0.001, s.elevatedTime + s.groundTime);
    return s;
  }
}
