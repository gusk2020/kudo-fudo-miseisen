/**
 * Monthly road-network simulation. Pure and deterministic: (sim, world) -> sim, all randomness from sim.rngState.
 * Every change that matters appends an event with its cause and, for roads, an entry in the edge's own history.
 * All demand, population and budget figures are SYNTHETIC (a toy economy), not statistics.
 */
import { cityBoost, settlementBoost } from "./sites";
import { dist } from "../core/geom";
import { JAPAN } from "../core/data";
import { buildIndex, checkIntegrity, edgePoints, layPath, newEdgeDefaults, newId, pushHist, setEdgeState } from "./network";
import { analyze, analyzeGen, capacityOf, RAIL_PAX, passable, strandedWithout, zeroDemand, type Analysis } from "./demand";
import { ERAS, composeDials, eraKeyOf, type EraKey } from "./eras";
import { applyYearEvents } from "./events";
import { openStraits } from "./straits";
import { PRIVATIZE_YEAR, reassignRoute, reformJnr, successorOperator } from "./reform";
import { SNAP_EVERY_YEARS, makeDeltaSnapshot } from "./ledger";
import { autoResolve, defaultPolicy, openWindow, windowDue } from "./policy";
import { techAt, techYear, TECH_K } from "./tech";
import { LAKE_BRIDGE_TAG, reviewLakeFerries } from "./ferry";
import { ensureHubs, hubBoost, hubStats, reviewHubs } from "./hubs";
import { reviewRailLines } from "./railecon";
import { reviewWorks } from "./freeze";
import { carryOver, finishCrossing, isCrossingProject, planCrossings } from "./crossing";
import { homeCity, subCity, tokyoCity } from "./ceremony";
import { prefOfSeat } from "../core/seat";
import type { Vec } from "../core/types";
import { CAND_1945, chooseEra, kaigenDue, newKaigen, openKaigen, stanceAt } from "./kaigen";
import { facCost, planYearGen } from "./planning";
import { seedInitialNetworkGen } from "./seed";
import { ERA, FU_PREFS, GRADE_LABEL, GRADE_MODE, KIND_LABEL, NICK_LABEL, SIM_VERSION, modeOf, monthToYM, setActiveEra, setActiveTimeline, ymLabel, type Grade, type RouteEdgeRef, type SimEdge, type SimProject, type SimRoute, type SimState } from "./types";
import { cellDistKm, type World } from "./world";

export const MONTHS_PER_YEAR_X1_MS = 60000;       // x1: one real minute is one game year
export const MS_PER_MONTH_X1 = MONTHS_PER_YEAR_X1_MS / 12;
export const CATCHUP_CAP_MONTHS = 360;            // at most 30 years are simulated on return; the rest is reported as skipped
export const EVENT_CAP = 600, EVENT_CAP_S3 = 1000;
/** Everyday noise is dropped first when the timeline is full, so the history that matters (world, policy, reforms, openings, closures) survives a century. */
const MINOR_EVENTS = new Set(["village", "boom", "city", "dormant", "reopen", "lost", "skip", "project", "lane"]);
export const CAPITAL_BONUS = 1.35, CAPITAL_LOSS = 0.85, SUB_CAPITAL_BONUS = 1.15;   // pop multipliers for a capital that is not Tokyo (provisional)
/** Stage 9: リニア -- not before this calendar year, nor before the technology clock reaches MAGLEV_TECH_YEAR, and only for long new high-speed lines. */
export const MAGLEV_YEAR = 2000, MAGLEV_TECH_YEAR = 2030, MAGLEV_MIN_KM = 120;
export const BUDGET_K = 2.6e-6, NATIONAL_POOL = 0.2, EQUAL_SHARE = 0.45;
/** Railways add this much on top of the road budget (Stage 3 only); the dials then decide the split. */
export const RAIL_BUDGET_SCALE = 0.9, RAIL_FARE = 2.2e-6, RAIL_MAINT = { rural: 0.04, standard: 0.07, highgrade: 0.18 } as const, RAIL_DECAY = 0.25;
export const DORMANT_YEARS = 5, CLOSE_YEARS = 12, DROP_YEARS = 8, LOCAL_KEEP = 25, REVIVE_DEMAND = 30, REVIVE_YEARS = 3;
const MAINT = { unpaved: 0.003, gravel: 0.0045, paved: 0.007 } as const, STD_MAINT = { rural: 1, standard: 1.5, highgrade: 3 } as const;
const DECAY = { unpaved: 0.2, gravel: 0.14, paved: 0.07 } as const;

// ---- randomness / ids / events ----
export function rand(sim: SimState): number {
  sim.rngState = (sim.rngState + 0x6d2b79f5) >>> 0; let t = sim.rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export function hashString(s: string): string { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h.toString(16); }
export function simHash(sim: SimState): string {
  return hashString(JSON.stringify([sim.month, sim.rngState, sim.nodes, sim.edges, sim.routes, sim.projects, sim.cities, sim.settlements, sim.links, sim.macro, sim.routeCounters, sim.events.length, sim.skippedMonths, sim.operators, sim.dials, sim.mods, ...(sim.hubs ? [sim.hubs] : [])]));
}
export function ev(sim: SimState, kind: string, text: string, cause: string, refs: Record<string, string> = {}) {
  sim.events.push({ id: ++sim.next.event, month: sim.month, kind, text, cause, refs });
  const cap = sim.stage3 ? EVENT_CAP_S3 : EVENT_CAP;
  if (sim.events.length > cap + (sim.stage3 ? 100 : 0)) {
    if (sim.stage3) { let extra = sim.events.length - cap; const keep = sim.events.filter((x) => { if (extra > 0 && MINOR_EVENTS.has(x.kind)) { extra--; return false; } return true; }); sim.events = keep; }
    if (sim.events.length > cap) sim.events.splice(0, sim.events.length - cap);
  }
}
export const prefName = (id: string) => JAPAN.prefectures.find((p) => p.id === id)?.name ?? id;
/** Official name only (国道N号). */
export const routeOfficial = (r: SimRoute) => GRADE_MODE[r.grade] === "rail" ? `${r.opName ?? GRADE_LABEL[r.grade]}${r.number}号線` : `${r.scope === "JP" ? "" : prefName(r.scope) + " "}${GRADE_LABEL[r.grade]}${r.number}号`;
/** Official name plus the earned nickname, if any: 国道N号(通称:酷道). */
export const routeLabel = (r: SimRoute) => routeOfficial(r) + (r.nick ? `(通称:${NICK_LABEL[r.grade]})` : "");
export const yearOf = (sim: SimState) => monthToYM(sim.startYear, sim.month).year;

/** Builds the starting state in small slices (yields progress 0..1) so a phone never freezes on one long task. */
/** `firstEra`: index into CAND_1945. When given, the game has an era timeline (Issue #13) and `era` is taken from that candidate's stance. */
export interface SimOpts { era?: EraKey; stage3?: boolean; firstEra?: number; techK?: number; capital?: string; subCapital?: string; palace?: { pref: string; pos: Vec } }
export function* createSimGen(w: World, mapHash: string, terrainHash: string, seed: number, opts: SimOpts = {}): Generator<number, SimState> {
  w.barrier = !!opts.stage3;   // Stage 9: the mountain barrier is part of the real-map game
  const firstCand = opts.stage3 && opts.firstEra !== undefined ? CAND_1945[Math.max(0, Math.min(CAND_1945.length - 1, opts.firstEra))] : null, eraKey = firstCand ? firstCand.stance : opts.era ?? "kobun";
  const sim: SimState = {
    schemaVersion: SIM_VERSION, mapHash, terrainHash, seed: seed >>> 0, era: eraKey, startYear: 1950, month: 0, rngState: (seed ^ 0xa5a5a5a5) >>> 0, speed: 0,
    next: { node: 0, edge: 0, route: 0, project: 0, event: 0 }, nodes: {}, edges: {}, routes: {}, projects: {}, cities: {}, settlements: {}, links: [], snaps: [], regionShare: {},
    macro: { mood: 0, budgetBu: 0, maintCoverage: 1 }, routeCounters: {}, events: [], stats: [], skippedMonths: 0, lastWallMs: 0, ceremonyDone: false,
    operators: { jnr: { id: "jnr", name: "国鉄", kind: "jnr", since: 1950, note: "国有の鉄道" } }, dials: null as never, mods: [], ...(opts.stage3 ? { stage3: true, policy: defaultPolicy() } : {}), ...(firstCand ? { kaigen: newKaigen(firstCand, opts.firstEra!, seed >>> 0) } : {}), ...(opts.stage3 && (firstCand || opts.techK !== undefined) ? { tech: { k: opts.techK ?? TECH_K } } : {}),
    ...(prefOfSeat(opts.capital) && prefOfSeat(opts.capital) !== "JP-13" ? { capital: prefOfSeat(opts.capital)! } : {}), ...(prefOfSeat(opts.subCapital) ? { subCapital: prefOfSeat(opts.subCapital)! } : {}), ...(opts.palace ? { palace: opts.palace } : {}),
    ...(firstCand ? { crossings: true as const } : {}),
  };
  sim.dials = composeDials(sim, 1950); setActiveEra(eraKeyOf(eraKey)); setActiveTimeline(sim.kaigen?.eras ?? null);
  const tokyoId = tokyoCity(w)?.id;
  for (const c of w.cities) sim.cities[c.id] = { pop: c.pop0, popSource: c.popSource, lowAccessYears: 0, industry: Math.round((0.25 + 0.3 * (c.coastal ? 1 : 0) + 0.25 * c.plains + 0.1 * rand(sim)) * 1000) / 1000 };
  // a moved capital draws people and industry to itself and costs the old one some; a sub-capital gains a little (fictional, modest, provisional)
  if (sim.capital && tokyoId && sim.cities[tokyoId]) { const hc = homeCity(w, sim.capital); if (hc && sim.cities[hc.id] && hc.id !== tokyoId) { const c = sim.cities[hc.id], o = sim.cities[tokyoId]; c.pop = Math.round(c.pop * CAPITAL_BONUS); c.industry = Math.min(1, Math.round((c.industry + 0.15) * 1000) / 1000); if (!(sim.subCapital && subCity(w, sim.subCapital)?.id === tokyoId)) o.pop = Math.round(o.pop * CAPITAL_LOSS); } }
  if (sim.subCapital) { const sc = subCity(w, sim.subCapital), hc = homeCity(w, sim.capital); if (sc && sim.cities[sc.id] && sc.id !== hc?.id) { const c = sim.cities[sc.id]; c.pop = Math.round(c.pop * SUB_CAPITAL_BONUS); c.industry = Math.min(1, Math.round((c.industry + 0.05) * 1000) / 1000); } }
  if (sim.stage3) ensureHubs(sim, w, sim.startYear);   // Stage 8: the ports of 1950 (airports open from the late 1950s)
  yield* seedInitialNetworkGen(sim, w); refreshNick(sim); takeSnapshot(sim); yield 1;
  return sim;
}
export function createSim(w: World, mapHash: string, terrainHash: string, seed: number, opts: SimOpts = {}): SimState {
  const g = createSimGen(w, mapHash, terrainHash, seed, opts); for (;;) { const r = g.next(); if (r.done) return r.value; }
}
export function issueNumber(sim: SimState, grade: Grade, scope: string): number { const k = `${grade}:${scope}`; return (sim.routeCounters[k] = (sim.routeCounters[k] ?? 0) + 1); }
export function designate(sim: SimState, chain: RouteEdgeRef[], grade: Grade, scope: string, text: string, cause: string, quiet = false, forceNumber?: number): SimRoute | null {
  if (!chain.length) return null;
  const id = newId(sim, "route"), number = forceNumber ?? issueNumber(sim, grade, scope);
  const rail = GRADE_MODE[grade] === "rail", opId = rail ? (grade === "jnr" ? "jnr" : scope) : undefined, opName = rail ? (sim.operators[opId!]?.name ?? GRADE_LABEL[grade]) : undefined;
  const r: SimRoute = { id, scope, grade, number, name: rail ? `${opName}${number}号線` : `${GRADE_LABEL[grade]}${number}号`, ...(rail ? { mode: "rail" as const, op: opId, opName } : {}), edges: chain.map((c) => ({ ...c })), since: sim.month, active: true, lowYears: 0, highYears: 0, history: [{ month: sim.month, grade, number, text, scope, ...(rail ? { opName } : {}) }], nick: false, oldEdges: [] };
  sim.routes[id] = r; if (!quiet) ev(sim, "route", `${routeOfficial(r)}を指定: ${text}`, cause, { route: id }); return r;
}
const routesOfEdge = (sim: SimState, id: string) => Object.values(sim.routes).filter((r) => r.active && (r.edges.some((x) => x.edgeId === id) || r.oldEdges.includes(id)));
export const bestGradeOf = (sim: SimState, id: string): Grade | null => { let b: Grade | null = null; for (const r of routesOfEdge(sim, id)) if (!b || r.grade === "national" || (r.grade === "fu" && b === "ken")) b = r.grade; return b; };

// ---- 通称: earned later by rough, narrow, designated roads (never assigned at designation) ----
export function refreshNick(sim: SimState) {
  const grade = new Map<string, Grade>(); for (const r of Object.values(sim.routes)) if (r.active) for (const id of [...r.edges.map((x) => x.edgeId), ...r.oldEdges]) { const g = grade.get(id); if (!g || r.grade === "national") grade.set(id, r.grade); }
  for (const e of Object.values(sim.edges)) {
    const g = grade.get(e.id), live = e.state === "open" || e.state === "dormant", rail = modeOf(e) === "rail";
    const rough = rail ? e.quality < 38 || e.weathering > 35 : e.standard === "rural" && (e.quality < 35 || e.weathering > 40 || e.maxGradePct >= 9);
    // never at the start: the nickname is earned over time
    if (!e.nick && g && live && rough && sim.month >= 36) { e.nick = true; pushHist(sim, e, `通称「${NICK_LABEL[g]}」と呼ばれる状態に${rail ? "(利用が少なく保守が行き届かない。" : "("}品質${Math.round(e.quality)}・風化${Math.round(e.weathering)}・勾配${e.maxGradePct}%)`); }
    else if (e.nick && (!g || !live || !(rail ? e.quality < 55 || e.weathering > 30 : e.standard === "rural" && (e.quality < 55 || e.weathering > 30 || e.maxGradePct >= 9)))) { e.nick = false; pushHist(sim, e, "通称が外れた(整備・格上げ・指定解除)"); }
  }
  for (const r of Object.values(sim.routes)) { if (!r.active) { r.nick = false; continue; } const es = r.edges.map((x) => sim.edges[x.edgeId]).filter(Boolean), km = es.reduce((s, e) => s + e.lengthKm, 0) || 1; r.nick = es.filter((e) => e.nick).reduce((s, e) => s + e.lengthKm, 0) / km >= 0.5; }
}
export function takeSnapshot(sim: SimState) {
  if (sim.stage3) { sim.snaps.push(makeDeltaSnapshot(sim, yearOf(sim))); if (sim.snaps.length > 80) sim.snaps.splice(1, 1); return; }
  const edges: Record<string, number> = {};
  for (const e of Object.values(sim.edges)) edges[e.id] = (e.built < 1 ? 4 : { open: 0, dormant: 1, closed: 2, lost: 3 }[e.state]) * 16 + Math.min(15, Math.floor(e.quality / 6.5));
  sim.snaps.push({ year: yearOf(sim), edges }); if (sim.snaps.length > 14) sim.snaps.splice(1, 1);
}
const macroBudget = (y: number) => Math.pow(1.06, Math.min(y, 1973) - 1950) * Math.pow(1.02, Math.max(0, Math.min(y, 1990) - 1973)) * Math.pow(0.985, Math.max(0, y - 2000));
/**
 * Stage 3 worlds follow the real course of the population up to 2026 (demography is a fact of the world, the same on every line): fast growth to the mid-70s, slow growth to about 2008 (Japan's real peak),
 * then decline. Cities grow faster than the country (the model's rural areas hold the rest). Stage 2 (legacy) keeps its own curve.
 */
function popRateReal(y: number, pop: number): number {
  let r = y < 1975 ? 0.016 : y < 1990 ? 0.0105 : y < 2008 ? 0.0075 : -0.003;
  if (pop > 1e6 && y < 1990) r += 0.007; if (pop < 1.5e5 && y >= 1955 && y < 1985) r -= 0.006; if (pop < 3e5 && y >= 2008) r -= 0.006; return r;
}
function popRate(y: number, pop: number, real = false): number {
  if (real) return popRateReal(y, pop);
  let r = y < 1975 ? 0.012 : y < 1990 ? 0.004 : y < 2000 ? 0 : -0.006;
  if (pop > 1e6 && y < 1990) r += 0.008; if (pop < 1.5e5 && y >= 1955 && y < 1985) r -= 0.006; if (pop < 3e5 && y >= 2000) r -= 0.01; return r;
}
export const routePrefs = (w: World, es: SimEdge[]): Set<string> => { const s = new Set<string>(); for (const e of es) for (const k of e.cells) { const p = w.prefOf(k); if (p) s.add(p); } return s; };
export const projLabel = (sim: SimState, p: SimProject) => `${sim.nodes[p.from]?.name ?? "地点"}〜${sim.nodes[p.to]?.name ?? "地点"}`;
const edgeName = (sim: SimState, e: SimEdge) => `${sim.nodes[e.a]?.name ?? "地点"}〜${sim.nodes[e.b]?.name ?? "地点"}`;

// ---- yearly decisions ----
function* yearlyGen(sim: SimState, w: World): Generator<void> {
  const y = yearOf(sim);
  if (sim.stage3) { applyYearEvents(sim, y); openStraits(sim, w, y); sim.dials = composeDials(sim, y); ensureHubs(sim, w, y); }
  const an = yield* analyzeGen(sim, w); yield;
  if (sim.stage3 && (sim.kaigen ? (sim.dials.privatize >= 0.5 && !!sim.operators.jnr && sim.operators.jnr.until === undefined && y > 1950) : PRIVATIZE_YEAR[eraKeyOf(sim.era)] === y)) { reformJnr(sim, w, y); yield; }
  updatePopulation(sim, w, an, y); updateRegionShares(sim, w, sim.stage3 ? an : undefined); if (sim.hubs) reviewHubs(sim, w, an.hub, y); yield;
  yield* evaluateEdgesGen(sim, w, an, y); yield;
  evaluateRoutes(sim, w, y); reviewRailLines(sim, w, y); yield;
  yield* planYearGen(sim, w, an, y);
  if (sim.crossings) { planCrossings(sim, w, y); reviewLakeFerries(sim, w, y); }
  reviewWorks(sim);
  refreshNick(sim);
  if (sim.stage3) compactSim(sim, y);
  if (y !== sim.startYear && y % (sim.stage3 ? SNAP_EVERY_YEARS : 10) === 0) takeSnapshot(sim);
  const edges = Object.values(sim.edges), routes = Object.values(sim.routes).filter((r) => r.active), live = edges.filter((e) => e.state === "open" && e.built >= 1);
  const prefs = new Set(live.map((e) => e.region)); const pr = Object.values(sim.projects);
  sim.stats.push({
    year: y, routes: routes.length, km: Math.round(live.reduce((s, e) => s + e.lengthKm, 0)), building: pr.filter((p) => p.status === "building" || p.status === "planned").length, unbuilt: pr.filter((p) => p.status === "unbuilt" || p.status === "suspended").length,
    open: live.length, lost: edges.filter((e) => e.state === "lost").length, budget: Math.round(sim.macro.budgetBu * 100) / 100,
    pop: Math.round(Object.values(sim.cities).reduce((s, c) => s + c.pop, 0)), villagePop: Math.round(Object.values(sim.settlements).reduce((s, v) => s + v.pop, 0)),
    dormant: edges.filter((e) => e.state === "dormant").length, closed: edges.filter((e) => e.state === "closed" && e.built >= 1).length, bypass: sim.links.length,
    regionsBuilding: new Set(pr.filter((p) => p.status === "building").map((p) => p.region)).size, prefsWithRoad: prefs.size,
    ...(sim.hubs ? hubStats(sim, an) : {}),
    ...(sim.stage3 ? { ...landShares(live), airShare: Math.round(an.airShare * 1000) / 1000, seaShare: Math.round(an.seaShare * 1000) / 1000, railKm: Math.round(live.filter((e) => modeOf(e) === "rail").reduce((s, e) => s + e.lengthKm, 0)), roadKm: Math.round(live.filter((e) => modeOf(e) === "road").reduce((s, e) => s + e.lengthKm, 0)) } : {}),
  });
  if (sim.stats.length > 160) sim.stats.shift();
}
/** Keeps a century-long save small: rounds the long floats, drops the working detail of long-finished projects. Stage 3 only. */
function compactSim(sim: SimState, y: number) {
  for (const e of Object.values(sim.edges)) { e.quality = Math.round(e.quality * 10) / 10; e.weathering = Math.round(e.weathering * 10) / 10; e.lengthKm = Math.round(e.lengthKm * 100) / 100; e.maxGradePct = Math.round(e.maxGradePct * 10) / 10; }
  for (const [id, p] of Object.entries(sim.projects)) {
    const age = y - monthToYM(sim.startYear, p.statusSince).year;
    if (p.status === "open" && age >= 25) delete sim.projects[id];
    else if ((p.status === "open" || p.status === "abolished") && age >= 8 && p.chain.length) { p.chain = []; p.replaces = []; }
  }
}
/**
 * Stage 7: the brake on runaway growth. Good transport and the seats of government make a city grow, and growth brings more traffic and more building --
 * a loop with no end unless something pushes back. Land, water and housing do: a city that has grown past CROWD_ROOM times its 1950 size (more room on a
 * wide plain) loses growth in proportion to how far past it is. Explainable, gentle, and only in the new economy.
 */
/** Stage 7: only projects at least this urgent get national top-up money; minor local works stay at the mercy of their own region (and may stall into 未成). */
/** Stage 7: edges reviewed per slice of the yearly evaluation (keeps each main-thread task short on a phone). */
export const EDGE_SLICE = 400;
/** Stage 7: the railway's share of passenger-km (rail figures are riders, a road vehicle stands for RAIL_PAX of them) and of freight, on the open land network. */
export function landShares(live: SimEdge[]): { paxRail: number; frRail: number } {
  let rp = 0, dp = 0, rf = 0, df = 0;
  for (const e of live) { if (e.facility === "ferry") continue; if (modeOf(e) === "rail") { rp += (e.through / RAIL_PAX + e.local) * e.lengthKm; rf += e.freight * e.lengthKm; } else { dp += (e.through + e.local) * e.lengthKm; df += e.freight * e.lengthKm; } }
  return { paxRail: Math.round((rp / Math.max(1e-9, rp + dp)) * 1000) / 1000, frRail: Math.round((rf / Math.max(1e-9, rf + df)) * 1000) / 1000 };
}
export const TOPUP_MIN_PRIORITY = 3, TOPUP_SHARE = 0.5;
export const CROWD_ROOM = 3, CROWD_PLAINS = 5, CROWD_K = 0.02;
export const crowding = (pop: number, pop0: number, plains: number) => CROWD_K * Math.max(0, pop / (Math.max(1, pop0) * (CROWD_ROOM + CROWD_PLAINS * plains)) - 1);
export const LOCAL_RAIL_KEEP = 0.007, LOCAL_ROAD_KEEP = 0.005;   // yearly growth a village gains from a railway / a proper road beside it
function updatePopulation(sim: SimState, w: World, an: Analysis, y: number) {
  // Stage 8: a port or hub draws people from the rest of the country rather than adding to it (the national course stays the demographic one)
  let hbP = 0, hbG = 0; if (sim.hubs) for (const c of w.cities) { const p = sim.cities[c.id].pop; hbP += p; hbG += p * hubBoost(sim, c.id).growth; } const hbMean = hbP ? hbG / hbP : 0;
  w.cities.forEach((c, i) => {
    const st = sim.cities[c.id], bo = cityBoost(sim, w, c.id), hb = hubBoost(sim, c.id), before = st.pop, g = popRate(y, st.pop, sim.stage3 === true && y <= 2026) + hb.growth - hbMean + 0.012 * (an.acc[i] - 0.4) + 0.004 * (bo.commerce + bo.industry + bo.manufacturing) / 3 - (sim.stage3 ? crowding(st.pop, c.pop0, c.plains) : 0) + (rand(sim) - 0.5) * 0.008;
    st.pop = Math.max(2000, Math.round(st.pop * (1 + g)));
    const target = Math.min(1, 0.2 + 0.35 * (c.coastal ? 1 : 0) + 0.2 * c.plains + 0.9 * an.acc[i] + 0.5 * bo.industry + hb.industry); st.industry = Math.round((st.industry + (target - st.industry) * 0.1) * 1000) / 1000;
    st.lowAccessYears = an.acc[i] < 0.02 ? st.lowAccessYears + 1 : 0; const base = c.pop0;
    if (sim.stage3 && !sim.hubs && st.airport === undefined && ((st.pop > 400000 * (1 - 0.25 * sim.dials.airBias) && y >= 1958 - Math.round(8 * sim.dials.airBias)) || (st.pop > 200000 * (1 - 0.25 * sim.dials.airBias) && y >= 1972 - Math.round(8 * sim.dials.airBias)) || (st.pop > 100000 * (1 - 0.25 * sim.dials.airBias) && y >= 1988 - Math.round(8 * sim.dials.airBias)))) { st.airport = y; ev(sim, "air", `${c.name}に空港が開港`, `人口${Math.round(st.pop / 1000)}千人に達し、航空需要が見込まれた`, { city: c.id }); }
    if (before < 2 * base && st.pop >= 2 * base) ev(sim, "city", `${c.name}の人口が1950年の2倍に`, an.acc[i] > 0.1 ? "道路網で結ばれ産業が集積" : "全国的な人口増", { city: c.id });
    if (before > 0.7 * base && st.pop <= 0.7 * base) ev(sim, "city", `${c.name}の人口が3割減`, st.lowAccessYears > 3 ? "幹線から外れ孤立" : "人口減少局面", { city: c.id });
  });
  const nodeCells = new Set(Object.values(sim.nodes).map((n) => n.cell));
  // Stage 3: a village that a railway or a proper road passes keeps its people better (empirical, not a statistic): this is the feedback that lets local transport pay back
  const railCells = new Set<number>(), goodCells = new Set<number>();
  if (sim.stage3) for (const e of Object.values(sim.edges)) if (e.state === "open" && e.built >= 1 && (modeOf(e) === "rail" || e.standard !== "rural")) for (const c of e.cells) (modeOf(e) === "rail" ? railCells : goodCells).add(c);
  const nearSet = (cell: number, s: Set<number>) => { if (!s.size) return false; const i = cell % w.nx, j = (cell / w.nx) | 0; for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) if (s.has((j + dj) * w.nx + i + di)) return true; return false; };
  for (const v of Object.values(sim.settlements)) {
    if (v.gone) continue; const ok = an.reach.get(v.id) !== false || !nodeCells.has(v.cell);   // a settlement with no road node yet is not 'cut off' v.isolatedYears = ok ? 0 : v.isolatedYears + 1;
    let g = y < 1960 ? 0.004 : y < 1975 ? -0.006 : y < 2000 ? -0.012 : -0.028; g += (rand(sim) - 0.5) * 0.01 + 0.01 * settlementBoost(sim, w, v.cell).tourism; if (!ok) g -= 0.03; if (sim.stage3 && ok) g += (nearSet(v.cell, railCells) ? LOCAL_RAIL_KEEP : 0) + (nearSet(v.cell, goodCells) ? LOCAL_ROAD_KEEP : 0);
    v.pop = Math.round(v.pop * (1 + g));
    if (v.pop < 120) { v.gone = true; v.pop = 0; ev(sim, "village", `${v.name}が無人化(廃村)`, ok ? "長期の人口減少" : "道路が途絶え孤立", { settlement: v.id }); }
  }
  // synthetic regional events (not real history): development, tourism or an industrial park raises demand somewhere
  if (y >= 1960) for (const pref of w.t.prefOrder) {
    const vs = Object.values(sim.settlements).filter((v) => !v.gone && w.prefOf(v.cell) === pref).sort((a, b) => (a.id < b.id ? -1 : 1));
    if (vs.length && rand(sim) < 0.02) { const v = vs[Math.floor(rand(sim) * vs.length)]; v.pop = Math.round(Math.max(v.pop * 2.2, 1500) + 1200); ev(sim, "boom", `${prefName(pref)}の${v.name}が再開発され人口が回復`, "地域イベント(観光・工業団地・宅地開発。合成)", { settlement: v.id }); }
    // a road that fell out of use may get a reason to come back: people move in next to it
    const idle = Object.values(sim.edges).filter((e) => e.region === pref && e.built >= 1 && (e.state === "closed" || e.state === "lost" || e.state === "dormant")).sort((a, b) => (a.id < b.id ? -1 : 1));
    if (idle.length && rand(sim) < 0.03) {
      const e = idle[Math.floor(rand(sim) * idle.length)], near = Object.values(sim.settlements).filter((v) => !v.gone && e.cells.some((c) => Math.abs((c % w.nx) - (v.cell % w.nx)) <= 2 && Math.abs(((c / w.nx) | 0) - ((v.cell / w.nx) | 0)) <= 2));
      if (near.length) { const v = near[Math.floor(rand(sim) * near.length)]; v.pop = Math.round(Math.max(v.pop * 2.2, 1500) + 1200); ev(sim, "boom", `${prefName(pref)}の${v.name}が再開発され、使われていない道の沿線に人が戻る`, "地域イベント(合成)", { settlement: v.id, edge: e.id }); continue; }
      const mid = e.cells[Math.floor(e.cells.length / 2)], i0 = mid % w.nx, j0 = (mid / w.nx) | 0; let cell = -1;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]]) { const k = (j0 + dj) * w.nx + i0 + di; if (k >= 0 && k < w.N && w.t.land[k] === 1 && !Object.values(sim.settlements).some((q) => q.cell === k)) { cell = k; break; } }
      const city = w.cities.filter((c) => c.island === w.t.island[mid]).sort((p2, q2) => cellDistKm(w, p2.cell, mid) - cellDistKm(w, q2.cell, mid))[0];
      if (cell >= 0 && city) {
        const id = `s.${String(1 + Object.keys(sim.settlements).reduce((m, k) => Math.max(m, parseInt(k.slice(2), 10) || 0), 0)).padStart(4, "0")}`;
        sim.settlements[id] = { id, name: `${city.name.replace(/市$/, "")}新開発地`, cell, city: city.id, pop: 3500, pop0: 3500, isolatedYears: 0, gone: false };
        ev(sim, "boom", `${prefName(pref)}に新開発地が誕生(${sim.settlements[id].name})`, "地域イベント(宅地・工業団地の開発。合成)。使われなくなった道の沿線に人が戻る", { settlement: id, edge: e.id });
      }
    }
  }
}
/** Stage 9: a share of the road purse follows NEED -- the people of a region weighted by how poorly they are reached (access below the national median) -- rather than wealth (地方交付・格差是正). */
export const NEED_SHARE = 0.15;
/** Stage 9: how far below the national median each city's access is (0 = at or above it, 1 = no access). Read by the budget split and the planners. */
export function accessDeficit(w: World, an: Pick<Analysis, "acc">): Float64Array {
  const xs = [...an.acc].sort((a, b) => a - b), med = xs[Math.floor(xs.length / 2)] || 1e-9, out = new Float64Array(w.cities.length);
  for (let i = 0; i < out.length; i++) out[i] = Math.max(0, Math.min(1, (med - (an.acc[i] ?? 0)) / med)); return out;
}
export function updateRegionShares(sim: SimState, w: World, an?: Pick<Analysis, "acc">) {
  const econ: Record<string, number> = {}; let tot = 0;
  for (const c of w.cities) { const r = c.pref ?? "JP-13", bo = cityBoost(sim, w, c.id), v = sim.cities[c.id].pop * (1 + bo.commerce) * sim.cities[c.id].industry * (1 + bo.manufacturing); econ[r] = (econ[r] ?? 0) + v; tot += v; }
  for (const v of Object.values(sim.settlements)) { const r = w.prefOf(v.cell) ?? "JP-13", e = v.pop * 0.15; econ[r] = (econ[r] ?? 0) + e; tot += e; }
  const n = w.t.prefOrder.length, share: Record<string, number> = {};
  const need: Record<string, number> = {}; let needTot = 0;
  if (an) { const d = accessDeficit(w, an); w.cities.forEach((c, i) => { const r = c.pref ?? "JP-13", v = sim.cities[c.id].pop * d[i]; need[r] = (need[r] ?? 0) + v; needTot += v; }); }
  const ns = needTot > 0 ? NEED_SHARE : 0;
  for (const r of w.t.prefOrder) share[r] = EQUAL_SHARE / n + (1 - EQUAL_SHARE - ns) * ((econ[r] ?? 0) / (tot || 1)) + ns * ((need[r] ?? 0) / (needTot || 1));
  sim.regionShare = share;
}
function* evaluateEdgesGen(sim: SimState, w: World, an: Analysis, y: number): Generator<void> {
  let n = 0;
  for (const e of Object.values(sim.edges)) {
    if (++n % EDGE_SLICE === 0) yield;   // Stage 7: a slice of edges at a time (closure checks search the network and are not cheap)
    if (e.built < 1) continue; const d = e.through + e.local + (sim.stage3 ? e.freight * 0.4 : 0), unit = modeOf(e) === "rail" ? "人/日" : "台/日", Z = zeroDemand(e);
    if (e.state === "open" || e.state === "dormant") {
      if (e.through > e.peakThrough) e.peakThrough = e.through;
      e.zeroYears = d < Z ? e.zeroYears + 1 : 0;
      e.congYears = e.through > 0.9 * capacityOf(e) ? e.congYears + 1 : 0;
      e.throughDropYears = e.peakThrough > 50 && e.bypassedBy.length && e.through < 0.25 * e.peakThrough ? e.throughDropYears + 1 : e.bypassedBy.length ? e.throughDropYears : 0;
      if (e.state === "dormant" && d >= Z * 2) { setEdgeState(sim, e, "open", `需要が回復(${Math.round(d)}${unit})`); ev(sim, "reopen", `${edgeName(sim, e)}が休止から再開`, `需要が${Math.round(d)}${unit}に回復`, { edge: e.id }); }
      else if (e.state === "open" && e.zeroYears >= DORMANT_YEARS) { setEdgeState(sim, e, "dormant", `需要が${e.zeroYears}年連続でほぼゼロ(閾値${Z}${unit}未満)`); ev(sim, "dormant", `${edgeName(sim, e)}を休止`, `需要が${e.zeroYears}年連続で${Z}${unit}未満`, { edge: e.id }); }
      else if (e.state === "dormant" && e.zeroYears >= CLOSE_YEARS) {
        const s = strandedWithout(sim, w, e);
        if (s.villages === 0 && s.cities === 0 && an.potential.get(e.id)! < REVIVE_DEMAND) { setEdgeState(sim, e, "closed", `需要ゼロが${e.zeroYears}年継続・代替路あり`); ev(sim, "close", `${edgeName(sim, e)}を閉鎖`, `需要ゼロが${e.zeroYears}年継続し、代替路があり孤立する集落もない`, { edge: e.id }); }
        else if (e.zeroYears === CLOSE_YEARS) { pushHist(sim, e, "閉鎖を見送り: 代替路がない、または沿線に集落がある"); }
      }
    } else if (e.state === "closed" || e.state === "lost") {
      const pot = an.potential.get(e.id) ?? 0; e.reviveYears = pot >= REVIVE_DEMAND ? e.reviveYears + 1 : 0;
    }
    void y;
  }
}
function evaluateRoutes(sim: SimState, w: World, y: number) {
  for (const r of Object.values(sim.routes)) {
    if (!r.active) continue;
    if (modeOf(r) === "rail") { evaluateRailRoute(sim, r); continue; }
    const es = r.edges.map((x) => sim.edges[x.edgeId]).filter(Boolean), km = es.reduce((s, e) => s + e.lengthKm, 0) || 1, mean = es.reduce((s, e) => s + (e.through + e.local) * e.lengthKm, 0) / km;
    // 旧道 branches: judged on how much of the *local* role is left, never on the fall in through traffic alone
    for (const id of [...r.oldEdges]) {
      const e = sim.edges[id]; if (!e) { r.oldEdges.splice(r.oldEdges.indexOf(id), 1); continue; }
      if (e.throughDropYears < DROP_YEARS) continue; const before = routeOfficial(r);
      if (e.local >= LOCAL_KEEP && r.grade === "national") {
        const pf = e.region, g: Grade = FU_PREFS.has(pf) ? "fu" : "ken", nr = designate(sim, [{ edgeId: id, dir: 1 }], g, pf, `${before}の旧道`, "所管変更", true);
        r.oldEdges.splice(r.oldEdges.indexOf(id), 1); pushHist(sim, e, `${before}の旧道から${GRADE_LABEL[g]}に所管変更(通過需要が${DROP_YEARS}年以上激減、沿線需要${Math.round(e.local)}台/日は残る)`);
        ev(sim, "demote", `${before}の旧道(${edgeName(sim, e)})を${nr ? routeOfficial(nr) : GRADE_LABEL[g]}に所管変更`, `通過需要が新道へ移り${DROP_YEARS}年以上低迷、ただし沿線の生活需要${Math.round(e.local)}台/日が残るため廃止せず管理継続`, { edge: id, route: r.id });
      } else if (e.local >= LOCAL_KEEP) { e.throughDropYears = 0; pushHist(sim, e, "通過は減ったが沿線需要が大きいため指定を維持"); }
      else { r.oldEdges.splice(r.oldEdges.indexOf(id), 1); pushHist(sim, e, `${before}の旧道の指定を解除(市町村道へ。通過・沿線とも需要が小さい)`); ev(sim, "demote", `${before}の旧道(${edgeName(sim, e)})の指定を解除`, `通過需要が${DROP_YEARS}年以上激減し、沿線需要(${Math.round(e.local)}台/日)も小さい`, { edge: id, route: r.id }); }
    }
    const floor = r.grade === "national" ? 150 : 15, prefs = routePrefs(w, es);
    r.lowYears = mean < floor ? r.lowYears + 1 : 0; r.highYears = r.grade !== "national" && mean > 3500 ? r.highYears + 1 : 0;
    if (r.lowYears >= 15) {
      const old = routeOfficial(r);
      if (r.grade === "national" && prefs.size === 1) { const p = [...prefs][0], g: Grade = FU_PREFS.has(p) ? "fu" : "ken"; r.grade = g; r.scope = p; r.number = issueNumber(sim, g, p); r.name = `${GRADE_LABEL[g]}${r.number}号`; r.lowYears = 0; r.history.push({ month: sim.month, grade: g, number: r.number, text: "降格", scope: r.scope }); ev(sim, "demote", `${old}が${routeOfficial(r)}に降格`, `路線の平均需要が${Math.round(mean)}台/日で15年連続${floor}台/日未満`, { route: r.id }); }
      else { r.active = false; r.endMonth = sim.month; r.history.push({ month: sim.month, grade: r.grade, number: r.number, text: "指定解除" }); ev(sim, "demote", `${old}の指定を解除(市町村道へ)`, `平均需要${Math.round(mean)}台/日が15年連続で${floor}台/日未満`, { route: r.id }); }
    } else if (r.grade !== "national" && r.highYears >= 6 && km >= 40 && Object.values(sim.routes).filter((q) => q.active && q.grade === "national").length < 120) {
      const old = routeOfficial(r); r.grade = "national"; r.scope = "JP"; r.number = issueNumber(sim, "national", "JP"); r.name = `国道${r.number}号`; r.highYears = 0; r.history.push({ month: sim.month, grade: "national", number: r.number, text: "昇格", scope: "JP" });
      ev(sim, "promote", `${old}が${routeOfficial(r)}に昇格`, `平均需要が${Math.round(mean)}台/日で6年連続${3500}台/日超`, { route: r.id });
    }
    if (!es.some((e) => e.state === "open" || e.state === "dormant") && !r.oldEdges.length) { r.active = false; r.endMonth = sim.month; ev(sim, "route", `${routeOfficial(r)}を廃止`, "全区間が閉鎖または廃道", { route: r.id }); }
  }
  void y;
}

/** A railway line has no promotion or demotion between grades: it either keeps running, runs thin (and earns 酷鉄/死鉄), or is abolished. */
function evaluateRailRoute(sim: SimState, r: SimRoute) {
  const es = r.edges.map((x) => sim.edges[x.edgeId]).filter(Boolean), km = es.reduce((s, e) => s + e.lengthKm, 0) || 1;
  const mean = es.reduce((s, e) => s + (e.through + e.local + e.freight * 0.4) * e.lengthKm, 0) / km;
  r.lowYears = mean < 400 ? r.lowYears + 1 : 0;
  if (!es.some((e) => e.state === "open" || e.state === "dormant")) {
    r.active = false; r.endMonth = sim.month; r.history.push({ month: sim.month, grade: r.grade, number: r.number, text: "路線廃止" });
    ev(sim, "abolish", `${routeOfficial(r)}を廃止`, "全区間が休止を経て閉鎖または廃線になった", { route: r.id });
  }
}

// ---- monthly ----
function* monthlyGen(sim: SimState, w: World): Generator<void> {
  const y = yearOf(sim);
  if (sim.month % 12 === 0) sim.macro.mood = Math.max(-1, Math.min(1, sim.macro.mood * 0.6 + (rand(sim) - 0.5) * 0.8));
  let econ = 0; for (const c of Object.values(sim.cities)) econ += c.pop * c.industry; for (const v of Object.values(sim.settlements)) econ += v.pop * 0.15;
  const Bfull = BUDGET_K * econ * macroBudget(y) * (1 + 0.15 * sim.macro.mood + 0.02);
  // Stage 3: one transport budget, split between roads and railways by the era's dials; roads keep the Stage 2 amount at roadShare = 1 / 1+RAIL_BUDGET_SCALE
  const total = sim.stage3 ? Bfull * (1 + RAIL_BUDGET_SCALE) * sim.dials.growth : Bfull, B = sim.stage3 ? total * sim.dials.roadShare * sim.dials.austerity : Bfull;
  sim.macro.budgetBu = Math.round(total * 1e4) / 1e4;
  const regional = B * (1 - NATIONAL_POOL); let pool = B * NATIONAL_POOL, need = 0, funded = 0;
  // maintenance region by region, busiest roads first; each region has its own purse
  const byRegion = new Map<string, SimEdge[]>();
  for (const e of Object.values(sim.edges)) if ((e.state === "open" || e.state === "dormant") && e.built >= 1 && modeOf(e) === "road" && e.facility !== "ferry") (byRegion.get(e.region) ?? byRegion.set(e.region, []).get(e.region)!).push(e);
  const left: Record<string, number> = {};
  for (const r of w.t.prefOrder) left[r] = regional * (sim.regionShare[r] ?? 1 / w.t.prefOrder.length);
  for (const [r, es] of [...byRegion.entries()].sort()) {
    es.sort((a, b) => b.traffic - a.traffic || (a.id < b.id ? -1 : 1)); let purse = left[r] ?? 0;
    for (const e of es) {
      const cost = e.lengthKm * MAINT[e.surface] * STD_MAINT[e.standard] * (e.quality < 50 ? 1.5 : 1) * (e.state === "dormant" ? 0.15 : 1); need += cost;
      const ok = purse >= cost; if (ok) { purse -= cost; funded += cost; }
      const decay = DECAY[e.surface] * (1 + e.maxGradePct / 15) * (e.standard === "highgrade" ? 0.6 : 1);
      if (ok) { e.quality = Math.min(100, e.quality + 0.3 - 0.3 * decay); e.weathering = Math.max(0, e.weathering - 0.08); }
      else { e.quality = Math.max(0, e.quality - decay * 2); e.weathering = Math.min(100, e.weathering + 0.04 + (e.quality < 40 ? 0.08 : 0) + (e.zeroYears > 0 ? 0.05 : 0)); }
      if (e.weathering >= 100) { setEdgeState(sim, e, "lost", `維持費が賄えず風化が進行(品質${Math.round(e.quality)})`); ev(sim, "lost", `${edgeName(sim, e)}が廃道化`, `維持費が賄えず風化(品質${Math.round(e.quality)})${e.zeroYears ? `・需要ゼロ${e.zeroYears}年` : ""}`, { edge: e.id }); }
    }
    left[r] = purse;
  }
  sim.macro.maintCoverage = need > 0 ? funded / need : 1;
  yield;   // Stage 7: upkeep, construction and the railways are separate slices of the month
  for (const e of Object.values(sim.edges)) if (e.state === "closed" && e.built >= 1) { e.weathering = Math.min(100, e.weathering + 0.3); if (e.weathering >= 100) { setEdgeState(sim, e, "lost", "閉鎖後に放置され風化"); ev(sim, "lost", `${edgeName(sim, e)}が廃道化`, "閉鎖後に維持されず風化(復旧には再整備が必要)", { edge: e.id }); } }
  // construction: each region funds its own queue; leftovers and the national pool fund the rest
  const projs = Object.values(sim.projects).filter((p) => (p.status === "planned" || p.status === "building") && modeOf(p) === "road").sort((a, b) => b.priority - a.priority || (a.id < b.id ? -1 : 1));
  // Stage 7: what the national pool does not need for national projects goes to regional projects their own region could not fully fund this month
  // (国庫補助). Measured before this: 96% of the pool and 63% of the regional purses went unspent while regional projects stalled for lack of money.
  const reqOf = (p: SimProject) => { const totLen = p.edgeIds.reduce((s, id) => s + (sim.edges[id]?.lengthKm ?? 0), 0) || 1, tm = sim.tech && p.edgeIds.some((id) => sim.edges[id]?.facility) ? techAt(sim.tech.k, yearOf(sim)).timeMult : 1; return { totLen, req: Math.max(0.0001, p.costBu / Math.max(24 * tm, totLen * 0.8 * tm)) }; };
  const short: { p: SimProject; f: number; req: number; totLen: number }[] = [];
  for (const p of projs) if (p.region !== "JP") { const r = p.region, { req, totLen } = reqOf(p), f = Math.min(req, Math.max(0, left[r] ?? 0)); left[r] = (left[r] ?? 0) - f; if (sim.stage3 && f < req) short.push({ p, f, req, totLen }); else if (f > 0 || p.status === "building") progressProject(sim, w, p, f, req, totLen); }
  for (const p of projs) if (p.region === "JP") { const { req, totLen } = reqOf(p), f = Math.min(req, Math.max(0, pool)); pool -= f; if (f > 0 || p.status === "building") progressProject(sim, w, p, f, req, totLen); }
  for (const s of short) { const g = s.p.priority >= TOPUP_MIN_PRIORITY ? Math.min((s.req - s.f) * TOPUP_SHARE, Math.max(0, pool)) : 0; pool -= g; const f = s.f + g; if (f > 0 || s.p.status === "building") progressProject(sim, w, s.p, f, s.req, s.totLen); }
  if (sim.stage3) { const sl = (sim.regionSlack ??= {}); for (const r of w.t.prefOrder) { const full = regional * (sim.regionShare[r] ?? 1 / w.t.prefOrder.length); if (full > 0) sl[r] = Math.round(((sl[r] ?? 0.5) * 0.97 + 0.03 * Math.max(0, Math.min(1, (left[r] ?? 0) / full))) * 1000) / 1000; } }
  for (const r of Object.keys(left)) pool += Math.max(0, left[r] ?? 0) * 0;      // regional leftovers are not pooled: each region's purse is its own
  if (sim.stage3) { yield; railMonthly(sim, w, total * (1 - sim.dials.roadShare)); yield; resolveConcepts(sim); }
  for (const p of Object.values(sim.projects)) {
    if (p.status === "suspended" && sim.month - p.statusSince >= 96) { p.status = "unbuilt"; p.statusSince = sim.month; ev(sim, "project", `未成線化: ${projLabel(sim, p)}`, "中断から8年経過しても再開されない", { project: p.id }); }
    if (p.status === "suspended" || p.status === "unbuilt") for (const id of p.edgeIds) { const e = sim.edges[id]; if (e && e.built < 1) e.weathering = Math.min(100, e.weathering + 0.03); }
  }
}
/** 構想 -> 計画, or the idea fades away: a new line spends a year or two as a concept before it is planned; many never get further. */
function resolveConcepts(sim: SimState) {
  for (const p of Object.values(sim.projects)) {
    if (p.status !== "concept" || sim.month - p.statusSince < 18) continue;
    const appetite = modeOf(p) === "rail" ? sim.dials.railBuild : sim.dials.hwyBuild;
    if (appetite >= 0.25 && rand(sim) < 0.7) { p.status = "planned"; p.statusSince = sim.month; ev(sim, "project", `計画決定: ${projLabel(sim, p)}`, `構想から${Math.round((sim.month - p.startMonth) / 12 * 10) / 10}年。${p.reason}`, { project: p.id }); }
    else {
      p.status = "abolished"; p.statusSince = sim.month;
      for (const id of p.edgeIds) { const e = sim.edges[id]; if (e && e.built < 1 && !Object.values(sim.routes).some((r) => r.edges.some((x) => x.edgeId === id)) && !Object.values(sim.projects).some((q) => q !== p && (q.edgeIds.includes(id) || q.chain.some((c) => c.edgeId === id) || q.replaces.includes(id)))) delete sim.edges[id]; }
      p.edgeIds = p.edgeIds.filter((id) => sim.edges[id]); p.chain = [];
      ev(sim, "project", `構想のまま立ち消え: ${projLabel(sim, p)}`, appetite < 0.25 ? "建設への意欲が下がり、計画に進まなかった" : "財政・世論の判断で計画に進まなかった", { project: p.id });
    }
  }
}
/** Railways: each operator pays for its own upkeep out of fares plus a share of the subsidy pool; building is funded from a national construction pool. */
function railMonthly(sim: SimState, w: World, railB: number) {
  const dl = sim.dials, M = railB * 0.6 * dl.austerity, byOp = new Map<string, SimEdge[]>();
  for (const e of Object.values(sim.edges)) if (modeOf(e) === "rail" && e.facility !== "ferry" && (e.state === "open" || e.state === "dormant") && e.built >= 1) (byOp.get(e.op ?? "jnr") ?? byOp.set(e.op ?? "jnr", []).get(e.op ?? "jnr")!).push(e);
  const ops = [...byOp.keys()].sort(), rev = new Map<string, number>();
  for (const op of ops) rev.set(op, byOp.get(op)!.reduce((t, e) => t + e.traffic * e.lengthKm * RAIL_FARE * (e.state === "open" ? 1 : 0.3), 0) * (op === "jnr" ? dl.jnrFare : 1));
  const others = ops.filter((o) => o !== "jnr"), othersRev = others.reduce((t, o) => t + rev.get(o)!, 0) || 1;
  for (const op of ops) {
    let pool = rev.get(op)! + (op === "jnr" ? M * dl.jnrSubsidy : M * (1 - dl.jnrSubsidy) * (rev.get(op)! / othersRev));
    const es = byOp.get(op)!.sort((a, b) => b.traffic - a.traffic || (a.id < b.id ? -1 : 1));
    for (const e of es) {
      const cost = e.lengthKm * RAIL_MAINT[e.standard] * (e.quality < 50 ? 1.5 : 1) * (e.state === "dormant" ? 0.15 : 1), ok = pool >= cost;
      if (ok) pool -= cost;
      const decay = RAIL_DECAY * (1 + e.maxGradePct / 12) * (e.standard === "highgrade" ? 0.6 : 1);
      if (ok) { e.quality = Math.min(100, e.quality + 0.3 - 0.3 * decay); e.weathering = Math.max(0, e.weathering - 0.08); }
      else { e.quality = Math.max(0, e.quality - decay * 2); e.weathering = Math.min(100, e.weathering + 0.04 + (e.quality < 40 ? 0.08 : 0) + (e.zeroYears > 0 ? 0.05 : 0)); }
      if (e.weathering >= 100) { setEdgeState(sim, e, "lost", `保守費が賄えず荒廃(品質${Math.round(e.quality)})`); ev(sim, "lost", `${edgeName(sim, e)}の線路が荒廃し廃線跡に`, `保守費が賄えず荒廃${e.zeroYears ? `・需要ゼロ${e.zeroYears}年` : ""}`, { edge: e.id }); }
    }
  }
  let pot = railB * 0.4 * dl.railBuild * 2;
  const projs = Object.values(sim.projects).filter((p) => (p.status === "planned" || p.status === "building") && modeOf(p) === "rail").sort((a, b) => b.priority - a.priority || (a.id < b.id ? -1 : 1));
  for (const p of projs) {
    const totLen = p.edgeIds.reduce((t, id) => t + (sim.edges[id]?.lengthKm ?? 0), 0) || 1, req = Math.max(0.0001, p.costBu / Math.max(36, totLen * 0.6)), f = Math.min(req, Math.max(0, pot)); pot -= f;
    if (f > 0 || p.status === "building") progressProject(sim, w, p, f, req, totLen);
  }
}
function progressProject(sim: SimState, w: World, p: SimProject, f: number, req: number, totLen: number) {
  const y = yearOf(sim);
  if (p.status === "planned" && f > 0) { p.status = "building"; p.statusSince = sim.month; ev(sim, "project", `着工: ${projLabel(sim, p)}(${prefName(p.region)})`, "地域の予算が確保された", { project: p.id }); }
  if (p.status !== "building") return;
  p.spentBu += f; p.stallMonths = f < 0.25 * req ? p.stallMonths + 1 : 0;
  if (p.kind === "upgrade" || p.kind === "improve" || p.kind === "restore" || p.kind === "electrify" || p.kind === "convert") {
    if (p.spentBu >= p.costBu - 1e-9) { p.status = "open"; p.statusSince = sim.month; completeProject(sim, w, p); }
    else if (p.stallMonths >= 36) { p.status = "abolished"; p.statusSince = sim.month; ev(sim, "project", `${KIND_LABEL[p.kind]}計画を取りやめ: ${projLabel(sim, p)}`, "予算不足が36か月続き、見送り(未成線にはならない)", { project: p.id }); }
    return;
  }
  let amt = f;
  const totW = p.edgeIds.reduce((s, id) => s + (sim.edges[id] ? sim.edges[id].lengthKm * facCost(sim.edges[id], sim) : 0), 0) || 1;
  for (const id of p.edgeIds) { const e = sim.edges[id]; if (!e || e.built >= 1) continue; const ec = p.costBu * e.lengthKm * facCost(e, sim) / totW, add = Math.min(amt / ec, 1 - e.built); e.built = Math.min(1, e.built + add); amt -= add * ec; if (e.built >= 1) { e.built = 1; e.state = "open"; e.open = true; e.builtMonth = sim.month; if (e.facility) ev(sim, "facility", `${(e.facilityName ?? "").replace(/^[a-z-]+:/, "")}が開通(${e.facility === "tunnel" ? "トンネル" : "橋"}・${Math.round(e.lengthKm)}km)`, `${projLabel(sim, p)}の一部として`, { edge: e.id, project: p.id }); pushHist(sim, e, `${modeOf(p) === "rail" ? "新線として開業" : p.kind === "bypass" ? "バイパスとして供用開始" : "新設として供用開始"}`); if (modeOf(p) === "rail") { e.quality = 88; e.surface = "paved"; } else { if (y >= 1965 && e.standard === "rural") e.standard = "standard"; if (y >= 1965) { e.surface = "paved"; e.quality = 90; } } } if (amt <= 1e-9) break; }
  if (p.edgeIds.every((id) => (sim.edges[id]?.built ?? 1) >= 1)) { p.status = "open"; p.statusSince = sim.month; completeProject(sim, w, p); }
  else if (p.stallMonths >= 36) { p.status = "suspended"; p.statusSince = sim.month; ev(sim, "project", `工事中断: ${projLabel(sim, p)}`, `予算不足が36か月続いた(地域の予算${Math.round((sim.regionShare[p.region] ?? 0) * 1000) / 10}%)`, { project: p.id }); }
}
/**
 * A line that was abolished and then comes back keeps its old number (the one case where a number is used again: the same line returning).
 * It is revived when at least half of its length runs again.
 */
export function reviveRoutes(sim: SimState, w: World, edgeId: string) {
  for (const r of Object.values(sim.routes)) {
    if (r.active || !r.edges.some((x) => x.edgeId === edgeId)) continue;
    const es = r.edges.map((x) => sim.edges[x.edgeId]).filter(Boolean), tot = es.reduce((t, x) => t + x.lengthKm, 0) || 1, runs = es.filter((x) => x.state === "open" && x.built >= 1).reduce((t, x) => t + x.lengthKm, 0);
    if (runs / tot < 0.5) continue;
    r.active = true; delete r.endMonth; r.lowYears = 0;
    // the national railway is gone: a revived line goes to the successor of its area
    if (r.grade === "jnr" && sim.operators.jnr?.until !== undefined && es.length) reassignRoute(sim, r, sim.operators[successorOperator(sim, w, es[0], monthToYM(sim.startYear, sim.month).year)]);
    r.history.push({ month: sim.month, grade: r.grade, number: r.number, scope: r.scope, ...(r.opName ? { opName: r.opName } : {}), text: "復活(同じ路線なので旧番号を引き継ぐ)" });
    ev(sim, "reopen", `${routeOfficial(r)}が復活`, "区間の復旧で路線が再び成り立った。番号は同じ路線の復活なので再利用", { route: r.id });
  }
}
function completeRailProject(sim: SimState, w: World, p: SimProject, es: SimEdge[]) {
  const label = projLabel(sim, p);
  if (p.kind === "electrify") { const e = es[0]; if (e) { const was = e.standard; e.standard = e.standard === "rural" ? "standard" : "highgrade"; e.quality = 95; e.weathering = 0; pushHist(sim, e, `改良(${was === "rural" ? "電化・複線化" : "高速化"})`); } ev(sim, "project", `${p.reason.includes("高速") ? "高速化" : "電化・複線化"}が完了: ${label}`, p.reason, { project: p.id }); return; }
  if (p.kind === "restore") { const e = es[0]; if (e) { e.state = "closed"; setEdgeState(sim, e, "open", `沿線需要の回復で復旧(${p.reason})`); e.quality = 55; e.weathering = 0; e.lost = false; e.zeroYears = 0; reviveRoutes(sim, w, e.id); } ev(sim, "reopen", `復活開業: ${label}`, p.reason, { project: p.id }); return; }
  let op = p.op ?? "jnr";
  if (op === "jnr" && sim.operators.jnr?.until !== undefined && es.length) { op = successorOperator(sim, w, es[0], yearOf(sim)); for (const e of es) e.op = op; }   // the national railway no longer exists: the line opens under the successor of its area
  // Stage 9: a new high-speed line opened when the technology allows it is a maglev (リニア): faster, and drawn differently from a 新幹線
  const y9 = yearOf(sim), km9 = es.reduce((t, e) => t + e.lengthKm, 0), maglev = es.length > 0 && es.every((e) => e.standard === "highgrade") && y9 >= MAGLEV_YEAR && (!sim.tech || techYear(sim.tech.k, y9) >= MAGLEV_TECH_YEAR) && km9 >= MAGLEV_MIN_KM && sim.dials.hsr > 0.45;
  if (maglev) for (const e of es) { e.maglev = true; pushHist(sim, e, "超電導リニアとして開業"); }
  const grade: Grade = op === "jnr" ? "jnr" : "priv", r = designate(sim, p.chain, grade, op === "jnr" ? "JP" : op, label, "新線の開業");
  p.routeId = r?.id ?? null; ev(sim, "open", `開業: ${r ? routeOfficial(r) : label}${maglev ? "(リニア)" : ""}(${label}、${Math.round(es.reduce((t, e) => t + e.lengthKm, 0))}km)`, `工事費${p.costBu.toFixed(1)}を投入。${p.reason}`, { project: p.id });
}
function completeProject(sim: SimState, w: World, p: SimProject) {
  const es = p.edgeIds.map((id) => sim.edges[id]).filter(Boolean);
  if (p.reason.startsWith(LAKE_BRIDGE_TAG)) { const moved = es[0] ? carryOver(sim, w, es[0]) : 0; ev(sim, "open", `湖上大橋が開通: ${(es[0]?.facilityName ?? projLabel(sim, p)).replace(/^bridge:/, "")}`, `${p.reason}${moved ? `。湖上フェリーの${moved}路線を橋へ付け替えた` : ""}`, { project: p.id }); return; }
  if (isCrossingProject(p)) { const moved = finishCrossing(sim, w, p); ev(sim, "open", `海峡連絡が開通: ${projLabel(sim, p)}(${es[0]?.facility === "tunnel" ? "海底トンネル" : "橋"})`, `${p.reason}${moved ? "。航路の路線は新しい連絡へ付け替えた" : ""}`, { project: p.id }); if (moved) return; }
  if (p.kind === "convert") {
    const re = es[0]; if (!re || re.convertedTo) return;
    // laid like any new road: where the right-of-way meets an existing road the two share cells and nodes, never overlap
    const lay = layPath(sim, w, re.cells, { open: true, surface: "gravel", quality: 60, built: 1, month: sim.month, standard: "rural" });
    if (!lay.chain.length) return;
    re.convertedTo = lay.chain[0].edgeId; pushHist(sim, re, "廃線跡を道路に転用");
    for (const id of lay.created) { pushHist(sim, sim.edges[id], "廃線跡を道路に転用して供用開始"); }
    ev(sim, "convert", `廃線跡を道路に転用: ${projLabel(sim, p)}`, p.reason, { project: p.id, edge: re.id }); return;
  }
  if (modeOf(p) === "rail") return completeRailProject(sim, w, p, es);
  if (p.kind === "upgrade") { for (const e of es) if (e.state === "open") { e.surface = "paved"; e.quality = Math.max(e.quality, 95); pushHist(sim, e, "舗装化"); } ev(sim, "project", `舗装化が完了: ${projLabel(sim, p)}`, p.reason, { project: p.id }); return; }
  if (p.kind === "improve") { const e = es[0]; if (e) { e.standard = e.standard === "rural" ? "standard" : "highgrade"; e.surface = "paved"; e.quality = 95; e.weathering = 0; pushHist(sim, e, `改良(規格を${e.standard === "standard" ? "一般2車線" : "高規格"}に)`); } ev(sim, "project", `改良が完了: ${projLabel(sim, p)}`, p.reason, { project: p.id }); return; }
  if (p.kind === "restore") { const e = es[0]; if (e) { e.state = "closed"; setEdgeState(sim, e, "open", `沿線需要の回復で復旧(${p.reason})`); e.quality = 55; e.weathering = 0; e.lost = false; e.zeroYears = 0; reviveRoutes(sim, w, e.id); } ev(sim, "reopen", `復旧・再開通: ${projLabel(sim, p)}`, p.reason, { project: p.id }); return; }
  if (p.kind === "bypass") {
    // The old road may have been split by other projects after this one was planned: every piece of it is replaced, not just the first.
    const olds = p.replaces.map((id) => sim.edges[id]).filter(Boolean), oldIds = new Set(olds.map((e) => e.id)), id = newId(sim, "route").replace("r.", "l.");
    if (olds.length) {
      const old = olds[0], oldName = `${sim.nodes[olds[0].a]?.name ?? "地点"}〜${sim.nodes[olds[olds.length - 1].b]?.name ?? "地点"}`;
      for (const e of es) { e.bypassOf = olds.map((o) => o.id); pushHist(sim, e, `${oldName}のバイパスとして開通`); }
      for (const o of olds) { o.bypassedBy = es.map((e) => e.id); o.peakThrough = Math.max(o.peakThrough, o.through); o.throughDropYears = 0; pushHist(sim, o, "バイパス開通。通過交通の移行を待って管理方針を決める(旧道)"); }
      let rid: string | null = null;
      for (const r of Object.values(sim.routes)) if (r.active) {
        const hits = r.edges.map((x, i) => (oldIds.has(x.edgeId) ? i : -1)).filter((i) => i >= 0); if (!hits.length) continue;
        const at = hits[0]; let end = at; while (hits.includes(end + 1)) end++;
        // only a route that runs the whole old road can be re-pointed at the new one; a route that merely shares a piece of it keeps the old road
        const fe = sim.edges[r.edges[at].edgeId], le = sim.edges[r.edges[end].edgeId], sNode = r.edges[at].dir === 1 ? fe.a : fe.b, eNode = r.edges[end].dir === 1 ? le.b : le.a;
        if (!((sNode === p.from && eNode === p.to) || (sNode === p.to && eNode === p.from))) continue;
        const fwd = sNode === p.from, chain = fwd ? p.chain.map((c) => ({ ...c })) : [...p.chain].reverse().map((c) => ({ edgeId: c.edgeId, dir: (-c.dir) as 1 | -1 }));
        r.edges.splice(at, end - at + 1, ...chain); for (const o of olds) if (!r.oldEdges.includes(o.id)) r.oldEdges.push(o.id); rid = rid ?? r.id; r.history.push({ month: sim.month, grade: r.grade, number: r.number, text: "バイパス開通(旧道を管理)" });
      }
      sim.links.push({ id, kind: "bypass", newEdges: es.map((e) => e.id), oldEdges: olds.map((o) => o.id), month: sim.month, routeId: rid });
      void old;
    }
    ev(sim, "bypass", `バイパス開通: ${projLabel(sim, p)}`, `${p.reason}。経路配分を再計算し通過交通は新道へ、旧道は沿線需要で存廃を判断`, { project: p.id }); return;
  }
  const prefs = routePrefs(w, es), km = es.reduce((s, e) => s + e.lengthKm, 0);
  if (p.kind === "access") { ev(sim, "open", `集落アクセス道が開通: ${projLabel(sim, p)}`, p.reason, { project: p.id }); return; }
  let r: SimRoute | null;
  if (prefs.size > 1 || km >= 120) r = designate(sim, p.chain, "national", "JP", projLabel(sim, p), prefs.size > 1 ? "複数府県にまたがる" : "延長120km以上");
  else { const pf = [...prefs][0] ?? "JP-13"; r = designate(sim, p.chain, FU_PREFS.has(pf) ? "fu" : "ken", pf, projLabel(sim, p), "単一府県内の路線"); }
  p.routeId = r?.id ?? null; ev(sim, "open", `供用開始: ${projLabel(sim, p)}`, `工事費${p.costBu.toFixed(1)}を投入`, { project: p.id });
}

/** One simulated month as a series of short atoms (yield between them). */
export function* stepMonthGen(sim: SimState, w: World): Generator<void> {
  if (sim.policy?.pending || sim.kaigen?.pending) return;   // waiting for the player at a policy window or an era change: time does not move
  if (sim.month % 12 === 0) {
    if (kaigenDue(sim.kaigen, yearOf(sim))) { startKaigen(sim, yearOf(sim)); if (sim.kaigen!.pending) return; }
    if (windowDue(sim, yearOf(sim))) { openWindow(sim, w, yearOf(sim)); if (sim.policy!.pending) return; }
    yield* yearlyGen(sim, w);
  }
  yield* monthlyGen(sim, w); yield; sim.month++;
}
/** An era change is due: open it; if nobody is there to choose (or the setting says so) the first candidate (the real one for 1989/2019, else fewest strokes) is taken. */
export function startKaigen(sim: SimState, year: number) {
  const k = sim.kaigen!; openKaigen(k, year); const pol = sim.policy, auto = !!pol && (pol.mode === "auto" || (pol.mode === "idleAuto" && pol.away));
  if (auto) { settleKaigen(sim, 0, true); return; }
  ev(sim, "kaigen", `${year}年: 改元の時を迎えた(候補${k.pending!.cands.length}案)`, "元号を選んでください。時間は止まっています", {});
}
export function settleKaigen(sim: SimState, idx: number, auto = false) {
  const k = sim.kaigen; if (!k?.pending) return null; const year = k.pending.year, prev = k.eras[k.eras.length - 1], names = k.pending.cands.map((c) => c.name).join("・");
  const e = chooseEra(k, idx, sim.seed, auto); if (!e) return null; setActiveTimeline(k.eras);
  ev(sim, "kaigen", `改元: ${e.name}元年(${year}年)${auto ? "【自動】" : ""}`, `${prev.name}が終わり${e.name}へ。候補: ${names}。方針: ${STANCE_NAME[e.stance]}${e.real ? "" : "(暫定規則で生成した名)"}。以後の道路・鉄道の方針に${prev.name}の分も一部残って効く`, {});
  sim.dials = composeDials(sim, year); return e;
}
const STANCE_NAME: Record<string, string> = { heisei: "均衡", shubun: "道路重視", shoka: "鉄道重視", kobun: "旧版" };
export function stepMonth(sim: SimState, w: World) { const g = stepMonthGen(sim, w); while (!g.next().done); }
/** Fast-forward with no player (tests, tools): a policy window that opens is resolved by the world's own scores. */
export function advance(sim: SimState, w: World, months: number) { for (let i = 0; i < months; i++) { stepMonth(sim, w); if (sim.kaigen?.pending) { settleKaigen(sim, 0, true); stepMonth(sim, w); } if (sim.policy?.pending) { autoResolve(sim, w); stepMonth(sim, w); } } }
/** How many months to simulate after being away: capped, with the rest reported rather than silently dropped. */
export function planCatchUp(elapsedWallMs: number, speed: number): { months: number; skipped: number } {
  if (!(elapsedWallMs > 0) || speed <= 0) return { months: 0, skipped: 0 };
  const raw = Math.floor((elapsedWallMs * speed) / MS_PER_MONTH_X1); return { months: Math.min(raw, CATCHUP_CAP_MONTHS), skipped: Math.max(0, raw - CATCHUP_CAP_MONTHS) };
}
export function noteSkipped(sim: SimState, skipped: number) {
  if (skipped > 0) { sim.skippedMonths += skipped; ev(sim, "skip", `放置により${Math.floor(skipped / 12)}年${skipped % 12}か月分の経過を省略`, `復帰時の集約計算は上限${CATCHUP_CAP_MONTHS / 12}年`, {}); }
}
export function summary(sim: SimState) {
  const edges = Object.values(sim.edges), routes = Object.values(sim.routes).filter((r) => r.active), live = edges.filter((e) => e.state === "open" && e.built >= 1);
  const q = (lo: number, hi: number) => live.filter((e) => e.quality >= lo && e.quality < hi).length;
  return {
    ym: ymLabel(sim.startYear, sim.month), routes: routes.length, roadKm: Math.round(live.filter((x) => modeOf(x) === "road").reduce((s, x) => s + x.lengthKm, 0)), railKm: Math.round(live.filter((x) => modeOf(x) === "rail").reduce((s, x) => s + x.lengthKm, 0)), km: Math.round(live.reduce((s, e) => s + e.lengthKm, 0)),
    building: Object.values(sim.projects).filter((p) => p.status === "building" || p.status === "planned").length,
    unbuilt: Object.values(sim.projects).filter((p) => p.status === "unbuilt" || p.status === "suspended").length,
    good: q(60, 101), fair: q(30, 60), poor: q(0, 30), lost: edges.filter((e) => e.state === "lost").length, closed: edges.filter((e) => e.state === "closed" && e.built >= 1).length, dormant: edges.filter((e) => e.state === "dormant").length,
  };
}
export { checkIntegrity, cellDistKm, passable, edgePoints, buildIndex, dist };
