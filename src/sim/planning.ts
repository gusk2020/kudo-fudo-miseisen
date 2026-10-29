/**
 * Yearly planning. Every prefecture keeps its own queue and purse, so many regions build at the same time.
 * Cost control ("performance budget"): at most MAX_PATHFINDS route searches per year, regions take turns.
 */
import { REBUILD_DRIVE_MAX, rebuildDrive } from "./cycle27";
import { basePop, capitalPref } from "./roles";
import { RAIL_NEW_FACTOR, RAIL_UPGRADE_FACTOR, stance18 } from "./policy18";
import { FAVOURED_LEAN, POLICY_HWY_SCORE, POLICY_HWY_SHARE, POLICY_RAIL_SCORE, POLICY_RAIL_SHARE, POLICY_TRUNK_KM, POLICY_TRUNK_MIN, POLICY_TRUNK_SCORE, reconCorridor, reconFade, reconMeanCore, reconOf, reconRegionLean, reconText } from "./recon";
import { dist } from "../core/geom";
import { refBias, referenceGrids } from "./reference";
import { buildIndex, facilitySplit, layPath, newId, nodeAtCell, stepKey } from "./network";
import { HARD_ROCK_M, crossingEase, facilityCostMult, isWaterTunnel, techAt, waterTechAt } from "./tech";
import { accessDeficit, ev, projLabel, rand, yearOf } from "./engine";
import { CAPACITY, RAIL_CAPACITY as RAIL_CAP, edgeSpeed, type Analysis } from "./demand";
const edgeKmh = (e: SimEdge) => edgeSpeed(e);
import { KIND_LABEL, modeOf, type Operator, type ProjectKind, type SimEdge, type SimProject, type SimState, type Standard } from "./types";
import { mountainCost, pathfind, type World } from "./world";
import { burdenCost, terrainGate } from "./land";

/** A long tunnel or bridge costs several times as much per km as the open line. */
export const facCost = (e: SimEdge, sim?: Pick<SimState, "tech" | "startYear" | "month">) => (e.facility === "tunnel" ? 3 : e.facility === "bridge" ? 2.2 : 1) * (e.facility && sim?.tech ? (sim.tech.wk !== undefined && isWaterTunnel(e) ? waterTechAt(sim.tech.wk, sim.startYear + Math.floor(sim.month / 12)).costMult : facilityCostMult(sim.tech, sim.startYear + Math.floor(sim.month / 12))) : 1) * (1 + Math.min(0.5, (e.curv ?? 0) * 0.3));
export const MAX_TUNNEL_PROJECTS = 3;
/** Stage 7: a new road is laid beside an existing connection only when it cuts the way to at most this share of the cells (a real shortcut). */
export const DETOUR_CUT = 0.75;
/** Stage 7 地方道: villages of at least this many people may get a link of their own when it cuts the way to the neighbour to LINK_CUT of the cells. */
export const LINK_MIN_POP = 1200, LINK_CUT = 0.75;
/** Counters for tests and tools only (not saved): how often the tunnelling limit or the tunnel-project cap held a project back, and how many hard-rock rolls went wrong. */
export const techStats = { tooLong: 0, capped: 0, checked: 0, hard: 0, trouble: 0, unaffordable: 0 };
/**
 * Can the line along `path` be built with the technology of year `y`? A tunnel longer than the longest that can be driven means the project
 * has to wait (null: not feasible yet); too many tunnel projects at once also waits, so cheaper tunnels do not crowd out everything else.
 * `hard` = the tunnel runs through high, hard rock (the success roll applies). Only games with a tech rule are gated; older saves are not.
 */
/** Stage 12: the construction multiplier of a stretch -- the land model (land.ts) in the games that use it, the Stage 9 barrier cost otherwise. */
const mtnCost = (w: World, sim: SimState, mode: "road" | "rail", cells: number[], y: number): number => (w.land12 ? burdenCost(w, sim, mode, cells, y) : mountainCost(w, cells));
/**
 * Stage 12: can the place pay for it? A stretch of range costs several times the same length of plain (land.ts), and until now nothing ever asked whether the
 * money was there -- cost only made a project slow, so every planner kept laying lines through the hardest ground it could reach. A project whose land makes
 * it dearer than ordinary ground must now fit AFFORD times the purse of the region (or of the railway pool) that has to pay for it.
 */
export const AFFORD = 1.0;
export function affordable(sim: SimState, w: World, mode: "road" | "rail", path: number[], newKm: number, unit: number, purse: number, y: number): boolean {
  if (!w.land12) return true; const m = burdenCost(w, sim, mode, path, y); if (m <= 1.05) return true;
  const ok = newKm * unit * m <= AFFORD * purse; if (!ok) techStats.unaffordable++; return ok;
}
/** The railway construction pool of one year (the monthly pot of railMonthly times twelve). */
export const railPurse = (sim: SimState): number => sim.macro.budgetBu * (1 - sim.dials.roadShare) * 0.8 * sim.dials.railBuild * 12;
export function techCheck(sim: SimState, w: World, mode: "road" | "rail", path: number[], y: number): { ok: boolean; hard: boolean } {
  if (w.land12 && !terrainGate(w, sim, mode, path, y).ok) { techStats.tooLong++; return { ok: false, hard: false }; }   // Stage 12: a stretch of range that only a tunnel longer than this year's technology could cross is not built, however much it would earn
  if (!sim.tech) return { ok: true, hard: false };
  const tun = facilitySplit(w, mode, path, true).find((s) => s.fac === "tunnel"); if (!tun) return { ok: true, hard: false };
  const km = (tun.cells.length - 1) * w.cell, now = techAt(sim.tech.k, y); techStats.checked++; if (km > now.tunnelKm) { techStats.tooLong++; return { ok: false, hard: false }; }
  const active = Object.values(sim.projects).filter((p) => (p.status === "planned" || p.status === "building" || p.status === "concept") && p.edgeIds.some((id) => sim.edges[id]?.facility === "tunnel")).length;
  if (active >= MAX_TUNNEL_PROJECTS) { techStats.capped++; return { ok: false, hard: false }; }
  return { ok: true, hard: tun.cells.some((k) => w.elevM(k) >= HARD_ROCK_M) };
}
/** After a project with a hard-rock tunnel is laid: the odds of an easy dig are the year's rock-success; failure means a costlier, harder dig (never a cancelled project). */
export function techRoll(sim: SimState, p: SimProject, hard: boolean, y: number, label: string): void {
  if (!sim.tech || !hard) return; const now = techAt(sim.tech.k, y);
  techStats.hard++; if (rand(sim) < now.rockP) return; techStats.trouble++;
  p.costBu = Math.round(p.costBu * 1.35 * 100) / 100; ev(sim, "project", `難工事が見込まれる: ${label}`, `長大トンネルが硬い岩盤を抜ける(この年の施工の確実さ${Math.round(now.rockP * 100)}%)ため、工事費が3割5分増えた`, { project: p.id });
}   // tunnels and bridges cost more; so do winding alignments (more earthwork)
/**
 * How much a service by the OTHER mode already counts as meeting a corridor's need (0..1). It follows the era's own preference between car and train
 * (carBias vs railBias, the same numbers the passenger split uses), so a car-minded world sees a good road as the answer and builds few parallel railways,
 * and a rail-minded world the reverse. `other` is the mode that already serves the pair. Empirical; never reaches 1, so a corridor can still get both.
 */
export function competeWeight(dl: { carBias: number; railBias: number }, other: "road" | "rail"): number {
  const lean = other === "road" ? dl.carBias - dl.railBias : dl.railBias - dl.carBias;   // >0: the world prefers the mode that is already there
  return Math.max(0.25, Math.min(0.9, 0.55 + 0.2 * lean));
}
export const MAX_PATHFINDS = 12, REGIONS_PER_YEAR = 14, MAX_PATHFINDS_S3 = 16, REGIONS_PER_YEAR_S3 = 18, MAX_ACTIVE_PER_REGION = 2;
export const UNIT: Record<Standard, number> = { rural: 1, standard: 1.8, highgrade: 4 };
interface Cand { score: number; kind: ProjectKind; edge?: SimEdge; vid?: string; a?: number; b?: number; reason: string; toCell?: number; toName?: string; local?: boolean; fromCell?: number; fromName?: string; pol?: true }
/** Projects born as local branch lines/connectors carry this prefix in their reason (no new save field needed). */
export const LOCAL_TAG = "【地方】";

/**
 * Stage 9: why a corridor off the Pacific belt can still be built. Gravity alone always ranks the big belt cities first, so two explainable terms lift the rest:
 *  - ACCESS: a pair whose cities are reached worse than the national median (accessDeficit 0..1) counts for up to BALANCE_K more -- the national plans'
 *    "balanced development" (国土の均衡ある発展), applied by rule to whatever region is poorly reached, never by name;
 *  - PORT: a city with a significant trade port (tier >= 2) needs its hinterland link (PORT_LINK_K per tier above 1).
 * The factor and its causes go into the project's reason, so the timeline says why the line was built.
 */
export const BALANCE_K = 0.8, PORT_LINK_K = 0.12;
export function corridorFactor(sim: SimState, w: World, def: Float64Array | null, i: number, j: number, rc?: { y: number; meanCore: number }): { f: number; why: string; add: number } {
  const rk = rc ? reconCorridor(sim, w, i, j, rc.y, rc.meanCore) : { f: 1, why: "", add: 0 }, d = def ? (def[i] + def[j]) / 2 : 0, tier = Math.max(sim.hubs?.ports[w.cities[i].id]?.tier ?? 0, sim.hubs?.ports[w.cities[j].id]?.tier ?? 0), port = tier >= 2 ? PORT_LINK_K * (tier - 1) : 0;
  const f = (1 + BALANCE_K * d + port) * rk.f, why = [rk.why, d >= 0.15 ? `交通の不便な地域を優先(到達性が全国中央値より${Math.round(d * 100)}%低い)` : "", port ? `港湾(${["", "地方", "重要", "国際拠点", "国際戦略"][tier]}港)の後背地輸送` : ""].filter(Boolean).join("・");
  return { f, add: rk.add, why: why ? `。${why}` : "" };
}
export function activeProjects(sim: SimState) { return Object.values(sim.projects).filter((p) => p.status === "concept" || p.status === "planned" || p.status === "building" || p.status === "suspended"); }
export function createProject(sim: SimState, kind: ProjectKind, region: string, from: string, to: string, edgeIds: string[], chain: SimProject["chain"], cost: number, reason: string, priority: number, replaces: string[] = []): SimProject {
  const id = newId(sim, "project");
  const p: SimProject = { id, kind, region, replaces, from, to, edgeIds, chain, costBu: Math.round(cost * 100) / 100, spentBu: 0, status: "planned", startMonth: sim.month, stallMonths: 0, statusSince: sim.month, routeId: null, reason, priority };
  sim.projects[id] = p; return p;
}
const nodeName = (sim: SimState, id: string) => sim.nodes[id]?.name ?? "地点";

export function* planYearGen(sim: SimState, w: World, an: Analysis, y: number): Generator<void> {
  const regions = w.t.prefOrder, n = regions.length, B = sim.stage3 ? sim.macro.budgetBu * sim.dials.roadShare * (0.4 + 0.8 * sim.dials.hwyBuild) : sim.macro.budgetBu; const drive = sim.stage3 ? rebuildDrive(sim.e2200, y) : 0; let pf = Math.round((sim.stage3 ? MAX_PATHFINDS_S3 : MAX_PATHFINDS) * (1 + REBUILD_DRIVE_MAX.pathfinds * drive)); const RPY = Math.round((sim.stage3 ? REGIONS_PER_YEAR_S3 : REGIONS_PER_YEAR) * (1 + REBUILD_DRIVE_MAX.regions * drive)), extraActive = drive > 0.5 ? 1 : 0;   // (Stage 28: the rebuilding lifts the yearly limits)
  const def = sim.stage3 ? accessDeficit(w, an) : null, rc = reconOf(sim) ? { y, meanCore: reconMeanCore(sim, w) } : undefined;
  const start = ((y - sim.startYear) * RPY) % n, slice = Array.from({ length: Math.min(n, RPY) }, (_, i) => regions[(start + i) % n]);
  const live = activeProjects(sim).filter((p) => modeOf(p) === "road"), busy = new Set(live.flatMap((p) => p.edgeIds)), perRegion = new Map<string, number>();
  for (const p of live) if (p.status !== "suspended") perRegion.set(p.region, (perRegion.get(p.region) ?? 0) + 1);
  const edgesBy = new Map<string, SimEdge[]>(); for (const e of Object.values(sim.edges)) if (modeOf(e) === "road" && e.facility !== "ferry") (edgesBy.get(e.region) ?? edgesBy.set(e.region, []).get(e.region)!).push(e);
  const vilBy = new Map<string, string[]>(); for (const v of Object.values(sim.settlements)) if (!v.gone) { const r = w.prefOf(v.cell) ?? capitalPref(sim); (vilBy.get(r) ?? vilBy.set(r, []).get(r)!).push(v.id); }
  const cityBy = new Map<string, number[]>(); w.cities.forEach((c, i) => { const r = c.pref ?? capitalPref(sim); (cityBy.get(r) ?? cityBy.set(r, []).get(r)!).push(i); });
  const nc = w.cities.length, others: { cell: number; pos: [number, number]; name: string; pop: number; isl: number }[] = [];
  if (sim.stage3) { for (const v of Object.values(sim.settlements)) if (!v.gone && v.pop >= 300) others.push({ cell: v.cell, pos: w.cellPos(v.cell) as [number, number], name: v.name, pop: v.pop, isl: w.t.island[v.cell] }); for (const c of w.cities) others.push({ cell: c.cell, pos: c.pos as [number, number], name: c.name, pop: sim.cities[c.id].pop, isl: w.t.island[c.cell] }); }
  for (const r of slice) {
    const fav = sim.pop15 && rc && reconRegionLean(sim, w, r, rc.meanCore) >= FAVOURED_LEAN ? 1 : 0;   // (Stage 15: a region the policy favours works faster)
    if ((perRegion.get(r) ?? 0) >= MAX_ACTIVE_PER_REGION + extraActive + fav + ((sim.regionSlack?.[r] ?? 0) > 0.5 ? 1 : 0) + ((sim.regionSlack?.[r] ?? 0) > 0.75 ? 1 : 0)) continue;
    const purse = Math.max(8, B * 0.8 * (sim.regionShare[r] ?? 1 / n) * 48), cands: Cand[] = [];
    for (const vid of vilBy.get(r) ?? []) if (an.reach.get(vid) === false) cands.push({ score: 6 + sim.settlements[vid].pop / 2000, kind: "access", vid, reason: `${sim.settlements[vid].name}が道路網から孤立している` });
    for (const e of edgesBy.get(r) ?? []) {
      if (busy.has(e.id) || e.built < 1) continue; const d = e.through + e.local;
      if (e.state === "open" && e.congYears >= 2 && e.standard !== "highgrade") cands.push({ score: 3 + (e.through / CAPACITY[e.standard]) * 3, kind: e.standard === "rural" && e.maxGradePct < 5 && e.lengthKm < 25 ? "improve" : "bypass", edge: e, reason: `通過交通が容量の${Math.round((e.through / CAPACITY[e.standard]) * 100)}%に達し${e.congYears}年混雑` });
      else if (fav && rc && e.state === "open" && e.surface !== "paved" && d >= POLICY_TRUNK_MIN && e.quality < 80) cands.push({ score: POLICY_TRUNK_SCORE * reconFade(y, reconOf(sim)?.since), kind: "upgrade", edge: e, reason: `復興方針(${reconText(reconOf(sim)!)})による幹線の舗装(需要${Math.round(d)}台/日)` });
      else if (fav && rc && e.state === "open" && e.standard === "rural" && e.surface === "paved" && d >= POLICY_TRUNK_MIN && e.lengthKm >= 8) cands.push({ score: POLICY_TRUNK_SCORE * reconFade(y, reconOf(sim)?.since), kind: "improve", edge: e, reason: `復興方針(${reconText(reconOf(sim)!)})による幹線の整備(需要${Math.round(d)}台/日)` });   // Stage 15: a region the policy favours gets its busy trunk roads built up without waiting for the jam
      else if (fav && sim.towns16 && rc && e.state === "open" && e.standard === "standard" && e.surface === "paved" && e.lengthKm >= POLICY_TRUNK_KM && d >= POLICY_HWY_SHARE * CAPACITY.standard) cands.push({ score: POLICY_HWY_SCORE * reconFade(y, reconOf(sim)?.since), kind: "improve", edge: e, reason: `復興方針(${reconText(reconOf(sim)!)})による幹線の高規格化(需要${Math.round(d)}台/日)` });
      else if (sim.stage3 && e.state === "open" && e.standard === "rural" && e.surface === "paved" && e.local >= 250 && e.quality >= 50) cands.push({ score: 1.2 + e.local / 800, kind: "improve", edge: e, reason: `${LOCAL_TAG}沿線の生活需要${Math.round(e.local)}台/日が細道の容量に近づいている` });
      else if (e.state === "open" && e.surface !== "paved" && d >= 150 && e.quality < 80) cands.push({ score: 1 + d / 400, kind: "upgrade", edge: e, reason: `需要${Math.round(d)}台/日で未舗装・砂利のため舗装化` });
      else if ((e.state === "closed" || e.state === "lost") && e.reviveYears >= 3 && e.region === r) cands.push({ score: 2.5 + (an.potential.get(e.id) ?? 0) / 60, kind: "restore", edge: e, reason: `沿線需要${Math.round(an.potential.get(e.id) ?? 0)}台/日が${e.reviveYears}年続いている` });
    }
    // Stage 7: 地方道 -- a sizeable village whose way to its neighbour runs a long way round gets a link of its own (farm, forest and pass roads). Built while
    // the countryside grows and the era builds roads; once the village empties the link falls idle and the ordinary review closes it (廃道).
    if (sim.stage3) {
      const vs = (vilBy.get(r) ?? []).map((id) => sim.settlements[id]).filter((v) => v.pop >= LINK_MIN_POP).sort((p, q) => q.pop - p.pop || (p.id < q.id ? -1 : 1)).slice(0, 3);
      for (const v of vs) {
        const vp = w.cellPos(v.cell); let best: { cell: number; name: string; pop: number; d: number } | null = null;
        for (const u of others) { if (u.cell === v.cell || u.isl !== w.t.island[v.cell]) continue; const d = dist(vp, u.pos); if (d >= 6 && d <= 25 && (!best || d < best.d)) best = { cell: u.cell, name: u.name, pop: u.pop, d }; }
        if (!best) continue;
        const score = 0.8 + Math.log10(1 + Math.sqrt(v.pop * best.pop) / 2000) * (0.5 + sim.dials.hwyBuild) * (0.6 + 0.4 * sim.dials.growth);
        cands.push({ score, kind: "access", vid: v.id, toCell: best.cell, toName: best.name, local: true, reason: `${LOCAL_TAG}${v.name}から${best.name}まで直線${Math.round(best.d)}kmだが道が遠回り` });
      }
    }
    for (const i of cityBy.get(r) ?? []) for (let j = 0; j < nc; j++) {
      const a = w.cities[i], b = w.cities[j]; if (j === i || a.island !== b.island) continue; const d = dist(a.pos, b.pos); if (d < 12 || d > 160) continue;
      const t = an.T[i * nc + j], roadSvc = isFinite(t) ? Math.min(1, d / (t * 40)) : 0, tt = an.TT[i * nc + j], railSvc = sim.stage3 && isFinite(tt) ? Math.min(1, d / (tt * 60)) : 0;
      // competition: where a good railway already serves the pair and the era prefers it, a new road is less needed (and the other way round for railways below)
      const service = Math.max(roadSvc, railSvc * competeWeight(sim.dials, "rail")); if (service > 0.6) continue;
      const unmet = (Math.pow(sim.cities[a.id].pop * sim.cities[b.id].pop, 0.7) / Math.pow(d, 1.2)) * (1 - service) / (d * 1.3 + 10);
      const cf = corridorFactor(sim, w, def, i, j, rc);
      cands.push({ score: Math.log10(1 + unmet) * 1.2 * (d < 30 ? 1.3 : 1) * cf.f + cf.add, kind: "new", a: i, b: j, local: d < 30, reason: `${a.name}〜${b.name}間の需要に対し${isFinite(t) ? `所要時間${t.toFixed(1)}h` : "未接続"}${cf.why}` });
    }
    cands.sort((p, q) => q.score - p.score || (p.kind < q.kind ? -1 : 1));
    // Stage 7: work on the roads that exist (improve, bypass, pave, restore) and new roads (new links, village access) have SEPARATE turns. Before, both
    // competed in one ranking and a congested road (score 3+) always beat a missing link (score ~1-2), so in 150 years barely twenty new roads were laid.
    if (!sim.stage3) {   // the Stage 2 (roads only) world keeps its original single ranking
      let made = 0; for (const c of cands.slice(0, 8)) { if (made >= 2 || (made === 1 && !(c.kind === "access" || c.local || c.kind === "improve"))) continue; if (tryPlan(sim, w, c, r, purse, () => pf-- > 0, () => pf > 0, y)) made++; }
      yield; if (pf <= 0) break; continue;
    }
    const isNew = (c: Cand) => c.kind === "new" || c.kind === "access", slack = sim.regionSlack?.[r] ?? 0, room = MAX_ACTIVE_PER_REGION + extraActive + fav + (slack > 0.5 ? 1 : 0) + (slack > 0.75 ? 1 : 0) - (perRegion.get(r) ?? 0);   // a region whose money sits idle takes on more work
    let made = 0, madeNew = 0, madeOld = 0;
    for (const c of [...cands.filter(isNew).slice(0, 5), ...cands.filter((x) => !isNew(x)).slice(0, 5)].sort((p, q) => q.score - p.score)) {
      if (made >= room) break; if (isNew(c) ? madeNew >= 1 + fav : madeOld >= 2) continue;
      if (tryPlan(sim, w, c, r, purse, () => pf-- > 0, () => pf > 0, y)) { made++; if (isNew(c)) madeNew++; else madeOld++; }
    }
    yield;   // one region per slice: keeps every main-thread task short
    if (pf <= 0) break;
  }
  if (sim.stage3) { yield* planRailGen(sim, w, an, y); planConvert(sim, y); }
}
/** A railway that is gone can become a road (a bus road, a cycle road, a local lane): the right-of-way is already there. At most one a year, and only where roads are in favour. */
export function planConvert(sim: SimState, y: number) {
  if (sim.dials.hwyBuild < 0.3 || Object.values(sim.projects).filter((p) => p.kind === "convert" && p.status !== "open" && p.status !== "abolished").length >= 2) return;
  const busy = new Set(Object.values(sim.projects).filter((p) => p.status === "planned" || p.status === "building").flatMap((p) => p.edgeIds));
  const cs = Object.values(sim.edges).filter((e) => modeOf(e) === "rail" && e.facility !== "ferry" && (e.state === "closed" || e.state === "lost") && e.built >= 1 && !e.convertedTo && !busy.has(e.id) && e.lengthKm >= 8).sort((a, b) => (a.id < b.id ? -1 : 1));
  if (!cs.length || rand(sim) > 0.35) return;
  const e = cs[Math.floor(rand(sim) * cs.length)], p = createProject(sim, "convert", e.region, e.a, e.b, [e.id], [{ edgeId: e.id, dir: 1 }], e.lengthKm * 0.35, `廃止された鉄道の跡が使える(${Math.round(e.lengthKm)}km)`, 1.2);
  ev(sim, "project", `廃線跡の転用計画: ${sim.nodes[e.a]?.name ?? "地点"}〜${sim.nodes[e.b]?.name ?? "地点"}(道路へ)`, p.reason, { project: p.id, edge: e.id }); void y;
}
export const MAX_RAIL_PATHFINDS = 5;
/** Stage 7: a corridor between two cities of at least this size and at most this far apart may be built by a private company even in the national railway's era (was 250,000 / 110 km). */
export const PRIVATE_MIN_POP = 150000, PRIVATE_MAX_KM = 130;
export const RAIL_UNIT: Record<Standard, number> = { rural: 1.6, standard: 2.8, highgrade: 6 };
const baseName = (n: string) => n.replace(/市$/, "");
/** Railway planning, once a year: new lines where the demand is not served by rail, electrification/high-speed where lines are full, revival where demand returned. */
export function* planRailGen(sim: SimState, w: World, an: Analysis, y: number): Generator<void> {
  const dl = sim.dials; if (dl.railBuild < 0.05) return;
  const live = Object.values(sim.projects).filter((p) => modeOf(p) === "rail" && (p.status === "concept" || p.status === "planned" || p.status === "building" || p.status === "suspended"));
  const liveNew = live.filter((p) => p.kind === "new" && !p.reason.startsWith(LOCAL_TAG)).length, liveUp = live.filter((p) => p.kind !== "new").length, maxNew = 1 + Math.round(dl.railBuild * 2), maxUp = 2 + Math.round(dl.railBuild * 2);
  if (liveNew >= maxNew && liveUp >= maxUp && live.filter((p) => p.reason.startsWith(LOCAL_TAG)).length >= 1 + Math.round(dl.railBuild * 3)) return;
  const busy = new Set(live.flatMap((p) => p.edgeIds)), nc = w.cities.length, cands: (Cand & { op?: string; std?: Standard })[] = [];
  const rail18 = stance18(sim) !== null;   // Stage 18: 海路重視 / 空路重視 hold railway building back
  const rcr = reconOf(sim) ? { y, meanCore: reconMeanCore(sim, w) } : undefined, favMemo = new Map<string, boolean>(), favRegion = (r: string) => { let v = favMemo.get(r); if (v === undefined) { v = !!rcr && reconRegionLean(sim, w, r, rcr.meanCore) >= FAVOURED_LEAN; favMemo.set(r, v); } return v; };
  for (const e of Object.values(sim.edges)) {
    if (modeOf(e) !== "rail" || e.facility === "ferry" || busy.has(e.id) || e.built < 1) continue;
    if (e.state === "open" && e.congYears >= 2 && e.standard !== "highgrade" && (e.standard === "rural" || dl.hsr > 0.4) && !(rail18 && e.standard !== "rural")) cands.push({ score: (rail18 ? RAIL_UPGRADE_FACTOR : 1) * 3.2 + Math.min(3, (e.through / RAIL_CAPACITY_OF(e)) * 0.3), kind: "electrify", edge: e, reason: `輸送量が容量の${Math.round((e.through / RAIL_CAPACITY_OF(e)) * 100)}%に達し${e.congYears}年混雑(${e.standard === "rural" ? "電化・複線化" : "高速化"})` });
    else if (sim.towns16 && !rail18 && rcr && e.state === "open" && e.standard !== "highgrade" && e.lengthKm >= POLICY_TRUNK_KM && e.through >= POLICY_RAIL_SHARE * RAIL_CAPACITY_OF(e) && favRegion(w.prefOf(e.cells[e.cells.length >> 1]) ?? e.region)) cands.push({ pol: true, score: POLICY_RAIL_SCORE * reconFade(y, reconOf(sim)?.since), kind: "electrify", edge: e, reason: `復興方針(${reconText(reconOf(sim)!)})による幹線鉄道の${e.standard === "rural" ? "電化・複線化" : "高速化"}(輸送量が容量の${Math.round((e.through / RAIL_CAPACITY_OF(e)) * 100)}%)` });
    else if ((e.state === "closed" || e.state === "lost") && e.reviveYears >= 3 && dl.railBuild > 0.3 && !e.convertedTo) cands.push({ score: 2 + (an.potential.get(e.id) ?? 0) / 90, kind: "restore", edge: e, reason: `沿線需要${Math.round(an.potential.get(e.id) ?? 0)}人/日が${e.reviveYears}年続いている` });
  }
  const dens = (c: { pop: number }) => c.pop, rdef = accessDeficit(w, an), rc = reconOf(sim) ? { y, meanCore: reconMeanCore(sim, w) } : undefined;
  for (let i = 0; i < nc; i++) for (let j = i + 1; j < nc; j++) {
    const a = w.cities[i], b = w.cities[j]; if (a.island !== b.island) continue; const d = dist(a.pos, b.pos); if (d < 40 || d > 260) continue;
    const tt = an.TT[i * nc + j], tr = an.T[i * nc + j], railSvc = isFinite(tt) ? Math.min(1, d / (tt * 60)) : 0, roadSvc = isFinite(tr) ? Math.min(1, d / (tr * 40)) : 0, svc = Math.max(railSvc, roadSvc * competeWeight(dl, "road")); if (svc > 0.65) continue;
    const pa = dens(sim.cities[a.id]), pb = dens(sim.cities[b.id]), unmet = (Math.pow(pa * pb, 0.65) / Math.pow(d, 1.25)) * (1 - svc) * 1e-3;
    const big = Math.min(pa, pb) > 400000, std: Standard = dl.hsr > 0.45 && y >= 1955 && big && d >= 120 ? "highgrade" : y >= 1960 ? "standard" : "rural";
    const cf = corridorFactor(sim, w, rdef, i, j, rc);
    cands.push({ score: (Math.log10(1 + unmet * 30) * (0.5 + dl.railBuild) + (std === "highgrade" ? 0.5 * dl.hsr : 0)) * cf.f * (rail18 ? RAIL_NEW_FACTOR : 1) + (rail18 ? 0 : cf.add), kind: "new", a: i, b: j, std: rail18 && std === "highgrade" ? "standard" : std, reason: `${a.name}〜${b.name}間(${Math.round(d)}km)の鉄道が${isFinite(tt) ? `所要${tt.toFixed(1)}時間` : "未整備"}${cf.why}` });
  }
  // 地方支線: a city the railway does not reach is tied to the nearest existing line by a short rural branch (quota of its own below)
  const railNodes: { cell: number; pos: [number, number]; name: string; isl: number }[] = [], seenN = new Set<string>();
  for (const e of Object.values(sim.edges)) if (modeOf(e) === "rail" && e.state === "open" && e.built >= 1) for (const id of [e.a, e.b]) if (!seenN.has(id)) { seenN.add(id); const n = sim.nodes[id]; if (n) railNodes.push({ cell: n.cell, pos: n.pos as [number, number], name: n.name ?? "既設線", isl: w.t.island[n.cell] }); }
  const onRail = new Set(railNodes.map((n) => n.cell));
  for (let i = 0; i < nc && railNodes.length; i++) {
    const a = w.cities[i]; if (onRail.has(a.cell)) continue; const pa = sim.cities[a.id].pop; if (pa < 8000) continue;
    let best: (typeof railNodes)[0] | null = null, bd = Infinity; for (const n of railNodes) { const dd = dist(a.pos, n.pos); if (dd < bd && dd >= 6 && dd <= 90 && n.isl === w.t.island[a.cell]) { bd = dd; best = n; } }
    if (!best) continue;
    const roadT = an.T[i * nc + i] ; void roadT;
    const demand = Math.log10(1 + (pa / 25000) * (70 / bd)) * (0.4 + dl.railBuild) * (1 + 0.5 * dl.railBias) * (0.6 + 0.4 * dl.growth);
    cands.push({ score: demand + 0.15, kind: "new", a: i, toCell: best.cell, toName: best.name, std: "rural", local: true, reason: `${LOCAL_TAG}${a.name}(人口${Math.round(pa / 1000)}千人)に鉄道が届いていない。最寄りの既設線まで${Math.round(bd)}km` });
  }
  // ... and so is a sizeable village (settlement): the branch line is what keeps a rural area alive when the road is slow
  const cityIdx = new Map(w.cities.map((c, i) => [c.id, i]));
  for (const v of Object.values(sim.settlements)) {
    if (v.gone || v.pop < 1200 || !railNodes.length) continue; const ci = cityIdx.get(v.city); if (ci === undefined) continue;
    const vp = w.cellPos(v.cell); let best: (typeof railNodes)[0] | null = null, bd = Infinity;
    for (const n of railNodes) { const dd = dist(vp, n.pos); if (dd < bd && dd >= 6 && dd <= 45 && n.isl === w.t.island[v.cell]) { bd = dd; best = n; } }
    if (!best) continue;
    const demand = Math.log10(1 + (v.pop / 4000) * (30 / bd)) * (0.4 + dl.railBuild) * (1 + 0.5 * dl.railBias) * (0.6 + 0.4 * dl.growth);
    cands.push({ score: demand, kind: "new", a: ci, fromCell: v.cell, fromName: v.name, toCell: best.cell, toName: best.name, std: "rural", local: true, reason: `${LOCAL_TAG}${v.name}(人口${v.pop}人)は鉄道から${Math.round(bd)}kmで、支線の需要がある` });
  }
  cands.sort((p, q) => q.score - p.score || (p.kind < q.kind ? -1 : 1) || (p.a ?? 0) - (q.a ?? 0) || (p.b ?? 0) - (q.b ?? 0) || (p.fromCell ?? 0) - (q.fromCell ?? 0));
  if ((globalThis as any).__DBG) console.log(y, "cands", cands.filter(c => c.kind === "new").length, cands.slice(0, 5).map(c => c.kind + ":" + c.score.toFixed(2)), "live", live.length, "liveNew", liveNew, "maxNew", maxNew, "up", liveUp, maxUp);
  let made = 0, pf = MAX_RAIL_PATHFINDS, nNew = 0, nUp = 0, nLocal = 0; const liveLocal = live.filter((p) => p.reason.startsWith(LOCAL_TAG)).length, maxLocal = 1 + Math.round(dl.railBuild * 3); const wantNew = dl.railBuild > 0.9 ? 2 : 1, wantUp = Math.max(1, Math.round(0.3 + 1.2 * dl.railBuild));
  // Stage 16: the policy's own trunk upgrades have a turn of their own (one a year, two at a time), or the jammed Pacific belt's never-ending list of congested lines takes every turn there is
  const livePol = live.filter((p) => p.kind !== "new" && p.reason.includes("復興方針")).length; let nPol = 0;
  const ranked = [...cands.filter((c) => c.kind === "new" && !c.local).slice(0, 25), ...cands.filter((c) => c.local).slice(0, 8), ...cands.filter((c) => c.kind !== "new" && !c.pol).slice(0, 12), ...cands.filter((c) => c.pol).slice(0, 6)].sort((p, q) => q.score - p.score);
  for (const c of ranked) {
    if (nNew >= wantNew && nUp >= wantUp && nLocal >= 1) break;
    if (c.score < 0.25) break;
    if (c.pol) { if (nPol >= 1 || livePol + nPol >= 2) continue; }
    else if (c.local) { if (nLocal >= 1 || liveLocal + nLocal >= maxLocal) continue; }
    else if (c.kind === "new" ? nNew >= wantNew || liveNew + nNew >= maxNew : nUp >= wantUp || liveUp + nUp >= maxUp) continue;   // new lines and upgrades each get their own quota, so upgrades cannot crowd out new lines for ever
    if (c.edge && (c.kind === "electrify" || c.kind === "restore")) {
      const e = c.edge, cost = e.lengthKm * (c.kind === "restore" ? (e.state === "lost" ? 2.4 : 1.2) : e.standard === "rural" ? 1.3 : 3.2) * mtnCost(w, sim, "rail", e.cells, y);   // Stage 9: upgrading a line through drawn mountains costs as much more as building it
      const p = createProject(sim, c.kind, "JP", e.a, e.b, [e.id], [{ edgeId: e.id, dir: 1 }], cost, c.reason, c.score); p.mode = "rail"; p.op = e.op ?? "jnr";
      ev(sim, "project", `${c.kind === "restore" ? "復活計画" : e.standard === "rural" ? "電化・複線化計画" : "高速化計画"}: ${projLabel(sim, p)}`, c.reason, { project: p.id, edge: e.id }); made++; if (c.pol) nPol++; else nUp++; yield; continue;
    }
    if ((globalThis as any).__DBG) console.log("cand", c.kind, c.score.toFixed(2), c.a, c.b, "pf", pf, "nNew", nNew, nUp);
    if (c.kind === "new" && c.a !== undefined && (c.b !== undefined || c.toCell !== undefined) && pf-- > 0) {
      const a = w.cities[c.a], aCell = c.fromCell ?? a.cell, aName = c.fromName ?? a.name, b = c.b !== undefined ? w.cities[c.b] : null, bCell = b ? b.cell : c.toCell!, bName = b ? b.name : c.toName ?? "既設線", idx = buildIndex(sim, "rail"), ref = referenceGrids(w), std = c.std ?? "rural";
      const path = pathfind(w, aCell, bCell, { rail: true, ease: crossingEase(sim.tech, y), bias: (k) => refBias(ref.rail)(k) * (idx.roadCells.has(k) ? 1.6 : 1), margin: 16 }); yield; if (!path) continue;   // a new line is a direct one: existing track is not discounted
      const newKm = path.filter((k, q) => q > 0 && !idx.step.has(stepKey(path[q - 1], k))).length * w.cell; if ((globalThis as any).__DBG) console.log("try", aName, bName, "newKm", newKm, "len", path.length * w.cell); if (newKm < (c.local ? 6 : 15)) continue;
      const tcR = techCheck(sim, w, "rail", path, y); if (!tcR.ok) continue;   // not buildable with this year's tunnelling (yet)
      if (!affordable(sim, w, "rail", path, newKm, RAIL_UNIT[std], railPurse(sim), y)) continue;
      const jnrEra = sim.dials.privatize < 0.5, privateOk = !!b && Math.min(sim.cities[a.id].pop, sim.cities[b.id].pop) > PRIVATE_MIN_POP && dist(a.pos, b.pos) < PRIVATE_MAX_KM,   /* Stage 7: private companies enter the busier corridors the national railway serves poorly, so the two compete */ localPrivate = !!c.local && !jnrEra;
      let op = "jnr"; if (c.local && !localPrivate) op = "jnr"; else if (!jnrEra || privateOk) { const anchorIsA = !b || basePop(sim, w, a) >= basePop(sim, w, b), id = `p.${anchorIsA ? a.id : b!.id}`, anchor = anchorIsA ? a : b!; if (!sim.operators[id]) sim.operators[id] = { id, name: `${baseName(anchor.name)}${jnrEra ? "電鉄" : "鉄道"}`, kind: "private", since: y, note: "新規参入の鉄道事業者(架空の事業者名)" } as Operator; op = id; }
      const l = layPath(sim, w, path, { facilities: !!sim.stage3, open: false, surface: "paved", quality: 88, built: 0, month: sim.month, standard: std, mode: "rail", op }); if (!l.created.length) continue;
      const es = l.created.map((id) => sim.edges[id]), cost = es.reduce((s2, x) => s2 + x.lengthKm * RAIL_UNIT[std] * (1 + x.maxGradePct * 0.08) * facCost(x, sim) * mtnCost(w, sim, "rail", x.cells, y), 0);
      const p = createProject(sim, "new", "JP", nodeAtCell(sim, w, idx, aCell, "junction"), nodeAtCell(sim, w, idx, bCell, "junction"), l.created, l.chain, cost, c.reason, c.score); p.mode = "rail"; p.op = op; p.status = "concept"; techRoll(sim, p, tcR.hard, y, `${aName}〜${bName}`);
      ev(sim, "project", `${std === "highgrade" ? "高速新線" : "新線"}構想: ${aName}〜${bName}(${Math.round(es.reduce((s2, x) => s2 + x.lengthKm, 0))}km・${sim.operators[op]?.name ?? "国鉄"})`, c.reason, { project: p.id }); made++; if (c.local) nLocal++; else nNew++; yield;
    }
  }
}
const RAIL_CAPACITY_OF = (e: SimEdge) => RAIL_CAP[e.standard];
function tryPlan(sim: SimState, w: World, c: Cand, region: string, purse: number, spend: () => boolean, canSpend: () => boolean, y: number): boolean {
  const std: Standard = y >= 1965 ? "standard" : "rural";
  if (c.kind === "upgrade" && c.edge) { const e = c.edge, cost = e.lengthKm * 0.5; if (cost > purse) return false; const p = createProject(sim, "upgrade", region, e.a, e.b, [e.id], [{ edgeId: e.id, dir: 1 }], cost, c.reason, c.score); ev(sim, "project", `舗装化計画: ${projLabel(sim, p)}(${KIND_LABEL.upgrade})`, c.reason, { project: p.id, edge: e.id }); return true; }
  if (c.kind === "restore" && c.edge) { const e = c.edge, cost = e.lengthKm * (e.state === "lost" ? 1.2 : 0.4); if (cost > purse) return false; const p = createProject(sim, "restore", region, e.a, e.b, [e.id], [{ edgeId: e.id, dir: 1 }], cost, c.reason, c.score); ev(sim, "project", `復旧計画: ${projLabel(sim, p)}`, c.reason, { project: p.id, edge: e.id }); return true; }
  if ((c.kind === "improve" || c.kind === "bypass") && c.edge) {
    const e = c.edge, target: Standard = e.standard === "rural" ? "standard" : "highgrade";
    if (c.kind === "bypass" && canSpend()) {
      const old = new Set(e.cells.slice(1, -1)), near = new Set<number>(); for (const k of old) near.add(k);
      if (!spend()) return false;
      const path = pathfind(w, e.cells[0], e.cells[e.cells.length - 1], { bias: (k) => (near.has(k) ? 3 : 1), margin: 12, ease: crossingEase(sim.tech, y) });
      const shared = path ? path.filter((k) => old.has(k)).length : 99;
      if (path && shared === 0 && path.length >= 3) {
        const idx = buildIndex(sim); if (path.slice(1, -1).some((k) => idx.nodeByCell.has(k) || idx.cellEdge.has(k))) return planImprove(sim, w, e, region, purse, c);
        const tcB = techCheck(sim, w, "road", path, y); if (!tcB.ok || !affordable(sim, w, "road", path, path.length * w.cell, UNIT[target], purse, y)) return planImprove(sim, w, e, region, purse, c);   // would cut another road: improve in place instead
        const l = layPath(sim, w, path, { facilities: !!sim.stage3, open: false, surface: "paved", quality: 90, built: 0, month: sim.month, standard: target });
        if (l.created.length) {
          const es = l.created.map((id) => sim.edges[id]), cost = es.reduce((s, x) => s + x.lengthKm * UNIT[target] * (1 + x.maxGradePct * 0.03) * facCost(x, sim) * mtnCost(w, sim, "road", x.cells, y), 0);
          if (cost > purse * 1.5) { for (const x of es) { x.built = 0; } }  // kept as a (slow) plan; the region's purse decides how long it takes
          const p = createProject(sim, "bypass", region, e.a, e.b, l.created, l.chain, cost, c.reason, c.score, [e.id]); techRoll(sim, p, tcB.hard, y, projLabel(sim, p));
          ev(sim, "project", `バイパス計画: ${projLabel(sim, p)}(${Math.round(es.reduce((s, x) => s + x.lengthKm, 0))}km・${target === "highgrade" ? "高規格" : "2車線"})`, `${c.reason}。同じ区間に新道を計画`, { project: p.id, edge: e.id }); return true;
        }
      }
    }
    return planImprove(sim, w, e, region, purse, c);
  }
  if (c.kind === "access" && c.vid && c.toCell !== undefined && canSpend()) {
    const v = sim.settlements[c.vid]; if (!spend()) return false;
    const idx = buildIndex(sim), now = pathfind(w, v.cell, c.toCell, { roadCells: idx.roadCells, margin: 10 }), direct = pathfind(w, v.cell, c.toCell, { margin: 10, ease: crossingEase(sim.tech, y), bias: (k) => (idx.roadCells.has(k) ? 1.25 : 1) });
    if (!direct) return false; const nowKm = now ? now.length : Infinity; if (direct.length > nowKm * LINK_CUT) return false;   // the way that exists is already about as short
    if (!techCheck(sim, w, "road", direct, y).ok) return false;
    const newKm = direct.filter((k, q) => q > 0 && !idx.step.has(stepKey(direct[q - 1], k))).length * w.cell; if (newKm < 4) return false; if (newKm > purse) return false; if (!affordable(sim, w, "road", direct, newKm, 0.9, purse, y)) return false;
    const l = layPath(sim, w, direct, { facilities: !!sim.stage3, open: false, surface: "gravel", quality: 70, built: 0, month: sim.month, standard: "rural" }); if (!l.created.length) return false;
    const es = l.created.map((id) => sim.edges[id]), cost = es.reduce((s, x) => s + x.lengthKm * 0.9 * (1 + x.maxGradePct * 0.03) * facCost(x, sim) * (w.land12 ? mtnCost(w, sim, "road", x.cells, y) : 1), 0);
    const p = createProject(sim, "access", region, nodeAtCell(sim, w, idx, v.cell, "village"), nodeAtCell(sim, w, idx, c.toCell, "junction"), l.created, l.chain, cost, c.reason, c.score);
    ev(sim, "project", `地方道の計画: ${v.name}〜${c.toName ?? "隣の集落"}(${Math.round(es.reduce((s, x) => s + x.lengthKm, 0))}km)`, c.reason, { project: p.id }); return true;
  }
  if (c.kind === "access" && c.vid && canSpend()) {
    const v = sim.settlements[c.vid], city = w.cityById.get(v.city)!; if (!spend()) return false;
    const idx = buildIndex(sim), path = pathfind(w, v.cell, city.cell, { roadCells: idx.roadCells, margin: 12 }); if (!path) return false;
    if (w.land12 && !techCheck(sim, w, "road", path, yearOf(sim)).ok) return false;
    const newKm = path.filter((k, q) => q > 0 && !idx.step.has(stepKey(path[q - 1], k))).length * w.cell; if (newKm < 3 || newKm * 1 > purse) return false; if (!affordable(sim, w, "road", path, newKm, 0.8, purse, yearOf(sim))) return false;
    const l = layPath(sim, w, path, { facilities: !!sim.stage3, open: false, surface: "gravel", quality: 70, built: 0, month: sim.month, standard: "rural" }); if (!l.created.length) return false;
    const es = l.created.map((id) => sim.edges[id]), a = nodeAtCell(sim, w, idx, v.cell, "village"), cost = es.reduce((s, x) => s + x.lengthKm * 0.8 * (w.land12 ? mtnCost(w, sim, "road", x.cells, yearOf(sim)) : 1), 0);
    const p = createProject(sim, "access", region, a, nodeAtCell(sim, w, idx, city.cell, "junction"), l.created, l.chain, cost, c.reason, c.score);
    ev(sim, "project", `集落アクセス道の計画: ${v.name}`, c.reason, { project: p.id }); return true;
  }
  if (c.kind === "new" && c.a !== undefined && c.b !== undefined && canSpend()) {
    const a = w.cities[c.a], b = w.cities[c.b]; if (!spend()) return false;
    const idx = buildIndex(sim), path = pathfind(w, a.cell, b.cell, { roadCells: idx.roadCells, ease: crossingEase(sim.tech, y) }); if (!path) return false;
    const tcN = techCheck(sim, w, "road", path, y); if (!tcN.ok) return false;
    let newKm = path.filter((k, q) => q > 0 && !idx.step.has(stepKey(path[q - 1], k))).length * w.cell;
    if (newKm < (c.local ? 5 : 15)) {
      if (!sim.stage3) return false;
      // Stage 7: the pair is already joined, only slowly. Either a genuinely shorter new road is worth laying (a pass road or a tunnel that cuts a long
      // detour), or the slowest piece of the road that exists is improved. Before, both cases were simply dropped (9 candidates in 10).
      if (!canSpend() || !spend()) return false;
      const direct = pathfind(w, a.cell, b.cell, { ease: crossingEase(sim.tech, y), bias: (k) => (idx.roadCells.has(k) ? 1.25 : 1) });
      const dk = direct ? direct.filter((k, q) => q > 0 && !idx.step.has(stepKey(direct[q - 1], k))).length * w.cell : 0;
      if (direct && dk >= (c.local ? 5 : 12) && direct.length <= path.length * DETOUR_CUT && techCheck(sim, w, "road", direct, y).ok) { path.splice(0, path.length, ...direct); newKm = dk; }
      else {
        const busy = new Set(activeProjects(sim).flatMap((p) => p.edgeIds)), along = new Set<string>(); for (let q = 1; q < path.length; q++) { const st = idx.step.get(stepKey(path[q - 1], path[q])); if (st) along.add(st.edge); }
        const slow = [...along].map((id) => sim.edges[id]).filter((e) => e && e.state === "open" && e.built >= 1 && modeOf(e) === "road" && e.facility !== "ferry" && !busy.has(e.id) && (e.standard === "rural" || e.surface !== "paved")).sort((p, q) => edgeKmh(p) - edgeKmh(q) || (p.id < q.id ? -1 : 1))[0];
        if (!slow) return false; 
        if (slow.surface !== "paved") { const cost = slow.lengthKm * 0.5; if (cost > purse) return false; const p = createProject(sim, "upgrade", region, slow.a, slow.b, [slow.id], [{ edgeId: slow.id, dir: 1 }], cost, `${c.reason}。経路上の未舗装区間を舗装`, c.score); ev(sim, "project", `舗装化計画: ${projLabel(sim, p)}`, p.reason, { project: p.id, edge: slow.id }); return true; }
        return planImprove(sim, w, slow, region, purse, { ...c, reason: `${c.reason}。経路上で最も遅い区間を改良` });
      }
    }
    if (newKm * 1.3 > Math.max(30, purse)) return false; if (!affordable(sim, w, "road", path, newKm, UNIT[std], purse, y)) return false;
    const l = layPath(sim, w, path, { facilities: !!sim.stage3, open: false, surface: "gravel", quality: 80, built: 0, month: sim.month, standard: std }); if (!l.created.length) return false;
    const es = l.created.map((id) => sim.edges[id]), cost = es.reduce((s, x) => s + x.lengthKm * UNIT[std] * (1 + x.maxGradePct * 0.03) * facCost(x, sim) * mtnCost(w, sim, "road", x.cells, y), 0);
    const reg = a.pref === b.pref ? region : "JP";
    const p = createProject(sim, "new", reg, nodeAtCell(sim, w, idx, a.cell, "junction"), nodeAtCell(sim, w, idx, b.cell, "junction"), l.created, l.chain, cost, c.reason, c.score); if (sim.stage3) p.status = "concept"; techRoll(sim, p, tcN.hard, y, `${a.name}〜${b.name}`);
    ev(sim, "project", `${sim.stage3 ? "新規構想" : "新規計画"}: ${a.name}〜${b.name}(${Math.round(es.reduce((s, x) => s + x.lengthKm, 0))}km)`, c.reason, { project: p.id }); return true;
  }
  return false;
}
function planImprove(sim: SimState, w: World, e: SimEdge, region: string, purse: number, c: Cand): boolean {
  const target: Standard = e.standard === "rural" ? "standard" : "highgrade", cost = e.lengthKm * UNIT[target] * 0.6 * mtnCost(w, sim, "road", e.cells, yearOf(sim)); if (cost > purse * 1.5) return false;
  const p = createProject(sim, "improve", region, e.a, e.b, [e.id], [{ edgeId: e.id, dir: 1 }], cost, c.reason, c.score);
  ev(sim, "project", `改良計画: ${nodeName(sim, e.a)}〜${nodeName(sim, e.b)}(${target === "standard" ? "2車線化" : "高規格化"})`, c.reason, { project: p.id, edge: e.id }); return true;
}
void rand;
