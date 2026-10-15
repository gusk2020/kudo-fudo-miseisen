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
import { crossingPorts, fixedLink, servedMasses, type Crossing } from "./ferry";
import { capacityOf } from "./demand";
import { ev, yearOf } from "./engine";
import { newEdgeDefaults, newId, pushHist } from "./network";
import { techAt } from "./tech";
import { modeOf, type Mode, type SimEdge, type SimProject, type SimState } from "./types";
import type { World } from "./world";

export const CROSSING_TAG = "【海峡連絡】";
/** At most this many crossing projects of one mode at once; and a pair is not tried again within COOLING_YEARS of an abandoned attempt. */
export const MAX_ACTIVE_PER_MODE = 1, COOLING_YEARS = 12, FUND_SHARE = 0.6, SCORE_MIN = 0.3;
/** A fixed link must serve people: the smaller shore's population (cities and villages) has to reach this many per km of open water. 10 km of strait needs 35,000 on the small side, 50 km needs 175,000. */
export const POP_PER_KM = 3500;
const ACTIVE = new Set(["concept", "planned", "building", "suspended"]);

export const isCrossingProject = (p: SimProject) => p.reason.startsWith(CROSSING_TAG);
const ferryOf = (sim: SimState, c: Crossing, mode: Mode): SimEdge | null => {
  const na = Object.values(sim.nodes).find((n) => n.cell === c.a.cell)?.id, nb = Object.values(sim.nodes).find((n) => n.cell === c.b.cell)?.id; if (!na || !nb) return null;
  return Object.values(sim.edges).find((e) => e.facility === "ferry" && modeOf(e) === mode && ((e.a === na && e.b === nb) || (e.a === nb && e.b === na))) ?? null;
};
/** What would be built across this gap, and what it would cost (null when neither a bridge nor a tunnel is feasible this year). */
export function chooseStructure(sim: SimState, gapKm: number, km: number, mode: Mode, year: number): { fac: "bridge" | "tunnel"; cost: number } | null {
  if (!sim.tech) return null; const now = techAt(sim.tech.k, year), unit = mode === "rail" ? RAIL_UNIT.standard : UNIT.standard, opts: { fac: "bridge" | "tunnel"; cost: number }[] = [];
  // the structure is the span over open water (dearer the longer it is); the rest of the way between the two ports is ordinary road or rail
  const price = (fac: "bridge" | "tunnel", span: number) => span * facCost({ facility: fac, curv: 0 } as SimEdge, sim) * unit * (1 + span / (fac === "bridge" ? 15 : 40)) + Math.max(0, km - span) * unit;
  if (gapKm <= now.bridgeKm) opts.push({ fac: "bridge", cost: price("bridge", gapKm) });
  if (gapKm <= now.tunnelKm) opts.push({ fac: "tunnel", cost: price("tunnel", gapKm) });
  return opts.sort((a, b) => a.cost - b.cost)[0] ?? null;
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
  const dl = sim.dials, started: SimProject[] = [], masses = servedMasses(w), proj = Object.values(sim.projects).filter(isCrossingProject);
  for (const mode of ["road", "rail"] as Mode[]) {
    if (proj.filter((p) => modeOf(p) === mode && ACTIVE.has(p.status)).length >= MAX_ACTIVE_PER_MODE) continue;
    const appetite = (mode === "road" ? dl.hwyBuild : dl.railBuild) * (1 + 0.5 * dl.hsr) * (1 - 0.35 * Math.min(1, dl.seaBias)); if (appetite < 0.15) continue;
    let best: { c: Crossing; s: { fac: "bridge" | "tunnel"; cost: number }; score: number; ferry: SimEdge } | null = null;
    for (let i = 0; i < masses.length; i++) for (let j = i + 1; j < masses.length; j++) {
      const c = crossingPorts(w, masses[i], masses[j]); if (!c || fixedLink(sim, w, c.la, c.lb, mode)) continue;
      const ferry = ferryOf(sim, c, mode); if (!ferry || ferry.state !== "open") continue;
      const recent = proj.some((p) => modeOf(p) === mode && p.from === ferry.a && p.to === ferry.b && (ACTIVE.has(p.status) || yearOf(sim) - (sim.startYear + Math.floor(p.statusSince / 12)) < COOLING_YEARS)); if (recent) continue;
      if (Math.min(massPop(sim, w, c.la), massPop(sim, w, c.lb)) < POP_PER_KM * c.gapKm) continue;   // too few people on the small shore for this much strait
      const s = chooseStructure(sim, c.gapKm, c.km, mode, y); if (!s) continue;
      const months = Math.max(24, c.gapKm * 0.8) * techAt(sim.tech.k, y).timeMult, need = s.cost / months, pool = sim.macro.budgetBu * (mode === "road" ? dl.roadShare * dl.austerity : 1 - dl.roadShare) * (mode === "road" ? 0.2 : 0.6);
      if (need > FUND_SHARE * pool) continue;
      const score = Math.min(2, ferryLoad(ferry)) * appetite;
      if (score >= SCORE_MIN && (!best || score > best.score || (score === best.score && c.km < best.c.km))) best = { c, s, score, ferry };
    }
    if (best) started.push(startCrossing(sim, w, best.c, best.s, best.ferry, mode, best.score, y));
  }
  return started;
}
function startCrossing(sim: SimState, w: World, c: Crossing, s: { fac: "bridge" | "tunnel"; cost: number }, ferry: SimEdge, mode: Mode, score: number, y: number): SimProject {
  const id = newId(sim, "edge"), rail = mode === "rail", a = c.a.name.replace(/市$/, ""), b = c.b.name.replace(/市$/, "");
  const e: SimEdge = { ...newEdgeDefaults(), id, a: ferry.a, b: ferry.b, cells: [...ferry.cells], lengthKm: ferry.lengthKm, surface: "paved", quality: 92, built: 0, open: false, state: "closed", standard: "standard", maxGradePct: 1, builtMonth: null, region: ferry.region, facility: s.fac, facilityName: `link:${a}〜${b}${s.fac === "bridge" ? "大橋" : "海底トンネル"}`, ...(rail ? { mode: "rail" as const, op: ferry.op ?? "jnr" } : {}) };
  sim.edges[id] = e;
  const reason = `${CROSSING_TAG}${a}〜${b}の${rail ? "鉄道" : "道路"}連絡船は混雑(${Math.round(ferryLoad(ferry) * 100)}%)。海峡${c.gapKm}kmは${s.fac === "bridge" ? "橋" : "海底トンネル"}で結べる技術がある`;
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
