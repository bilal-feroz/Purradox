// Typed publish/subscribe bus. Systems talk through events instead of holding
// references to each other, which keeps the replay recorder, telemetry,
// audio and UI decoupled from gameplay code.

import type { CatId } from "../data/cats";

/** What AI cats can hear (see RivalBrain.hear). */
export type SoundType = "trashCrash" | "bottleRoll" | "bell" | "pigeonBurst" | "fishDrop" | "catHiss" | "laundryFlap" | "scrapsSpill";

export interface GameEvents {
  jump: { cat: CatId; x: number; y: number; z: number };
  land: { cat: CatId; x: number; y: number; z: number; impact: number };
  pounceStart: { cat: CatId; dirX: number; dirZ: number; x: number; y: number; z: number };
  /** An AI cat is winding up a pounce (readable tell for Perfect Hiss). */
  pounceTell: { cat: CatId; x: number; y: number; z: number };
  pounceHit: { attacker: CatId; target: CatId; gripDamage: boolean; x: number; y: number; z: number };
  hissStart: { cat: CatId; dirX: number; dirZ: number; x: number; y: number; z: number };
  perfectHiss: { hisser: CatId; attacker: CatId; x: number; y: number; z: number };
  hesitate: { cat: CatId; by: CatId };
  interact: { cat: CatId; target: string; x: number; y: number; z: number };
  fishPickup: { cat: CatId; recovered: boolean; stolen: boolean; x: number; y: number; z: number };
  fishDrop: { cat: CatId; by: CatId | null; x: number; y: number; z: number };
  gripChanged: { cat: CatId; grip: number };
  fishLanded: { x: number; y: number; z: number };
  footstep: { cat: CatId; sprint: boolean; x: number; y: number; z: number; volume: number };
  /** Something audible happened: AI cats within earshot may react. */
  sound: { type: SoundType; x: number; y: number; z: number; radius: number; intensity: number; source: CatId | "world" };
  pigeonsBurst: { x: number; y: number; z: number; count: number };
  zoneEnter: { cat: CatId; zone: string; index: number };
  alert: { text: string; kind: "stolen" | "dropped" | "recovered" | "perfect" | "info" };
  meow: { cat: CatId; aggressive?: boolean };
  scentMemory: { duration: number };
  respawn: { cat: CatId };
}

type Handler<T> = (payload: T) => void;

export class EventBus {
  private handlers = new Map<keyof GameEvents, Set<Handler<unknown>>>();

  on<K extends keyof GameEvents>(type: K, handler: Handler<GameEvents[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler as Handler<unknown>);
    return () => this.off(type, handler);
  }

  off<K extends keyof GameEvents>(type: K, handler: Handler<GameEvents[K]>): void {
    this.handlers.get(type)?.delete(handler as Handler<unknown>);
  }

  emit<K extends keyof GameEvents>(type: K, payload: GameEvents[K]): void {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const h of [...set]) (h as Handler<GameEvents[K]>)(payload);
  }

  listenerCount(): number {
    let n = 0;
    for (const set of this.handlers.values()) n += set.size;
    return n;
  }
}
