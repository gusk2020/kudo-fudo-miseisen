/**
 * Travel demand and route assignment. Two components are kept apart on every edge:
 *  - through (通過): city-to-city trips routed over the fastest path (so a faster bypass pulls them off the old road)
 *  - local   (沿線): trips of the settlements along the road and village-to-city trips (these stay on an old road)
 * All figures are synthetic "vehicles/day"; they are not statistics.
 */
import { MinHeap } from "../core/heap";
import { Standard, Surface, type SimEdge, type SimState } from "./types";
import type { World } from "./world";

export const KFLOW = 1.5e-3, KVIL = 0.04, KLOC = 0.02;
export const ZERO_DEMAND = 4;                       // below this many vehicles/day a road counts as unused (explicit, not float noise)
export const CAPACITY: Record<Standard, number> = { rural: 3000, standard: 12000, highgrade: 40000 };
const BASE_SPEED: Record<Standard, number> = { rural: 25, standard: 45, highgrade: 80 };
const SURF: Record<Surface, number> = { unpaved: 0.6, gravel: 0.8, paved: 1 };
export const edgeSpeed = (e: SimEdge) => BASE_SPEED[e.standard] * SURF[e.surface] * (0.5 + 0.5 * e.quality / 100) * (1 - Math.min(0.4, e.maxGradePct / 50));
export const passable = (e: SimEdge) => (e.state === "open" || e.state === "dormant") && e.built >= 1 && !e.lost;

export interface Analysis {
  T: Float64Array; acc: number[]; cityNodes: (string | null)[];
  reach: Map<string, boolean>;               // settlement id -> can still reach its parent city
  potential: Map<string, number>;            // edge id -> local demand the settlements around it would generate (also for unused edges)
}
export function placeCellsNear(w: World, cell: number, r: number): number[] {
  const i = cell % w.nx, j = (cell / w.nx) | 0, out: number[] = [];
  for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) { const a = i + di, b = j + dj; if (a >= 0 && b >= 0 && a < w.nx && b < w.ny) out.push(b * w.nx + a); }
  return out;
}
export function analyze(sim: SimState, w: World): Analysis {
  const nodeIds = Object.keys(sim.nodes), pos = new Map(nodeIds.map((id, i) => [id, i])), nodeByCell = new Map<number, string>();
  for (const n of Object.values(sim.nodes)) nodeByCell.set(n.cell, n.id);
  const adj: { to: number; edge: SimEdge; t: number }[][] = nodeIds.map(() => []), edges = Object.values(sim.edges);
  for (const e of edges) { e.through = 0; e.local = 0; }
  for (const e of edges) if (passable(e)) { const a = pos.get(e.a)!, b = pos.get(e.b)!, t = e.lengthKm / Math.max(3, edgeSpeed(e)); adj[a].push({ to: b, edge: e, t }); adj[b].push({ to: a, edge: e, t }); }
  const nc = w.cities.length, cityNodes = w.cities.map((c) => nodeByCell.get(c.cell) ?? null), T = new Float64Array(nc * nc).fill(Infinity), reach = new Map<string, boolean>();
  const villagesOf = new Map<string, string[]>(); for (const s of Object.values(sim.settlements)) (villagesOf.get(s.city) ?? villagesOf.set(s.city, []).get(s.city)!).push(s.id);
  for (let i = 0; i < nc; i++) {
    const src = cityNodes[i]; if (!src) { for (const vid of villagesOf.get(w.cities[i].id) ?? []) reach.set(vid, false); continue; }
    const d = new Float64Array(nodeIds.length).fill(Infinity), pn = new Int32Array(nodeIds.length).fill(-1), pe: (SimEdge | null)[] = new Array(nodeIds.length).fill(null), h = new MinHeap(64), s0 = pos.get(src)!;
    d[s0] = 0; h.push(0, s0);
    while (h.size) { const { key, val } = h.pop(); if (key > d[val]) continue; for (const a of adj[val]) { const nd = key + a.t; if (nd < d[a.to]) { d[a.to] = nd; pn[a.to] = val; pe[a.to] = a.edge; h.push(nd, a.to); } } }
    for (let j = 0; j < nc; j++) if (j !== i && cityNodes[j]) T[i * nc + j] = d[pos.get(cityNodes[j]!)!];
    for (let j = i + 1; j < nc; j++) {
      const cn = cityNodes[j]; if (!cn) continue; const k0 = pos.get(cn)!; if (!isFinite(d[k0])) continue;
      const flow = KFLOW * Math.pow(sim.cities[w.cities[i].id].pop * sim.cities[w.cities[j].id].pop, 0.6) / (1 + Math.pow(d[k0], 1.2));
      for (let k = k0; pn[k] >= 0; k = pn[k]) pe[k]!.through += flow;
    }
    for (const vid of villagesOf.get(w.cities[i].id) ?? []) {
      const v = sim.settlements[vid], vn = nodeByCell.get(v.cell); if (!vn || v.gone) { reach.set(vid, !v.gone && false); if (v.gone) reach.set(vid, true); continue; }
      const k0 = pos.get(vn)!, ok = isFinite(d[k0]); reach.set(vid, ok); if (!ok) continue;
      for (let k = k0; pn[k] >= 0; k = pn[k]) pe[k]!.local += KVIL * v.pop;
    }
  }
  // settlements along a road generate local trips on it, whether or not the road is currently used
  const cellEdges = new Map<number, SimEdge[]>(); for (const e of edges) for (const c of e.cells) (cellEdges.get(c) ?? cellEdges.set(c, []).get(c)!).push(e);
  const potential = new Map<string, number>();
  for (const v of Object.values(sim.settlements)) {
    if (v.gone) continue; const hit = new Set<SimEdge>(); for (const c of placeCellsNear(w, v.cell, 2)) for (const e of cellEdges.get(c) ?? []) hit.add(e);
    if (!hit.size) continue; const share = (KLOC * v.pop) / hit.size; for (const e of hit) { potential.set(e.id, (potential.get(e.id) ?? 0) + share); if (passable(e)) e.local += share; }
  }
  for (const e of edges) { if (!passable(e)) { e.through = 0; e.local = 0; } e.traffic = Math.round((e.through + e.local) * 100) / 100; e.through = Math.round(e.through * 100) / 100; e.local = Math.round(e.local * 100) / 100; }
  const popTot = w.cities.reduce((s, c) => s + sim.cities[c.id].pop, 0), acc: number[] = [];
  for (let i = 0; i < nc; i++) { let s = 0; for (let j = 0; j < nc; j++) if (j !== i) { const t = T[i * nc + j]; if (isFinite(t)) s += sim.cities[w.cities[j].id].pop * Math.exp(-t / 3); } acc.push(popTot ? s / popTot : 0); }
  return { T, acc, cityNodes, reach, potential };
}
/** Settlements (and city links) that would be cut off *because of* removing `skip` (already-cut-off ones are not counted). */
export function strandedWithout(sim: SimState, w: World, skip: SimEdge | null): { villages: number; cities: number } {
  const nodeIds = Object.keys(sim.nodes), pos = new Map(nodeIds.map((id, i) => [id, i])), nodeByCell = new Map<number, number>(); for (const n of Object.values(sim.nodes)) nodeByCell.set(n.cell, pos.get(n.id)!);
  const comps = (omit: SimEdge | null) => {
    const adj: number[][] = nodeIds.map(() => []); for (const e of Object.values(sim.edges)) if (passable(e) && e !== omit) { const a = pos.get(e.a)!, b = pos.get(e.b)!; adj[a].push(b); adj[b].push(a); }
    const comp = new Int32Array(nodeIds.length).fill(-1); let c = 0;
    for (let s = 0; s < nodeIds.length; s++) if (comp[s] < 0) { const st = [s]; comp[s] = c; while (st.length) { const x = st.pop()!; for (const y of adj[x]) if (comp[y] < 0) { comp[y] = c; st.push(y); } } c++; }
    return comp;
  };
  const cut = (comp: Int32Array) => { let n = 0; for (const v of Object.values(sim.settlements)) { if (v.gone) continue; const pc = w.cityById.get(v.city), a = nodeByCell.get(v.cell), b = pc ? nodeByCell.get(pc.cell) : undefined; if (a === undefined || b === undefined || comp[a] !== comp[b]) n++; } return n; };
  const base = comps(null), now = comps(skip);
  return { villages: cut(now) - cut(base), cities: skip && now[pos.get(skip.a)!] !== now[pos.get(skip.b)!] ? 1 : 0 };
}
