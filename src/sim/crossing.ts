/**
 * Strait links (Issue #15): where a ferry runs, the game may decide to build a bridge or a tunnel in its place -- for roads and railways alike, earlier and more often than
 * history did, but never faster than the technology, the money and the traffic allow.
 *
 * The choice among ferry / bridge / tunnel, for one pair of land masses and one mode, each year:
 *   1. TECHNOLOGY  the open water to cross (`gapKm`) must be within what a bridge can span (tech.BRIDGE_KM) or a tunnel can be driven (tech.TUNNEL_KM) at this year's
 *                  technology clock; the cheaper of the two feasible structures is chosen. Beyond both, the ferry stays (Okinawa, for one).
 *   2. DEMAND      the traffic on the ferry itself, against its capacity (a full ferry is the reason to build). Rail needs a railway on both shores.
 *   3. WILL        the era's appetite for building that mode (hwyBuild / railBuild, helped by hsr, dampened by a sea-minded world line: seaBias).
 *   4. COST        the project must be fundable: its monthly need may not exceed a share of the national pool it is paid from.
 *   5. LIMITS      one crossing project per mode at a time, and a cooling-off before the same pair is tried again, so nothing chains without end.
 * The history is kept as for any project (構想 / 計画 / 工事中 / 中断 / 未成 / 供用 / 取りやめ), and when a link opens the ferry it replaces is closed and the routes that used it
 * are carried over to the new edge (same two ports), so a numbered route such as 国道1号 stays one continuous road.
 *
 * Pure rules over the sim and the world; no place names.
 */
import { UNIT, RAIL_UNIT, createProject, facCost } from "./planning";
import { dist } from "../core/geom";
import type { Vec } from "../core/types";
import { buildIndex, layPath, nodeAtCell } from "./network";
import { isLakeFerry, nearTown, shoreNames } from "./ferry";
import { pathfind } from "./world";
import { waterTechAt } from "./tech";
import { RAIL_FROM_ROAD, sidePops, virtualTrips } from "./waterlink";
import type { WCity } from "./world";
import { capacityOf } from "./demand";
import { ev, yearOf } from "./engine";
import { newEdgeDefaults, newId, pushHist } from "./network";
import { techAt } from "./tech";
import { modeOf, type Mode, type SimEdge, type SimProject, type SimState } from "./types";
import type { World } from "./world";

export const CROSSING_TAG = "【海峡連絡】";
/** At most this many crossing projects of one mode at once; and a pair is not tried again within COOLING_YEARS of an abandoned attempt. */
export const MAX_ACTIVE_PER_MODE = 2, COOLING_YEARS = 12, FUND_SHARE = 0.6, SCORE_MIN = 0.3;
/** Stage 11: the longer the water, the busier the ferry must be before a fixed link is planned: the bar is SCORE_MIN + span / SPAN_SCORE_KM (10 km: 0.47, 25 km: 0.72, 40 km: 0.97). */
export const SPAN_SCORE_KM = 60;
/** Stage 13: crossing projects running at once per mode with the water-tunnel rule (the named straits are many); a railway tunnel planned from a road ferry sees this share of its load. */
export const MAX_ACTIVE_WATER = 6, STARTS_PER_YEAR_WATER = 2, LAKE_TUNNEL_MAX_KM = 40;
/** A fixed link must serve people: the smaller shore's population (cities and villages) has to reach this many per km of open water. 10 km of strait needs 35,000 on the small side, 50 km needs 175,000. */
export const POP_PER_KM = 3500;
/** Stage 13: what a project already under way takes of the yearly budget, per month (its price over a typical building time); the water-tunnel games limit what is started by this, not by a count. */
export const COMMIT_MONTHS = 60, LAND_PART_MAX_KM = 45;
const ACTIVE = new Set(["concept", "planned", "building", "suspended"]);

export const isCrossingProject = (p: SimProject) => p.reason.startsWith(CROSSING_TAG);
/** Stage 11: a bridge is the preferred structure whenever the technology can span the water and it costs no more than BRIDGE_PREF times the tunnel (a bridge is built to be seen and
 * driven; the cheaper structure won every time before, so no bridge was ever planned). A tunnel takes the crossings a bridge cannot span, or where it would cost far more. */
export const BRIDGE_PREF = 2.2, BRIDGE_WAIT_YEARS = 30 /* technology-clock years (15 calendar years at K=2) */, PLAN_TUNNEL_MAX_KM = 40;
/** Stage 13: with the water-tunnel rule (tech.wk) the longest tunnel a crossing project will plan is longer: the sea beds the user named are 15-70 km wide. */
export const PLAN_WATER_TUNNEL_MAX_KM = 70;
/** What would be built across this gap, and what it would cost (null when neither a bridge nor a tunnel is feasible this year). */
export function chooseStructure(sim: SimState, gapKm: number, km: number, mode: Mode, year: number): { fac: "bridge" | "tunnel"; cost: number } | null {
  if (!sim.tech) return null; const now = techAt(sim.tech.k, year), unit = mode === "rail" ? RAIL_UNIT.standard : UNIT.standard;
  // the structure is the span over open water (dearer the longer it is); the rest of the way between the two ports is ordinary road or rail
  const price = (fac: "bridge" | "tunnel", span: number) => span * facCost({ facility: fac, facilityName: fac === "tunnel" ? "link:" : undefined, curv: 0 } as SimEdge, sim) * unit * (1 + span / (fac === "bridge" ? 15 : 40)) + Math.max(0, km - span) * unit;
  // Stage 13: a tunnel under water has a technology rule of its own (tech.wk): its reach and its price are not the bridge's or the land tunnel's
  const wk = sim.tech.wk, reach = wk !== undefined ? waterTechAt(wk, year).reachKm : now.tunnelKm, maxPlan = wk !== undefined ? PLAN_WATER_TUNNEL_MAX_KM : PLAN_TUNNEL_MAX_KM;
  const b = gapKm <= now.bridgeKm ? { fac: "bridge" as const, cost: price("bridge", gapKm) } : null, t = gapKm <= reach ? { fac: "tunnel" as const, cost: price("tunnel", gapKm) } : null;
  if (t && gapKm > maxPlan) return b;   // no tunnel is planned across water wider than the world's longest (the Channel Tunnel's 38 km): a wider sea stays a ferry
  if (b && t) return b.cost <= BRIDGE_PREF * t.cost ? b : t;
  // a strait a bridge will span within BRIDGE_WAIT_YEARS is waited for rather than tunnelled: the bridge is the structure the crossing is meant to get
  if (!b && t && gapKm <= techAt(sim.tech.k, year + BRIDGE_WAIT_YEARS / sim.tech.k).bridgeKm && wk === undefined) return null;   // (Stage 13: with the water-tunnel rule the tunnel is built when it is ready; waiting for a bridge is the older games' rule)
  return b ?? t;
}
/**
 * Stage 11: the crossings the planner considers are the FERRY routes themselves (any open sea ferry of the mode between two port cities on different land masses), not one canonical
 * pair per pair of masses. Before, Honshu-Shikoku had a single candidate (the two closest cities) and everything else -- Okayama-Takamatsu, Hiroshima-Matsuyama, the Bungo channel --
 * could never be planned. The open water of a corridor is the narrowest strait between the two shores it joins (`localGapKm`).
 */
/** A shore end of a crossing: a port city, or (Stage 13) a bare shore cell with the name of the town nearest it. */
export interface Port { cell: number; pos: Vec; name: string }
export interface Corridor { ferry: SimEdge; a: Port; b: Port; span: number; km: number; kind: "strait" | "bay" | "lake" }
const portOf = (w: World, cell: number, other?: number): Port => { const c = w.cityByCell.get(cell); return c ? { cell, pos: c.pos, name: c.name } : { cell, pos: w.cellPos(cell), name: other === undefined ? nearTown(w, cell) + "岸" : shoreNames(w, cell, other)[0] }; };
const spanMemo = new WeakMap<World, Map<string, number>>();
/** The narrowest open water between the two shores THIS corridor joins: the nearest pair of coast cells among those within SPAN_REACH_KM of its two ports (km). A straight line between two port
 * cities is not the strait -- Aomori to Hakodate is 100 km, the Tsugaru strait between their coasts is a quarter of that. */
export const SPAN_REACH_KM = 60;
export function localGapKm(w: World, ca: number, cb: number): number {
  let m = spanMemo.get(w); if (!m) { m = new Map(); spanMemo.set(w, m); } const key = ca < cb ? `${ca}:${cb}` : `${cb}:${ca}`, hit = m.get(key); if (hit !== undefined) return hit;
  const r = Math.ceil(SPAN_REACH_KM / w.cell), shore = (c: number): number[] => {
    const lm = w.lm[c], i0 = c % w.nx, j0 = (c / w.nx) | 0, out: number[] = [];
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) { const i = i0 + di, j = j0 + dj; if (i < 1 || j < 1 || i >= w.nx - 1 || j >= w.ny - 1 || di * di + dj * dj > r * r) continue; const k = j * w.nx + i; if (w.lm[k] !== lm) continue; if (w.t.land[k - 1] === 0 || w.t.land[k + 1] === 0 || w.t.land[k - w.nx] === 0 || w.t.land[k + w.nx] === 0) out.push(k); }
    return out;
  }, A = shore(ca), B = shore(cb); let best = Infinity;
  for (const x of A) { const ax = x % w.nx, ay = (x / w.nx) | 0; for (const y of B) { const d = Math.hypot(ax - (y % w.nx), ay - ((y / w.nx) | 0)); if (d < best) best = d; } }
  const km = isFinite(best) ? Math.round(best * w.cell * 10) / 10 : Infinity; m.set(key, km); return km;
}
export function corridorsOf(sim: SimState, w: World, mode: Mode): Corridor[] {
  const out: Corridor[] = [];
  for (const f of Object.values(sim.edges)) {
    if (f.facility !== "ferry" || modeOf(f) !== mode || f.state !== "open" || f.cells.length < 2) continue;
    const ca = f.cells[0], cb = f.cells[f.cells.length - 1], a = w.cityByCell.get(ca), b = w.cityByCell.get(cb);
    if (a && b && w.lm[ca] !== w.lm[cb] && !isLakeFerry(f)) { out.push({ ferry: f, a, b, span: localGapKm(w, ca, cb), km: Math.round(f.lengthKm * 10) / 10, kind: "strait" }); continue; }
    // Stage 13: water the older rule never looked at -- a bay whose shores are one land mass, a strait between shore towns that are not cities, and a lake
    if (!sim.tech || sim.tech.wk === undefined) continue;
    const lake = isLakeFerry(f); if (lake && dist(w.cellPos(ca), w.cellPos(cb)) > LAKE_TUNNEL_MAX_KM) continue;   // a tunnel along the length of a lake is no crossing
    const bay = w.lm[ca] === w.lm[cb] && !lake, open = Math.max(1, Math.round((dist(w.cellPos(ca), w.cellPos(cb)) - w.cell) * 10) / 10);
    out.push({ ferry: f, a: portOf(w, ca, cb), b: portOf(w, cb, ca), span: lake || bay ? open : localGapKm(w, ca, cb), km: Math.round(f.lengthKm * 10) / 10, kind: lake ? "lake" : bay ? "bay" : "strait" });
  }
  // a railway tunnel is planned where a road ferry runs and a railway reaches both shores (the railway is joined to the tunnel by approach lines)
  if (mode === "rail" && sim.tech?.wk !== undefined) {
    const have = new Set(out.map((c) => c.ferry.id)), idx = buildIndex(sim, "rail");
    for (const f of Object.values(sim.edges)) {
      if (f.facility !== "ferry" || modeOf(f) !== "road" || f.state !== "open" || f.cells.length < 2 || have.has(f.id) || isLakeFerry(f)) continue;
      const ca = f.cells[0], cb = f.cells[f.cells.length - 1]; if (w.lm[ca] !== w.lm[cb] && !(w.cityByCell.get(ca) && w.cityByCell.get(cb))) continue;
      if (!railNear(w, idx, ca, cb) || !railNear(w, idx, cb, ca)) continue;
      const bay = w.lm[ca] === w.lm[cb], span = bay ? Math.round((Math.hypot(w.cellPos(ca)[0] - w.cellPos(cb)[0], w.cellPos(ca)[1] - w.cellPos(cb)[1]) - w.cell) * 10) / 10 : localGapKm(w, ca, cb);
      out.push({ ferry: f, a: portOf(w, ca, cb), b: portOf(w, cb, ca), span, km: Math.round(f.lengthKm * 10) / 10, kind: bay ? "bay" : "strait" });
    }
  }
  return out.sort((p, q) => (p.ferry.id < q.ferry.id ? -1 : 1));
}
/** A railway node within RAIL_REACH_KM of a shore cell on the same land mass. */
export const RAIL_REACH_KM = 45;
const railNear = (w: World, idx: ReturnType<typeof buildIndex>, cell: number, other: number): boolean => { const p = w.cellPos(cell), po = w.cellPos(other); for (const q of idx.nodeByCell.keys()) { const d = dist(w.cellPos(q), p); if (w.lm[q] === w.lm[cell] && d <= RAIL_REACH_KM && d < dist(w.cellPos(q), po)) return true; } return false; };
/** A fixed link of this mode (built, or still a live project) already runs within LINK_NEAR_KM of both ports of this corridor. */
export const LINK_NEAR_KM = 40;
export function corridorTaken(sim: SimState, w: World, c: Corridor, mode: Mode): boolean {
  const near = (cell: number, port: Port) => Math.hypot(w.cellPos(cell)[0] - port.pos[0], w.cellPos(cell)[1] - port.pos[1]) <= LINK_NEAR_KM;
  for (const e of Object.values(sim.edges)) {
    if ((e.facility !== "bridge" && e.facility !== "tunnel") || modeOf(e) !== mode || e.cells.length < 2) continue;
    if (e.built < 1 && !Object.values(sim.projects).some((p) => p.edgeIds.includes(e.id) && ACTIVE.has(p.status))) continue;
    const x = e.cells[0], z = e.cells[e.cells.length - 1]; if ((near(x, c.a) && near(z, c.b)) || (near(x, c.b) && near(z, c.a))) return true;
  }
  return false;
}
/** People living on a land mass: its cities and its villages. */
export function massPop(sim: SimState, w: World, lm: number): number {
  let n = 0; for (const c of w.cities) if (w.lm[c.cell] === lm) n += sim.cities[c.id]?.pop ?? 0;
  for (const v of Object.values(sim.settlements)) if (!v.gone && w.lm[v.cell] === lm) n += v.pop; return n;
}
/** How hard the ferry is working: its traffic over its capacity. A pair with no ferry of this mode reports 0. */
export const ferryLoad = (e: SimEdge | null) => (e ? (e.through + e.local + 0.4 * e.freight) / capacityOf(e) : 0);

/** One year's decision. Returns the projects started (usually none). */
/** Why a corridor is, or is not, a candidate this year: the planner's whole test for one corridor, kept apart so a study (or a test) can ask it. */
export interface CorridorEval { ok: boolean; why: string; s?: { fac: "bridge" | "tunnel"; cost: number }; score?: number; rank?: number; need?: number; fund?: number; bar?: number }
export function evalCorridor(sim: SimState, w: World, c: Corridor, mode: Mode, y: number, appetite: number, started: SimProject[] = [], proj: SimProject[] = Object.values(sim.projects).filter(isCrossingProject)): CorridorEval {
  const committed = sim.tech?.wk !== undefined ? [...proj, ...started].filter((p) => modeOf(p) === mode && ACTIVE.has(p.status)).reduce((t, p) => t + p.costBu / COMMIT_MONTHS, 0) : 0;
  const dl = sim.dials, wk = sim.tech?.wk, ferry = c.ferry;
  if (corridorTaken(sim, w, c, mode) || started.some((p) => p.from === ferry.a && p.to === ferry.b && modeOf(p) === mode)) return { ok: false, why: "taken" };
  if (proj.some((p) => modeOf(p) === mode && p.from === ferry.a && p.to === ferry.b && (ACTIVE.has(p.status) || yearOf(sim) - (sim.startYear + Math.floor(p.statusSince / 12)) < COOLING_YEARS))) return { ok: false, why: "recent" };
  // (Stage 13: a link is a crossing of water, not a second trunk road: where the two ports are far apart by land, the ordinary road between them comes first and the crossing is planned between nearer shores)
  if (wk !== undefined && c.km - c.span > LAND_PART_MAX_KM) return { ok: false, why: "far-ports" };
  const s = chooseStructure(sim, c.span, c.km, mode, y); if (!s) return { ok: false, why: "no-structure" };
  // a cheaper structure needs fewer people and less traffic to be worth building: the bars scale with its price relative to the general one (0.5 for a water tunnel at wk 3)
  const cheap = s.fac === "tunnel" && wk !== undefined ? waterTechAt(wk, y).costMult : 1;
  const side = sidePops(sim, w, c.a.cell, c.b.cell), mpA = massPop(sim, w, w.lm[c.a.cell]), mpB = massPop(sim, w, w.lm[c.b.cell]), popSmall = c.kind !== "strait" ? Math.min(...side) : wk === undefined ? Math.min(mpA, mpB) : Math.min(Math.max(mpA, side[0]), Math.max(mpB, side[1]));   // (a headland the 5 km grid cuts off from its island is a mass of nobody: its own people count)
  if (popSmall < POP_PER_KM * cheap * Math.max(c.span, 1)) return { ok: false, why: "pop", s };   // too few people on the small shore for this much water
  const tm = s.fac === "tunnel" && wk !== undefined ? waterTechAt(wk, y).timeMult : techAt(sim.tech!.k, y).timeMult;
  const months = Math.max(24, c.span * 0.8) * tm, need = s.cost / months, pool = sim.macro.budgetBu * (mode === "road" ? dl.roadShare * dl.austerity : 1 - dl.roadShare) * (mode === "road" ? 0.2 : 0.6);
  if (need + committed > FUND_SHARE * pool) return { ok: false, why: "funds", s, need, fund: FUND_SHARE * pool };
  const load = Math.max(ferryLoad(ferry) * (modeOf(ferry) !== mode ? RAIL_FROM_ROAD : 1), c.kind === "strait" ? 0 : virtualTrips(sim, w, c.a.cell, c.b.cell, c.km, mode) / (mode === "rail" ? 6000 : 3000));
  const score = Math.min(2, load) * appetite, bar = (SCORE_MIN + c.span / SPAN_SCORE_KM) * cheap;
  // (Stage 13: with a limited number of projects at a time, the planner takes the best return for the money -- traffic against the square root of the price -- not simply the busiest: a modest strait with a cheap crossing is not starved for a century by the great ones)
  const rank = wk !== undefined ? score / Math.sqrt(Math.max(1, s.cost) / 50) : score;
  return score >= bar ? { ok: true, why: "ok", s, score, rank, bar } : { ok: false, why: "score", s, score, rank, bar };
}
export function planCrossings(sim: SimState, w: World, y: number): SimProject[] {
  if (!sim.crossings || !sim.tech) return [];
  const dl = sim.dials, started: SimProject[] = [], proj = Object.values(sim.projects).filter(isCrossingProject), wk = sim.tech.wk;
  for (const mode of ["road", "rail"] as Mode[]) {
    const maxActive = wk !== undefined ? MAX_ACTIVE_WATER : MAX_ACTIVE_PER_MODE;
    const appetite = (mode === "road" ? dl.hwyBuild : dl.railBuild) * (1 + 0.5 * dl.hsr) * (1 - 0.35 * Math.min(1, dl.seaBias)); if (appetite < 0.15) continue;
    for (let round = 0; round < (wk !== undefined ? STARTS_PER_YEAR_WATER : 1); round++) {
      if (proj.filter((p) => modeOf(p) === mode && ACTIVE.has(p.status)).length + started.filter((p) => modeOf(p) === mode).length >= maxActive) break;
      let best: { c: Corridor; s: { fac: "bridge" | "tunnel"; cost: number }; score: number; rank: number } | null = null;
      for (const c of corridorsOf(sim, w, mode)) {
        const ev = evalCorridor(sim, w, c, mode, y, appetite, started, proj); if (!ev.ok) continue;
        if (!best || ev.rank! > best.rank || (ev.rank === best.rank && c.km < best.c.km)) best = { c, s: ev.s!, score: ev.score!, rank: ev.rank! };
      }
      if (!best) break;
      const sp = startCrossing(sim, w, best.c, best.s, best.c.ferry, mode, best.score, y); if (sp) started.push(sp); else break;
    }
  }
  return started;
}
/** Stage 13: a railway line from the nearest railway node on this shore to the shore cell, so the tunnel joins the network (null when none is near; empty when the shore is already a station). */
function railApproach(sim: SimState, w: World, cell: number, towardShore: boolean, y: number, other: number): { created: string[]; chain: { edgeId: string; dir: 1 | -1 }[]; km: number } | null {
  const idx = buildIndex(sim, "rail"); if (idx.nodeByCell.has(cell)) return { created: [], chain: [], km: 0 };
  let best = -1, bd = Infinity; const p = w.cellPos(cell);
  const po = w.cellPos(other);
  // (a node nearer the OTHER shore is that shore's, not this one's: both ends of a short crossing must not be joined to the network through each other)
  for (const q of idx.nodeByCell.keys()) { if (w.lm[q] !== w.lm[cell]) continue; const d = dist(w.cellPos(q), p); if (d < bd && d < dist(w.cellPos(q), po)) { bd = d; best = q; } }
  if (best < 0 || bd > RAIL_REACH_KM) return null;
  const path = towardShore ? pathfind(w, best, cell, { rail: true, margin: 14, ease: 0 }) : pathfind(w, cell, best, { rail: true, margin: 14, ease: 0 }); if (!path || path.length < 2) return null;
  const l = layPath(sim, w, path, { facilities: !!w.land12, open: false, surface: "paved", quality: 88, built: 0, month: sim.month, standard: "standard", mode: "rail", op: "jnr" }); void y;
  return { created: l.created, chain: l.chain, km: l.created.reduce((m, id) => m + (sim.edges[id]?.lengthKm ?? 0), 0) };
}
function startCrossing(sim: SimState, w: World, c: Corridor, s: { fac: "bridge" | "tunnel"; cost: number }, ferry: SimEdge, mode: Mode, score: number, y: number): SimProject | null {
  const rail = mode === "rail", a = c.a.name.replace(/市$/, ""), b = c.b.name.replace(/市$/, ""), sea = c.kind === "lake" ? "湖底" : "海底";
  // a railway tunnel needs the railway to reach both shores; the approach lines are part of the project (and of its price)
  type Ap = NonNullable<ReturnType<typeof railApproach>>; let approachA: Ap | null = { created: [], chain: [], km: 0 }, approachB: Ap | null = approachA;
  if (rail && sim.tech?.wk !== undefined && ferry.mode !== "rail") { approachA = railApproach(sim, w, c.a.cell, true, y, c.b.cell); approachB = railApproach(sim, w, c.b.cell, false, y, c.a.cell); if (!approachA || !approachB) { for (const ap of [approachA, approachB]) if (ap) for (const id of ap.created) delete sim.edges[id]; return null; } }
  const id = newId(sim, "edge");
  const e: SimEdge = { ...newEdgeDefaults(), id, a: ferry.a, b: ferry.b, cells: [...ferry.cells], lengthKm: ferry.lengthKm, surface: "paved", quality: 92, built: 0, open: false, state: "closed", standard: "standard", maxGradePct: 1, builtMonth: null, region: ferry.region, facility: s.fac, facilityName: `link:${a}〜${b}${s.fac === "bridge" ? "大橋" : `${sea}トンネル`}`, ...(rail ? { mode: "rail" as const, op: ferry.op ?? "jnr" } : {}) };
  sim.edges[id] = e;
  const approachKm = approachA!.km + approachB!.km, cost = s.cost + approachKm * RAIL_UNIT.standard, edgeIds = [id, ...approachA!.created, ...approachB!.created], chain = [...approachA!.chain, { edgeId: id, dir: 1 as const }, ...approachB!.chain];
  const reason = `${CROSSING_TAG}${a}〜${b}の${rail ? "鉄道" : "道路"}${rail && ferry.mode !== "rail" ? "輸送" : "連絡船"}は混雑(${Math.round(ferryLoad(ferry) * 100)}%)。${c.kind === "lake" ? "湖面" : "海峡"}${c.span}kmは${s.fac === "bridge" ? "橋" : sea + "トンネル"}で結べる技術がある`;
  // a route is one unbroken chain: if the approaches do not join up end to end, nothing is started (and nothing is left behind)
  const joins = chain.every((x, i) => { if (i === 0) return true; const q = chain[i - 1], pe = sim.edges[q.edgeId], ce = sim.edges[x.edgeId]; return !!pe && !!ce && (q.dir === 1 ? pe.b : pe.a) === (x.dir === 1 ? ce.a : ce.b); });
  if (!joins) { if (process.env.DBG13) (globalThis as any).__dbg13 = ((globalThis as any).__dbg13 ?? []).concat(`${c.a.name}>${c.b.name} ` + chain.map((x) => { const q = sim.edges[x.edgeId]; return `${x.edgeId}/${x.dir}:${q?.a}>${q?.b}`; }).join(" ")); for (const eid of edgeIds) delete sim.edges[eid]; return null; }
  const p = createProject(sim, "new", "JP", ferry.a, ferry.b, edgeIds, chain, cost, reason, score); p.status = "concept"; if (rail) { p.mode = "rail"; p.op = e.op; }
  ev(sim, "crossing", `${c.kind === "lake" ? "湖底" : "海峡"}${s.fac === "bridge" ? "架橋" : "トンネル"}構想(${rail ? "鉄道" : "道路"}): ${a}〜${b}`, `${reason}(工費の目安${cost.toFixed(1)}${approachKm ? `、取付線${Math.round(approachKm)}kmを含む` : ""}。連絡船はそのまま運航)`, { project: p.id, edge: id }); return p;
}
/**
 * A crossing project has just opened: the ferry it replaces (same two ports, same mode) is closed and the routes that used it move onto the new edge, so
 * a numbered route stays continuous. Returns true when at least one route was carried over (the caller then does not give the link a number of its own).
 */
export function finishCrossing(sim: SimState, w: World, p: SimProject): boolean { const e = sim.edges[p.edgeIds[0]]; return !!e && carryOver(sim, w, e) > 0; }
/** The same hand-over for any fixed link that has just opened between two ports (a planned one, or a scripted historical one). Returns the number of routes moved. */
export function carryOver(sim: SimState, w: World, e: SimEdge): number {
  const mode = modeOf(e); let moved = 0;
  const ferry = Object.values(sim.edges).find((f) => f.facility === "ferry" && modeOf(f) === mode && f.state !== "lost" && ((f.a === e.a && f.b === e.b) || (f.a === e.b && f.b === e.a)));
  if (ferry) {
    for (const r of Object.values(sim.routes)) for (const ref of r.edges) if (ref.edgeId === ferry.id) { ref.edgeId = e.id; ref.dir = ferry.a === e.a ? ref.dir : ((-ref.dir) as 1 | -1); moved++; }
    ferry.state = "closed"; ferry.open = false; pushHist(sim, ferry, `${e.facility === "bridge" ? "橋" : "トンネル"}の開通により航路を廃止`);
    ev(sim, "close", `${(ferry.facilityName ?? "").replace(/^[a-z-]+:/, "")}を廃止`, `${(e.facilityName ?? "").replace(/^[a-z-]+:/, "")}の開通で役目を終えた${moved ? `(${moved}路線を新しい${e.facility === "bridge" ? "橋" : "トンネル"}へ付け替え)` : ""}`, { edge: ferry.id });
  }
  return moved;
}
