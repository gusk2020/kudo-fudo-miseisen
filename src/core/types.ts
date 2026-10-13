export type Vec = [number, number];
export const ISLAND_IDS = ["honshu", "hokkaido", "kyushu", "shikoku"] as const;
export type IslandId = (typeof ISLAND_IDS)[number];

/** Deformation operation. Centre/vector are in the island's local frame *after* the preceding ops. A dent is a bulge with k < 0. */
export type Op =
  | { t: "pull"; c: Vec; d: Vec; r: number }
  | { t: "bulge"; c: Vec; r: number; k: number };

export interface Place { pos: Vec; rot: number; scale: number }
export interface BodyState { ops: Op[]; place: Place }
export interface FeatureState { pos: Vec | null; rot: number } // pos null = follow Honshu's warp of the real position

export const STEPS = ["base", "honshu", "islands", "features", "terrain", "confirm"] as const;
export type StepId = (typeof STEPS)[number];
export const STEP_LABELS: Record<StepId, string> = {
  base: "1A 初期表示", honshu: "1B 本州変形", islands: "1C 島の配置",
  features: "1D 固有地形", terrain: "1E 地形生成", confirm: "1F 最終確定",
};

export interface ProjectState {
  schemaVersion: number;
  seed: number;
  step: number;
  bodies: Record<IslandId, BodyState>;
  features: { biwa: FeatureState; fuji: FeatureState };
  ridges: { sw: Vec[] | null; ne: Vec[] | null };
  finalized: boolean;
  layers: Record<string, boolean>;
}

export type Severity = "error" | "warn";
export interface Issue { step: StepId; severity: Severity; code: string; msg: string; }
