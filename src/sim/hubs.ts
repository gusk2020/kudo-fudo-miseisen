/**
 * Stage 8: trade ports and airports (港湾・空港) as facilities with a size, a capacity, routes and a history.
 *
 * Until now a port was a blue square at every coastal city and an airport opened once and for all when its city was big enough; the sea and the air took
 * a fixed share of trips and nothing else happened. Here both are facilities that grow, shrink and close, carry real demand and put it on the land network:
 *
 *   demand    Each city has foreign trade (its people and industry, times the era's trade index) and international travellers (its people, times the
 *             era's travel index). Domestic air trips come from the city-to-city model (demand.ts), domestic coastal freight likewise.
 *   catchment Foreign trade goes to the ports a city can reach, weighted by the port's size and how long the trip is (road or rail, whichever is
 *             quicker); a full port loses part of its pull to the next one. Travellers split between ship and plane by era (the liner gives way to the
 *             jet in the 1960s), and go to an international airport the same way. The trip to the port or airport is loaded onto the roads and railways
 *             like any other trip, so a big port fills the trunk roads behind it and a hub airport its access line.
 *   routes    A port's foreign trade is split over abstract foreign destinations (FOREIGN: directions, not real ports) by the era's trade pattern and by
 *             which way the port faces the sea; a destination that carries enough becomes a regular route (航路), one that falls away is suspended and
 *             then abolished. Airports get domestic routes from the busiest city pairs and international ones like the ports.
 *   size      Ports have four tiers (地方港湾 → 国際戦略港湾), airports two kinds with a clear gap: a regional airport (1,200-2,500 m runway, a few
 *             thousand travellers a day) and an international hub (3,000 m and more, tens of thousands, expanded runway by runway). A facility running
 *             full for two years is expanded if the era wants it (seaBias / airBias) and the money is there; one left nearly empty for a decade is cut back,
 *             a tiny one closed. Containers (from 1968) and jets (from about 1960) are the technology steps; works take several years.
 *   region    A busy port lifts its city's industry and a hub its growth, but by bounded amounts (hubBoost): nothing here can grow without limit.
 *
 * Pure rules over the sim and the map; no real port or airport names, no timetables. Absent `sim.hubs` (older saves) it is created at the next yearly step.
 */
import { dist } from "../core/geom";
import { terrainGate } from "./land";
import type { Vec } from "../core/types";
import { ev } from "./engine";
import { buildIndex, layPath } from "./network";
import { goodsPull, paxPull } from "./sites";
import { modeOf, type AirportState, type HubRoute, type HubsState, type PortState, type SimState } from "./types";
import { pathfind, type World } from "./world";

type Key = [number, number][];
const at = (k: Key, y: number) => { if (y <= k[0][0]) return k[0][1]; for (let i = 1; i < k.length; i++) if (y <= k[i][0]) { const [a, va] = k[i - 1], [b, vb] = k[i]; return va + ((vb - va) * (y - a)) / (b - a); } return k[k.length - 1][1]; };
const unit = (x: number, y: number): Vec => { const n = Math.hypot(x, y); return [x / n, y / n]; };

/** Abstract foreign destinations: a direction from Japan (world east/north) and their share of trade by year. Model values, not statistics. */
export interface Foreign { id: string; name: string; dir: Vec; share: Key }
export const FOREIGN: Foreign[] = [
  { id: "kr", name: "朝鮮半島方面", dir: unit(-1, 0.1), share: [[1950, 0.05], [1965, 0.08], [1990, 0.12], [2100, 0.12]] },
  { id: "cn", name: "大陸東岸方面", dir: unit(-1, -0.4), share: [[1950, 0.04], [1972, 0.05], [1990, 0.12], [2010, 0.25], [2100, 0.22]] },
  { id: "ru", name: "沿海州方面", dir: unit(-0.3, 1), share: [[1950, 0.02], [1990, 0.03], [2100, 0.05]] },
  { id: "sea", name: "東南アジア方面", dir: unit(-0.5, -1), share: [[1950, 0.12], [1980, 0.16], [2100, 0.22]] },
  { id: "na", name: "北米方面", dir: unit(1, 0.35), share: [[1950, 0.45], [1980, 0.32], [2010, 0.2], [2100, 0.16]] },
  { id: "oc", name: "豪州方面", dir: unit(0.15, -1), share: [[1950, 0.1], [1975, 0.12], [2100, 0.1]] },
  { id: "eu", name: "欧州・中東方面", dir: unit(-0.7, -0.7), share: [[1950, 0.22], [1980, 0.2], [2100, 0.13]] },
];
export const foreignName = (id: string) => FOREIGN.find((f) => f.id === id)?.name ?? id;
export const foreignShares = (y: number) => { const s = FOREIGN.map((f) => at(f.share, y)), t = s.reduce((a, b) => a + b, 0); return s.map((x) => x / t); };

/** Era indices (1973 = 1 for trade, 1990 = 1 for travel). Model curves in the spirit of the real record. */
export const TRADE: Key = [[1950, 0.25], [1960, 0.45], [1973, 1], [1990, 1.4], [2008, 1.8], [2050, 1.9], [2100, 1.7]];
export const INTL_TRAVEL: Key = [[1950, 0.02], [1964, 0.08], [1975, 0.3], [1990, 1], [2008, 1.4], [2019, 2.2], [2050, 2.3], [2100, 2]];
export const KTRADE = 1.2e-3, KINTL = 4e-3, CATCH_H = 2.5, ACCESS_H = 0.4, FEEDER_H = 2.5;
export const seaPaxShare = (y: number, seaBias: number) => Math.min(0.95, (0.03 + 0.9 / (1 + Math.exp((y - 1962) / 3.5))) * (1 + 0.6 * seaBias));
export const airCargoShare = (y: number, airBias: number) => (y < 1958 ? 0 : Math.min(0.18, Math.min(0.1, 0.0015 * (y - 1958)) * (1 + 0.6 * airBias)));

/** Ports: four tiers, capacity in freight units a day (the same units as freight on the roads). */
export const PORT_CAP = [0, 800, 3000, 10000, 30000];
export const PORT_TIER_LABEL = ["", "地方港湾", "重要港湾", "国際拠点港湾", "国際戦略港湾"];
export const PORT_MAX_LANES = [0, 0, 2, 4, 7];
export const CONTAINER_YEAR = 1968;
/** Airports: a regional airport and an international hub differ by an order of magnitude (travellers a day). */
export const AIR_KIND_LABEL = { regional: "地方空港", hub: "国際ハブ空港" } as const;
export const RUNWAY_CAP: [number, number][] = [[1200, 2000], [2000, 8000], [2500, 15000], [3000, 25000]];
export const HUB_CAP = 50000, HUB_GROW = 1.7, HUB_MAX_STEPS = 4, JET_YEAR = 1960;
export const AIR_LANE_MIN = 300, SEA_LANE_MIN = 250, AIR_INTL_LANE_MIN = 400;
export const AIR_MAX_LANES = { regional: 8, hub: 40 } as const, AIR_INTL_MAX = { regional: 2, hub: 7 } as const;
const runwayCap = (m: number) => { let c = RUNWAY_CAP[0][1]; for (const [r, v] of RUNWAY_CAP) if (m >= r) c = v; return c; };
export const intlCapable = (a: AirportState, y: number) => a.until === undefined && (a.kind === "hub" || (a.runwayM >= 2500 && y >= 1975));

// ---- geometry ----
const faceMemo = new WeakMap<World, Map<number, Vec>>();
/** Which way a coastal cell faces the open sea: the mean direction to the sea cells within ~50 km (lakes do not count). */
export function facing(w: World, cell: number): Vec {
  let m = faceMemo.get(w); if (!m) { m = new Map(); faceMemo.set(w, m); } const hit = m.get(cell); if (hit) return hit;
  const R = Math.max(2, Math.round(50 / w.cell)), i0 = cell % w.nx, j0 = (cell / w.nx) | 0; let sx = 0, sy = 0;
  for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) { const i = i0 + di, j = j0 + dj, d = Math.hypot(di, dj); if (d > R || d === 0) continue; const sea = i < 0 || j < 0 || i >= w.nx || j >= w.ny || w.t.land[j * w.nx + i] === 0; if (sea) { sx += di / d; sy += dj / d; } }
  const n = Math.hypot(sx, sy), v: Vec = n > 1e-9 ? [sx / n, sy / n] : [0, 0]; m.set(cell, v); return v;   // grid j grows northward (cellPos y = y0 + j*cell)
}
export const affinity = (face: Vec, d: Foreign) => 0.35 + 0.65 * Math.max(0, face[0] * d.dir[0] + face[1] * d.dir[1]);
/** Destination split of one port's foreign trade. */
export function portSplit(w: World, cell: number, y: number): number[] { const f = facing(w, cell), s = foreignShares(y), v = FOREIGN.map((d, i) => s[i] * affinity(f, d)), t = v.reduce((a, b) => a + b, 0) || 1; return v.map((x) => x / t); }
const idxMemo = new WeakMap<World, Map<string, number>>();
export const cityIndex = (w: World) => { let m = idxMemo.get(w); if (!m) { m = new Map(w.cities.map((c, i) => [c.id, i])); idxMemo.set(w, m); } return m; };

// ---- demand (called from the analysis; pure) ----
export interface HubFlows {
  ports: { i: number; id: string; cargo: Float64Array; pax: Float64Array }[];   // per port (tier >= 2): foreign cargo and sea travellers from each city
  airs: { i: number; id: string; pax: Float64Array; cargo: Float64Array; feed: Float64Array }[];   // per international airport; `feed`: travellers arriving on a domestic connection
  unmet: number;                                                                // foreign trade with no port in reach (freight units)
}
const capF = (load: number) => (load > 1 ? 1 / load : 1);
/** Where every city's foreign trade and international travellers go, from the travel times of this analysis (T road, TT rail, nc x nc). */
export function hubDemand(sim: SimState, w: World, T: Float64Array, TT: Float64Array): HubFlows | null {
  const h = sim.hubs; if (!h) return null;
  const y = sim.startYear + Math.floor(sim.month / 12), dl = sim.dials, nc = w.cities.length, ix = cityIndex(w), tr = at(TRADE, y), it = at(INTL_TRAVEL, y);
  const time = (p: number, j: number) => (p === j ? 0 : Math.min(T[p * nc + j], TT[p * nc + j] + ACCESS_H));
  const ports = Object.values(h.ports).filter((p) => p.until === undefined && p.tier >= 2).map((p) => ({ p, i: ix.get(p.city)!, S: Math.sqrt(PORT_CAP[p.tier] * capF(p.load)) })).filter((x) => x.i !== undefined);
  const airs = Object.values(h.airports).filter((a) => intlCapable(a, y)).map((a) => ({ a, i: ix.get(a.city)!, S: Math.pow(a.cap * capF(a.load), 0.7) * (a.railAccess ? 1.15 : 1) })).filter((x) => x.i !== undefined);
  const out: HubFlows = { ports: ports.map((x) => ({ i: x.i, id: x.p.city, cargo: new Float64Array(nc), pax: new Float64Array(nc) })), airs: airs.map((x) => ({ i: x.i, id: x.a.city, pax: new Float64Array(nc), cargo: new Float64Array(nc), feed: new Float64Array(nc) })), unmet: 0 };
  const own = new Set(Object.values(h.airports).filter((a) => a.until === undefined).map((a) => ix.get(a.city)!));
  const sp = seaPaxShare(y, dl.seaBias), ac = airCargoShare(y, dl.airBias), wp = new Float64Array(ports.length), wa = new Float64Array(airs.length);
  for (let j = 0; j < nc; j++) {
    const c = w.cities[j], st = sim.cities[c.id]; if (!st) continue;
    const V = KTRADE * st.pop * (0.2 + st.industry) * goodsPull(sim, w, c.id) * tr * (1 + 0.3 * dl.seaBias), P = KINTL * st.pop * paxPull(sim, w, c.id) * it * (1 + 0.3 * dl.airBias);
    let sP = 0, sA = 0;
    for (let k = 0; k < ports.length; k++) { const t = time(ports[k].i, j); wp[k] = isFinite(t) ? ports[k].S * Math.exp(-t / CATCH_H) : 0; sP += wp[k]; }
    for (let k = 0; k < airs.length; k++) { const t = time(airs[k].i, j); wa[k] = isFinite(t) ? airs[k].S * Math.exp(-t / CATCH_H) : 0; sA += wa[k]; }
    const airC = sA > 0 ? V * ac : 0, seaC = V - airC, airP = sA > 0 ? P * (1 - sp) : 0, seaP = P - airP;
    if (sP > 0) for (let k = 0; k < ports.length; k++) { const f = wp[k] / sP; out.ports[k].cargo[j] = seaC * f; out.ports[k].pax[j] = seaP * f; }
    else { out.unmet += seaC; if (sA > 0) for (let k = 0; k < airs.length; k++) out.airs[k].pax[j] += (seaP * wa[k]) / sA; }
    // a traveller far from every international airport flies there from the home airport (a domestic connection), not across the country by road or rail
    let feed = false; if (sA > 0 && own.has(j)) { let tb = Infinity; for (let k = 0; k < airs.length; k++) tb = Math.min(tb, time(airs[k].i, j)); feed = tb > FEEDER_H; }
    if (sA > 0) for (let k = 0; k < airs.length; k++) { const f = wa[k] / sA; (feed ? out.airs[k].feed : out.airs[k].pax)[j] += airP * f; out.airs[k].cargo[j] = airC * f; }
  }
  return out;
}

// ---- state ----
const PORT_MIN_POP = 90000, PORT_NEW_POP = 140000, PORT_MAX = 40;
/** Facilities keep their distance: a new port not within PORT_SPACING_KM of another, a new airport not within AIR_SPACING_KM of an open one (unless its city is huge). */
export const PORT_SPACING_KM = 12, AIR_SPACING_KM = 60, AIR_SPACING_POP = 3e6;
const nearestKm = (w: World, id: string, others: string[]) => { const c = w.cityById.get(id); if (!c) return Infinity; let b = Infinity; for (const o of others) { if (o === id) continue; const q = w.cityById.get(o); if (q) b = Math.min(b, dist(c.pos, q.pos)); } return b; };
export const hubLog = (x: { hist: { y: number; t: string }[] }, y: number, t: string) => { x.hist.push({ y, t }); if (x.hist.length > 16) x.hist.splice(1, 1); };
const portName = (w: World, id: string) => `${(w.cityById.get(id)?.name ?? id).replace(/市$/, "")}港`;
const airName = (w: World, id: string) => `${(w.cityById.get(id)?.name ?? id).replace(/市$/, "")}空港`;
export { portName, airName };
/** Creates the facilities of the starting year (or of an older save's current year): ports by coastal size, airports from the cities that already have one. */
export function ensureHubs(sim: SimState, w: World, y: number): HubsState | null {
  if (!sim.stage3) return null; if (sim.hubs) return sim.hubs;
  const h: HubsState = { ports: {}, airports: {}, routes: [], seq: 0 }; sim.hubs = h;
  const coast = w.cities.filter((c) => c.coastal && (sim.cities[c.id]?.pop ?? 0) >= PORT_MIN_POP).map((c) => ({ c, s: sim.cities[c.id].pop * (0.3 + sim.cities[c.id].industry) })).sort((a, b) => b.s - a.s || (a.c.id < b.c.id ? -1 : 1)).slice(0, PORT_MAX);
  const kept: string[] = []; coast.filter(({ c }) => { if (nearestKm(w, c.id, kept) < PORT_SPACING_KM) return false; kept.push(c.id); return true; }).forEach(({ c }, r) => { const tier = r < 2 ? 3 : r < 10 ? 2 : 1; h.ports[c.id] = { city: c.id, tier, since: y, cargo: 0, pax: 0, load: 0, hi: 0, lo: 0, hist: [{ y, t: `${PORT_TIER_LABEL[tier]}(${y === sim.startYear ? "開始時点" : "記録の開始"})` }] }; });
  for (const c of w.cities) { const ap = sim.cities[c.id]?.airport; if (ap !== undefined) h.airports[c.id] = newAirport(c.cell, c.id, ap, ap >= JET_YEAR + 5 ? 2000 : 1200); }
  return h;
}
const newAirport = (cell: number, city: string, y: number, runwayM: number): AirportState => ({ city, kind: "regional", since: y, runwayM, cap: runwayCap(runwayM), pax: 0, intl: 0, cargo: 0, load: 0, hi: 0, lo: 0, site: cell, access: [], hist: [{ y, t: `開港(滑走路${runwayM}m)` }] });
const newRoute = (h: HubsState, mode: "sea" | "air", a: string, b: string, intl: boolean, y: number, vol: number): HubRoute => { const r: HubRoute = { id: `h${++h.seq}`, mode, a, b, intl, since: y, state: "open", vol: Math.round(vol), lo: 0 }; h.routes.push(r); return r; };
const live = (r: HubRoute) => r.state !== "closed";

/** Stage 8: what a port or airport adds to its city (bounded; see the module note). */
export function hubBoost(sim: SimState, cityId: string): { industry: number; growth: number } {
  const h = sim.hubs; if (!h) return { industry: 0, growth: 0 };
  const p = h.ports[cityId], a = h.airports[cityId]; let industry = 0, growth = 0;
  if (p && p.until === undefined) { const use = Math.min(1, p.cargo / PORT_CAP[p.tier]); industry += Math.min(0.12, 0.025 * p.tier * (0.4 + 0.6 * use)); growth += p.tier >= 3 ? 0.0006 * use : 0; }
  if (a && a.until === undefined) growth += a.kind === "hub" ? 0.0008 * Math.min(1, a.pax / a.cap + 0.3) : 0;
  return { industry, growth: Math.min(0.0012, growth) };
}

// ---- yearly review ----
export interface HubTotals { port: Map<string, { cargo: number; pax: number; dom: number }>; air: Map<string, { intl: number; cargo: number; dom: number }>; pairs: Map<string, number>; unmet: number }
/** Hub works are paid from their own accounts (港湾・空港整備の特別会計), checked against the year's transport budget so a poor era builds less. */
const affordable = (sim: SimState, cost: number, appetite: number) => cost <= sim.macro.budgetBu * 1.5 * appetite;
/** The bridge/tunnel technology rule (tech.ts) is about long structures and is deliberately not applied here: port and airport works follow the era's own steps (containers, jets). */
const costMult = (_sim: SimState, _y: number) => 1;
const buildYears = (_sim: SimState, _y: number, base: number) => base;

export function reviewHubs(sim: SimState, w: World, tot: HubTotals | undefined, y: number): number {
  const h = ensureHubs(sim, w, y); if (!h || !tot) return 0;
  const dl = sim.dials, seaApp = 0.5 + 0.5 * Math.min(1.5, dl.seaBias) + 0.2 * (dl.growth - 1), airApp = 0.5 + 0.5 * Math.min(1.5, dl.airBias) + 0.2 * (dl.growth - 1);
  let n = 0;
  // finish works
  for (const p of Object.values(h.ports)) if (p.build && p.build.done <= y) { p.tier = p.build.to; hubLog(p, y, `${PORT_TIER_LABEL[p.tier]}に拡張(完成)`); ev(sim, "port", `${portName(w, p.city)}の拡張が完成: ${PORT_TIER_LABEL[p.tier]}`, `能力${PORT_CAP[p.tier]}(貨物/日)`, { city: p.city }); delete p.build; n++; }
  for (const a of Object.values(h.airports)) if (a.build && a.build.done <= y) { if (a.kind === "hub" && a.build.kind === "hub") a.steps = (a.steps ?? 0) + 1; a.cap = a.build.cap; a.runwayM = a.build.runwayM; a.kind = a.build.kind; hubLog(a, y, `${a.build.what}(完成)`); ev(sim, "air", `${airName(w, a.city)}: ${a.build.what}が完成`, `${AIR_KIND_LABEL[a.kind]}・滑走路${a.runwayM}m・能力${a.cap}人/日`, { city: a.city }); delete a.build; n++; }
  // ---- ports ----
  for (const p of Object.values(h.ports)) {
    if (p.until !== undefined) continue;
    const t = tot.port.get(p.city) ?? { cargo: 0, pax: 0, dom: 0 }; p.cargo = Math.round(t.cargo + t.dom); p.pax = Math.round(t.pax); p.load = Math.round((p.cargo / PORT_CAP[p.tier]) * 1000) / 1000;
    p.hi = p.load >= 0.85 ? p.hi + 1 : 0; p.lo = p.load <= 0.2 ? p.lo + 1 : 0;
    const top = p.tier >= 4 || (p.tier === 3 && y < CONTAINER_YEAR);
    if (!p.build && p.hi >= 2 && !top) {
      const to = p.tier + 1, cost = 0.4 * to * costMult(sim, y);
      if (affordable(sim, cost, seaApp)) { const yrs = buildYears(sim, y, to >= 4 ? 6 : 4); p.build = { to, done: y + yrs }; hubLog(p, y, `${PORT_TIER_LABEL[to]}への拡張に着工`); ev(sim, "port", `${portName(w, p.city)}の拡張に着工(${to >= 4 ? "コンテナ埠頭" : "岸壁の増設"})`, `取扱が能力の${Math.round(p.load * 100)}%で2年続いた。完成予定${y + yrs}年・工費${Math.round(cost * 100) / 100}`, { city: p.city }); n++; }
    } else if (!p.build && p.lo >= 10 && p.tier >= 2 && seaApp < 1.2) {
      p.tier--; p.lo = 0; hubLog(p, y, `${PORT_TIER_LABEL[p.tier]}に縮小`); ev(sim, "port", `${portName(w, p.city)}を縮小: ${PORT_TIER_LABEL[p.tier]}`, `取扱が能力の2割以下で10年続いた`, { city: p.city }); n++;
    } else if (p.tier === 1 && p.lo >= 15 && y >= 1990 && p.cargo < 0.05 * PORT_CAP[1]) {
      p.until = y; hubLog(p, y, "閉港"); ev(sim, "port", `${portName(w, p.city)}を閉港`, `取扱がほとんどない状態が15年続いた`, { city: p.city }); n++;
    }
  }
  if (y >= 1955 && Object.values(h.ports).filter((p) => p.until === undefined).length < PORT_MAX) {
    const c = w.cities.filter((c) => c.coastal && !h.ports[c.id] && nearestKm(w, c.id, Object.keys(h.ports)) >= PORT_SPACING_KM && (sim.cities[c.id]?.pop ?? 0) >= PORT_NEW_POP * (1 - 0.25 * Math.min(1, dl.seaBias))).sort((a, b) => sim.cities[b.id].pop * (0.3 + sim.cities[b.id].industry) - sim.cities[a.id].pop * (0.3 + sim.cities[a.id].industry) || (a.id < b.id ? -1 : 1))[0];
    if (c && affordable(sim, 0.3 * costMult(sim, y), seaApp)) { h.ports[c.id] = { city: c.id, tier: 1, since: y, cargo: 0, pax: 0, load: 0, hi: 0, lo: 0, hist: [{ y, t: "開港(地方港湾)" }] }; ev(sim, "port", `${portName(w, c.id)}が開港`, `人口${Math.round(sim.cities[c.id].pop / 1000)}千人の臨海都市。海路の選好${dl.seaBias.toFixed(2)}`, { city: c.id }); n++; }
  }
  // ---- airports ----
  for (const c of [...w.cities].sort((p, q) => (sim.cities[q.id]?.pop ?? 0) - (sim.cities[p.id]?.pop ?? 0) || (p.id < q.id ? -1 : 1))) {   // biggest first; the opening rule that Stage 3 used, now as a facility (a poorer or less air-minded era opens later)
    const st = sim.cities[c.id]; if (!st || h.airports[c.id]) continue; const b = dl.airBias, f = 1 - 0.25 * b;
    const due = (st.pop > 400000 * f && y >= 1958 - Math.round(8 * b)) || (st.pop > 200000 * f && y >= 1972 - Math.round(8 * b)) || (st.pop > 100000 * f && y >= 1988 - Math.round(8 * b));
    if (!due || !affordable(sim, 0.25 * costMult(sim, y), airApp)) continue;
    const near = nearestKm(w, c.id, Object.values(h.airports).filter((a) => a.until === undefined).map((a) => a.city)); if (near < AIR_SPACING_KM && !(st.pop >= AIR_SPACING_POP && near >= 25)) continue;   // a neighbouring city's airport already serves it
    const rw = y >= JET_YEAR + 5 ? 2000 : 1200; h.airports[c.id] = newAirport(c.cell, c.id, y, rw); st.airport = y;
    ev(sim, "air", `${airName(w, c.id)}が開港(${AIR_KIND_LABEL.regional}・滑走路${rw}m)`, `人口${Math.round(st.pop / 1000)}千人に達し、空路の選好${b.toFixed(2)}`, { city: c.id }); n++;
  }
  const opened = Object.values(h.airports).filter((a) => a.until === undefined);
  for (const a of opened) {
    const t = tot.air.get(a.city) ?? { intl: 0, cargo: 0, dom: 0 }; a.intl = Math.round(t.intl); a.cargo = Math.round(t.cargo); a.pax = Math.round(t.dom + t.intl); a.load = Math.round((a.pax / a.cap) * 1000) / 1000;
    a.hi = a.load >= 0.9 ? a.hi + 1 : 0; a.lo = a.load <= 0.1 ? a.lo + 1 : 0;
    if (a.build) continue;
    if (a.kind === "regional" && a.hi >= 1 && a.load >= 0.7 && a.runwayM < 3000) {
      const to = a.runwayM < 2000 ? (y >= JET_YEAR ? 2000 : 0) : a.runwayM < 2500 ? (y >= 1975 ? 2500 : 0) : y >= 1985 && a.hi >= 3 ? 3000 : 0;
      if (to && affordable(sim, 0.2 * costMult(sim, y), airApp)) { const yrs = buildYears(sim, y, 3); a.build = { cap: runwayCap(to), runwayM: to, kind: "regional", done: y + yrs, what: `滑走路を${to}mに延長${to === 2000 ? "(ジェット化)" : ""}` }; ev(sim, "air", `${airName(w, a.city)}の滑走路延長に着工(${to}m)`, `利用が能力の${Math.round(a.load * 100)}%。完成予定${y + yrs}年`, { city: a.city }); n++; }
    } else if (a.kind === "hub" && a.hi >= 2) {
      const steps = a.steps ?? 0;
      if (steps < HUB_MAX_STEPS && affordable(sim, 1.2 * costMult(sim, y), airApp)) { const what = ["第2滑走路の増設", "沖合への展開(滑走路の増設)", "第3滑走路の増設", "第4滑走路の増設"][steps], yrs = buildYears(sim, y, 6); a.build = { cap: Math.round(a.cap * HUB_GROW), runwayM: Math.max(a.runwayM, 3500), kind: "hub", done: y + yrs, what }; hubLog(a, y, `${what}に着工`); ev(sim, "air", `${airName(w, a.city)}: ${what}に着工`, `利用が能力の${Math.round(a.load * 100)}%で2年続いた。完成予定${y + yrs}年`, { city: a.city }); n++; }
    } else if (a.kind === "regional" && a.lo >= 10 && y >= 2000 && !h.routes.some((r) => live(r) && r.mode === "air" && (r.a === a.city || r.b === a.city) && r.state === "open")) {
      a.until = y; const st = sim.cities[a.city]; if (st) delete st.airport; hubLog(a, y, "廃港"); ev(sim, "air", `${airName(w, a.city)}を廃港`, "定期便がなくなり利用がほとんどない状態が10年続いた", { city: a.city }); n++;
    }
  }
  // hubs: the first from the 1950s, more as international travel grows (at most three); the busiest airport by its international catchment is chosen
  const intlTot = [...tot.air.values()].reduce((s, x) => s + x.intl, 0) + [...tot.port.values()].reduce((s, x) => s + x.pax, 0), hubs = opened.filter((a) => a.kind === "hub" || a.build?.kind === "hub").length;
  const want = y < 1955 ? 0 : Math.min(4, 1 + Math.floor(intlTot / (60000 * (1 - 0.3 * Math.min(1, dl.airBias)))));
  if (hubs < want) {
    const pot = (a: AirportState) => { const c = w.cityById.get(a.city); return c ? sim.cities[a.city].pop * paxPull(sim, w, a.city) : 0; };
    const cand = opened.filter((a) => a.kind === "regional" && !a.build).sort((p, q) => pot(q) - pot(p) || (p.city < q.city ? -1 : 1))[0], cost = 2 * costMult(sim, y);
    if (cand && (hubs === 0 || affordable(sim, cost, airApp))) {
      const yrs = hubs === 0 ? 1 : buildYears(sim, y, 6); cand.site = hubSite(w, cand.site); cand.build = { cap: HUB_CAP, runwayM: 3000, kind: "hub", done: y + yrs, what: "国際ハブ空港として整備(滑走路3000m)" };
      layAccess(sim, w, cand, "road", y); hubLog(cand, y, "国際ハブ空港の整備に着工");
      ev(sim, "air", `${airName(w, cand.city)}を国際ハブ空港として整備`, `国際旅客${Math.round(intlTot / 1000)}千人/日。${hubs === 0 ? "最初の国際空港" : `${hubs + 1}か所目のハブ`}。完成予定${y + yrs}年`, { city: cand.city }); n++;
    }
  }
  for (const a of opened) if (a.kind === "hub" && !a.railAccess && a.pax >= 0.4 * a.cap && y >= 1964 && (dl.railBias > -0.3 || a.pax >= a.cap)) { if (layAccess(sim, w, a, "rail", y)) { a.railAccess = y; hubLog(a, y, "空港アクセス鉄道が開業"); ev(sim, "air", `${airName(w, a.city)}へのアクセス鉄道が開業`, `空港の利用${Math.round(a.pax / 1000)}千人/日`, { city: a.city }); n++; } }
  n += reviewRoutes(sim, w, h, tot, y);
  return n;
}
/** A hub needs room: the lowest coastal land cell 8-25 km from the city on the same land, else the city itself. */
function hubSite(w: World, cell: number): number {
  const R = Math.ceil(25 / w.cell), r0 = Math.max(1, Math.floor(8 / w.cell)), i0 = cell % w.nx, j0 = (cell / w.nx) | 0; let best = cell, bs = Infinity;
  for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) { const d = Math.hypot(di, dj); if (d < r0 || d > R) continue; const i = i0 + di, j = j0 + dj; if (i < 1 || j < 1 || i >= w.nx - 1 || j >= w.ny - 1) continue; const k = j * w.nx + i; if (w.t.land[k] !== 1 || w.lm[k] !== w.lm[cell]) continue; const sea = [1, -1, w.nx, -w.nx].some((o) => w.t.land[k + o] === 0); if (!sea) continue; const s = w.elevM(k) + 3 * d; if (s < bs) { bs = s; best = k; } }
  return best;
}
/** The access road (or railway) from the city to the airport site, laid as real network; its edges carry the airport's ground trips. */
function layAccess(sim: SimState, w: World, a: AirportState, mode: "road" | "rail", y: number): boolean {
  const c = w.cityById.get(a.city); if (!c || a.site === c.cell) return false;
  const idx = buildIndex(sim, mode); let from = c.cell;
  if (mode === "rail") { let bd = Infinity; for (const q of idx.nodeByCell.keys()) { if (w.lm[q] !== w.lm[c.cell]) continue; const d = dist(w.cellPos(q), w.cellPos(a.site)); if (d < bd) { bd = d; from = q; } } if (bd > 60) return false; }
  const path = pathfind(w, from, a.site, { margin: 8, ...(mode === "rail" ? { rail: true } : {}) }); if (!path || path.length < 2) return false;
  if (w.land12 && !terrainGate(w, sim, mode, path, y).ok) return false;
  const lay = layPath(sim, w, path, { facilities: w.land12, open: true, surface: "paved", quality: 90, built: 1, month: sim.month, standard: "standard", mode, ...(mode === "rail" ? { op: "jnr" } : {}) });
  const ids = lay.chain.map((x) => x.edgeId).filter((id) => modeOf(sim.edges[id]) === mode); if (!ids.length) return false;
  for (const id of lay.created) sim.edges[id].hist.push({ m: sim.month, t: `${airName(w, a.city)}へのアクセス${mode === "rail" ? "鉄道" : "道路"}として開通(${y}年)` });
  if (mode === "rail") a.railIds = ids; else a.access = ids; return true;
}
/** Routes: international sea lanes per port, international air routes per airport, domestic air routes from the busiest city pairs. */
function reviewRoutes(sim: SimState, w: World, h: HubsState, tot: HubTotals, y: number): number {
  let n = 0; const sh = foreignShares(y);
  const want = new Map<string, { mode: "sea" | "air"; a: string; b: string; intl: boolean; vol: number; min: number }>();
  for (const p of Object.values(h.ports)) { if (p.until !== undefined || p.tier < 2) continue; const t = tot.port.get(p.city); if (!t) continue; const split = portSplit(w, w.cities[cityIndex(w).get(p.city)!].cell, y); FOREIGN.map((d, i) => ({ d, v: t.cargo * split[i] + t.pax * split[i] * 0.5 })).sort((a, b) => b.v - a.v).slice(0, PORT_MAX_LANES[p.tier]).forEach(({ d, v }) => want.set(`sea:${p.city}:${d.id}`, { mode: "sea", a: p.city, b: d.id, intl: true, vol: v, min: SEA_LANE_MIN })); }
  for (const a of Object.values(h.airports)) { if (!intlCapable(a, y)) continue; const t = tot.air.get(a.city); if (!t) continue; FOREIGN.map((d, i) => ({ d, v: t.intl * sh[i] })).sort((p, q) => q.v - p.v).slice(0, AIR_INTL_MAX[a.kind]).forEach(({ d, v }) => want.set(`air:${a.city}:${d.id}`, { mode: "air", a: a.city, b: d.id, intl: true, vol: v, min: AIR_INTL_LANE_MIN })); }
  const cnt = new Map<string, number>();
  for (const [k, v] of [...tot.pairs.entries()].sort((p, q) => q[1] - p[1] || (p[0] < q[0] ? -1 : 1))) {
    const [a, b] = k.split("|"), A = h.airports[a], B = h.airports[b]; if (!A || !B || A.until !== undefined || B.until !== undefined) continue;
    if ((cnt.get(a) ?? 0) >= AIR_MAX_LANES[A.kind] || (cnt.get(b) ?? 0) >= AIR_MAX_LANES[B.kind]) continue;
    cnt.set(a, (cnt.get(a) ?? 0) + 1); cnt.set(b, (cnt.get(b) ?? 0) + 1); want.set(`air:${a}:${b}`, { mode: "air", a, b, intl: false, vol: v, min: AIR_LANE_MIN });
  }
  const label = (r: { mode: string; a: string; b: string; intl: boolean }) => `${r.mode === "sea" ? portName(w, r.a) : airName(w, r.a)}〜${r.intl ? foreignName(r.b) : airName(w, r.b)}${r.mode === "sea" ? "航路" : "便"}`;
  for (const r of h.routes) {
    if (!live(r)) continue; const k = `${r.mode}:${r.a}:${r.b}`, v = want.get(k); r.vol = Math.round(v?.vol ?? 0); want.delete(k);
    const min = r.mode === "sea" ? SEA_LANE_MIN : r.intl ? AIR_INTL_LANE_MIN : AIR_LANE_MIN, gone = (r.mode === "sea" ? h.ports[r.a] : h.airports[r.a])?.until !== undefined || (!r.intl && h.airports[r.b]?.until !== undefined);
    if (r.state === "open" && (gone || r.vol < 0.5 * min)) { r.lo++; if (gone || r.lo >= 3) { r.state = "suspended"; r.lo = 0; ev(sim, "lane", `${label(r)}を休止`, gone ? "港・空港の廃止" : `利用${r.vol}が基準の半分を下回る年が3年続いた`, { city: r.a }); n++; } }
    else if (r.state === "suspended") { if (!gone && r.vol >= min) { r.state = "open"; r.lo = 0; ev(sim, "lane", `${label(r)}を再開`, `利用${r.vol}が回復`, { city: r.a }); n++; } else if (++r.lo >= 6 || gone) { r.state = "closed"; r.until = y; ev(sim, "lane", `${label(r)}を廃止`, "休止のまま再開の見込みがない", { city: r.a }); n++; } }
    else r.lo = 0;
  }
  for (const [, v] of [...want.entries()].sort((p, q) => q[1].vol - p[1].vol || (p[0] < q[0] ? -1 : 1))) {
    if (v.vol < v.min) continue; const r = newRoute(h, v.mode, v.a, v.b, v.intl, y, v.vol); ev(sim, "lane", `${label(r)}を開設`, `${v.intl ? "国際" : "国内"}${v.mode === "sea" ? "貨物・旅客" : "旅客"}の需要${Math.round(v.vol)}/日`, { city: v.a }); n++;
  }
  const closed = h.routes.filter((r) => !live(r)); if (closed.length > 80) { const drop = new Set(closed.slice(0, closed.length - 80).map((r) => r.id)); h.routes = h.routes.filter((r) => !drop.has(r.id)); }
  return n;
}
/** Facilities and routes as they stood in a given year (for the past-era view): those opened by then and not yet closed. */
export function hubsAt(sim: SimState, year: number) {
  const h = sim.hubs; if (!h) return { ports: [] as PortState[], airports: [] as AirportState[], routes: [] as HubRoute[] };
  const on = (x: { since: number; until?: number }) => x.since <= year && (x.until === undefined || x.until > year);
  return { ports: Object.values(h.ports).filter(on), airports: Object.values(h.airports).filter(on), routes: h.routes.filter((r) => on(r) && (r.state !== "suspended" || r.since > year - 1)) };
}

/** Stage 8: the yearly record of the sea and the air (sim.stats), for the atlas chart and the study. */
export function hubStats(sim: SimState, an: { hub?: HubTotals }): Partial<Record<"ports" | "airports" | "hubs" | "seaCargo" | "airPax" | "airIntl" | "seaLanes" | "airLanes", number>> {
  const h = sim.hubs!, P = Object.values(h.ports).filter((p) => p.until === undefined), A = Object.values(h.airports).filter((a) => a.until === undefined), R = h.routes.filter((r) => r.state === "open");
  const t = an.hub; let sea = 0, air = 0, intl = 0; if (t) { for (const x of t.port.values()) sea += x.cargo + x.dom; for (const x of t.air.values()) { air += x.intl + x.dom; intl += x.intl; } }
  return { ports: P.length, airports: A.length, hubs: A.filter((a) => a.kind === "hub").length, seaCargo: Math.round(sea), airPax: Math.round(air), airIntl: Math.round(intl), seaLanes: R.filter((r) => r.mode === "sea").length, airLanes: R.filter((r) => r.mode === "air").length };
}

/** Stage 8: the airport each city's travellers use -- its own, else the nearest open one within AIR_SPACING_KM on the same land (a neighbouring city's).
 *  Built once per analysis (`airportMap`) and read per city pair; `airportOf` is the single-city form for callers outside the analysis. */
export function airportMap(sim: SimState, w: World): (string | null)[] {
  const h = sim.hubs; if (!h) return w.cities.map(() => null); const open = Object.values(h.airports).filter((a) => a.until === undefined);
  return w.cities.map((c) => { if (h.airports[c.id] && h.airports[c.id].until === undefined) return c.id; let best: string | null = null, bd = AIR_SPACING_KM; for (const a of open) { const q = w.cityById.get(a.city); if (!q || w.lm[q.cell] !== w.lm[c.cell]) continue; const d = dist(c.pos, q.pos); if (d < bd) { bd = d; best = a.city; } } return best; });
}
export const airportOf = (sim: SimState, w: World, i: number): string | null => airportMap(sim, w)[i] ?? null;
