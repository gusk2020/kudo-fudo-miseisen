export type Vec = [number, number];
export const ISLAND_IDS = ["honshu", "hokkaido", "kyushu", "shikoku"] as const;
export type IslandId = (typeof ISLAND_IDS)[number];

/** Deformation operation. Centre/vector are in the island's local frame *after* the preceding ops. A dent is a bulge with k < 0. */
export type Op =
  | { t: "pull"; c: Vec; d: Vec; r: number }
  | { t: "bulge"; c: Vec; r: number; k: number };

export interface Place { pos: Vec; rot: number; scale: number }
export interface BodyState { ops: Op[]; place: Place }
export interface FeatureState { pos: Vec | null; rot: number; scale?: number; height?: number }   // Issue #15: scale = outline / body size (both), height = summit height (Fuji only); absent = 1 // pos null = follow Honshu's warp of the real position

export const STEPS = ["base", "honshu", "islands", "features", "terrain", "confirm", "roads"] as const;
export type StepId = (typeof STEPS)[number];
export const STEP_LABELS: Record<StepId, string> = {
  base: "1A 初期表示", honshu: "1B 本州変形", islands: "1C 島の配置",
  features: "1D 固有地形", terrain: "1E 地形生成", confirm: "1F 最終確定", roads: "2 道路・開通の儀",
};

export interface ProjectState {
  schemaVersion: number;
  seed: number;
  step: number;
  bodies: Record<IslandId, BodyState>;
  features: { biwa: FeatureState; fuji: FeatureState };
  ridges: { sw: Vec[] | null; ne: Vec[] | null };
  finalized: boolean;
  /** Stage 3: the real Japan (no deformation, no drawn ridges). Set only by realState(); the hand-edited map flow never sets it. */
  real?: boolean;
  /** Issue #13: the five added islands (淡路・対馬・佐渡・壱岐・隠岐) are part of the land. Set only by realState(); older saves lack it, so their terrain stays exactly as it was. */
  islands?: boolean;
  /** Issue #13: id of the city chosen as the capital (default: 東京). A city/administration parameter, kept apart from the terrain. */
  capital?: string;
  layers: Record<string, boolean>;
}

export type Severity = "error" | "warn";
export interface Issue { step: StepId; severity: Severity; code: string; msg: string; }
