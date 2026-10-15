/** Static, derived-from-the-map context for the simulation. Rebuilt on load; never saved. */
import { MinHeap } from "../core/heap";
import { JAPAN } from "../core/data";
import { mulberry32 } from "../core/rng";
import type { TerrainResult } from "../core/terrain";
import type { Vec } from "../core/types";

export interface WCity { id: string; name: string; cell: number; pos: Vec; pref: string | null; island: number; pop0: number; popSource: "ne" | "synthetic"; coastal: boolean; plains: number; kind: string }
export interface World {
  t: TerrainResult; nx: number; ny: number; cell: number; N: number;
  cities: WCity[]; cityById: Map<string, WCity>; cityByCell: Map<number, WCity>;
  river: Uint8Array; cellPos(k: number): Vec; cellOf(p: Vec): number;
  elevM(k: number): number; prefOf(k: number): string | null;
}
export const POP_1950_SCALE = 0.32; // reference (modern) population -> 1950 level; a synthetic scaling, not a statistic

export function buildWorld(t: TerrainResult, seed: number): World {
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
  for (const c of JAPAN.cities) { const p = (c as any).pop as number | null | undefined; if (p) pop.set(c.id, { pop: p, src: "ne" }); }
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
  const cityById = new Map(cities.map((c) => [c.id, c])), cityByCell = new Map<number, WCity>();
  for (const c of cities) if (!cityByCell.has(c.cell)) cityByCell.set(c.cell, c);
  return { t, nx, ny, cell, N, cities, cityById, cityByCell, river, cellPos, cellOf, elevM: (k) => t.elev[k], prefOf: (k) => (t.pref[k] ? t.prefOrder[t.pref[k] - 1] : null) };
}

export interface PathOpts { bias?: (k: number) => number; allow?: (k: number) => boolean; roadCells?: { has(k: number): boolean }; margin?: number; rail?: boolean }
const D8: [number, number, number][] = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.4142], [-1, 1, 1.4142], [1, -1, 1.4142], [-1, -1, 1.4142]];

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
      let f = o.rail
        ? 1 + 0.18 * slope + 0.06 * slope * slope + (w.river[n] ? 0.3 : 0) + (t.elev[n] > 1200 ? 0.6 : 0)     // a railway climbs far less than a road
        : 1 + 0.07 * slope + 0.012 * slope * slope + (w.river[n] ? 0.5 : 0) + (t.ridge[n] > 0.5 ? 0.35 : 0) + (t.elev[n] > 1500 ? 0.5 : 0);
      if (o.roadCells?.has(n) && o.roadCells.has(c)) f *= 0.3;
      if (o.bias) f *= o.bias(n);
      const nd = dist[lc] + dkm * f, ln = loc(n);
      if (nd < dist[ln]) { dist[ln] = nd; prev[ln] = c; heap.push(nd + hx(n), n); }
    }
  }
  if (!isFinite(dist[loc(to)])) return null;
  const out: number[] = []; for (let k = to; k !== -1; k = prev[loc(k)]) { out.push(k); if (k === from) break; }
  return out.reverse();
}
export const cellDistKm = (w: World, a: number, b: number) => Math.hypot(((a % w.nx) - (b % w.nx)), (((a / w.nx) | 0) - ((b / w.nx) | 0))) * w.cell;
