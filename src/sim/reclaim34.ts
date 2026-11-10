/** Stage 34: islands under 30 km2 are enlarged where a seat of government is put, and a coastal capital / sub-capital reclaims land from the sea.
 *
 *  The map is a 5 km grid: one cell is 25 km2. Nothing smaller than a cell can be drawn, so two things are kept apart:
 *  - the BUDGET, an exact number of km2 (kept in integer half-km2 units, so no float drift), and
 *  - the TERRAIN, which only ever changes by whole cells, one cell the moment the budget holds 25 km2 (never one a year).
 *  The enlargement target is 30 km2 but the grid can only hold 25 or 50, so a one-cell island becomes two cells (50 km2): the effective area is always reported.
 *  Land is never joined to another land mass: a cell is added only if every land cell around it (all 8 neighbours) already belongs to the mass it grows.
 *  Everything that changed the land is recorded in an ordered log; a world is rebuilt from the terrain plus that log, so the same log always gives the same land. */
import { SUB2_SHARE } from "./subs36";
import type { Vec } from "../core/types";
import type { World } from "./world";
import { resetWorldCaches } from "./worldMemo";
import type { SimState } from "./types";
import { homeCity, subCity } from "./ceremony";
import { DEFAULT_CAPITAL, DEFAULT_SUB } from "../core/seat";
import type { SeatMove } from "./seatmove20";

export const MIN_ISLAND_KM2 = 30;                 // the nominal size an island under a seat is enlarged to
export const UNIT_KM2 = 0.5;                       // the budget is counted in these (5 km2 = 10 units, 0.5 km2 = 1 unit)
export const RATE_FIRST_KM2 = 5, RATE_SECOND_KM2 = 0.5, FIRST_YEARS = 50, SECOND_YEARS = 50;   // years 1-50, 51-100; none after
export const SEARCH_CELLS = 8;                     // a site fills the nearest shore within this many cells (40 km)
export const COASTAL_CELLS = 2;                    // a seat is coastal when open sea is within this many cells
export const RECLAIMED_ELEV_M = 4;
/** Stage 37 (C1): the first year automatic reclamation may happen in an 1800 game. */
export const RECLAIM_FROM_1800 = 1950;

export interface RecLog { k: number; kind: "grow" | "fill"; y: number; site?: number }
/** `epoch`: how many relocation events had moved this role when the site began. A move that lands on the same grid cell is still a move (the 5 km cell is coarser than the point the player chose), so the cell alone cannot tell it. */
export interface RecSite { role: "capital" | "sub" | "sub2"; epoch?: number; cell: number; start: number; last: number; accU: number; active: boolean; coastal: boolean; filled: number; blocked: number }
export interface Rec34 { sites: RecSite[]; log: RecLog[]; done: string[] }
export interface G34Input { log: RecLog[]; done: string[] }

/** Units of budget one calendar year adds, for the n-th year since the site began (n = 1, 2, ...). */
export const rateUnits = (n: number) => (n >= 1 && n <= FIRST_YEARS ? RATE_FIRST_KM2 / UNIT_KM2 : n > FIRST_YEARS && n <= FIRST_YEARS + SECOND_YEARS ? RATE_SECOND_KM2 / UNIT_KM2 : 0);
export const cellUnits = (cellKm: number) => (cellKm * cellKm) / UNIT_KM2;

interface Arrays { land: Uint8Array; island: Uint8Array; pref: Uint8Array; plains: Uint8Array; elev: Float32Array; nx: number; ny: number }
const N8: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]], N4: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** Puts one sea cell on the land: it takes the island, prefecture and flatness of its lowest-numbered land neighbour (a function of the state alone, so a replay gives the same cell). */
function addCell(a: Arrays, k: number): boolean {
  if (a.land[k] !== 0) return false; const i = k % a.nx, j = (k / a.nx) | 0; let src = -1;
  for (const [di, dj] of N4) { const x = i + di, y = j + dj; if (x < 0 || y < 0 || x >= a.nx || y >= a.ny) continue; const q = y * a.nx + x; if (a.land[q] === 1 && (src < 0 || q < src)) src = q; }
  if (src < 0) return false; a.land[k] = 1; a.island[k] = a.island[src]; a.pref[k] = a.pref[src]; a.plains[k] = 1; a.elev[k] = RECLAIMED_ELEV_M; return true;
}
/** The legal cell nearest to (ci, cj) within `reach` cells: open sea, next to the mass on a side, and no land of any OTHER mass in its 8 neighbours. `mine` says whether a land cell belongs to the mass being grown. */
function pickCell(a: Arrays, ci: number, cj: number, reach: number, mine: (k: number) => boolean): number {
  let best = -1, bd = Infinity;
  for (let dj = -reach; dj <= reach; dj++) for (let di = -reach; di <= reach; di++) {
    const x = ci + di, y = cj + dj; if (x < 1 || y < 1 || x >= a.nx - 1 || y >= a.ny - 1) continue; const k = y * a.nx + x; if (a.land[k] !== 0) continue;
    let side = false, ok = true;
    for (const [dx, dy] of N8) { const q = (y + dy) * a.nx + x + dx; if (a.land[q] !== 1) continue; if (!mine(q)) { ok = false; break; } }
    if (!ok) continue; for (const [dx, dy] of N4) if (a.land[(y + dy) * a.nx + x + dx] === 1) side = true; if (!side) continue;
    const d = Math.hypot(di, dj); if (d < bd - 1e-9 || (Math.abs(d - bd) <= 1e-9 && k < best)) { bd = d; best = k; }
  }
  return best;
}
function component(a: Arrays, k0: number): Set<number> {   // the 8-connected land of one island number, as lm is built
  const out = new Set<number>([k0]), st = [k0];
  while (st.length) { const c = st.pop()!, i = c % a.nx, j = (c / a.nx) | 0; for (const [di, dj] of N8) { const x = i + di, y = j + dj; if (x < 0 || y < 0 || x >= a.nx || y >= a.ny) continue; const q = y * a.nx + x; if (a.land[q] === 1 && !out.has(q) && a.island[q] === a.island[c]) { out.add(q); st.push(q); } } }
  return out;
}
const seatKey = (m: SeatMove) => `${m.by}:${m.pref}:${m.pos[0].toFixed(1)},${m.pos[1].toFixed(1)}`;

export interface TerrainLike { land: Uint8Array; island: Uint8Array; pref: Uint8Array; plains: Uint8Array; elev: Float32Array; grid: { x0: number; y0: number; cell: number; nx: number; ny: number } }
/** Build time: replays the log onto copies of the land arrays, then enlarges the island of every seat in `moves` not seen before. Returns the arrays and what was newly decided. */
export function applyG34<T extends TerrainLike>(t: T, input: G34Input, moves: SeatMove[]): { t: T; add: G34Input; grown: { key: string; role: string; from: number; to: number; cells: number }[] } {
  const { nx, ny, cell, x0, y0 } = t.grid, a: Arrays = { land: t.land.slice(), island: t.island.slice(), pref: t.pref.slice(), plains: t.plains.slice(), elev: t.elev.slice(), nx, ny };
  for (const e of input.log) addCell(a, e.k);
  const add: G34Input = { log: [], done: [] }, grown: { key: string; role: string; from: number; to: number; cells: number }[] = [];
  for (const m of moves) {
    const key = seatKey(m); if (input.done.includes(key) || add.done.includes(key)) continue; add.done.push(key);
    let i = Math.floor((m.pos[0] - x0) / cell), j = Math.floor((m.pos[1] - y0) / cell); if (i < 0 || j < 0 || i >= nx || j >= ny) continue;
    let k = j * nx + i; if (a.land[k] !== 1) { let bd = Infinity, bk = -1; for (let dj = -4; dj <= 4; dj++) for (let di = -4; di <= 4; di++) { const x = i + di, y = j + dj; if (x < 0 || y < 0 || x >= nx || y >= ny || a.land[y * nx + x] !== 1) continue; const d = Math.hypot(di, dj); if (d < bd) { bd = d; bk = y * nx + x; } } if (bk < 0) continue; k = bk; i = k % nx; j = (k / nx) | 0; }
    const own = component(a, k), from = own.size; let guard = 0;
    while (own.size * cell * cell < MIN_ISLAND_KM2 && guard++ < 50) {
      const c = pickCell(a, i, j, 3, (q) => own.has(q)); if (c < 0) break; addCell(a, c); own.add(c); add.log.push({ k: c, kind: "grow", y: (m as { since?: number }).since ?? 0 });
    }
    if (own.size !== from) grown.push({ key, role: m.by, from: from * cell * cell, to: own.size * cell * cell, cells: own.size - from });
  }
  return { t: { ...t, land: a.land, island: a.island, pref: a.pref, plains: a.plains, elev: a.elev }, add, grown };
}

/** The relocation events (finished or open) that moved this role: kept (現状維持) events and events that left the seat alone do not count. */
export const movesOf = (sim: SimState, role: "capital" | "sub" | "sub2"): number => [...(sim.e2200hist ?? []), ...(sim.e2200 ? [sim.e2200] : [])].filter((e) => e.moved?.includes(role)).length;
const seatCellOf = (sim: SimState, w: World, role: "capital" | "sub" | "sub2"): number => {
  const cap = sim.capital ?? DEFAULT_CAPITAL;
  if (role === "sub2") { const c2 = sim.subCapital2 ? subCity(w, sim.subCapital2) : null; return c2 ? c2.cell : -1; }   // Stage 36 M3
  const c = role === "capital" ? homeCity(w, cap) : subCity(w, sim.subCapital ?? (cap === DEFAULT_SUB ? DEFAULT_CAPITAL : DEFAULT_SUB));
  return c ? c.cell : -1;
};
function isCoastal(w: World, k: number): boolean { const i = k % w.nx, j = (k / w.nx) | 0; for (let dj = -COASTAL_CELLS; dj <= COASTAL_CELLS; dj++) for (let di = -COASTAL_CELLS; di <= COASTAL_CELLS; di++) { const x = i + di, y = j + dj; if (x < 0 || y < 0 || x >= w.nx || y >= w.ny) continue; if (w.t.land[y * w.nx + x] === 0) return true; } return false; }

/** Once a year: starts a site for a seat that has none (a moved seat ends the old site's schedule and starts a new one; the old land stays), adds the year's budget, and turns whole cells' worth into land. Returns the cells added. */
export function stepReclaim(sim: SimState, w: World, y: number): number[] {
  const rec = sim.rec34; if (!rec || !w.g34) return [];
  for (const role of (sim.subCapital2 ? ["capital", "sub", "sub2"] : ["capital", "sub"]) as ("capital" | "sub" | "sub2")[]) {
    const cell = seatCellOf(sim, w, role); if (cell < 0) continue; const cur = rec.sites.find((s) => s.role === role && s.active);
    const ep = movesOf(sim, role); if (cur && cur.epoch === undefined) cur.epoch = ep;   // (a site saved before epochs existed is taken to be current)
    if (cur && cur.cell === cell && cur.epoch === ep) continue; if (cur) cur.active = false;
    rec.sites.push({ role, epoch: ep, cell, start: y, last: y, accU: 0, active: true, coastal: isCoastal(w, cell), filled: 0, blocked: 0 });
  }
  const a: Arrays = { land: w.t.land, island: w.t.island, pref: w.t.pref, plains: w.t.plains, elev: w.t.elev, nx: w.nx, ny: w.ny }, added: number[] = [], CU = cellUnits(w.cell);
  rec.sites.forEach((s, si) => {
    if (!s.active) return;
    const share = sim.subCapital2 && s.role !== "capital" ? SUB2_SHARE : 1;   // Stage 36 M3: with two sub-capitals each reclaims at 0.7x
    // Stage 37 (C1): in an 1800 game nothing is reclaimed from the sea by itself before 1950 (the enlargement of a tiny island under a seat is a separate thing and is untouched); the 100 years of reclamation then count from 1950
    const from = sim.rules1800 ? Math.max(s.start, RECLAIM_FROM_1800 - 1) : s.start;
    while (s.last < y) { s.last++; if (s.coastal && (!sim.rules1800 || s.last >= RECLAIM_FROM_1800)) s.accU += rateUnits(s.last - from) * share; }
    const lm0 = w.lm[s.cell], ci = s.cell % w.nx, cj = (s.cell / w.nx) | 0;
    while (s.accU >= CU) {
      const c = pickCell(a, ci, cj, SEARCH_CELLS, (q) => w.lm[q] === lm0);
      if (c < 0) { s.blocked++; break; }   // no legal shore: the budget is kept and tried again next year (it is never spent on land that would join two masses)
      addCell(a, c); w.lm[c] = lm0; s.accU -= CU; s.filled++; rec.log.push({ k: c, kind: "fill", y, site: si }); added.push(c);
    }
  });
  if (added.length) resetWorldCaches(w);
  return added;
}

export interface RecReport { role: "capital" | "sub" | "sub2"; active: boolean; coastal: boolean; years: number; budgetKm2: number; filledCells: number; filledKm2: number; blocked: number }
/** What the panel shows: the budget (exact km2) next to what the grid has actually received (whole cells, 25 km2 each). */
export function reclaimReport(sim: SimState, cellKm = 5): RecReport[] {
  return (sim.rec34?.sites ?? []).map((s) => ({ role: s.role, active: s.active, coastal: s.coastal, years: s.last - s.start, budgetKm2: s.accU * UNIT_KM2, filledCells: s.filled, filledKm2: s.filled * cellKm * cellKm, blocked: s.blocked }));
}
export type { Vec };
