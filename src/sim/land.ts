/**
 * Stage 12 (Issue #30, #31): the land as the base of the whole economy -- ONE terrain evaluation, read by every place that builds, keeps or closes a line
 * and by every city. Only games from Stage 12 on use it (`w.land12`); older saves keep exactly the rules they were made with.
 *
 *   hardness   what a cell asks of a builder, on top of ordinary earthwork: the drawn-range / Fuji barrier field times height (mountainBarrier, Stage 9/11).
 *   run        a stretch of consecutive cells at or above H_TUNNEL is not something a road can climb: it has to be a TUNNEL, and a tunnel cannot be longer than
 *              the year's technology can dig (techAt().tunnelKm). A line whose run is longer is not rejected for being dear -- it cannot be built at all, yet.
 *   cost       a line's construction multiplier is what an engineer would add up, not a smooth curve of height:
 *                - open ground: 1 + 0.25 x hardness (cut and fill, retaining walls on the steep ground of a range's foot),
 *                - a tunnel: TUNNEL_UNIT x (1 + L/TUNNEL_LEN_KM)^0.8 per km -- the price of a tunnel is mostly drilling, ventilation and safety, so it does not
 *                  keep growing with the height of the mountain above it, but it does grow faster than its length (longer = more shafts, more air, harder rescue);
 *                  technology cuts it (techAt().costMult) but never to the cost of open ground.
 *   upkeep     the same ground costs more to keep: landslides, snow, drainage and tunnel ventilation (UPKEEP_*), so a mountain line must earn its keep.
 *   site       how much of the land around a city can be built on (flat, low, outside a range): its CAPACITY. A city whose land is far worse than that of
 *              any real city (SITE_REF_KM2) is squeezed -- fewer people at the start and a lower ceiling, the rest settle on the better land nearby.
 * Nothing here knows a place name: every number is read from the cell grid.
 */
import { MTN_RIDGE_MIN, mountainBarrier, type World, type WCity } from "./world";
import { techAt, TUNNEL_KM, facilityCostMult, type TechState } from "./tech";
import type { Mode } from "./types";

/** A cell this hard can only be crossed in a tunnel. (Cost multiplier 5: a ridge at 0.5 closeness and about 1,300 m, or the core of a 1,000 m range.) */
export const H_TUNNEL = 5;
export const TUNNEL_UNIT: Record<Mode, number> = { road: 5, rail: 7 }, TUNNEL_LEN_KM = 25, TUNNEL_POW = 0.8;
/** How much of its hardness an open (not tunnelled) cell adds to the cost of a km. */
export const OPEN_K = 0.8;
export const UPKEEP_OPEN = 0.12, UPKEEP_TUNNEL = 1.6, UPKEEP_CAP = 6;
/** The share of a tunnel's cost technology can never remove (shafts, ventilation, rock). */
export const TUNNEL_COST_FLOOR = 0.45;

export const hardnessAt = (w: World, k: number): number => (w.t.barrier[k] > MTN_RIDGE_MIN ? mountainBarrier(w.t.barrier[k], w.t.elev[k]) : 0);

export interface Burden { ok: boolean; costMult: number; runKm: number; tunnelKm: number; openHard: number; n: number }
/** The longest tunnel this game's technology can dig in year `y` (km). The older games without a tech rule get the 1950 figure. */
export const tunnelLimitKm = (tech: TechState | undefined, y: number): number => (tech ? techAt(tech.k, y).tunnelKm : TUNNEL_KM[0][1]);
/** What a path of grid cells asks of a builder (see the file comment). `limitKm` = the longest tunnel allowed (Infinity = report only). */
export function routeBurden(w: World, mode: Mode, cells: ArrayLike<number>, limitKm = Infinity, techCost = 1): Burden {
  const n = cells.length; if (!n) return { ok: true, costMult: 1, runKm: 0, tunnelKm: 0, openHard: 0, n: 0 };
  let extra = 0, run = 0, maxRun = 0, tun = 0, openHard = 0;
  const flush = () => { if (run > 0) { const L = run * w.cell; extra += run * TUNNEL_UNIT[mode] * Math.pow(1 + L / TUNNEL_LEN_KM, TUNNEL_POW) * Math.max(TUNNEL_COST_FLOOR, techCost); tun += L; if (run > maxRun) maxRun = run; run = 0; } };
  for (let i = 0; i < n; i++) {
    const h = hardnessAt(w, cells[i]);
    if (h >= H_TUNNEL) run++; else { flush(); if (h > 0) { extra += OPEN_K * h; openHard += h; } }
  }
  flush();
  const runKm = maxRun * w.cell;
  return { ok: runKm <= limitKm + 1e-9, costMult: 1 + extra / n, runKm, tunnelKm: tun, openHard, n };
}
/** Construction multiplier for the games that use it: the whole path, technology of year `y` taken off the tunnel part. */
/** (technology already cuts a tunnel edge's price through facCost, so it is not taken off twice here) */
export const burdenCost = (w: World, _sim: { tech?: TechState }, mode: Mode, cells: ArrayLike<number>, _y: number): number => routeBurden(w, mode, cells, Infinity, 1).costMult;
/** The gate every planner asks: can this path be built with this year's technology? */
export function terrainGate(w: World, sim: { tech?: TechState }, mode: Mode, cells: ArrayLike<number>, y: number): Burden {
  return routeBurden(w, mode, cells, tunnelLimitKm(sim.tech, y), facilityCostMult(sim.tech, y));
}

const upkeepMemo = new WeakMap<object, number>();
/** Yearly upkeep multiplier of a built edge (>= 1): open mountain ground and tunnels cost more to keep. Memoised per edge object (its cells never change). */
export function upkeepMult(w: World, e: { cells: number[]; facility?: string }): number {
  if (!w.land12) return 1; const m = upkeepMemo.get(e); if (m !== undefined) return m;
  let s = 0; for (const k of e.cells) { const h = hardnessAt(w, k); if (h > 0) s += h >= H_TUNNEL ? UPKEEP_TUNNEL : UPKEEP_OPEN * h; }
  const v = Math.min(UPKEEP_CAP, 1 + s / Math.max(1, e.cells.length)); upkeepMemo.set(e, v); return v;
}

// ---- the sites of cities ----
/** Slope in percent, the steepest of the four neighbours. */
const slopeMemo = new WeakMap<World, Float32Array>();
/** Memoised per world (the terrain never changes within a game). */
export function slopeOf(w: World): Float32Array { let m = slopeMemo.get(w); if (!m) { m = slopeField(w); slopeMemo.set(w, m); } return m; }
function slopeField(w: World): Float32Array {
  const { nx, ny, cell, t } = w, out = new Float32Array(w.N);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i; let m = 0; const e = t.elev[k];
    if (i > 0) m = Math.max(m, Math.abs(e - t.elev[k - 1])); if (i + 1 < nx) m = Math.max(m, Math.abs(e - t.elev[k + 1]));
    if (j > 0) m = Math.max(m, Math.abs(e - t.elev[k - nx])); if (j + 1 < ny) m = Math.max(m, Math.abs(e - t.elev[k + nx]));
    out[k] = (m / (cell * 1000)) * 100;
  }
  return out;
}
/** Buildable share of one land cell, 0..1: flat enough (the cut-and-fill limit is about 15 %), low enough, and outside a range. */
export function suitability(slopePct: number, elevM: number, barrier: number, elevOfRange: number): number {
  const flat = Math.max(0, 1 - slopePct / 15), low = elevM <= 300 ? 1 : Math.max(0, 1 - (elevM - 300) / 1200), range = barrier > MTN_RIDGE_MIN ? 1 / (1 + mountainBarrier(barrier, elevOfRange) / 2) : 1;
  return flat * low * range;
}
const SITE_RADIUS_CELLS = 4;
/** Share of the land around a city (cells within SITE_RADIUS_CELLS) that can be built on, weighted by suitability. A small island of flat ground scores 1: the sea is not the terrain's doing. */
export const SITE_REF = 0.3;   // the poorest real sites (basin cities between mountain ranges) score about this, so only a site worse than any real city's is squeezed
const siteMemo = new WeakMap<World, Map<string, number>>();
export function siteQuality(w: World, c: WCity): number {
  let m = siteMemo.get(w); if (!m) {
    m = new Map(); const sl = slopeField(w), { nx, ny, t } = w, R = SITE_RADIUS_CELLS;
    for (const q of w.cities) {
      const ci = q.cell % nx, cj = (q.cell / nx) | 0; let s = 0, n = 0;
      for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) {
        if (di * di + dj * dj > R * R + 1) continue; const a = ci + di, b = cj + dj; if (a < 0 || b < 0 || a >= nx || b >= ny) continue;
        const k = b * nx + a; if (t.land[k] !== 1) continue; n++; s += suitability(sl[k], t.elev[k], t.barrier[k], t.elev[k]);
      }
      m.set(q.id, n ? s / n : 0);
    }
    siteMemo.set(w, m);
  }
  return m.get(c.id) ?? 0;
}
/** 0.15..1: how much of its real size a city can keep on the land it has in this game. 1 for any city on land as good as a real city's. */
export function siteCapacity(w: World, c: WCity): number { return Math.max(0.15, Math.min(1, siteQuality(w, c) / SITE_REF)); }
