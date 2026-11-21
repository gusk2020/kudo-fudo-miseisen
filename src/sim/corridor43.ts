/**
 * Stage 43 (A2): mountain corridors do not fill up with parallel roads.
 * The owner's 4800-year game laid road after road side by side over the 群馬〜新潟 mountains. In a game made with `sim.s43`, a NEW road (a new line, a bypass, a shortcut) whose way runs
 * through mountains (MOUNTAIN_M and above) is first checked (±22 km: on the 5 km grid two roads need a free cell between them to count as two, so a narrower transect could never see three) against what already crosses the same mountains: across the new way, at several points in its mountain stretch, a transect of
 * ±CORRIDOR_HALF_KM is drawn perpendicular to it and the separate roads it cuts are counted (a run of road cells is one road). If the typical count (median over the points) is already
 * CORRIDOR_MAX, the corridor is full: no new road is laid there (a bypass becomes an improvement of the road that exists instead). An expressway may still be the one more when none of the
 * corridor's roads is one (a road of a different kind is not a duplicate). Plains are never checked, so the busy, many-roaded lowlands stay as they were; upgrading and restoring a road is not
 * "new" and is never blocked. No place is named; the corridor is whatever the terrain and the roads make it.
 */
import { MTN_RIDGE_MIN, type World } from "./world";
import { modeOf, type SimState, type Standard } from "./types";

export const CORRIDOR_MAX = 3, CORRIDOR_HALF_KM = 22, CORRIDOR_EVERY = 3, CORRIDOR_MIN_SAMPLES = 2, MOUNTAIN_M = 500;
/** A mountain cell: a drawn range's ridge zone above MOUNTAIN_M, or (worlds without ranges) high ground. */
export const isMountainCell = (w: World, k: number): boolean => w.elevM(k) >= MOUNTAIN_M || (!!w.t.barrier && w.t.barrier[k] > MTN_RIDGE_MIN && w.elevM(k) >= MOUNTAIN_M * 0.6);   // (the real map has no drawn ranges: height decides; a drawn range counts from lower down)
const memo = new WeakMap<SimState, { key: string; cells: Map<number, boolean> }>();
/** The cells of the roads that exist or are being built (not the lost or closed ones): cell -> is an expressway there. */
function liveRoadCells(sim: SimState): Map<number, boolean> {
  const key = `${sim.month}:${sim.next.edge}`, m = memo.get(sim); if (m && m.key === key) return m.cells;
  const cells = new Map<number, boolean>();
  for (const e of Object.values(sim.edges)) {
    if (modeOf(e) !== "road" || e.facility === "ferry" || e.state === "lost" || e.state === "closed" && e.built >= 1) continue;
    const hg = e.standard === "highgrade"; for (const k of e.cells) if (hg || !cells.has(k)) cells.set(k, hg || (cells.get(k) ?? false));
  }
  memo.set(sim, { key, cells }); return cells;
}
export interface CorridorCount { samples: number; median: number; highgrade: boolean }
/** How many separate roads already cross the mountain stretch of this grid path (median over transects), and whether one of them is an expressway. */
export function corridorCount(sim: SimState, w: World, path: number[], newOnly = true): CorridorCount {
  const roads = liveRoadCells(sim), own = new Set(path), counts: number[] = []; let highgrade = false;
  for (let i = 2; i < path.length - 2; i += CORRIDOR_EVERY) {
    if (!isMountainCell(w, path[i]) || (newOnly && roads.has(path[i]))) continue;   // (only where the way is NEW and in the mountains: a stretch that rides an existing road adds no road)
    const p = w.cellPos(path[i - 2]), q = w.cellPos(path[i + 2]), dx = q[0] - p[0], dy = q[1] - p[1], L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L, c = w.cellPos(path[i]);
    let n = 0, inRoad = false; const step = w.cell / 2;
    for (let t = -CORRIDOR_HALF_KM; t <= CORRIDOR_HALF_KM; t += step) {
      const k = w.cellOf([c[0] + nx * t, c[1] + ny * t]); const r = k >= 0 && !own.has(k) && roads.has(k);
      if (r && !inRoad) { n++; if (roads.get(k)) highgrade = true; } inRoad = r;
    }
    counts.push(n);
  }
  counts.sort((a, b) => a - b);
  return { samples: counts.length, median: counts.length ? counts[counts.length >> 1] : 0, highgrade };
}
/** Is the mountain corridor this new road would use already full (`sim.s43` games only)? `standard` = the kind of road to be built. */
export function corridorFull(sim: SimState, w: World, path: number[], standard: Standard): boolean {
  if (!sim.s43 || path.length < 6) return false;
  const c = corridorCount(sim, w, path); if (c.samples < CORRIDOR_MIN_SAMPLES || c.median < CORRIDOR_MAX) return false;
  return !(standard === "highgrade" && !c.highgrade);   // (an expressway may be the one more where the corridor has none)
}
