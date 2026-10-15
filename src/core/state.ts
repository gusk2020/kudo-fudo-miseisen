import { BODY_DEFS, JAPAN } from "./data";
import { realToWorld } from "./body";
import type { BodyState, IslandId, ProjectState, Vec } from "./types";
import { ISLAND_IDS } from "./types";

export const SCHEMA_VERSION = 1;
export const LAYER_KEYS = ["coast", "elevation", "rivers", "lakes", "borders", "cities", "ridges"] as const;
export const ROAD_LAYER_KEYS = ["roads", "rail", "plans", "abandoned", "ports", "signs"] as const;
export const LAYER_LABELS: Record<string, string> = { coast: "海岸線", elevation: "標高", rivers: "河川", lakes: "湖", borders: "府県境", cities: "都市", ridges: "山脈", roads: "道路", plans: "建設計画・未成線", signs: "路線番号標識", rail: "鉄道", abandoned: "廃止・廃墟跡", ports: "港・空港" };

export function defaultBody(id: IslandId): BodyState { return { ops: [], place: { pos: [BODY_DEFS[id].origin[0], BODY_DEFS[id].origin[1]], rot: 0, scale: 1 } }; }
export function defaultState(seed = 20260101): ProjectState {
  const bodies = {} as Record<IslandId, BodyState>;
  for (const id of ISLAND_IDS) bodies[id] = defaultBody(id);
  return {
    schemaVersion: SCHEMA_VERSION, seed, step: 0, bodies,
    features: { biwa: { pos: null, rot: 0 }, fuji: { pos: null, rot: 0 } },
    ridges: { sw: null, ne: null }, finalized: false,
    layers: { coast: true, elevation: true, rivers: true, lakes: true, borders: true, cities: true, ridges: true, roads: true, rail: true, plans: true, abandoned: true, ports: true, signs: true },
  };
}
/** Stage 3 start: real geography, nothing deformed, already finalised, at the roads step. */
export function realState(seed = 20260101): ProjectState { const s = defaultState(seed); s.finalized = true; s.step = 6; s.real = true; return s; }
export const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

/** World positions of the fixed-shape features (default = real position pushed through Honshu's warp). */
export function featureWorldPos(s: ProjectState, which: "biwa" | "fuji"): Vec {
  const f = s.features[which];
  if (f.pos) return f.pos;
  return realToWorld("honshu", s.bodies.honshu, which === "biwa" ? JAPAN.biwa.center : JAPAN.fuji.center);
}

export class Store {
  state: ProjectState;
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private subs = new Set<() => void>();
  constructor(s: ProjectState = defaultState()) { this.state = s; }
  subscribe(f: () => void) { this.subs.add(f); return () => this.subs.delete(f); }
  private emit() { this.subs.forEach((f) => f()); }
  /** Called when an edit is refused because the map is finalised (locked). */
  onBlocked: (() => void) | null = null;
  get locked() { return this.state.finalized; }
  /** Apply a mutation as one undoable step. Refused (returns false) while the map is finalised. */
  commit(mut: (s: ProjectState) => void): boolean {
    if (this.state.finalized) { this.onBlocked?.(); return false; }
    this.undoStack.push(JSON.stringify(this.state));
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
    mut(this.state);
    this.emit();
    return true;
  }
  /** The only way to edit a finalised map again: explicit, not undoable. */
  unlock() { this.state.finalized = false; this.emit(); }
  /** Non-undoable change (view preferences, step navigation). */
  set(mut: (s: ProjectState) => void) { mut(this.state); this.emit(); }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  undo() {
    if (this.state.finalized) { this.onBlocked?.(); return false; }
    const p = this.undoStack.pop(); if (!p) return false;
    this.redoStack.push(JSON.stringify(this.state));
    const keepStep = this.state.step, keepLayers = this.state.layers;
    this.state = JSON.parse(p); this.state.step = keepStep; this.state.layers = keepLayers; this.emit(); return true;
  }
  redo() {
    if (this.state.finalized) { this.onBlocked?.(); return false; }
    const p = this.redoStack.pop(); if (!p) return false;
    this.undoStack.push(JSON.stringify(this.state));
    const keepStep = this.state.step, keepLayers = this.state.layers;
    this.state = JSON.parse(p); this.state.step = keepStep; this.state.layers = keepLayers; this.emit(); return true;
  }
  replace(s: ProjectState) { this.state = s; this.undoStack = []; this.redoStack = []; this.emit(); }
}
