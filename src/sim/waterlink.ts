/**
 * Stage 13 (Issue #33): water crossings found from the SHAPE of the coast, not from a list of ports.
 *
 * Before, a fixed link (bridge or tunnel) could only be planned where a ferry already ran between two port cities on different land masses. A bay whose two shores are one land
 * mass (Tokyo Bay, Ise Bay, Kagoshima Bay), the peninsulas of a lake or of a ria coast, and a strait nobody had put a ferry on never became a candidate at all.
 *
 * A candidate here is a pair of shore cells that FACE each other across open water: a straight line from one to the other crosses only water (sea or lake) and arrives on land.
 * It is kept when it is worth crossing:
 *   - the two shores are different land masses (a strait): always, if the water is no wider than MAX_STRAIT_KM; or
 *   - they are the same land mass and the way round over land is much longer than the way across (LAND_RATIO times, and at least MIN_SAVING_KM more): a bay or a lake.
 * Candidates are thinned so that one strait is one candidate, then ranked by what crossing saves. Nothing here knows a name or a coordinate: every number is read from the grid.
 * The water is never drawn as road: a candidate only says where two shores face each other; what crosses (ferry, bridge, tunnel) is decided by money, technology and demand.
 */
import { basePop } from "./roles";
import { dist } from "../core/geom";
import type { WCity, World } from "./world";
import type { Mode, SimState } from "./types";
import type { Vec } from "../core/types";

export const MAX_RAY_KM = 70, MAX_STRAIT_KM = 45, LAND_RATIO = 2.2, MIN_SAVING_KM = 25, MIN_CROSS_KM = 6, DEDUPE_KM = 22, DIRECTIONS = 16;
export interface WaterLink { id: string; a: number; b: number; kind: "sea" | "lake"; km: number; landKm: number | null; lmA: number; lmB: number; nameA: string; nameB: string; saving: number }

const memo = new WeakMap<World, WaterLink[]>();
const town = (w: World, k: number, avoid?: string): { name: string; c: WCity } => {
  let best: WCity = w.cities[0], bd = Infinity; const p = w.cellPos(k);
  for (const c of w.cities) { const d = dist(c.pos, p); if (c.name !== avoid && d < bd) { bd = d; best = c; } }
  return { name: best.name.replace(/市$/, ""), c: best };
};
/** Shortest way over land between two cells of one land mass (km), or null if longer than `capKm`. A plain 8-neighbour search on the 5 km grid. */
export function landDistanceKm(w: World, from: number, to: number, capKm: number): number | null {
  const { nx, ny, cell, t } = w, lm = w.lm[from]; if (lm === 0 || w.lm[to] !== lm) return null;
  const cap = capKm / cell, dist2 = new Map<number, number>(), heap: [number, number][] = [[0, from]]; dist2.set(from, 0);
  const push = (d: number, k: number) => { heap.push([d, k]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = (): [number, number] => { const top = heap[0], last = heap.pop()!; if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  while (heap.length) {
    const [d, k] = pop(); if (d > (dist2.get(k) ?? Infinity) + 1e-9) continue; if (k === to) return Math.round(d * cell * 10) / 10; if (d > cap) return null;
    const i = k % nx, j = (k / nx) | 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue; const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= nx || b >= ny) continue; const q = b * nx + a; if (t.land[q] !== 1 || w.lm[q] !== lm) continue;
      const nd = d + (di && dj ? 1.4142 : 1); if (nd < (dist2.get(q) ?? Infinity)) { dist2.set(q, nd); push(nd, q); }
    }
  }
  return null;
}
/** Every pair of shore cells that face each other across water, thinned to one per strait and kept when worth crossing (see the file comment). Memoised per world. */
export function waterLinks(w: World): WaterLink[] {
  const hit = memo.get(w); if (hit) return hit;
  const { nx, ny, cell, t } = w, R = MAX_RAY_KM / cell, isLand = (k: number) => t.land[k] === 1 && w.lm[k] > 0;
  const dirs = Array.from({ length: DIRECTIONS }, (_, i) => [Math.cos((i * 2 * Math.PI) / DIRECTIONS), Math.sin((i * 2 * Math.PI) / DIRECTIONS)] as const);
  // 1) shore cells
  const shore: number[] = [];
  for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) { const k = j * nx + i; if (!isLand(k)) continue; if (t.land[k - 1] !== 1 || t.land[k + 1] !== 1 || t.land[k - nx] !== 1 || t.land[k + nx] !== 1) shore.push(k); }
  // 2) rays over water; one pair per (block of 4x4 cells, direction bucket) -- the shortest, so a strait is not listed once per shore cell
  const best = new Map<string, { a: number; b: number; d: number; lake: boolean }>();
  for (const p of shore) {
    const pi = p % nx, pj = (p / nx) | 0;
    for (let di = 0; di < DIRECTIONS; di++) {
      const [dx, dy] = dirs[di]; let lake = true, water = 0, q = -1;
      for (let s = 1; s <= R * 2; s++) {
        const x = pi + 0.5 + dx * s * 0.5, y = pj + 0.5 + dy * s * 0.5, a = Math.floor(x), b = Math.floor(y); if (a < 0 || b < 0 || a >= nx || b >= ny) break;
        const k = b * nx + a; if (k === p) continue; const lc = t.land[k];
        if (lc === 1) { if (isLand(k) && water >= 1) q = k; break; }
        water++; if (lc !== 2) lake = false; if (s * 0.5 > R) break;
      }
      if (q < 0) continue; const d = Math.hypot((q % nx) - pi, ((q / nx) | 0) - pj) * cell; if (d < MIN_CROSS_KM) continue;
      const mi = (pi + (q % nx)) >> 3, mj = (pj + ((q / nx) | 0)) >> 3, key = `${mi},${mj},${di % (DIRECTIONS / 2)}`, old = best.get(key);
      if (!old || d < old.d) best.set(key, { a: p, b: q, d, lake });
    }
  }
  // 3) worth crossing?
  const cands: WaterLink[] = [];
  for (const v of best.values()) {
    const la = w.lm[v.a], lb = w.lm[v.b], strait = la !== lb; let landKm: number | null = null, saving = 0;
    if (strait) { if (v.d > MAX_STRAIT_KM) continue; saving = 120 - v.d; }
    else { landKm = landDistanceKm(w, v.a, v.b, Math.max(300, v.d * 8)); const l = landKm ?? Math.max(300, v.d * 8); if (l < LAND_RATIO * v.d + MIN_SAVING_KM) continue; saving = l - v.d; }
    const na = town(w, v.a), nb = town(w, v.b, na.name + "市");
    cands.push({ id: "", a: v.a, b: v.b, kind: v.lake ? "lake" : "sea", km: Math.round(v.d * 10) / 10, landKm, lmA: la, lmB: lb, nameA: na.name, nameB: nb.name === na.name ? `${nb.name}対岸` : nb.name, saving });
  }
  cands.sort((p, q) => q.saving - p.saving || p.a - q.a || p.b - q.b);
  // 4) one candidate per strait: a later (smaller-saving) pair whose ends both lie near an accepted pair's ends is the same strait
  const out: WaterLink[] = [];
  for (const c of cands) {
    const pa = w.cellPos(c.a), pb = w.cellPos(c.b);
    if (out.some((o) => { const oa = w.cellPos(o.a), ob = w.cellPos(o.b); return (dist(pa, oa) < DEDUPE_KM && dist(pb, ob) < DEDUPE_KM) || (dist(pa, ob) < DEDUPE_KM && dist(pb, oa) < DEDUPE_KM); })) continue;
    c.id = `wl${out.length + 1}`; out.push(c);
  }
  memo.set(w, out); return out;
}

/** People within SHORE_REACH_KM of either end of a crossing, each counted ONCE, on the shore they are nearer to: cities and villages. Returns [shore a, shore b]. */
export const SHORE_REACH_KM = 70, RURAL_RADIUS_CELLS = 5, RURAL_PER_KM2 = 45;
const ruralMemo = new WeakMap<World, Map<number, number>>();
/** The people of the countryside round a shore cell who live in no city or village the model names (1950 figure): the land within RURAL_RADIUS_CELLS times RURAL_PER_KM2. A headland
 * has half the land of an inland town, so it has half the people. */
export function ruralBase(w: World, cell: number): number {
  let m = ruralMemo.get(w); if (!m) { m = new Map(); ruralMemo.set(w, m); } const hit = m.get(cell); if (hit !== undefined) return hit;
  const R = RURAL_RADIUS_CELLS, i0 = cell % w.nx, j0 = (cell / w.nx) | 0; let n = 0;
  for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) { if (di * di + dj * dj > R * R) continue; const i = i0 + di, j = j0 + dj; if (i < 0 || j < 0 || i >= w.nx || j >= w.ny) continue; if (w.t.land[j * w.nx + i] === 1) n++; }
  const v = n * w.cell * w.cell * RURAL_PER_KM2; m.set(cell, v); return v;
}
/** One answer per (game, year, pair of shores): the planner, the demand block and the checks all ask for the same pairs, and the people only change in the yearly step (Stage 28: it was one answer per month, which measured as the same sum over every city and village twelve times a year). The stamp also holds the relocation event's state and the seats moved, so people moved by hand (the event) start a new answer. */
let popMemo: { sim: SimState; stamp: string; map: Map<number, [number, number]> } | null = null;
export function sidePops(sim: SimState, w: World, ca: number, cb: number): [number, number] {
  const stamp = `${Math.floor(sim.month / 12)}|${sim.e2200?.state ?? ""}|${sim.e2200hist?.length ?? 0}|${sim.moves20?.length ?? 0}`; if (!popMemo || popMemo.sim !== sim || popMemo.stamp !== stamp) popMemo = { sim, stamp, map: new Map() };
  const key = ca * 1_000_003 + cb, hit = popMemo.map.get(key); if (hit) return hit;
  const r = sidePopsRaw(sim, w, ca, cb, stamp); popMemo.map.set(key, r); return r;
}
/** Stage 28: what every pair of shores shares in a year -- the nation's course (the scale) and the flat list of everyone who counts (cities first, then villages, as before) -- is made once, not once per pair. */
let flatMemo: { sim: SimState; stamp: string; scale: number; x: Float64Array; y: Float64Array; n: Float64Array } | null = null;
function flatPeople(sim: SimState, w: World, stamp: string) {
  if (flatMemo && flatMemo.sim === sim && flatMemo.stamp === stamp) return flatMemo;
  let now = 0, base = 0; for (const c of w.cities) { now += sim.cities[c.id]?.pop ?? 0; base += sim.roles?.p15 ? basePop(sim, w, c) : c.pop0; }
  const vs = Object.values(sim.settlements).filter((v) => !v.gone), m = w.cities.length + vs.length, x = new Float64Array(m), y = new Float64Array(m), n = new Float64Array(m); let k = 0;
  for (const c of w.cities) { x[k] = c.pos[0]; y[k] = c.pos[1]; n[k++] = sim.cities[c.id]?.pop ?? 0; }
  for (const v of vs) { const p = w.cellPos(v.cell); x[k] = p[0]; y[k] = p[1]; n[k++] = v.pop; }
  return (flatMemo = { sim, stamp, scale: base > 0 ? now / base : 1, x, y, n });
}
function sidePopsRaw(sim: SimState, w: World, ca: number, cb: number, stamp = ""): [number, number] {
  const pa = w.cellPos(ca), pb = w.cellPos(cb), f = flatPeople(sim, w, stamp); let a = 0, b = 0;   // (the countryside follows the nation's course)
  a += ruralBase(w, ca) * f.scale; b += ruralBase(w, cb) * f.scale;
  for (let i = 0; i < f.n.length; i++) { const da = Math.hypot(f.x[i] - pa[0], f.y[i] - pa[1]), db = Math.hypot(f.x[i] - pb[0], f.y[i] - pb[1]); if (Math.min(da, db) > SHORE_REACH_KM) continue; if (da <= db) a += f.n[i]; else b += f.n[i]; }
  return [a, b];
}
/**
 * Stage 13: the demand for a crossing between two shores that are not cities. The traffic analysis only runs between cities, so a ferry from one headland to another carries almost
 * nothing however many people live on the two shores. The demand is estimated from the shores themselves: a gravity of the people within reach of each end, times how much the
 * crossing saves over the way by land (the detour in km; 100 km saved counts in full, up to 1.5x), in vehicles (or riders) a day. A rail tunnel sees RAIL_FROM_ROAD of the road's.
 */
export const VIRTUAL_K = 3e-7, VIRTUAL_SAVING_KM = 100, VIRTUAL_SAVING_MAX = 1.5, RAIL_FROM_ROAD = 0.8, ROAD_REF = 3000, RAIL_REF = 6000;
const landMemo = new WeakMap<World, Map<string, number | null>>();
export function landDetourKm(w: World, a: number, b: number): number | null {
  let m = landMemo.get(w); if (!m) { m = new Map(); landMemo.set(w, m); } const key = a < b ? `${a}:${b}` : `${b}:${a}`; if (m.has(key)) return m.get(key)!;
  const km = landDistanceKm(w, a, b, 400); m.set(key, km); return km;
}
export function virtualTrips(sim: SimState, w: World, ca: number, cb: number, km: number, mode: Mode): number {
  const [pa, pb] = sidePops(sim, w, ca, cb), land = w.lm[ca] === w.lm[cb] ? landDetourKm(w, ca, cb) ?? 400 : 400, saving = Math.max(0, Math.min(VIRTUAL_SAVING_MAX, (land - km) / VIRTUAL_SAVING_KM));
  return VIRTUAL_K * Math.pow(pa * pb, 0.6) * saving * (mode === "rail" ? RAIL_FROM_ROAD * RAIL_REF : ROAD_REF);
}
