/**
 * Travel demand and route assignment. Two components are kept apart on every edge:
 *  - through (通過): city-to-city trips routed over the fastest path (so a faster bypass pulls them off the old road)
 *  - local   (沿線): trips of the settlements along the road and village-to-city trips (these stay on an old road)
 * All figures are synthetic "vehicles/day"; they are not statistics.
 */
import { goodsPull, paxPull } from "./sites";
import { airportMap, hubDemand, JET_YEAR, type HubTotals } from "./hubs";
import { MinHeap } from "../core/heap";
import { modeOf, type Mode, type Standard, type Surface, type SimEdge, type SimState } from "./types";
import type { World } from "./world";
import { realToLonLat } from "../core/data";

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
export const FERRY_SPEED = 28, FERRY_WAIT_H = 0.7, FERRY_PORT_PAX = 0.3;   // Stage 10: a ferry's vehicles count this much each toward its ports' traffic (beside its freight)   // a ferry is slow and waits for its sailing (the same for cars and for the rail steamer)
export const MAGLEV_SPEED = 420;
export const edgeSpeed = (e: SimEdge) => e.facility === "ferry" ? FERRY_SPEED : e.maglev && modeOf(e) === "rail" ? MAGLEV_SPEED * (0.7 + 0.3 * e.quality / 100) : modeOf(e) === "rail"
  ? RAIL_SPEED[e.standard] * (0.6 + 0.4 * e.quality / 100) * (1 - Math.min(0.3, e.maxGradePct / 40)) * curveFactor(e, 0.35)
  : BASE_SPEED[e.standard] * SURF[e.surface] * (0.5 + 0.5 * e.quality / 100) * (1 - Math.min(0.4, e.maxGradePct / 50)) * curveFactor(e, 0.2);
export const passable = (e: SimEdge) => (e.state === "open" || e.state === "dormant") && e.built >= 1 && !e.lost;

export interface Analysis {
  airShare: number; seaShare: number;   // share of long passenger trips by air / of coastal freight by sea (Stage 3 supporting modes)
  T: Float64Array; TT: Float64Array; acc: number[]; cityNodes: (string | null)[];
  reach: Map<string, boolean>;               // settlement id -> can still reach its parent city
  potential: Map<string, number>;            // edge id -> local demand the settlements around it would generate (also for unused edges)
  airPkm?: number; seaTkm?: number;          // Stage 8: domestic air traveller-km and sea freight-km this year (for the mode comparison)
  hub?: HubTotals;                           // Stage 8: what each port and airport handled this year (hubs.ts), when the game has them
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
/**
 * Stage 12: weather and the running of a service. A lane that needs no land structure still has to be flown or sailed, and weather decides how often it is:
 * the expected share of its trips that arrive on time. It is a simple model, not a forecast -- the northern and exposed coasts lose more days to snow and rough
 * sea, the sea more than the air, and forecasting and bigger ships claw some of it back over the decades. Games from Stage 12 on only (1 elsewhere).
 */
export const AIR_ONTIME = 0.93, SEA_ONTIME = 0.85;
const exposureLat = (w: World, i: number) => Math.max(0, Math.min(1, (realToLonLat(w.cities[i].pos as [number, number])[1] - 34) / 8));
export function weatherFactor(sim: SimState, w: World, mode: "air" | "sea", i: number, j: number): number {
  if (!sim.econ) return 1; const y = sim.startYear + Math.floor(sim.month / 12), base = mode === "air" ? AIR_ONTIME : SEA_ONTIME, gain = 1 - 0.3 * Math.max(0, Math.min(1, (y - 1950) / 100));
  return Math.max(0.5, 1 - (1 - base) * (1 + 0.6 * (exposureLat(w, i) + exposureLat(w, j))) * gain);
}
/** Share of a long trip taken by air: both ends need an airport, it grows with distance, and a good railway takes some of it back. */
export function airShare(sim: SimState, w: World, i: number, j: number, railS: number, ap: (string | null)[] | null = null): number {
  const h = sim.hubs, m = h ? ap ?? airportMap(sim, w) : null, ai = m ? m[i] : null, aj = m ? m[j] : null;
  if (h ? !ai || !aj || ai === aj : sim.cities[w.cities[i].id].airport === undefined || sim.cities[w.cities[j].id].airport === undefined) return 0;
  const d = Math.hypot(w.cities[i].pos[0] - w.cities[j].pos[0], w.cities[i].pos[1] - w.cities[j].pos[1]); if (d < AIR_MIN_KM) return 0;
  const base = Math.min(0.55 + 0.15 * Math.min(1, sim.dials.airBias), (0.08 + 0.5 * (1 - Math.exp(-(d - AIR_MIN_KM) / 450))) * (1 - 0.45 * railS) * (1 + 0.8 * sim.dials.airBias));
  if (!h) return base;
  // Stage 8: the plane competes on time and price as well as distance -- slow propeller years, cheaper fares later -- a full airport turns trips away,
  // and a city without its own airport flies from its neighbour's (a longer trip to the airport)
  const y = sim.startYear + Math.floor(sim.month / 12), A = h.airports[ai!], B = h.airports[aj!], full = Math.max(A?.load ?? 0, B?.load ?? 0), borrow = (ai === w.cities[i].id ? 1 : 0.75) * (aj === w.cities[j].id ? 1 : 0.75);
  return base * borrow * (y < JET_YEAR ? 0.55 : y < 1970 ? 0.8 : y >= 2012 ? 1.1 : 1) * (full > 1 ? 1 / full : 1) * weatherFactor(sim, w, "air", i, j);
}
/** Stage 8: the share of a domestic freight trip between two coastal cities that goes by ship: both need a port, short hauls stay on land, a full port turns cargo away. */
export function seaShareOf(sim: SimState, w: World, i: number, j: number): number {
  const a = w.cities[i], b = w.cities[j]; if (!a.coastal || !b.coastal) return 0;
  const base = Math.min(0.6, SEA_FREIGHT * (1 + sim.dials.seaBias)), h = sim.hubs; if (!h) return base;
  const P = h.ports[a.id], Q = h.ports[b.id]; if (!P || !Q || P.until !== undefined || Q.until !== undefined) return 0;
  const d = Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1]), full = Math.max(P.load, Q.load);
  return Math.min(0.6, base * Math.min(1.5, Math.max(0.15, (d - 60) / 300))) * (full > 1 ? 1 / full : 1) * weatherFactor(sim, w, "sea", i, j);
}
/** The whole analysis in one go (tests, tools). The game itself uses `analyzeGen` so a long pass can be cut into slices. */
export function analyze(sim: SimState, w: World): Analysis { const g = analyzeGen(sim, w); for (;;) { const r = g.next(); if (r.done) return r.value; } }
export function* analyzeGen(sim: SimState, w: World): Generator<void, Analysis> {
  const nodeIds = Object.keys(sim.nodes), pos = new Map(nodeIds.map((id, i) => [id, i])), nodeByCell = new Map<number, string>(), N = nodeIds.length;
  for (const n of Object.values(sim.nodes)) nodeByCell.set(n.cell, n.id);
  const multi = sim.stage3 === true, dl = sim.dials;
  const adjRoad: Adj[][] = nodeIds.map(() => []), adjRail: Adj[][] = nodeIds.map(() => []), edges = Object.values(sim.edges);
  for (const e of edges) { e.through = 0; e.local = 0; e.freight = 0; }
  let anyRail = false, airFlow = 0, landFlow = 0, seaFr = 0, landFr = 0, airPkm = 0, seaTkm = 0;
  for (const e of edges) if (passable(e)) {
    const a = pos.get(e.a)!, b = pos.get(e.b)!, t = e.lengthKm / Math.max(3, edgeSpeed(e)) + (e.facility === "ferry" ? FERRY_WAIT_H : 0), g = modeOf(e) === "rail" ? adjRail : adjRoad; if (g === adjRail) anyRail = true;
    g[a].push({ to: b, edge: e, t }); g[b].push({ to: a, edge: e, t });
  }
  const nc = w.cities.length, cityNodes = w.cities.map((c) => nodeByCell.get(c.cell) ?? null), T = new Float64Array(nc * nc).fill(Infinity), TT = new Float64Array(nc * nc).fill(Infinity), reach = new Map<string, boolean>();
  const villagesOf = new Map<string, string[]>(); for (const s of Object.values(sim.settlements)) (villagesOf.get(s.city) ?? villagesOf.set(s.city, []).get(s.city)!).push(s.id);
  const railDeg = new Int32Array(N); if (anyRail) for (let i = 0; i < N; i++) railDeg[i] = adjRail[i].length;
  // Stage 8: the trees from port and airport cities are kept, so the trips to them can be put on the network once every travel time is known
  const apMap = multi && sim.hubs ? airportMap(sim, w) : null;
  const hubCity = new Set<number>(), trees = new Map<number, { R: Tree; Q: Tree | null }>(), pairs = new Map<string, number>(), domSea = new Map<string, number>(), domAir = new Map<string, number>();
  if (multi && sim.hubs) w.cities.forEach((c, i) => { if (sim.hubs!.ports[c.id] || sim.hubs!.airports[c.id]) hubCity.add(i); });
  for (let i = 0; i < nc; i++) {
    if (i > 0 && i % 6 === 0) yield;   // a slice of work per few source cities keeps each frame short
    const src = cityNodes[i]; if (!src) { for (const vid of villagesOf.get(w.cities[i].id) ?? []) reach.set(vid, false); continue; }
    const s0 = pos.get(src)!, R = dijkstra(adjRoad, N, s0), Q = anyRail && railDeg[s0] > 0 ? dijkstra(adjRail, N, s0) : null;
    for (let j = 0; j < nc; j++) if (j !== i && cityNodes[j]) { const k = pos.get(cityNodes[j]!)!; T[i * nc + j] = R.d[k]; if (Q) TT[i * nc + j] = Q.d[k]; }
    if (hubCity.has(i)) trees.set(i, { R, Q });
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
      const air = airShare(sim, w, i, j, s, apMap), land = flow * (1 - air); airFlow += flow * air; landFlow += land;
      if (air > 0 && sim.hubs) { const a = apMap![i]!, b = apMap![j]!, p = flow * air * RAIL_PAX; airPkm += p * Math.hypot(w.cities[i].pos[0] - w.cities[j].pos[0], w.cities[i].pos[1] - w.cities[j].pos[1]); pairs.set(a < b ? `${a}|${b}` : `${b}|${a}`, p); domAir.set(a, (domAir.get(a) ?? 0) + p); domAir.set(b, (domAir.get(b) ?? 0) + p); }
      if (s < 1) for (let k = k0; R.pn[k] >= 0; k = R.pn[k]) R.pe[k]!.through += land * (1 - s);
      if (s > 0 && Q) for (let k = k0; Q.pn[k] >= 0; k = Q.pn[k]) Q.pe[k]!.through += land * s * RAIL_PAX;
      // freight: industry-to-industry; trucks take it unless the railway is competitive and the era favours it
      const f0 = KFREIGHT * Math.pow(pi.pop * pi.industry * gi * pj.pop * pj.industry * gj, 0.6) / (1 + Math.pow(tmin, 1.2)), sf = railShare(tr, tt, dl.carBias * 0.4 - dl.freightRail, dl.railBias * 0.4 + dl.freightRail);
      const sea = seaShareOf(sim, w, i, j), fl = f0 * (1 - sea); seaFr += f0 * sea; landFr += fl;
      if (sea > 0) seaTkm += f0 * sea * Math.hypot(w.cities[i].pos[0] - w.cities[j].pos[0], w.cities[i].pos[1] - w.cities[j].pos[1]);
      if (sea > 0 && sim.hubs) for (const c of [w.cities[i].id, w.cities[j].id]) domSea.set(c, (domSea.get(c) ?? 0) + f0 * sea);
      if (sf < 1) for (let k = k0; R.pn[k] >= 0; k = R.pn[k]) R.pe[k]!.freight += fl * (1 - sf);
      if (sf > 0 && Q) for (let k = k0; Q.pn[k] >= 0; k = Q.pn[k]) Q.pe[k]!.freight += fl * sf * RAIL_PAX;
    }
    for (const vid of villagesOf.get(w.cities[i].id) ?? []) {
      const v = sim.settlements[vid], vn = nodeByCell.get(v.cell); if (!vn || v.gone) { reach.set(vid, !v.gone && false); if (v.gone) reach.set(vid, true); continue; }
      const k0 = pos.get(vn)!, ok = isFinite(R.d[k0]); reach.set(vid, ok); if (!ok) continue;
      for (let k = k0; R.pn[k] >= 0; k = R.pn[k]) R.pe[k]!.local += KVIL * v.pop;
    }
  }
  // Stage 8: foreign trade to the ports and travellers to the ports and airports ride the roads and railways like any other trip
  let hub: HubTotals | undefined;
  const hf = multi ? hubDemand(sim, w, T, TT) : null;
  if (hf) {
    hub = { port: new Map(), air: new Map(), pairs, unmet: hf.unmet };
    const load = (p: number, j: number, cargo: number, pax: number) => {   // a trickle is not worth a walk of the tree
      const tr = trees.get(p), cn = cityNodes[j]; if (!tr || !cn || p === j || (cargo < 1 && pax < 2)) return; const k0 = pos.get(cn)!, tr0 = tr.R.d[k0], tt0 = tr.Q ? tr.Q.d[k0] : Infinity;
      const s = railShare(tr0, tt0, dl.carBias, dl.railBias), sf = railShare(tr0, tt0, dl.carBias * 0.4 - dl.freightRail, dl.railBias * 0.4 + dl.freightRail), roadP = (pax / RAIL_PAX) * (1 - (isFinite(tt0) ? s : 0));
      if (isFinite(tr0)) for (let k = k0; tr.R.pn[k] >= 0; k = tr.R.pn[k]) { const e = tr.R.pe[k]!; e.through += roadP; e.freight += cargo * (1 - (isFinite(tt0) ? sf : 0)); }
      if (tr.Q && isFinite(tt0)) for (let k = k0; tr.Q.pn[k] >= 0; k = tr.Q.pn[k]) { const e = tr.Q.pe[k]!; e.through += pax * s; e.freight += cargo * sf * RAIL_PAX; }
    };
    for (const p of hf.ports) { let c = 0, x = 0; for (let j = 0; j < nc; j++) { c += p.cargo[j]; x += p.pax[j]; load(p.i, j, p.cargo[j], p.pax[j]); } hub.port.set(p.id, { cargo: c, pax: x, dom: 0 }); }
    for (const a of hf.airs) {
      let c = 0, x = 0; for (let j = 0; j < nc; j++) { c += a.cargo[j]; x += a.pax[j] + a.feed[j]; load(a.i, j, a.cargo[j], a.pax[j]); }
      hub.air.set(a.id, { intl: x, cargo: c, dom: 0 });
      for (let j = 0; j < nc; j++) if (a.feed[j] > 0) { const id = w.cities[j].id; domAir.set(id, (domAir.get(id) ?? 0) + a.feed[j]); }   // the connecting flight fills the home airport too
    }
    // Stage 10: what a sea ferry carries (vehicles and their goods) is handled at the ports at its two ends, so a busy ferry grows its ports
    if (sim.roles) for (const e of Object.values(sim.edges)) { if (e.facility !== "ferry" || e.state !== "open" || (e.facilityName ?? "").startsWith("ferry:【湖】")) continue; const v = e.freight + FERRY_PORT_PAX * e.through; if (v <= 0) continue; for (const k of [e.cells[0], e.cells[e.cells.length - 1]]) { const c = w.cityByCell.get(k); if (c && sim.hubs?.ports[c.id]) domSea.set(c.id, (domSea.get(c.id) ?? 0) + v); } }
    for (const [id, v] of domSea) { const t = hub.port.get(id) ?? { cargo: 0, pax: 0, dom: 0 }; t.dom = v; hub.port.set(id, t); }
    for (const [id, v] of domAir) { const t = hub.air.get(id) ?? { intl: 0, cargo: 0, dom: 0 }; t.dom = v; hub.air.set(id, t); }
    // the last leg, city to airport site, on the airport's own access road and railway
    for (const a of Object.values(sim.hubs!.airports)) {
      if (a.until !== undefined) continue; const t = hub.air.get(a.city); if (!t) continue; const pax = t.intl + t.dom, rail = (a.railIds ?? []).map((id) => sim.edges[id]).filter((e) => e && passable(e)), rs = rail.length ? 0.4 : 0;
      for (const id of a.access) { const e = sim.edges[id]; if (e && passable(e)) e.through += (pax * (1 - rs)) / RAIL_PAX; }
      for (const e of rail) e.through += pax * rs;
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
  return { T, TT, acc, cityNodes, reach, potential, ...(hub ? { hub } : {}), airPkm: Math.round(airPkm), seaTkm: Math.round(seaTkm), airShare: airFlow + landFlow > 0 ? airFlow / (airFlow + landFlow) : 0, seaShare: seaFr + landFr > 0 ? seaFr / (seaFr + landFr) : 0 };
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
