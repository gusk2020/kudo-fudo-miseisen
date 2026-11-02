/**
 * Stage 33: mountains and lakes the player creates on plain ground, and the lake form of a mountain range.
 * Units (the world grid is 5 km, `cell`): each press adds 500 m of height (mountain) or 5 km of diameter (lake), up to 3 presses (1500 m / 15 km). A mountain's nominal diameter is 10 x its height
 * (500 m -> 5 km, 1000 m -> 10 km, 1500 m -> 15 km), the same as the lake's. On a 5 km grid that is 1, 3 and 7 cells (area 25 / 75 / 175 km2 against the nominal 19.6 / 78.5 / 176.7 km2):
 * the shape is a blob of whole cells with an irregular outline and the nearest whole number of cells for the nominal area -- the nearest representable value, not an exact one.
 */
import { pointInPolygon } from "./geom";
import { fbm } from "./rng";
import { JAPAN } from "./data";
import { rangeFactor, rangeWorldLine, RANGES } from "./ranges";
import { pointSegDist } from "./geom";
import { FUJI_RADIUS_KM, featureShape } from "./validate";
import { realToWorld } from "./body";
import type { ProjectState, Vec } from "./types";

export type CreationKind = "mountain" | "lake";
export interface Creation { id: number; kind: CreationKind; pos: Vec; level: number }
export const CREATION_MAX_LEVEL = 3, MOUNTAIN_STEP_M = 500, DIAMETER_PER_M = 10, LAKE_STEP_KM = 5, PLAIN_MAX_M = 250, MAX_CREATIONS = 12;
export const creationHeightM = (level: number) => MOUNTAIN_STEP_M * level;
export const creationDiameterKm = (kind: CreationKind, level: number) => (kind === "mountain" ? (creationHeightM(level) * DIAMETER_PER_M) / 1000 : LAKE_STEP_KM * level);
export const clampLevel = (v: number) => Math.max(1, Math.min(CREATION_MAX_LEVEL, Math.round(v)));
/** The cell count for the nominal area, at least one. */
export const creationCells = (kind: CreationKind, level: number, cell: number) => Math.max(1, Math.round((Math.PI * (creationDiameterKm(kind, level) / 2) ** 2) / (cell * cell)));
export const cleanCreations = (raw: unknown): Creation[] | undefined => {
  if (!Array.isArray(raw)) return undefined; const out: Creation[] = [];
  for (const c of raw.slice(0, MAX_CREATIONS)) if (c && typeof c === "object" && Number.isInteger((c as any).id) && ((c as any).kind === "mountain" || (c as any).kind === "lake") && Array.isArray((c as any).pos) && (c as any).pos.length === 2 && (c as any).pos.every(Number.isFinite) && Number.isFinite((c as any).level)) out.push({ id: (c as any).id, kind: (c as any).kind, pos: [(c as any).pos[0], (c as any).pos[1]], level: clampLevel((c as any).level) });
  return out.length ? out : undefined;
};

export interface Grid { nx: number; ny: number; cell: number; x0: number; y0: number }
/**
 * The cells of one creation: `n` whole cells around the centre cell, chosen by distance scaled with a smooth, seeded function of the bearing (so the outline is irregular and the same every time).
 * Returns the cell indices (centre first) with a 0..1 "depth" for each (0 = centre, 1 = rim).
 */
export function creationFootprint(g: Grid, c: Creation, seed: number): { k: number; d: number }[] {
  const ci = Math.floor((c.pos[0] - g.x0) / g.cell), cj = Math.floor((c.pos[1] - g.y0) / g.cell); if (ci < 0 || cj < 0 || ci >= g.nx || cj >= g.ny) return [];
  const n = creationCells(c.kind, c.level, g.cell), r = creationDiameterKm(c.kind, c.level) / 2, ph = [fbm(seed + c.id, 1, 1) * 6.28, fbm(seed + c.id, 2, 2) * 6.28, fbm(seed + c.id, 3, 3) * 6.28];
  const reach = Math.ceil((2.2 * r) / g.cell) + 1, cand: { k: number; s: number }[] = [];
  for (let dj = -reach; dj <= reach; dj++) for (let di = -reach; di <= reach; di++) {
    const i = ci + di, j = cj + dj; if (i < 0 || j < 0 || i >= g.nx || j >= g.ny) continue;
    const dx = di * g.cell, dy = dj * g.cell, d = Math.hypot(dx, dy), a = Math.atan2(dy, dx), wob = 1 + 0.28 * Math.sin(2 * a + ph[0]) + 0.2 * Math.sin(3 * a + ph[1]) + 0.12 * Math.sin(5 * a + ph[2]);
    cand.push({ k: j * g.nx + i, s: d === 0 ? -1 : d / Math.max(0.4, wob) });
  }
  cand.sort((p, q) => p.s - q.s || p.k - q.k); const take = cand.slice(0, n), mx = Math.max(1e-9, take[take.length - 1].s);
  return take.map((t) => ({ k: t.k, d: t.s < 0 ? 0 : Math.min(1, t.s / (mx * 1.01)) }));
}

/** Where a new mountain or lake may NOT be centred, besides sea, lakes, mountains and high ground: the former sites of a moved Fuji / Biwa and the zones of ranges that were flattened (x0). Returns the reason, or null. */
export function excludedSite(s: ProjectState, p: Vec): string | null {
  if (!s.real) return null; const f = s.features;
  const fujiEdited = !!(f.fuji.pos || f.fuji.scale !== undefined || f.fuji.scaleY !== undefined || f.fuji.height !== undefined), biwaEdited = !!(f.biwa.pos || f.biwa.scale !== undefined || f.biwa.scaleY !== undefined);
  if (fujiEdited) { const o = realToWorld("honshu", s.bodies.honshu, JAPAN.fuji.center); if (Math.hypot(p[0] - o[0], p[1] - o[1]) < FUJI_RADIUS_KM * 1.7) return "もとの富士山があった場所には作れません"; }
  if (biwaEdited) { const o = realToWorld("honshu", s.bodies.honshu, JAPAN.biwa.center), poly = featureShape("biwa").map((q) => [q[0] + o[0], q[1] + o[1]] as Vec); if (pointInPolygon(p, poly)) return "もとの琵琶湖があった場所には作れません"; }
  for (const r of RANGES) if (rangeFactor(s.rangeEdits, r.id) <= 0) { const pts = rangeWorldLine(s, r); let d = Infinity; for (let q = 0; q + 1 < pts.length; q++) d = Math.min(d, pointSegDist(p, pts[q], pts[q + 1])); if (d < r.edge) return `平らにした${r.name}の場所には作れません`; }
  return null;
}
