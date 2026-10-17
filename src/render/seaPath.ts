/**
 * Stage 9: how a domestic ferry is DRAWN -- a route over the water, a little way off the coast, never across land (the simulation keeps the ferry as one
 * edge between its two ports; only the picture follows the sea). Least-cost path over water cells, where water close to the shore costs more, then thinned
 * and smoothed. A lake ferry keeps to its lake. Computed once per pair and kept.
 */
import { MinHeap } from "../core/heap";
import type { Vec } from "../core/types";
import type { World } from "../sim/world";

const shoreMemo = new WeakMap<World, Uint8Array>(), pathMemo = new WeakMap<World, Map<string, Vec[]>>();
/** Cells of water: distance (in cells, capped at 6) to the nearest land. */
function shoreDist(w: World): Uint8Array {
  const hit = shoreMemo.get(w); if (hit) return hit;
  const d = new Uint8Array(w.N).fill(255), q: number[] = [];
  for (let k = 0; k < w.N; k++) if (w.t.land[k] === 1) { d[k] = 0; q.push(k); }
  for (let h = 0; h < q.length; h++) { const k = q[h], i = k % w.nx, j = (k / w.nx) | 0; if (d[k] >= 6) continue; for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= w.nx || b >= w.ny) continue; const n = b * w.nx + a; if (d[n] > d[k] + 1) { d[n] = d[k] + 1; q.push(n); } } }
  shoreMemo.set(w, d); return d;
}
const D8: [number, number, number][] = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.4142], [-1, 1, 1.4142], [1, -1, 1.4142], [-1, -1, 1.4142]];
/** The drawn route between two port cells. `lake`: keep to lake water (else open sea). Falls back to the straight line when no water route is found. */
export function seaPath(w: World, a: number, b: number, lake = false): Vec[] {
  let m = pathMemo.get(w); if (!m) { m = new Map(); pathMemo.set(w, m); }
  const key = `${a}:${b}:${lake ? 1 : 0}`, hit = m.get(key); if (hit) return hit;
  const res = search(w, a, b, lake) ?? [w.cellPos(a), w.cellPos(b)]; m.set(key, res); return res;
}
function search(w: World, a: number, b: number, lake: boolean): Vec[] | null {
  const water = lake ? 2 : 0, sd = shoreDist(w), nx = w.nx, ny = w.ny, isW = (k: number) => w.t.land[k] === water;
  const ai = a % nx, aj = (a / nx) | 0, bi = b % nx, bj = (b / nx) | 0, M = 30;
  const i0 = Math.max(0, Math.min(ai, bi) - M), i1 = Math.min(nx - 1, Math.max(ai, bi) + M), j0 = Math.max(0, Math.min(aj, bj) - M), j1 = Math.min(ny - 1, Math.max(aj, bj) + M), bw = i1 - i0 + 1;
  const loc = (k: number) => (((k / nx) | 0) - j0) * bw + (k % nx) - i0, dist = new Float64Array(bw * (j1 - j0 + 1)).fill(Infinity), prev = new Int32Array(dist.length).fill(-1);
  const near = (k: number) => { const out: number[] = [], i = k % nx, j = (k / nx) | 0; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const x = i + di, y = j + dj; if (x < i0 || x > i1 || y < j0 || y > j1) continue; const n = y * nx + x; if (isW(n)) out.push(n); } return out; };
  // the ferry leaves from the shore nearest each port (a port city may lie a little inland: the short way to its quay is drawn as a land link, see `quays`)
  const ca = coastNear(w, a, water), cb = coastNear(w, b, water); if (ca < 0 || cb < 0) return null;
  const starts = near(ca), goals = new Set(near(cb)); if (!starts.length || !goals.size) return null;
  const h = new MinHeap(1024); for (const s of starts) { dist[loc(s)] = 0; h.push(0, s); }
  let end = -1;
  while (h.size) {
    const { key, val: c } = h.pop(); if (key > dist[loc(c)] + 1e-9) continue; if (goals.has(c)) { end = c; break; }
    const ci = c % nx, cj = (c / nx) | 0;
    for (const [di, dj, sdd] of D8) {
      const x = ci + di, y = cj + dj; if (x < i0 || x > i1 || y < j0 || y > j1) continue; const n = y * nx + x; if (!isW(n)) continue;
      const off = lake ? 1 : 1 + 2.2 / Math.max(1, Math.min(sd[n], 4));   // water hugging the coast costs more: the route stands off the shore
      const nd = dist[loc(c)] + sdd * off; if (nd < dist[loc(n)]) { dist[loc(n)] = nd; prev[loc(n)] = c; h.push(nd, n); }
    }
  }
  if (end < 0) return null;
  const cells: number[] = []; for (let k = end; k !== -1; k = prev[loc(k)]) cells.push(k); cells.reverse();
  let pts: Vec[] = cells.filter((_, i) => i % 2 === 0 || i === cells.length - 1).map((k) => w.cellPos(k)); if (pts.length < 2) return null;
  const wet = (p: Vec) => { const k = w.cellOf(p); return k >= 0 && isW(k); };
  for (let it = 0; it < 2; it++) {   // Chaikin smoothing, except where cutting a corner would put the line on land (then the corner is kept)
    const out: Vec[] = [pts[0]];
    for (let i = 0; i + 1 < pts.length; i++) { const p = pts[i], q = pts[i + 1], u: Vec = [0.75 * p[0] + 0.25 * q[0], 0.75 * p[1] + 0.25 * q[1]], v: Vec = [0.25 * p[0] + 0.75 * q[0], 0.25 * p[1] + 0.75 * q[1]]; if (i > 0 && !wet(u)) out.push(p); out.push(...[u, v].filter(wet)); }
    out.push(pts[pts.length - 1]); pts = out;
  }
  return pts;
}
/** The land cell touching the given water nearest to a port (the port itself when it is on the shore); -1 if none within ~30 km. */
export function coastNear(w: World, k: number, water = 0): number {
  const i0 = k % w.nx, j0 = (k / w.nx) | 0; let best = -1, bd = Infinity;
  for (let dj = -6; dj <= 6; dj++) for (let di = -6; di <= 6; di++) { const i = i0 + di, j = j0 + dj; if (i < 1 || j < 1 || i >= w.nx - 1 || j >= w.ny - 1) continue; const n = j * w.nx + i; if (w.t.land[n] !== 1) continue; if (![1, -1, w.nx, -w.nx].some((o) => w.t.land[n + o] === water)) continue; const d = di * di + dj * dj; if (d < bd) { bd = d; best = n; } }
  return best;
}
/** The short links from each port to where its ferry route meets the water (drawn thin, so the ferry visibly reaches the port). */
export function quays(w: World, a: number, b: number, lake = false): [Vec, Vec][] { const p = seaPath(w, a, b, lake); return p.length > 2 ? [[w.cellPos(a), p[0]], [p[p.length - 1], w.cellPos(b)]] : []; }
/** For tests: the share of a drawn sea route's points that fall on land. */
export function landShare(w: World, pts: Vec[]): number { const inner = pts.slice(1, -1); if (!inner.length) return 0; let n = 0; for (const p of inner) { const k = w.cellOf(p); if (k >= 0 && w.t.land[k] === 1) n++; } return n / inner.length; }
