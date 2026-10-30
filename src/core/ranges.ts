/**
 * Stage 30A: the major mountain ranges that can be raised or worn down in the terrain editor, one or two for each regional block of Japan.
 * Each is a rough crest line (lon/lat, not survey data -- the same standing as REAL_ALPS) with the half-width of its core (fully affected) and of its edge (blended back to the surrounding ground).
 * A range's edit is one number, `rangeEdits[id]`: the factor on its RELIEF above the plain-equivalent ground. 1 = as the DEM has it (and is stored as nothing), 0 = worn to plain, 2 = twice as high.
 * Adding a range is adding a row here; nothing else needs to know how many there are.
 */
import { realToWorld } from "./body";
import { JAPAN } from "./data";
import { pointSegDist } from "./geom";
import type { IslandId, ProjectState, Vec } from "./types";

export interface RangeDef { id: string; name: string; block: string; island: IslandId; line: [number, number][]; core: number; edge: number }
export const RANGES: RangeDef[] = [
  { id: "hidaka", name: "日高山脈", block: "北海道", island: "hokkaido", line: [[143.20, 41.95], [143.00, 42.35], [142.85, 42.80], [142.75, 43.30]], core: 14, edge: 34 },
  { id: "ou", name: "奥羽山脈", block: "東北", island: "honshu", line: [[140.88, 40.62], [140.72, 39.90], [140.45, 39.05], [140.15, 38.25], [139.92, 37.55], [139.90, 37.12]], core: 14, edge: 36 },
  { id: "kanto", name: "関東山地", block: "関東", island: "honshu", line: [[139.30, 35.82], [138.85, 35.95], [138.50, 36.02], [138.30, 36.10]], core: 12, edge: 30 },
  { id: "hida", name: "北アルプス(飛騨山脈)", block: "中部", island: "honshu", line: [[137.70, 36.95], [137.76, 36.76], [137.62, 36.58], [137.65, 36.34], [137.55, 36.11], [137.52, 36.0]], core: 12, edge: 30 },
  { id: "kiso", name: "中央アルプス(木曽山脈)", block: "中部", island: "honshu", line: [[137.90, 36.05], [137.80, 35.80], [137.65, 35.50]], core: 8, edge: 24 },
  { id: "akaishi", name: "南アルプス(赤石山脈)", block: "中部", island: "honshu", line: [[138.24, 35.80], [138.23, 35.78], [138.24, 35.67], [138.10, 35.60], [138.14, 35.45], [138.10, 35.33], [138.06, 35.22]], core: 10, edge: 28 },
  { id: "kii", name: "紀伊山地", block: "近畿", island: "honshu", line: [[135.60, 34.32], [135.85, 34.20], [136.05, 34.02]], core: 12, edge: 30 },
  { id: "chugoku", name: "中国山地", block: "中国", island: "honshu", line: [[132.20, 34.85], [133.00, 35.10], [133.55, 35.30], [134.30, 35.35]], core: 12, edge: 32 },
  { id: "shikoku", name: "四国山地", block: "四国", island: "shikoku", line: [[132.85, 33.72], [133.45, 33.78], [134.10, 33.85]], core: 10, edge: 28 },
  { id: "kyushu", name: "九州山地", block: "九州", island: "kyushu", line: [[131.40, 33.10], [131.30, 32.60], [131.00, 32.20]], core: 12, edge: 30 },
];
/** The factor on a range's relief: 0 (worn to plain) .. 2 (twice as high), in steps of 0.1 -- additive, because a multiplicative step could never reach 0, the plain. (Fuji's height steps are ×1.1 within 0.5..1.3.) */
export const RANGE_LIMITS: [number, number] = [0, 2];
export const RANGE_STEP = 0.1;
export const RANGE_MAX_M = 4900;   // = Fuji's tallest (3776 m x 1.3): an amplified range never passes the highest ground the game already allows
export const clampRange = (v: number) => Math.round(Math.max(RANGE_LIMITS[0], Math.min(RANGE_LIMITS[1], v)) * 10) / 10;
export const rangeFactor = (edits: Record<string, number> | undefined, id: string) => (edits && Number.isFinite(edits[id]) ? clampRange(edits[id]) : 1);
export const rangeById = (id: string) => RANGES.find((r) => r.id === id);
/** Keeps only known ranges with a factor that differs from 1 (what is stored, hashed and saved). */
export function cleanRangeEdits(raw: unknown): Record<string, number> | undefined {
  if (!raw || typeof raw !== "object") return undefined; const out: Record<string, number> = {};
  for (const r of RANGES) { const v = (raw as Record<string, unknown>)[r.id]; if (typeof v === "number" && Number.isFinite(v)) { const c = clampRange(v); if (c !== 1) out[r.id] = c; } }
  return Object.keys(out).length ? out : undefined;
}

/** The crest line in world (km) coordinates, following the island's own placement. */
export const rangeWorldLine = (s: ProjectState, r: RangeDef): Vec[] => r.line.map(([lon, lat]) => realToWorld(r.island, s.bodies[r.island], [(lon - JAPAN.proj.lon0) * JAPAN.proj.kmPerDegLon, (lat - JAPAN.proj.lat0) * JAPAN.proj.kmPerDegLat]));
/** The nearest range whose crest is within `tol` km of w (its core counts as distance 0), or null. */
export function rangeAt(s: ProjectState, w: Vec, tol: number): RangeDef | null {
  let best: RangeDef | null = null, bd = Infinity;
  for (const r of RANGES) { const pts = rangeWorldLine(s, r); let d = Infinity; for (let q = 0; q + 1 < pts.length; q++) d = Math.min(d, pointSegDist(w, pts[q], pts[q + 1])); d = Math.max(0, d - r.core); if (d < tol && d < bd) { bd = d; best = r; } }
  return best;
}
