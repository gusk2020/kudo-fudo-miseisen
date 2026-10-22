export type Vec = [number, number];
export const ISLAND_IDS = ["honshu", "hokkaido", "kyushu", "shikoku"] as const;
export type IslandId = (typeof ISLAND_IDS)[number];

/** Deformation operation. Centre/vector are in the island's local frame *after* the preceding ops. A dent is a bulge with k < 0. */
export type Op =
  | { t: "pull"; c: Vec; d: Vec; r: number }
  | { t: "bulge"; c: Vec; r: number; k: number };

export interface Place { pos: Vec; rot: number; scale: number }
export interface BodyState { ops: Op[]; place: Place }
export interface FeatureState { pos: Vec | null; rot: number; scale?: number; scaleY?: number; height?: number; auto?: true }   // Issue #15: scale = outline / body size (both). Stage 11: `scale` is the size along the feature's own x axis, `scaleY` along its y axis (absent = the same as `scale`: a uniform size, as in every older save); the stretch is axis-aligned in the feature's own frame and the rotation is applied after it, so the outline is never sheared., height = summit height (Fuji only); absent = 1 // pos null = follow Honshu's warp of the real position

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
  /** Stage 9: further strokes of each range (a range may be drawn in several strokes; `ridges` keeps the first). Absent on older saves. */
  ridgeExtra?: { sw: Vec[][]; ne: Vec[][] };
  /** Stage 10: the real Alps (北 = ne: 飛騨山脈, 南 = sw: 赤石山脈) levelled from the DEM, set the first time that range's tool is chosen. Absent on older saves. */
  alpsRemoved?: { ne?: true; sw?: true };
  /** Stage 10: the layers the player has switched by hand (their choice is never overridden by a later default, e.g. signs OFF after the ceremony). */
  layersSet?: string[];
  /** Stage 11: which map is shown, the road map or the terrain map -- chosen in the settings, kept with the game (a display choice: not part of the map hash). */
  bg?: "roadmap" | "terrain";
  finalized: boolean;
  /** Stage 3: the real Japan (no deformation, no drawn ridges). Set only by realState(); the hand-edited map flow never sets it. */
  real?: boolean;
  /** Issue #13: the five added islands (淡路・対馬・佐渡・壱岐・隠岐) are part of the land. Set only by realState(); older saves lack it, so their terrain stays exactly as it was. */
  islands?: boolean;
  /** Issue #13: id of the city chosen as the capital (default: 東京). A city/administration parameter, kept apart from the terrain. */
  capital?: string;
  /** Issue #15: the sub-capital (a prefecture id; must differ from the capital), and the Imperial Palace's prefecture and exact point. All are administrative settings. */
  subCapital?: string;
  palace?: string;
  palacePos?: Vec;
  /** Stage 19: the exact points of the capital and the sub-capital when they were chosen on the map (anywhere on the land of their prefecture); absent = the prefecture's 県庁所在地. Like palacePos, never terrain. */
  capitalPos?: Vec;
  subPos?: Vec;
  layers: Record<string, boolean>;
}

export type Severity = "error" | "warn";
export interface Issue { step: StepId; severity: Severity; code: string; msg: string; }
