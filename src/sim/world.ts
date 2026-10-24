/** Static, derived-from-the-map context for the simulation. Rebuilt on load; never saved. */
import { MinHeap } from "../core/heap";
import { EXTRA, JAPAN, TOWNS, lonLatToReal } from "../core/data";
import { mulberry32 } from "../core/rng";
import type { TerrainResult } from "../core/terrain";
import type { Vec } from "../core/types";
import { withIslets, type IsletCell } from "./islands20";
import { applySeatMoves, PEOPLE_PER_KM2, type MoveResult, type SeatMove } from "./seatmove20";

export interface WCity { id: string; name: string; cell: number; pos: Vec; pref: string | null; island: number; pop0: number; popSource: "ne" | "synthetic"; coastal: boolean; plains: number; kind: string; /** Stage 20: the city was the prefecture's 県庁所在地 before a seat was put elsewhere (it keeps its people) */ former?: true; /** Stage 20: the seat role whose point made this city the 県庁所在地 */ moved?: "capital" | "sub" | "palace"; /** Stage 20: the most people the place can hold (a small island); absent = no limit */ capPop?: number }
export interface World {
  t: TerrainResult; nx: number; ny: number; cell: number; N: number;
  cities: WCity[]; cityById: Map<string, WCity>; cityByCell: Map<number, WCity>;
  river: Uint8Array; cellPos(k: number): Vec; cellOf(p: Vec): number;
  elevM(k: number): number; prefOf(k: number): string | null;
  /** Land mass id per cell (1..lmCount; 0 = sea or lake). A mass is a connected piece of land with ONE island number, so Honshu and Kyushu (touching on the 5 km grid at Kanmon) and Okinawa (which shares Kyushu's island number) are all different masses: exactly the pieces a road cannot join without a crossing. */
  lm: Uint16Array; lmCount: number;
  /** Stage 9: drawn ranges are a construction barrier (games on the real map). Older hand-drawn-map games keep the cost they always had. */
  barrier?: boolean;
  /** Stage 12: the games that evaluate the land as the base of the economy (land.ts): tunnel limits, nonlinear costs, upkeep, city sites. */
  land12?: boolean;
  /** Stage 16: the world carries the provincial towns (src/data/towns.json) after the 55 cities. A game made from Stage 16 on is built on such a world and records it (`sim.towns16`); older games never see them. */
  hasTowns?: true;
  /** The ids of the towns this world carries (in `cities` after the 55 cities), recorded in the game as `sim.towns16`. */
  townIds?: string[];
  /** Stage 20: the small and far islands (the grid is widened to hold them); recorded in the game as `sim.isl20`. */
  islets?: IsletCell[];
  /** Stage 20: what the seat points put on the map did to the 県庁所在地 (recorded in the game as `sim.moves20`). */
  moves20?: MoveResult[]; moveSpec?: SeatMove[];
}
export const POP_1950_SCALE = 0.32; // reference (modern) population -> 1950 level; a synthetic scaling, not a statistic

/**
 * Stage 16: which provincial towns a game carries: the towns of the prefectures the seats of government stand in and of every prefecture next to them (a town is a real town; the game only adds the ones
 * whose growth the seats can reach, which keeps the city count -- and with it the cost of every pass over all pairs of cities -- down). Pure in the terrain and the two prefecture ids.
 */
export function townsForSeats(t: TerrainResult, prefs: string[]): string[] {
  const { nx, ny } = t.grid, adj = new Map<number, Set<number>>(), idx = prefs.map((p) => t.prefOrder.indexOf(p) + 1).filter((i) => i > 0);
  const link = (a: number, b: number) => { if (!a || !b || a === b) return; (adj.get(a) ?? adj.set(a, new Set()).get(a)!).add(b); (adj.get(b) ?? adj.set(b, new Set()).get(b)!).add(a); };
  for (let k = 0; k < nx * ny; k++) { if (t.land[k] !== 1) continue; const i = k % nx; if (i + 1 < nx && t.land[k + 1] === 1) link(t.pref[k], t.pref[k + 1]); if (k + nx < nx * ny && t.land[k + nx] === 1) link(t.pref[k], t.pref[k + nx]); }
  const want = new Set<number>(idx); for (const i of idx) for (const a of adj.get(i) ?? []) want.add(a);
  void ny;
  // at most TOWNS_PER_PREF towns of one prefecture, the biggest first (the seats' own prefectures count 1.8 times), and TOWN_MAX in all: a hundred cities cost every pass over the pairs of cities their square
  const pop = new Map(TOWNS.map((x) => [x.id, x.pop])), byPref = new Map<number, { id: string; score: number }[]>();
  for (const c of t.towns ?? []) { if (c.prefIndex <= 0 || !want.has(c.prefIndex)) continue; const l = byPref.get(c.prefIndex) ?? byPref.set(c.prefIndex, []).get(c.prefIndex)!; l.push({ id: c.id, score: (pop.get(c.id) ?? 0) * (idx.includes(c.prefIndex) ? 1.8 : 1) }); }
  const all: { id: string; score: number }[] = []; for (const l of byPref.values()) all.push(...l.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1)).slice(0, TOWNS_PER_PREF));
  const keep = new Set(all.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1)).slice(0, TOWN_MAX).map((x) => x.id));
  return (t.towns ?? []).filter((c) => keep.has(c.id)).map((c) => c.id);   // (in the order of the data file, so a world is the same wherever it is built)
}
export const TOWNS_PER_PREF = 5, TOWN_MAX = 40;
/** Stage 16: land the 5 km grid cannot hold. The Sadamisaki peninsula is 40 km long and a few km wide, so the grid keeps only its tip and a few cells of its root as separate specks
 *  (the tip is a single cell with no prefecture); a road cannot reach the tip, and the Kyushu-Shikoku strait the grid sees is the 47 km one from Nobeoka, not the 14 km Hoyo strait the
 *  real ferry crosses. Each line below is the spine of such a strip (lon,lat); the sea cells it passes through are made hilly land of the prefecture at its landward end. Applied to the
 *  world only (never to the terrain, so the terrain hash and every older save are untouched), and only for the towns world a new game gets. */
export const SUBGRID_LAND: { name: string; spine: [number, number][]; pref: string }[] = [
  { name: "佐田岬半島", spine: [[132.03, 33.36], [132.09, 33.385], [132.20, 33.43], [132.30, 33.47], [132.364, 33.495]], pref: "JP-38" },
];
export function withSubgridLand(t: TerrainResult): TerrainResult {
  const { nx, ny, cell, x0, y0 } = t.grid; let land: Uint8Array | null = null, island: Uint8Array | null = null, elev: Float32Array | null = null, pref: Uint8Array | null = null;
  for (const s of SUBGRID_LAND) {
    const pi = t.prefOrder.indexOf(s.pref) + 1; if (pi <= 0) continue;
    const pts = s.spine.map(([lon, lat]) => lonLatToReal(lon, lat));
    // the island is that of the landward end's cell
    const endCell = (p: Vec) => { const i = Math.floor((p[0] - x0) / cell), j = Math.floor((p[1] - y0) / cell); return i < 0 || j < 0 || i >= nx || j >= ny ? -1 : j * nx + i; };
    const ek = endCell(pts[pts.length - 1]); if (ek < 0 || t.land[ek] !== 1) continue; const isl = t.island[ek];
    for (let n = 1; n < pts.length; n++) {
      const a = pts[n - 1], b = pts[n], steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (cell / 2)));
      for (let q = 0; q <= steps; q++) {
        const k = endCell([a[0] + ((b[0] - a[0]) * q) / steps, a[1] + ((b[1] - a[1]) * q) / steps]); if (k < 0) continue;
        if (t.land[k] === 1 && t.pref[k]) continue;
        if (!land) { land = t.land.slice(); island = t.island.slice(); elev = t.elev.slice(); pref = t.pref.slice(); }
        land[k] = 1; island![k] = isl; elev![k] = Math.max(elev![k], 250); pref![k] = pi;
      }
    }
  }
  return land ? { ...t, land, island: island!, elev: elev!, pref: pref! } : t;
}
export function buildWorld(t0: TerrainResult, seed: number, withTowns: string[] | false = false, islets: boolean | 1 | 2 = false, moves: SeatMove[] = []): World {
  const t1 = withTowns ? withSubgridLand(t0) : t0, t = islets ? withIslets(t1, islets === 2 ? 2 : 1) : t1;
  const { nx, ny, cell, x0, y0 } = t.grid, N = nx * ny;
  const cellPos = (k: number): Vec => [x0 + ((k % nx) + 0.5) * cell, y0 + (((k / nx) | 0) + 0.5) * cell];
  const cellOf = (p: Vec) => { const i = Math.floor((p[0] - x0) / cell), j = Math.floor((p[1] - y0) / cell); return i < 0 || j < 0 || i >= nx || j >= ny ? -1 : j * nx + i; };
  const river = new Uint8Array(N);
  for (let i = 0; i < t.streams.length; i += 5) {
    const a = cellOf([t.streams[i], t.streams[i + 1]]), b = cellOf([t.streams[i + 2], t.streams[i + 3]]);
    if (a >= 0) river[a] = 1; if (b >= 0) river[b] = 1;
  }
  const rnd = mulberry32((seed ^ 0x5eed) >>> 0);
  const pop = new Map<string, { pop: number; src: "ne" | "synthetic" }>();
  for (const c of [...JAPAN.cities, ...EXTRA.cities]) { const p = (c as any).pop as number | null | undefined; if (p) pop.set(c.id, { pop: p, src: "ne" }); }
  const cities: WCity[] = [];
  for (const c of t.cities) {
    const k = cellOf(c.pos); if (k < 0) continue;
    let p = pop.get(c.id); if (!p) p = { pop: Math.round(120000 + rnd() * 600000), src: "synthetic" };
    else rnd(); // keep the random stream aligned whether or not a real figure exists
    let coastal = false, plain = 0, cnt = 0;
    for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) {
      const a = (k % nx) + di, b = ((k / nx) | 0) + dj; if (a < 0 || b < 0 || a >= nx || b >= ny) continue;
      const q = b * nx + a; cnt++; if (t.plains[q]) plain++; if (Math.abs(di) <= 2 && Math.abs(dj) <= 2 && t.land[q] === 0) coastal = true;
    }
    cities.push({ id: c.id, name: c.name, cell: k, pos: c.pos, pref: c.prefIndex ? t.prefOrder[c.prefIndex - 1] : null, island: t.island[k], pop0: Math.round(p.pop * POP_1950_SCALE), popSource: p.src, coastal, plains: cnt ? plain / cnt : 0, kind: c.kind });
  }
  // Stage 16: the provincial towns come last, so the cities keep their places in every array indexed by city (and the random stream above is untouched)
  if (withTowns && t.towns) {
    const popOf = new Map(TOWNS.map((x) => [x.id, x.pop])), only = new Set(withTowns);
    for (const c of t.towns) {
      if (!only.has(c.id)) continue;
      const k = cellOf(c.pos); if (k < 0 || cities.some((x) => x.cell === k)) continue;
      let coastal = false, plain = 0, cnt = 0;
      for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) {
        const a = (k % nx) + di, b = ((k / nx) | 0) + dj; if (a < 0 || b < 0 || a >= nx || b >= ny) continue;
        const q = b * nx + a; cnt++; if (t.plains[q]) plain++; if (Math.abs(di) <= 2 && Math.abs(dj) <= 2 && t.land[q] === 0) coastal = true;
      }
      cities.push({ id: c.id, name: c.name, cell: k, pos: c.pos, pref: c.prefIndex ? t.prefOrder[c.prefIndex - 1] : null, island: t.island[k], pop0: Math.round((popOf.get(c.id) ?? 50000) * POP_1950_SCALE), popSource: "ne", coastal, plains: cnt ? plain / cnt : 0, kind: "town" });
    }
  }
  let moves20: MoveResult[] | undefined;
  if (moves.length) {   // Stage 20: a seat put on the map makes that point its prefecture's 県庁所在地
    const owner = new Map<number, IsletCell>(); for (const s of t.islets ?? []) for (const k of s.cells) owner.set(k, s);
    const near = (k: number) => { let coastal = false, plain = 0, cnt = 0; for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) { const a = (k % nx) + di, b = ((k / nx) | 0) + dj; if (a < 0 || b < 0 || a >= nx || b >= ny) continue; const q = b * nx + a; cnt++; if (t.plains[q]) plain++; if (Math.abs(di) <= 2 && Math.abs(dj) <= 2 && t.land[q] === 0) coastal = true; } return { coastal, plains: cnt ? plain / cnt : 0 }; };
    moves20 = applySeatMoves(cities, t, cellOf, moves, (k) => { const o = owner.get(k); return o ? o.areaKm2 * PEOPLE_PER_KM2 : Infinity; }, near);
  }
  const lm = new Uint16Array(N); let lmCount = 0; const stack: number[] = [];
  for (let k0 = 0; k0 < N; k0++) if (t.land[k0] === 1 && !lm[k0]) {
    lm[k0] = ++lmCount; stack.push(k0);
    while (stack.length) { const c = stack.pop()!, i = c % nx, j = (c / nx) | 0; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= nx || b >= ny) continue; const q = b * nx + a; if (t.land[q] === 1 && !lm[q] && t.island[q] === t.island[c]) { lm[q] = lmCount; stack.push(q); } } }
  }
  const cityById = new Map(cities.map((c) => [c.id, c])), cityByCell = new Map<number, WCity>();
  for (const c of cities) if (!cityByCell.has(c.cell)) cityByCell.set(c.cell, c);
  return { t, nx, ny, cell, N, cities, ...(islets && t.islets ? { islets: t.islets } : {}), ...(moves20 ? { moves20, moveSpec: moves } : {}), cityById, cityByCell, lm, lmCount, river, cellPos, cellOf, ...(withTowns && t.towns && cities.some((c) => c.kind === "town") ? { hasTowns: true as const, townIds: cities.filter((c) => c.kind === "town").map((c) => c.id) } : {}), elevM: (k) => t.elev[k], prefOf: (k) => (t.pref[k] ? t.prefOrder[t.pref[k] - 1] : null) };
}

export interface PathOpts { bias?: (k: number) => number; allow?: (k: number) => boolean; roadCells?: { has(k: number): boolean }; margin?: number; rail?: boolean; ease?: number }   // ease 0..1: how much better tunnelling and bridging make mountains and rivers to cross (tech.ts); 0 = the older cost
const D8: [number, number, number][] = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.4142], [-1, 1, 1.4142], [1, -1, 1.4142], [-1, -1, 1.4142]];

/**
 * Stage 9: the cost a drawn mountain range adds to one km of line, from how close the cell is to the ridge (0..1) and how high it stands. A cell at the core
 * of a 2,000 m range costs about 40 times a flat km; above MTN_EXTREME_M three times that, and a railway above MTN_RAIL_PASS_M five times again. 0 outside the drawn ranges (the real terrain keeps its own cost).
 */
export const MTN_RIDGE_MIN = 0.15, MTN_K = 10, MTN_EXTREME_M = 2000, MTN_EASE = 1.4, MTN_RAIL_PASS_M = 1300;
/** Stage 11: however good the tunnelling, a high range keeps at least this share of its barrier (was 0.15: by 2050 the best technology made a drawn range nearly free to cross). */
export const MTN_EASE_FLOOR = 0.4;
/** Stage 11: on a steep slope inside a barrier the cost grows with the slope (percent) as 1 + slope / MTN_SLOPE_DIV. */
export const MTN_SLOPE_DIV = 8;
export const mountainBarrier = (ridge: number, elevM: number) => (ridge <= MTN_RIDGE_MIN ? 0 : ridge * MTN_K * Math.pow(Math.max(0, elevM) / 1000, 2) * (elevM > MTN_EXTREME_M ? 3 : 1));
/** Stage 9: how much a line through drawn mountains costs to build, relative to the same length on open ground (earthworks, tunnels, slow progress). */
export function mountainCost(w: World, cells: number[]): number { if (!cells.length || !w.barrier) return 1; let s = 0; for (const k of cells) s += mountainBarrier(w.t.barrier[k], w.t.elev[k]); return 1 + 0.25 * (s / cells.length); }
/** Least-cost path on the 5 km grid. Land only, never through lakes, never between islands. */
export function pathfind(w: World, from: number, to: number, o: PathOpts = {}): number[] | null {
  const { nx, ny, cell, t } = w; if (from < 0 || to < 0 || t.land[from] !== 1 || t.land[to] !== 1 || t.island[from] !== t.island[to]) return null;
  const isl = t.island[from], m = o.margin ?? 14;
  const fi = from % nx, fj = (from / nx) | 0, ti = to % nx, tj = (to / nx) | 0;
  const i0 = Math.max(0, Math.min(fi, ti) - m), i1 = Math.min(nx - 1, Math.max(fi, ti) + m), j0 = Math.max(0, Math.min(fj, tj) - m), j1 = Math.min(ny - 1, Math.max(fj, tj) + m);
  const bw = i1 - i0 + 1, bh = j1 - j0 + 1, dist = new Float64Array(bw * bh).fill(Infinity), prev = new Int32Array(bw * bh).fill(-1);
  const loc = (k: number) => ((((k / nx) | 0) - j0) * bw + (k % nx) - i0);
  const heap = new MinHeap(4096); dist[loc(from)] = 0; heap.push(0, from);
  const hx = (k: number) => Math.hypot((k % nx) - ti, ((k / nx) | 0) - tj) * cell * 0.35;
  while (heap.size) {
    const { key, val: c } = heap.pop(); if (c === to) break; const lc = loc(c);
    if (key - hx(c) > dist[lc] + 1e-9) continue;
    const ci = c % nx, cj = (c / nx) | 0;
    for (const [di, dj, sd] of D8) {
      const a = ci + di, b = cj + dj; if (a < i0 || a > i1 || b < j0 || b > j1) continue;
      const n = b * nx + a; if (t.land[n] !== 1 || t.island[n] !== isl) continue; if (o.allow && !o.allow(n) && n !== to) continue;
      const dkm = sd * cell, slope = Math.abs(t.elev[n] - t.elev[c]) / (dkm * 1000) * 100;
      const ez = 1 - (o.ease ?? 0);   // what a tunnel or a bridge takes off the cost of rough ground
      let f = o.rail
        ? 1 + ez * (0.18 * slope + 0.06 * slope * slope + (w.river[n] ? 0.3 : 0) + (t.elev[n] > 1200 ? 0.6 : 0))     // a railway climbs far less than a road
        : 1 + ez * (0.07 * slope + 0.012 * slope * slope + (w.river[n] ? 0.5 : 0) + (t.ridge[n] > 0.5 ? 0.35 : 0) + (t.elev[n] > 1500 ? 0.5 : 0));
      // Stage 9: a drawn mountain range is a real barrier -- its high ground costs many times an ordinary climb, a reference corridor gives it no discount,
      // and tunnelling technology takes off only part of it (MTN_*; see mountainCost)
      const mb = w.barrier ? mountainBarrier(t.barrier[n], t.elev[n]) * (1 + slope / MTN_SLOPE_DIV) : 0; if (mb > 0) f += mb * (o.rail ? (t.elev[n] > MTN_RAIL_PASS_M ? 5 : 1.3) : 1) * Math.max(MTN_EASE_FLOOR, 1 - MTN_EASE * (o.ease ?? 0));   // a railway cannot climb over a high pass at all: it waits for a long tunnel
      if (o.roadCells?.has(n) && o.roadCells.has(c)) f *= mb > 1 ? 0.6 : 0.3;
      if (o.bias) { const b = o.bias(n); f *= w.barrier && t.barrier[n] > MTN_RIDGE_MIN ? Math.max(1, b) : b; }
      const nd = dist[lc] + dkm * f, ln = loc(n);
      if (nd < dist[ln]) { dist[ln] = nd; prev[ln] = c; heap.push(nd + hx(n), n); }
    }
  }
  if (!isFinite(dist[loc(to)])) return null;
  const out: number[] = []; for (let k = to; k !== -1; k = prev[loc(k)]) { out.push(k); if (k === from) break; }
  out.reverse();
  // Stage 9: a path forced over a drawn range may only be so because the search window was too small to see the way round it: look once more, wider
  if (w.barrier && m < MTN_WIDE_MARGIN && out.some((k) => mountainBarrier(t.barrier[k], t.elev[k]) > MTN_RETRY)) return pathfind(w, from, to, { ...o, margin: MTN_WIDE_MARGIN }) ?? out;
  return out;
}
export const MTN_RETRY = 8, MTN_WIDE_MARGIN = 45;
export const cellDistKm = (w: World, a: number, b: number) => Math.hypot(((a % w.nx) - (b % w.nx)), (((a / w.nx) | 0) - ((b / w.nx) | 0))) * w.cell;
