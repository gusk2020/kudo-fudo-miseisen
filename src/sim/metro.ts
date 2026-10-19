/**
 * Stage 13 (Issue #33): the metropolitan areas -- how far each big city's daily life actually reaches.
 *
 * A circle of radius sqrt(pop) says how big a city is; it does not say where its people live. A real metropolis is a SHAPE: it runs along the railways and
 * motorways, fills the plain, stops at a range and at the sea, and crosses a prefecture's line without noticing. So the footprint here is grown, not drawn:
 *
 *   1. SATELLITES. A city within a commute of a city at least twice its size (travel time `an.T`, hours) is that city's satellite: one metropolis, counted once.
 *      Every city belongs to exactly one metropolis, so people and output are never counted twice where two circles would overlap.
 *   2. AREA BUDGET. The metropolis wants A = AREA_K x (pop in millions)^0.8 x (0.7 + 0.6 x industry) km2 of reference ground. (AREA_K = 800: Tokyo's 36 M -> ~14,000 km2,
 *      a regional city of 300 k -> ~300 km2, which is what Japan's metropolitan employment areas measure.)
 *   3. TERRAIN FACTOR. Ground is not equal: a plain develops 1.5x as widely (PLAIN_F), low hills and the like 1x, high ground 0.5x (HIGH_F). A cell of factor f uses
 *      cell^2 / f of the budget, so the same budget covers 1.5x the area on a plain and half of it on a mountain. AREA (not radius) is what the factor multiplies;
 *      the radius shown is sqrt(area / pi) of the area really covered.
 *   4. REACH. All the metropolises grow at once outward from their cities over the LAND grid, by travel time (an isochrone: roads and rails are fast, bare ground is
 *      slow, a range is slower), up to MAX_H hours. A cell goes to whoever reaches it first, which is the no-double-counting rule at the level of the ground.
 * Nothing here reads a name or a coordinate range.
 */
import { edgeSpeed } from "./demand";
import { H_TUNNEL, hardnessAt, slopeOf } from "./land";
import { modeOf } from "./types";
import type { SimState } from "./types";
import type { World } from "./world";

export const AREA_K = 800, AREA_POW = 0.8, PLAIN_F = 1.5, LOW_F = 1, HIGH_F = 0.5, PLAIN_M = 120, PLAIN_SLOPE = 4, LOW_M = 500, MAX_H = 1.5;
export const SAT_RATIO = 2, SAT_H = 0.75, OFF_KMH = 12, HISTORY_KEEP = 40;
export interface MetroInfo { core: string; members: string[]; pop: number; areaKm2: number; radiusKm: number; cells: number[]; prefs: string[]; outsidePct: number; budgetKm2: number }
export interface MetroState { year: number; list: MetroInfo[]; of: Record<string, string>; h: Record<string, [number, number, number][]> }

/** 1.5 on a plain, 1 on low ground, 0.5 on high ground or inside a range. */
export function terrainFactor(w: World, k: number): number {
  const m = w.elevM(k); if (m > LOW_M || hardnessAt(w, k) >= H_TUNNEL) return HIGH_F;
  return m <= PLAIN_M && slopeOf(w)[k] <= PLAIN_SLOPE ? PLAIN_F : LOW_F;
}
export const metroBudgetKm2 = (pop: number, industry: number) => AREA_K * Math.pow(pop / 1e6, AREA_POW) * (0.7 + 0.6 * industry);

class Heap {
  t: number[] = []; k: number[] = []; l: number[] = [];
  get size() { return this.t.length; }
  private swap(a: number, b: number) { [this.t[a], this.t[b]] = [this.t[b], this.t[a]]; [this.k[a], this.k[b]] = [this.k[b], this.k[a]]; [this.l[a], this.l[b]] = [this.l[b], this.l[a]]; }
  push(t: number, k: number, l: number) {
    let i = this.t.length; this.t.push(t); this.k.push(k); this.l.push(l);
    while (i > 0) { const p = (i - 1) >> 1; if (this.t[p] <= this.t[i]) break; this.swap(i, p); i = p; }
  }
  pop(): [number, number, number] {
    const r: [number, number, number] = [this.t[0], this.k[0], this.l[0]], t = this.t.pop()!, k = this.k.pop()!, l = this.l.pop()!;
    if (this.t.length) {
      this.t[0] = t; this.k[0] = k; this.l[0] = l; let i = 0; const n = this.t.length;
      for (;;) { const a = 2 * i + 1, b = a + 1; let m = i; if (a < n && this.t[a] < this.t[m]) m = a; if (b < n && this.t[b] < this.t[m]) m = b; if (m === i) break; this.swap(i, m); i = m; }
    }
    return r;
  }
}

/** The metropolises of year `y` from the cities' sizes, the travel times between them and the network as it stands. */
export function computeMetros(sim: SimState, w: World, an: { T: Float64Array; TT: Float64Array }, y: number, prev?: MetroState): MetroState {
  const nc = w.cities.length, P = w.cities.map((c) => sim.cities[c.id]?.pop ?? 0), order = w.cities.map((_, i) => i).sort((a, b) => P[b] - P[a] || a - b);
  // 1. satellites: the root of each city
  const root = new Array<number>(nc).fill(-1);
  for (const i of order) {
    let best = -1, bt = SAT_H;
    for (const j of order) { if (P[j] < SAT_RATIO * P[i]) break; if (j === i) continue; const t = Math.min(an.T[i * nc + j], an.TT[i * nc + j] + 0.4); if (t < bt) { bt = t; best = j; } }
    root[i] = best < 0 ? i : root[best];
  }
  const roots = order.filter((i) => root[i] === i), slot = new Map<number, number>(); roots.forEach((r, n) => slot.set(r, n));
  const members: number[][] = roots.map(() => []); for (let i = 0; i < nc; i++) members[slot.get(root[i])!].push(i);
  // 2. budgets
  const budget = roots.map((_, n) => { let pop = 0, ind = 0; for (const i of members[n]) { pop += P[i]; ind += P[i] * (sim.cities[w.cities[i].id]?.industry ?? 0.3); } return metroBudgetKm2(pop, pop ? ind / pop : 0.3); });
  // 3. the land grid: speed per cell from the open land network, bare ground slow
  const spd = new Float32Array(w.N).fill(OFF_KMH);
  for (const e of Object.values(sim.edges)) {
    if (e.built < 1 || e.state !== "open" || e.facility === "ferry") continue;
    const v = Math.max(OFF_KMH, Math.min(modeOf(e) === "rail" ? 90 : 70, edgeSpeed(e))); for (const k of e.cells) if (v > spd[k]) spd[k] = v;
  }
  const f = new Float32Array(w.N); for (let k = 0; k < w.N; k++) if (w.t.land[k] === 1) f[k] = terrainFactor(w, k);
  const owner = new Int16Array(w.N).fill(-1), rem = budget.slice(), cellKm2 = w.cell * w.cell, heap = new Heap(), cells: number[][] = roots.map(() => []);
  const nx = w.nx, ny = w.ny, dirs: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const claim = (k: number, l: number, t: number) => {
    owner[k] = l; rem[l] -= cellKm2 / f[k]; cells[l].push(k);
    const i = k % nx, j = (k / nx) | 0;
    for (const [di, dj] of dirs) {
      const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= nx || b >= ny) continue; const n = b * nx + a; if (owner[n] >= 0 || f[n] === 0) continue;
      const dt = t + (w.cell * (di && dj ? Math.SQRT2 : 1)) / ((spd[k] + spd[n]) / 2) * (1 + 0.35 * Math.min(8, hardnessAt(w, n)));
      if (dt <= MAX_H) heap.push(dt, n, l);
    }
  };
  roots.forEach((_, n) => { for (const i of members[n]) { const k = w.cities[i].cell; if (owner[k] < 0 && f[k] > 0) claim(k, n, 0); } });
  while (heap.size) { const [t, k, l] = heap.pop(); if (owner[k] >= 0 || rem[l] <= 0) continue; claim(k, l, t); }
  // 4. the result
  const list: MetroInfo[] = [], of: Record<string, string> = {};
  roots.forEach((r, n) => {
    const core = w.cities[r], ids = members[n].map((i) => w.cities[i].id); let pop = 0; for (const i of members[n]) pop += P[i];
    const area = cells[n].length * cellKm2, home = w.prefOf(core.cell), seen = new Map<string, number>(); let out = 0;
    for (const k of cells[n]) { const p = w.prefOf(k); if (p) { seen.set(p, (seen.get(p) ?? 0) + 1); if (p !== home) out++; } }
    list.push({ core: core.id, members: ids, pop, areaKm2: area, radiusKm: Math.sqrt(area / Math.PI), cells: cells[n].slice().sort((a, b) => a - b), prefs: [...seen.keys()].sort(), outsidePct: cells[n].length ? out / cells[n].length : 0, budgetKm2: budget[n] });
    for (const id of ids) if (id !== core.id) of[id] = core.id;
  });
  const h: MetroState["h"] = {}; if (prev) for (const [k, v] of Object.entries(prev.h)) h[k] = v;
  if (!prev || (y - sim.startYear) % 5 === 0) for (const m of list) { const a = (h[m.core] ??= []); if (!a.length || a[a.length - 1][0] !== y) a.push([y, Math.round(m.pop), Math.round(m.areaKm2)]); if (a.length > HISTORY_KEEP) a.shift(); }
  return { year: y, list, of, h };
}

/** The size (people) of the metropolis a city belongs to; its own if it has none yet. */
export function metroPopOf(m: MetroState | undefined, id: string, own: number): number {
  if (!m) return own; const root = m.of[id] ?? id, info = m.list.find((x) => x.core === root); return info ? info.pop : own;
}

/** Light check of a loaded metro block (a damaged one is dropped and rebuilt at the next yearly step). */
export function validMetro(m: unknown): m is MetroState {
  const o = m as MetroState | undefined; if (!o || typeof o !== "object" || !Number.isFinite(o.year) || !Array.isArray(o.list) || typeof o.of !== "object" || typeof o.h !== "object") return false;
  return o.list.every((x) => x && typeof x.core === "string" && Array.isArray(x.members) && Array.isArray(x.cells) && Array.isArray(x.prefs) && Number.isFinite(x.pop) && Number.isFinite(x.areaKm2) && Number.isFinite(x.radiusKm) && Number.isFinite(x.outsidePct) && Number.isFinite(x.budgetKm2));
}
