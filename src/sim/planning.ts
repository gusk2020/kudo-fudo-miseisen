/**
 * Yearly planning. Every prefecture keeps its own queue and purse, so many regions build at the same time.
 * Cost control ("performance budget"): at most MAX_PATHFINDS route searches per year, regions take turns.
 */
import { dist } from "../core/geom";
import { refBias, referenceGrids } from "./reference";
import { buildIndex, facilitySplit, layPath, newId, nodeAtCell } from "./network";
import { HARD_ROCK_M, crossingEase, facilityCostMult, techAt } from "./tech";
import { ev, projLabel, rand } from "./engine";
import { CAPACITY, RAIL_CAPACITY as RAIL_CAP, type Analysis } from "./demand";
import { KIND_LABEL, modeOf, type Operator, type ProjectKind, type SimEdge, type SimProject, type SimState, type Standard } from "./types";
import { pathfind, type World } from "./world";

/** A long tunnel or bridge costs several times as much per km as the open line. */
export const facCost = (e: SimEdge, sim?: Pick<SimState, "tech" | "startYear" | "month">) => (e.facility === "tunnel" ? 3 : e.facility === "bridge" ? 2.2 : 1) * (e.facility && sim?.tech ? facilityCostMult(sim.tech, sim.startYear + Math.floor(sim.month / 12)) : 1) * (1 + Math.min(0.5, (e.curv ?? 0) * 0.3));
export const MAX_TUNNEL_PROJECTS = 3;
/** Counters for tests and tools only (not saved): how often the tunnelling limit or the tunnel-project cap held a project back, and how many hard-rock rolls went wrong. */
export const techStats = { tooLong: 0, capped: 0, checked: 0, hard: 0, trouble: 0 };
/**
 * Can the line along `path` be built with the technology of year `y`? A tunnel longer than the longest that can be driven means the project
 * has to wait (null: not feasible yet); too many tunnel projects at once also waits, so cheaper tunnels do not crowd out everything else.
 * `hard` = the tunnel runs through high, hard rock (the success roll applies). Only games with a tech rule are gated; older saves are not.
 */
export function techCheck(sim: SimState, w: World, mode: "road" | "rail", path: number[], y: number): { ok: boolean; hard: boolean } {
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
export const MAX_PATHFINDS = 12, REGIONS_PER_YEAR = 14, MAX_ACTIVE_PER_REGION = 2;
const UNIT: Record<Standard, number> = { rural: 1, standard: 1.8, highgrade: 4 };
interface Cand { score: number; kind: ProjectKind; edge?: SimEdge; vid?: string; a?: number; b?: number; reason: string; toCell?: number; toName?: string; local?: boolean; fromCell?: number; fromName?: string }
/** Projects born as local branch lines/connectors carry this prefix in their reason (no new save field needed). */
export const LOCAL_TAG = "【地方】";

export function activeProjects(sim: SimState) { return Object.values(sim.projects).filter((p) => p.status === "concept" || p.status === "planned" || p.status === "building" || p.status === "suspended"); }
export function createProject(sim: SimState, kind: ProjectKind, region: string, from: string, to: string, edgeIds: string[], chain: SimProject["chain"], cost: number, reason: string, priority: number, replaces: string[] = []): SimProject {
  const id = newId(sim, "project");
  const p: SimProject = { id, kind, region, replaces, from, to, edgeIds, chain, costBu: Math.round(cost * 100) / 100, spentBu: 0, status: "planned", startMonth: sim.month, stallMonths: 0, statusSince: sim.month, routeId: null, reason, priority };
  sim.projects[id] = p; return p;
}
const nodeName = (sim: SimState, id: string) => sim.nodes[id]?.name ?? "地点";

export function* planYearGen(sim: SimState, w: World, an: Analysis, y: number): Generator<void> {
  const regions = w.t.prefOrder, n = regions.length, B = sim.stage3 ? sim.macro.budgetBu * sim.dials.roadShare * (0.4 + 0.8 * sim.dials.hwyBuild) : sim.macro.budgetBu; let pf = MAX_PATHFINDS;
  const start = ((y - sim.startYear) * REGIONS_PER_YEAR) % n, slice = Array.from({ length: REGIONS_PER_YEAR }, (_, i) => regions[(start + i) % n]);
  const live = activeProjects(sim).filter((p) => modeOf(p) === "road"), busy = new Set(live.flatMap((p) => p.edgeIds)), perRegion = new Map<string, number>();
  for (const p of live) if (p.status !== "suspended") perRegion.set(p.region, (perRegion.get(p.region) ?? 0) + 1);
  const edgesBy = new Map<string, SimEdge[]>(); for (const e of Object.values(sim.edges)) if (modeOf(e) === "road") (edgesBy.get(e.region) ?? edgesBy.set(e.region, []).get(e.region)!).push(e);
  const vilBy = new Map<string, string[]>(); for (const v of Object.values(sim.settlements)) if (!v.gone) { const r = w.prefOf(v.cell) ?? "JP-13"; (vilBy.get(r) ?? vilBy.set(r, []).get(r)!).push(v.id); }
  const cityBy = new Map<string, number[]>(); w.cities.forEach((c, i) => { const r = c.pref ?? "JP-13"; (cityBy.get(r) ?? cityBy.set(r, []).get(r)!).push(i); });
  const nc = w.cities.length;
  for (const r of slice) {
    if ((perRegion.get(r) ?? 0) >= MAX_ACTIVE_PER_REGION) continue;
    const purse = Math.max(8, B * 0.8 * (sim.regionShare[r] ?? 1 / n) * 48), cands: Cand[] = [];
    for (const vid of vilBy.get(r) ?? []) if (an.reach.get(vid) === false) cands.push({ score: 6 + sim.settlements[vid].pop / 2000, kind: "access", vid, reason: `${sim.settlements[vid].name}が道路網から孤立している` });
    for (const e of edgesBy.get(r) ?? []) {
      if (busy.has(e.id) || e.built < 1) continue; const d = e.through + e.local;
      if (e.state === "open" && e.congYears >= 2 && e.standard !== "highgrade") cands.push({ score: 3 + (e.through / CAPACITY[e.standard]) * 3, kind: e.standard === "rural" && e.maxGradePct < 5 && e.lengthKm < 25 ? "improve" : "bypass", edge: e, reason: `通過交通が容量の${Math.round((e.through / CAPACITY[e.standard]) * 100)}%に達し${e.congYears}年混雑` });
      else if (sim.stage3 && e.state === "open" && e.standard === "rural" && e.surface === "paved" && e.local >= 250 && e.quality >= 50) cands.push({ score: 1.2 + e.local / 800, kind: "improve", edge: e, reason: `${LOCAL_TAG}沿線の生活需要${Math.round(e.local)}台/日が細道の容量に近づいている` });
      else if (e.state === "open" && e.surface !== "paved" && d >= 150 && e.quality < 80) cands.push({ score: 1 + d / 400, kind: "upgrade", edge: e, reason: `需要${Math.round(d)}台/日で未舗装・砂利のため舗装化` });
      else if ((e.state === "closed" || e.state === "lost") && e.reviveYears >= 3 && e.region === r) cands.push({ score: 2.5 + (an.potential.get(e.id) ?? 0) / 60, kind: "restore", edge: e, reason: `沿線需要${Math.round(an.potential.get(e.id) ?? 0)}台/日が${e.reviveYears}年続いている` });
    }
    for (const i of cityBy.get(r) ?? []) for (let j = 0; j < nc; j++) {
      const a = w.cities[i], b = w.cities[j]; if (j === i || a.island !== b.island) continue; const d = dist(a.pos, b.pos); if (d < 12 || d > 160) continue;
      const t = an.T[i * nc + j], roadSvc = isFinite(t) ? Math.min(1, d / (t * 40)) : 0, tt = an.TT[i * nc + j], railSvc = sim.stage3 && isFinite(tt) ? Math.min(1, d / (tt * 60)) : 0;
      // competition: where a good railway already serves the pair and the era prefers it, a new road is less needed (and the other way round for railways below)
      const service = Math.max(roadSvc, railSvc * competeWeight(sim.dials, "rail")); if (service > 0.6) continue;
      const unmet = (Math.pow(sim.cities[a.id].pop * sim.cities[b.id].pop, 0.7) / Math.pow(d, 1.2)) * (1 - service) / (d * 1.3 + 10);
      cands.push({ score: Math.log10(1 + unmet) * 1.2 * (d < 30 ? 1.3 : 1), kind: "new", a: i, b: j, local: d < 30, reason: `${a.name}〜${b.name}間の需要に対し${isFinite(t) ? `所要時間${t.toFixed(1)}h` : "未接続"}` });
    }
    cands.sort((p, q) => q.score - p.score || (p.kind < q.kind ? -1 : 1)); let made = 0;
    // one project per visit, plus a second if it is a small local one (a village access road or a short local link): local work must not wait behind trunk work
    for (const c of cands.slice(0, 8)) { if (made >= 2 || (made === 1 && !(c.kind === "access" || c.local || c.kind === "improve"))) continue; if (tryPlan(sim, w, c, r, purse, () => pf-- > 0, () => pf > 0, y)) made++; }
    yield;   // one region per slice: keeps every main-thread task short
    if (pf <= 0) break;
  }
  if (sim.stage3) { yield* planRailGen(sim, w, an, y); planConvert(sim, y); }
}
/** A railway that is gone can become a road (a bus road, a cycle road, a local lane): the right-of-way is already there. At most one a year, and only where roads are in favour. */
export function planConvert(sim: SimState, y: number) {
  if (sim.dials.hwyBuild < 0.3 || Object.values(sim.projects).filter((p) => p.kind === "convert" && p.status !== "open" && p.status !== "abolished").length >= 2) return;
  const busy = new Set(Object.values(sim.projects).filter((p) => p.status === "planned" || p.status === "building").flatMap((p) => p.edgeIds));
  const cs = Object.values(sim.edges).filter((e) => modeOf(e) === "rail" && (e.state === "closed" || e.state === "lost") && e.built >= 1 && !e.convertedTo && !busy.has(e.id) && e.lengthKm >= 8).sort((a, b) => (a.id < b.id ? -1 : 1));
  if (!cs.length || rand(sim) > 0.35) return;
  const e = cs[Math.floor(rand(sim) * cs.length)], p = createProject(sim, "convert", e.region, e.a, e.b, [e.id], [{ edgeId: e.id, dir: 1 }], e.lengthKm * 0.35, `廃止された鉄道の跡が使える(${Math.round(e.lengthKm)}km)`, 1.2);
  ev(sim, "project", `廃線跡の転用計画: ${sim.nodes[e.a]?.name ?? "地点"}〜${sim.nodes[e.b]?.name ?? "地点"}(道路へ)`, p.reason, { project: p.id, edge: e.id }); void y;
}
export const MAX_RAIL_PATHFINDS = 5;
const RAIL_UNIT: Record<Standard, number> = { rural: 1.6, standard: 2.8, highgrade: 6 };
const baseName = (n: string) => n.replace(/市$/, "");
/** Railway planning, once a year: new lines where the demand is not served by rail, electrification/high-speed where lines are full, revival where demand returned. */
export function* planRailGen(sim: SimState, w: World, an: Analysis, y: number): Generator<void> {
  const dl = sim.dials; if (dl.railBuild < 0.05) return;
  const live = Object.values(sim.projects).filter((p) => modeOf(p) === "rail" && (p.status === "concept" || p.status === "planned" || p.status === "building" || p.status === "suspended"));
  const liveNew = live.filter((p) => p.kind === "new" && !p.reason.startsWith(LOCAL_TAG)).length, liveUp = live.filter((p) => p.kind !== "new").length, maxNew = 1 + Math.round(dl.railBuild * 2), maxUp = 2 + Math.round(dl.railBuild * 2);
  if (liveNew >= maxNew && liveUp >= maxUp && live.filter((p) => p.reason.startsWith(LOCAL_TAG)).length >= 1 + Math.round(dl.railBuild * 3)) return;
  const busy = new Set(live.flatMap((p) => p.edgeIds)), nc = w.cities.length, cands: (Cand & { op?: string; std?: Standard })[] = [];
  for (const e of Object.values(sim.edges)) {
    if (modeOf(e) !== "rail" || busy.has(e.id) || e.built < 1) continue;
    if (e.state === "open" && e.congYears >= 2 && e.standard !== "highgrade" && (e.standard === "rural" || dl.hsr > 0.4)) cands.push({ score: 3.2 + Math.min(3, (e.through / RAIL_CAPACITY_OF(e)) * 0.3), kind: "electrify", edge: e, reason: `輸送量が容量の${Math.round((e.through / RAIL_CAPACITY_OF(e)) * 100)}%に達し${e.congYears}年混雑(${e.standard === "rural" ? "電化・複線化" : "高速化"})` });
    else if ((e.state === "closed" || e.state === "lost") && e.reviveYears >= 3 && dl.railBuild > 0.3 && !e.convertedTo) cands.push({ score: 2 + (an.potential.get(e.id) ?? 0) / 90, kind: "restore", edge: e, reason: `沿線需要${Math.round(an.potential.get(e.id) ?? 0)}人/日が${e.reviveYears}年続いている` });
  }
  const dens = (c: { pop: number }) => c.pop;
  for (let i = 0; i < nc; i++) for (let j = i + 1; j < nc; j++) {
    const a = w.cities[i], b = w.cities[j]; if (a.island !== b.island) continue; const d = dist(a.pos, b.pos); if (d < 40 || d > 260) continue;
    const tt = an.TT[i * nc + j], tr = an.T[i * nc + j], railSvc = isFinite(tt) ? Math.min(1, d / (tt * 60)) : 0, roadSvc = isFinite(tr) ? Math.min(1, d / (tr * 40)) : 0, svc = Math.max(railSvc, roadSvc * competeWeight(dl, "road")); if (svc > 0.65) continue;
    const pa = dens(sim.cities[a.id]), pb = dens(sim.cities[b.id]), unmet = (Math.pow(pa * pb, 0.65) / Math.pow(d, 1.25)) * (1 - svc) * 1e-3;
    const big = Math.min(pa, pb) > 400000, std: Standard = dl.hsr > 0.45 && y >= 1955 && big && d >= 120 ? "highgrade" : y >= 1960 ? "standard" : "rural";
    cands.push({ score: Math.log10(1 + unmet * 30) * (0.5 + dl.railBuild) + (std === "highgrade" ? 0.5 * dl.hsr : 0), kind: "new", a: i, b: j, std, reason: `${a.name}〜${b.name}間(${Math.round(d)}km)の鉄道が${isFinite(tt) ? `所要${tt.toFixed(1)}時間` : "未整備"}` });
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
  const ranked = [...cands.filter((c) => c.kind === "new" && !c.local).slice(0, 25), ...cands.filter((c) => c.local).slice(0, 8), ...cands.filter((c) => c.kind !== "new").slice(0, 12)].sort((p, q) => q.score - p.score);
  for (const c of ranked) {
    if (nNew >= wantNew && nUp >= wantUp && nLocal >= 1) break;
    if (c.score < 0.25) break;
    if (c.local) { if (nLocal >= 1 || liveLocal + nLocal >= maxLocal) continue; }
    else if (c.kind === "new" ? nNew >= wantNew || liveNew + nNew >= maxNew : nUp >= wantUp || liveUp + nUp >= maxUp) continue;   // new lines and upgrades each get their own quota, so upgrades cannot crowd out new lines for ever
    if (c.edge && (c.kind === "electrify" || c.kind === "restore")) {
      const e = c.edge, cost = e.lengthKm * (c.kind === "restore" ? (e.state === "lost" ? 2.4 : 1.2) : e.standard === "rural" ? 1.3 : 3.2);
      const p = createProject(sim, c.kind, "JP", e.a, e.b, [e.id], [{ edgeId: e.id, dir: 1 }], cost, c.reason, c.score); p.mode = "rail"; p.op = e.op ?? "jnr";
      ev(sim, "project", `${c.kind === "restore" ? "復活計画" : e.standard === "rural" ? "電化・複線化計画" : "高速化計画"}: ${projLabel(sim, p)}`, c.reason, { project: p.id, edge: e.id }); made++; nUp++; yield; continue;
    }
    if ((globalThis as any).__DBG) console.log("cand", c.kind, c.score.toFixed(2), c.a, c.b, "pf", pf, "nNew", nNew, nUp);
    if (c.kind === "new" && c.a !== undefined && (c.b !== undefined || c.toCell !== undefined) && pf-- > 0) {
      const a = w.cities[c.a], aCell = c.fromCell ?? a.cell, aName = c.fromName ?? a.name, b = c.b !== undefined ? w.cities[c.b] : null, bCell = b ? b.cell : c.toCell!, bName = b ? b.name : c.toName ?? "既設線", idx = buildIndex(sim, "rail"), ref = referenceGrids(w), std = c.std ?? "rural";
      const path = pathfind(w, aCell, bCell, { rail: true, ease: crossingEase(sim.tech, y), bias: (k) => refBias(ref.rail)(k) * (idx.roadCells.has(k) ? 1.6 : 1), margin: 16 }); yield; if (!path) continue;   // a new line is a direct one: existing track is not discounted
      const newKm = path.filter((k, q) => q > 0 && !idx.step.has(`${path[q - 1]}:${k}`)).length * w.cell; if ((globalThis as any).__DBG) console.log("try", aName, bName, "newKm", newKm, "len", path.length * w.cell); if (newKm < (c.local ? 6 : 15)) continue;
      const tcR = techCheck(sim, w, "rail", path, y); if (!tcR.ok) continue;   // not buildable with this year's tunnelling (yet)
      const jnrEra = sim.dials.privatize < 0.5, privateOk = !!b && Math.min(sim.cities[a.id].pop, sim.cities[b.id].pop) > 250000 && dist(a.pos, b.pos) < 110, localPrivate = !!c.local && !jnrEra;
      let op = "jnr"; if (c.local && !localPrivate) op = "jnr"; else if (!jnrEra || privateOk) { const anchorIsA = !b || a.pop0 >= b.pop0, id = `p.${anchorIsA ? a.id : b!.id}`, anchor = anchorIsA ? a : b!; if (!sim.operators[id]) sim.operators[id] = { id, name: `${baseName(anchor.name)}${jnrEra ? "電鉄" : "鉄道"}`, kind: "private", since: y, note: "新規参入の鉄道事業者(架空の事業者名)" } as Operator; op = id; }
      const l = layPath(sim, w, path, { facilities: !!sim.stage3, open: false, surface: "paved", quality: 88, built: 0, month: sim.month, standard: std, mode: "rail", op }); if (!l.created.length) continue;
      const es = l.created.map((id) => sim.edges[id]), cost = es.reduce((s2, x) => s2 + x.lengthKm * RAIL_UNIT[std] * (1 + x.maxGradePct * 0.08) * facCost(x, sim), 0);
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
        const idx = buildIndex(sim); if (path.slice(1, -1).some((k) => idx.nodeByCell.has(k) || idx.cellEdge.has(k))) return planImprove(sim, e, region, purse, c);
        const tcB = techCheck(sim, w, "road", path, y); if (!tcB.ok) return planImprove(sim, e, region, purse, c);   // would cut another road: improve in place instead
        const l = layPath(sim, w, path, { facilities: !!sim.stage3, open: false, surface: "paved", quality: 90, built: 0, month: sim.month, standard: target });
        if (l.created.length) {
          const es = l.created.map((id) => sim.edges[id]), cost = es.reduce((s, x) => s + x.lengthKm * UNIT[target] * (1 + x.maxGradePct * 0.03) * facCost(x, sim), 0);
          if (cost > purse * 1.5) { for (const x of es) { x.built = 0; } }  // kept as a (slow) plan; the region's purse decides how long it takes
          const p = createProject(sim, "bypass", region, e.a, e.b, l.created, l.chain, cost, c.reason, c.score, [e.id]); techRoll(sim, p, tcB.hard, y, projLabel(sim, p));
          ev(sim, "project", `バイパス計画: ${projLabel(sim, p)}(${Math.round(es.reduce((s, x) => s + x.lengthKm, 0))}km・${target === "highgrade" ? "高規格" : "2車線"})`, `${c.reason}。同じ区間に新道を計画`, { project: p.id, edge: e.id }); return true;
        }
      }
    }
    return planImprove(sim, e, region, purse, c);
  }
  if (c.kind === "access" && c.vid && canSpend()) {
    const v = sim.settlements[c.vid], city = w.cityById.get(v.city)!; if (!spend()) return false;
    const idx = buildIndex(sim), path = pathfind(w, v.cell, city.cell, { roadCells: idx.roadCells, margin: 12 }); if (!path) return false;
    const newKm = path.filter((k, q) => q > 0 && !idx.step.has(`${path[q - 1]}:${k}`)).length * w.cell; if (newKm < 3 || newKm * 1 > purse) return false;
    const l = layPath(sim, w, path, { facilities: !!sim.stage3, open: false, surface: "gravel", quality: 70, built: 0, month: sim.month, standard: "rural" }); if (!l.created.length) return false;
    const es = l.created.map((id) => sim.edges[id]), a = nodeAtCell(sim, w, idx, v.cell, "village"), cost = es.reduce((s, x) => s + x.lengthKm * 0.8, 0);
    const p = createProject(sim, "access", region, a, nodeAtCell(sim, w, idx, city.cell, "junction"), l.created, l.chain, cost, c.reason, c.score);
    ev(sim, "project", `集落アクセス道の計画: ${v.name}`, c.reason, { project: p.id }); return true;
  }
  if (c.kind === "new" && c.a !== undefined && c.b !== undefined && canSpend()) {
    const a = w.cities[c.a], b = w.cities[c.b]; if (!spend()) return false;
    const idx = buildIndex(sim), path = pathfind(w, a.cell, b.cell, { roadCells: idx.roadCells, ease: crossingEase(sim.tech, y) }); if (!path) return false;
    const tcN = techCheck(sim, w, "road", path, y); if (!tcN.ok) return false;
    const newKm = path.filter((k, q) => q > 0 && !idx.step.has(`${path[q - 1]}:${k}`)).length * w.cell; if (newKm < (c.local ? 5 : 15) || newKm * 1.3 > Math.max(30, purse)) return false;
    const l = layPath(sim, w, path, { facilities: !!sim.stage3, open: false, surface: "gravel", quality: 80, built: 0, month: sim.month, standard: std }); if (!l.created.length) return false;
    const es = l.created.map((id) => sim.edges[id]), cost = es.reduce((s, x) => s + x.lengthKm * UNIT[std] * (1 + x.maxGradePct * 0.03) * facCost(x, sim), 0);
    const reg = a.pref === b.pref ? region : "JP";
    const p = createProject(sim, "new", reg, nodeAtCell(sim, w, idx, a.cell, "junction"), nodeAtCell(sim, w, idx, b.cell, "junction"), l.created, l.chain, cost, c.reason, c.score); if (sim.stage3) p.status = "concept"; techRoll(sim, p, tcN.hard, y, `${a.name}〜${b.name}`);
    ev(sim, "project", `${sim.stage3 ? "新規構想" : "新規計画"}: ${a.name}〜${b.name}(${Math.round(es.reduce((s, x) => s + x.lengthKm, 0))}km)`, c.reason, { project: p.id }); return true;
  }
  return false;
}
function planImprove(sim: SimState, e: SimEdge, region: string, purse: number, c: Cand): boolean {
  const target: Standard = e.standard === "rural" ? "standard" : "highgrade", cost = e.lengthKm * UNIT[target] * 0.6; if (cost > purse * 1.5) return false;
  const p = createProject(sim, "improve", region, e.a, e.b, [e.id], [{ edgeId: e.id, dir: 1 }], cost, c.reason, c.score);
  ev(sim, "project", `改良計画: ${nodeName(sim, e.a)}〜${nodeName(sim, e.b)}(${target === "standard" ? "2車線化" : "高規格化"})`, c.reason, { project: p.id, edge: e.id }); return true;
}
void rand;
