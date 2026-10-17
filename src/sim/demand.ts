/**
 * Travel demand and route assignment. Two components are kept apart on every edge:
 *  - through (通過): city-to-city trips routed over the fastest path (so a faster bypass pulls them off the old road)
 *  - local   (沿線): trips of the settlements along the road and village-to-city trips (these stay on an old road)
 * All figures are synthetic "vehicles/day"; they are not statistics.
 */
import { goodsPull, paxPull } from "./sites";
import { MinHeap } from "../core/heap";
import { modeOf, type Mode, type Standard, type Surface, type SimEdge, type SimState } from "./types";
import type { World } from "./world";

export const KFLOW = 1.5e-3, KVIL = 0.04, KLOC = 0.02;
/** Rail units are passengers/day; road units are vehicles/day. One flow unit of trip demand is a vehicle on a road or RAIL_PAX passengers on a train. */
/** Ports and airports are supporting players: a port moves a share of coastal freight by sea, an airport a share of long passenger trips by air. */
export const SEA_FREIGHT = 0.22, AIR_MIN_KM = 300;
export const RAIL_PAX = 2, KFREIGHT = 6e-4, KRAIL_LOC = 0.06, RAIL_ACCESS_H = 0.4, BIAS_K = 0.75, LOGIT_S = 1.5;
export const ZERO_DEMAND = 4;                       // below this many vehicles/day a road counts as unused (explicit, not float noise)
export const ZERO_DEMAND_RAIL = 25;                 // ... and this many passengers/day for a railway
export const zeroDemand = (e: SimEdge) => (modeOf(e) === "rail" ? ZERO_DEMAND_RAIL : ZERO_DEMAND);
export const CAPACITY: Record<Standard, number> = { rural: 3000, standard: 12000, highgrade: 40000 };
export const RAIL_CAPACITY: Record<Standard, number> = { rural: 6000, standard: 30000, highgrade: 100000 };
export const capacityOf = (e: SimEdge) => (modeOf(e) === "rail" ? RAIL_CAPACITY : CAPACITY)[e.standard];
const BASE_SPEED: Record<Standard, number> = { rural: 25, standard: 45, highgrade: 80 };
const RAIL_SPEED: Record<Standard, number> = { rural: 38, standard: 75, highgrade: 190 };
const SURF: Record<Surface, number> = { unpaved: 0.6, gravel: 0.8, paved: 1 };
/** Curve penalty on speed: a railway is hurt more by tight curves than a road is; only Stage 3 edges carry a curvature. */
const curveFactor = (e: SimEdge, k: number) => 1 - Math.min(0.35, (e.curv ?? 0) * k);
export const FERRY_SPEED = 28, FERRY_WAIT_H = 0.7;   // a ferry is slow and waits for its sailing (the same for cars and for the rail steamer)
export const edgeSpeed = (e: SimEdge) => e.facility === "ferry" ? FERRY_SPEED : modeOf(e) === "rail"
  ? RAIL_SPEED[e.standard] * (0.6 + 0.4 * e.quality / 100) * (1 - Math.min(0.3, e.maxGradePct / 40)) * curveFactor(e, 0.35)
  : BASE_SPEED[e.standard] * SURF[e.surface] * (0.5 + 0.5 * e.quality / 100) * (1 - Math.min(0.4, e.maxGradePct / 50)) * curveFactor(e, 0.2);
export const passable = (e: SimEdge) => (e.state === "open" || e.state === "dormant") && e.built >= 1 && !e.lost;

export interface Analysis {
  airShare: number; seaShare: number;   // share of long passenger trips by air / of coastal freight by sea (Stage 3 supporting modes)
  T: Float64Array; TT: Float64Array; acc: number[]; cityNodes: (string | null)[];
  reach: Map<string, boolean>;               // settlement id -> can still reach its parent city
  potential: Map<string, number>;            // edge id -> local demand the settlements around it would generate (also for unused edges)
}
export function placeCellsNear(w: World, cell: number, r: number): number[] {
  const i = cell % w.nx, j = (cell / w.nx) | 0, out: number[] = [];
  for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) { const a = i + di, b = j + dj; if (a >= 0 && b >= 0 && a < w.nx && b < w.ny) out.push(b * w.nx + a); }
  return out;
}
interface Adj { to: number; edge: SimEdge; t: number }
interface Tree { d: Float64Array; pn: Int32Array; pe: (SimEdge | null)[] }
function dijkstra(adj: Adj[][], n: number, s0: number): Tree {
  const d = new Float64Array(n).fill(Infinity), pn = new Int32Array(n).fill(-1), pe: (SimEdge | null)[] = new Array(n).fill(null), h = new MinHeap(64);
  d[s0] = 0; h.push(0, s0);
  while (h.size) { const { key, val } = h.pop(); if (key > d[val]) continue; for (const a of adj[val]) { const nd = key + a.t; if (nd < d[a.to]) { d[a.to] = nd; pn[a.to] = val; pe[a.to] = a.edge; h.push(nd, a.to); } } }
  return { d, pn, pe };
}
/**
 * Stage 7: the trips of a village beside a railway are split between the train and the car like any other trip -- by the era's car and rail preference
 * (the same dials the city-to-city split reads). Before this the railway kept every village's trips whatever happened to the car, so a rural line could
 * never lose its riders to the road and the road-minded world lines kept their branch lines open for ever. 1 = the old fixed amount; the factor runs
 * from about 1.3 (1950, few cars) to 0.15 (a car society), never zero (school and elderly riders).
 */
export const LOCAL_CAR_TILT = 0.3, LOCAL_RAIL_MIN = 0.15, LOCAL_RAIL_MAX = 1.4;
export function localCarShare(dl: { carBias: number; railBias: number }): number { return 1 / (1 + Math.exp(-LOGIT_S * (BIAS_K * (dl.carBias - dl.railBias) + LOCAL_CAR_TILT))); }
export function localRailFactor(dl: { carBias: number; railBias: number }): number { return Math.max(LOCAL_RAIL_MIN, Math.min(LOCAL_RAIL_MAX, 2 * (1 - localCarShare(dl)))); }
/** Share of a trip that takes the train, from the two travel times and the era's biases. 0 when there is no railway, 1 when there is no road. */
export function railShare(tRoad: number, tRail: number, carBias: number, railBias: number): number {
  const road = isFinite(tRoad), rail = isFinite(tRail); if (!rail) return 0; if (!road) return 1;
  const x = Math.log(((tRail + RAIL_ACCESS_H) * Math.exp(-BIAS_K * railBias)) / (tRoad * Math.exp(-BIAS_K * carBias)));   // >0: rail is the slower choice
  return 1 / (1 + Math.exp(LOGIT_S * x));
}
/** Share of a long trip taken by air: both ends need an airport, it grows with distance, and a good railway takes some of it back. */
export function airShare(sim: SimState, w: World, i: number, j: number, railS: number): number {
  const a = sim.cities[w.cities[i].id], b = sim.cities[w.cities[j].id]; if (a.airport === undefined || b.airport === undefined) return 0;
  const d = Math.hypot(w.cities[i].pos[0] - w.cities[j].pos[0], w.cities[i].pos[1] - w.cities[j].pos[1]); if (d < AIR_MIN_KM) return 0;
  return Math.min(0.55 + 0.15 * Math.min(1, sim.dials.airBias), (0.08 + 0.5 * (1 - Math.exp(-(d - AIR_MIN_KM) / 450))) * (1 - 0.45 * railS) * (1 + 0.8 * sim.dials.airBias));
}
/** The whole analysis in one go (tests, tools). The game itself uses `analyzeGen` so a long pass can be cut into slices. */
export function analyze(sim: SimState, w: World): Analysis { const g = analyzeGen(sim, w); for (;;) { const r = g.next(); if (r.done) return r.value; } }
export function* analyzeGen(sim: SimState, w: World): Generator<void, Analysis> {
  const nodeIds = Object.keys(sim.nodes), pos = new Map(nodeIds.map((id, i) => [id, i])), nodeByCell = new Map<number, string>(), N = nodeIds.length;
  for (const n of Object.values(sim.nodes)) nodeByCell.set(n.cell, n.id);
  const multi = sim.stage3 === true, dl = sim.dials;
  const adjRoad: Adj[][] = nodeIds.map(() => []), adjRail: Adj[][] = nodeIds.map(() => []), edges = Object.values(sim.edges);
  for (const e of edges) { e.through = 0; e.local = 0; e.freight = 0; }
  let anyRail = false, airFlow = 0, landFlow = 0, seaFr = 0, landFr = 0;
  for (const e of edges) if (passable(e)) {
    const a = pos.get(e.a)!, b = pos.get(e.b)!, t = e.lengthKm / Math.max(3, edgeSpeed(e)) + (e.facility === "ferry" ? FERRY_WAIT_H : 0), g = modeOf(e) === "rail" ? adjRail : adjRoad; if (g === adjRail) anyRail = true;
    g[a].push({ to: b, edge: e, t }); g[b].push({ to: a, edge: e, t });
  }
  const nc = w.cities.length, cityNodes = w.cities.map((c) => nodeByCell.get(c.cell) ?? null), T = new Float64Array(nc * nc).fill(Infinity), TT = new Float64Array(nc * nc).fill(Infinity), reach = new Map<string, boolean>();
  const villagesOf = new Map<string, string[]>(); for (const s of Object.values(sim.settlements)) (villagesOf.get(s.city) ?? villagesOf.set(s.city, []).get(s.city)!).push(s.id);
  const railDeg = new Int32Array(N); if (anyRail) for (let i = 0; i < N; i++) railDeg[i] = adjRail[i].length;
  for (let i = 0; i < nc; i++) {
    if (i > 0 && i % 6 === 0) yield;   // a slice of work per few source cities keeps each frame short
    const src = cityNodes[i]; if (!src) { for (const vid of villagesOf.get(w.cities[i].id) ?? []) reach.set(vid, false); continue; }
    const s0 = pos.get(src)!, R = dijkstra(adjRoad, N, s0), Q = anyRail && railDeg[s0] > 0 ? dijkstra(adjRail, N, s0) : null;
    for (let j = 0; j < nc; j++) if (j !== i && cityNodes[j]) { const k = pos.get(cityNodes[j]!)!; T[i * nc + j] = R.d[k]; if (Q) TT[i * nc + j] = Q.d[k]; }
    for (let j = i + 1; j < nc; j++) {
      const cn = cityNodes[j]; if (!cn) continue; const k0 = pos.get(cn)!, tr = R.d[k0], tt = Q ? Q.d[k0] : Infinity;
      if (!isFinite(tr) && !isFinite(tt)) continue;
      const pi = sim.cities[w.cities[i].id], pj = sim.cities[w.cities[j].id];
      if (!multi) {   // Stage 2 (roads only): the original formula, untouched
        const flow = KFLOW * Math.pow(pi.pop * pj.pop, 0.6) / (1 + Math.pow(tr, 1.2));
        for (let k = k0; R.pn[k] >= 0; k = R.pn[k]) R.pe[k]!.through += flow;
        continue;
      }
      const s = railShare(tr, tt, dl.carBias, dl.railBias), tmin = Math.min(tr, isFinite(tt) ? tt + RAIL_ACCESS_H : Infinity);
      const ai = paxPull(sim, w, w.cities[i].id), aj = paxPull(sim, w, w.cities[j].id), gi = goodsPull(sim, w, w.cities[i].id), gj = goodsPull(sim, w, w.cities[j].id);   // Issue #18: seats and sights shift a city's pull on passengers (commerce, tourism) and goods (manufacturing)
      const flow = KFLOW * Math.pow(pi.pop * ai * pj.pop * aj, 0.6) / (1 + Math.pow(tmin, 1.2));
      const air = airShare(sim, w, i, j, s), land = flow * (1 - air); airFlow += flow * air; landFlow += land;
      if (s < 1) for (let k = k0; R.pn[k] >= 0; k = R.pn[k]) R.pe[k]!.through += land * (1 - s);
      if (s > 0 && Q) for (let k = k0; Q.pn[k] >= 0; k = Q.pn[k]) Q.pe[k]!.through += land * s * RAIL_PAX;
      // freight: industry-to-industry; trucks take it unless the railway is competitive and the era favours it
      const f0 = KFREIGHT * Math.pow(pi.pop * pi.industry * gi * pj.pop * pj.industry * gj, 0.6) / (1 + Math.pow(tmin, 1.2)), sf = railShare(tr, tt, dl.carBias * 0.4 - dl.freightRail, dl.railBias * 0.4 + dl.freightRail);
      const sea = w.cities[i].coastal && w.cities[j].coastal ? Math.min(0.6, SEA_FREIGHT * (1 + dl.seaBias)) : 0, fl = f0 * (1 - sea); seaFr += f0 * sea; landFr += fl;
      if (sf < 1) for (let k = k0; R.pn[k] >= 0; k = R.pn[k]) R.pe[k]!.freight += fl * (1 - sf);
      if (sf > 0 && Q) for (let k = k0; Q.pn[k] >= 0; k = Q.pn[k]) Q.pe[k]!.freight += fl * sf * RAIL_PAX;
    }
    for (const vid of villagesOf.get(w.cities[i].id) ?? []) {
      const v = sim.settlements[vid], vn = nodeByCell.get(v.cell); if (!vn || v.gone) { reach.set(vid, !v.gone && false); if (v.gone) reach.set(vid, true); continue; }
      const k0 = pos.get(vn)!, ok = isFinite(R.d[k0]); reach.set(vid, ok); if (!ok) continue;
      for (let k = k0; R.pn[k] >= 0; k = R.pn[k]) R.pe[k]!.local += KVIL * v.pop;
    }
  }
  // settlements along a road generate local trips on it, whether or not the road is currently used
  const cellEdges = new Map<number, SimEdge[]>(); for (const e of edges) for (const c of e.cells) (cellEdges.get(c) ?? cellEdges.set(c, []).get(c)!).push(e);
  const potential = new Map<string, number>();
  for (const v of Object.values(sim.settlements)) {
    if (v.gone) continue; const hit = new Set<SimEdge>(); for (const c of placeCellsNear(w, v.cell, 2)) for (const e of cellEdges.get(c) ?? []) hit.add(e);
    if (!hit.size) continue;
    const road = [...hit].filter((e) => modeOf(e) === "road"), rail = [...hit].filter((e) => modeOf(e) === "rail");
    if (road.length) { const share = (KLOC * v.pop) / road.length; for (const e of road) { potential.set(e.id, (potential.get(e.id) ?? 0) + share); if (passable(e)) e.local += share; } }
    if (rail.length) { const share = (KRAIL_LOC * v.pop * (multi ? localRailFactor(dl) : 1)) / rail.length; for (const e of rail) { potential.set(e.id, (potential.get(e.id) ?? 0) + share); if (passable(e)) e.local += share; } }
  }
  for (const e of edges) {
    if (!passable(e)) { e.through = 0; e.local = 0; e.freight = 0; }
    e.traffic = Math.round((e.through + e.local + (multi ? e.freight * 0.4 : 0)) * 100) / 100;
    e.through = Math.round(e.through * 100) / 100; e.local = Math.round(e.local * 100) / 100; e.freight = Math.round(e.freight * 100) / 100;
  }
  const popTot = w.cities.reduce((s, c) => s + sim.cities[c.id].pop, 0), acc: number[] = [];
  for (let i = 0; i < nc; i++) { let s = 0; for (let j = 0; j < nc; j++) if (j !== i) { const t = Math.min(T[i * nc + j], TT[i * nc + j] + RAIL_ACCESS_H); if (isFinite(t)) s += sim.cities[w.cities[j].id].pop * Math.exp(-t / 3); } acc.push(popTot ? s / popTot : 0); }
  return { T, TT, acc, cityNodes, reach, potential, airShare: airFlow + landFlow > 0 ? airFlow / (airFlow + landFlow) : 0, seaShare: seaFr + landFr > 0 ? seaFr / (seaFr + landFr) : 0 };
}
/** Settlements (and city links) that would be cut off *because of* removing `skip` (already-cut-off ones are not counted). */
export function strandedWithout(sim: SimState, w: World, skip: SimEdge | null): { villages: number; cities: number } {
  if (skip && modeOf(skip) === "rail") return { villages: 0, cities: 0 };   // settlements reach their city by road; a railway closing strands no one in this model
  const nodeIds = Object.keys(sim.nodes), pos = new Map(nodeIds.map((id, i) => [id, i])), nodeByCell = new Map<number, number>(); for (const n of Object.values(sim.nodes)) nodeByCell.set(n.cell, pos.get(n.id)!);
  const comps = (omit: SimEdge | null) => {
    const adj: number[][] = nodeIds.map(() => []); for (const e of Object.values(sim.edges)) if (passable(e) && modeOf(e) === "road" && e !== omit) { const a = pos.get(e.a)!, b = pos.get(e.b)!; adj[a].push(b); adj[b].push(a); }
    const comp = new Int32Array(nodeIds.length).fill(-1); let c = 0;
    for (let s = 0; s < nodeIds.length; s++) if (comp[s] < 0) { const st = [s]; comp[s] = c; while (st.length) { const x = st.pop()!; for (const y of adj[x]) if (comp[y] < 0) { comp[y] = c; st.push(y); } } c++; }
    return comp;
  };
  const cut = (comp: Int32Array) => { let n = 0; for (const v of Object.values(sim.settlements)) { if (v.gone) continue; const pc = w.cityById.get(v.city), a = nodeByCell.get(v.cell), b = pc ? nodeByCell.get(pc.cell) : undefined; if (a === undefined || b === undefined || comp[a] !== comp[b]) n++; } return n; };
  const base = comps(null), now = comps(skip);
  return { villages: cut(now) - cut(base), cities: skip && now[pos.get(skip.a)!] !== now[pos.get(skip.b)!] ? 1 : 0 };
}
