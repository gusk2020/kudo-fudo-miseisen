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
/** A fixed link must serve people: the smaller shore's population (cities and villages) has to reach this many per km of open water. 10 km of strait needs 35,000 on the small side, 50 km needs 175,000. */
export const POP_PER_KM = 3500;
const ACTIVE = new Set(["concept", "planned", "building", "suspended"]);

export const isCrossingProject = (p: SimProject) => p.reason.startsWith(CROSSING_TAG);
/** Stage 11: a bridge is the preferred structure whenever the technology can span the water and it costs no more than BRIDGE_PREF times the tunnel (a bridge is built to be seen and
 * driven; the cheaper structure won every time before, so no bridge was ever planned). A tunnel takes the crossings a bridge cannot span, or where it would cost far more. */
export const BRIDGE_PREF = 2.2, BRIDGE_WAIT_YEARS = 30 /* technology-clock years (15 calendar years at K=2) */, PLAN_TUNNEL_MAX_KM = 40;
/** What would be built across this gap, and what it would cost (null when neither a bridge nor a tunnel is feasible this year). */
export function chooseStructure(sim: SimState, gapKm: number, km: number, mode: Mode, year: number): { fac: "bridge" | "tunnel"; cost: number } | null {
  if (!sim.tech) return null; const now = techAt(sim.tech.k, year), unit = mode === "rail" ? RAIL_UNIT.standard : UNIT.standard;
  // the structure is the span over open water (dearer the longer it is); the rest of the way between the two ports is ordinary road or rail
  const price = (fac: "bridge" | "tunnel", span: number) => span * facCost({ facility: fac, curv: 0 } as SimEdge, sim) * unit * (1 + span / (fac === "bridge" ? 15 : 40)) + Math.max(0, km - span) * unit;
  const b = gapKm <= now.bridgeKm ? { fac: "bridge" as const, cost: price("bridge", gapKm) } : null, t = gapKm <= now.tunnelKm ? { fac: "tunnel" as const, cost: price("tunnel", gapKm) } : null;
  if (t && gapKm > PLAN_TUNNEL_MAX_KM) return b;   // no tunnel is planned across water wider than the world's longest (the Channel Tunnel's 38 km): a wider sea stays a ferry
  if (b && t) return b.cost <= BRIDGE_PREF * t.cost ? b : t;
  // a strait a bridge will span within BRIDGE_WAIT_YEARS is waited for rather than tunnelled: the bridge is the structure the crossing is meant to get
  if (!b && t && gapKm <= techAt(sim.tech.k, year + BRIDGE_WAIT_YEARS / sim.tech.k).bridgeKm) return null;
  return b ?? t;
}
/**
 * Stage 11: the crossings the planner considers are the FERRY routes themselves (any open sea ferry of the mode between two port cities on different land masses), not one canonical
 * pair per pair of masses. Before, Honshu-Shikoku had a single candidate (the two closest cities) and everything else -- Okayama-Takamatsu, Hiroshima-Matsuyama, the Bungo channel --
 * could never be planned. The open water of a corridor is the narrowest strait between the two shores it joins (`localGapKm`).
 */
export interface Corridor { ferry: SimEdge; a: WCity; b: WCity; span: number; km: number }
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
    const a = w.cityByCell.get(f.cells[0]), b = w.cityByCell.get(f.cells[f.cells.length - 1]); if (!a || !b || w.lm[a.cell] === w.lm[b.cell]) continue;
    out.push({ ferry: f, a, b, span: localGapKm(w, a.cell, b.cell), km: Math.round(f.lengthKm * 10) / 10 });
  }
  return out.sort((p, q) => (p.ferry.id < q.ferry.id ? -1 : 1));
}
/** A fixed link of this mode (built, or still a live project) already runs within LINK_NEAR_KM of both ports of this corridor. */
export const LINK_NEAR_KM = 40;
export function corridorTaken(sim: SimState, w: World, c: Corridor, mode: Mode): boolean {
  const near = (cell: number, port: WCity) => Math.hypot(w.cellPos(cell)[0] - port.pos[0], w.cellPos(cell)[1] - port.pos[1]) <= LINK_NEAR_KM;
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
export function planCrossings(sim: SimState, w: World, y: number): SimProject[] {
  if (!sim.crossings || !sim.tech) return [];
  const dl = sim.dials, started: SimProject[] = [], proj = Object.values(sim.projects).filter(isCrossingProject);
  for (const mode of ["road", "rail"] as Mode[]) {
    if (proj.filter((p) => modeOf(p) === mode && ACTIVE.has(p.status)).length >= MAX_ACTIVE_PER_MODE) continue;
    const appetite = (mode === "road" ? dl.hwyBuild : dl.railBuild) * (1 + 0.5 * dl.hsr) * (1 - 0.35 * Math.min(1, dl.seaBias)); if (appetite < 0.15) continue;
    let best: { c: Corridor; s: { fac: "bridge" | "tunnel"; cost: number }; score: number } | null = null;
    for (const c of corridorsOf(sim, w, mode)) {
      const ferry = c.ferry; if (corridorTaken(sim, w, c, mode)) continue;
      const recent = proj.some((p) => modeOf(p) === mode && p.from === ferry.a && p.to === ferry.b && (ACTIVE.has(p.status) || yearOf(sim) - (sim.startYear + Math.floor(p.statusSince / 12)) < COOLING_YEARS)); if (recent) continue;
      if (Math.min(massPop(sim, w, w.lm[c.a.cell]), massPop(sim, w, w.lm[c.b.cell])) < POP_PER_KM * Math.max(c.span, 1)) continue;   // too few people on the small shore for this much strait
      const s = chooseStructure(sim, c.span, c.km, mode, y); if (!s) continue;
      const months = Math.max(24, c.span * 0.8) * techAt(sim.tech.k, y).timeMult, need = s.cost / months, pool = sim.macro.budgetBu * (mode === "road" ? dl.roadShare * dl.austerity : 1 - dl.roadShare) * (mode === "road" ? 0.2 : 0.6);
      if (need > FUND_SHARE * pool) continue;
      const score = Math.min(2, ferryLoad(ferry)) * appetite;
      if (score >= SCORE_MIN + c.span / SPAN_SCORE_KM && (!best || score > best.score || (score === best.score && c.km < best.c.km))) best = { c, s, score };
    }
    if (best) started.push(startCrossing(sim, w, best.c, best.s, best.c.ferry, mode, best.score, y));
  }
  return started;
}
function startCrossing(sim: SimState, w: World, c: Corridor, s: { fac: "bridge" | "tunnel"; cost: number }, ferry: SimEdge, mode: Mode, score: number, y: number): SimProject {
  const id = newId(sim, "edge"), rail = mode === "rail", a = c.a.name.replace(/市$/, ""), b = c.b.name.replace(/市$/, "");
  const e: SimEdge = { ...newEdgeDefaults(), id, a: ferry.a, b: ferry.b, cells: [...ferry.cells], lengthKm: ferry.lengthKm, surface: "paved", quality: 92, built: 0, open: false, state: "closed", standard: "standard", maxGradePct: 1, builtMonth: null, region: ferry.region, facility: s.fac, facilityName: `link:${a}〜${b}${s.fac === "bridge" ? "大橋" : "海底トンネル"}`, ...(rail ? { mode: "rail" as const, op: ferry.op ?? "jnr" } : {}) };
  sim.edges[id] = e;
  const reason = `${CROSSING_TAG}${a}〜${b}の${rail ? "鉄道" : "道路"}連絡船は混雑(${Math.round(ferryLoad(ferry) * 100)}%)。海峡${c.span}kmは${s.fac === "bridge" ? "橋" : "海底トンネル"}で結べる技術がある`;
  const p = createProject(sim, "new", "JP", ferry.a, ferry.b, [id], [{ edgeId: id, dir: 1 }], s.cost, reason, score); p.status = "concept"; if (rail) { p.mode = "rail"; p.op = e.op; }
  ev(sim, "crossing", `海峡${s.fac === "bridge" ? "架橋" : "トンネル"}構想(${rail ? "鉄道" : "道路"}): ${a}〜${b}`, `${reason}(工費の目安${s.cost.toFixed(1)}。連絡船はそのまま運航)`, { project: p.id, edge: id }); void y; return p;
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
