/**
 * Monthly road-network simulation. Pure and deterministic: (sim, world) -> sim, with all randomness drawn from sim.rngState.
 * Every state change that matters appends an event carrying its cause, so "why did this road die" can be answered.
 * All demand figures are SYNTHETIC (derived from city sizes and a toy economy), not statistics.
 */
import { MinHeap } from "../core/heap";
import { dist } from "../core/geom";
import { JAPAN } from "../core/data";
import { layPath, newId, buildIndex, checkIntegrity } from "./network";
import { ERA, FU_PREFS, GRADE_LABEL, ymLabel, monthToYM, type Grade, type SimEdge, type SimProject, type SimRoute, type SimState, type Surface, type RouteEdgeRef } from "./types";
import { cellDistKm, pathfind, type World } from "./world";

export const MONTHS_PER_YEAR_X1_MS = 60000;       // x1: one real minute is one game year
export const MS_PER_MONTH_X1 = MONTHS_PER_YEAR_X1_MS / 12;
export const CATCHUP_CAP_MONTHS = 360;            // at most 30 years are simulated on return; the rest is reported as skipped
export const EVENT_CAP = 600;
const BUDGET_K = 3.0e-7, MAX_ACTIVE = 3;
const MAINT: Record<Surface, number> = { unpaved: 0.0045, gravel: 0.0065, paved: 0.01 };
const DECAY: Record<Surface, number> = { unpaved: 0.2, gravel: 0.14, paved: 0.07 };
const SPEED: Record<Surface, number> = { unpaved: 18, gravel: 28, paved: 45 };

// ---- randomness / ids / events ----
export function rand(sim: SimState): number {
  sim.rngState = (sim.rngState + 0x6d2b79f5) >>> 0; let t = sim.rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export function hashString(s: string): string { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h.toString(16); }
export function simHash(sim: SimState): string {
  return hashString(JSON.stringify([sim.month, sim.rngState, sim.nodes, sim.edges, sim.routes, sim.projects, sim.cities, sim.macro, sim.routeCounters, sim.events.length, sim.skippedMonths]));
}
export function ev(sim: SimState, kind: string, text: string, cause: string, refs: Record<string, string> = {}) {
  sim.events.push({ id: ++sim.next.event, month: sim.month, kind, text, cause, refs });
  if (sim.events.length > EVENT_CAP) sim.events.splice(0, sim.events.length - EVENT_CAP);
}
export const prefName = (id: string) => JAPAN.prefectures.find((p) => p.id === id)?.name ?? id;
export const routeLabel = (r: SimRoute) => `${r.scope === "JP" ? "" : prefName(r.scope) + " "}${GRADE_LABEL[r.grade]}${r.number}号`;
const yearOf = (sim: SimState) => monthToYM(sim.startYear, sim.month).year;

export function createSim(w: World, mapHash: string, terrainHash: string, seed: number): SimState {
  const sim: SimState = {
    schemaVersion: 1, mapHash, terrainHash, seed: seed >>> 0, era: ERA.key, startYear: 1950, month: 0, rngState: (seed ^ 0xa5a5a5a5) >>> 0, speed: 0,
    next: { node: 0, edge: 0, route: 0, project: 0, event: 0 }, nodes: {}, edges: {}, routes: {}, projects: {}, cities: {},
    macro: { mood: 0, budgetBu: 0, maintCoverage: 1 }, routeCounters: {}, events: [], stats: [], skippedMonths: 0, lastWallMs: 0, ceremonyDone: false,
  };
  for (const c of w.cities) sim.cities[c.id] = { pop: c.pop0, popSource: c.popSource, lowAccessYears: 0, industry: Math.round((0.25 + 0.3 * (c.coastal ? 1 : 0) + 0.25 * c.plains + 0.1 * rand(sim)) * 1000) / 1000 };
  return sim;
}
export function issueNumber(sim: SimState, grade: Grade, scope: string): number { const k = `${grade}:${scope}`; return (sim.routeCounters[k] = (sim.routeCounters[k] ?? 0) + 1); }
export function designate(sim: SimState, chain: RouteEdgeRef[], grade: Grade, scope: string, text: string, cause: string): SimRoute | null {
  if (!chain.length) return null;
  const id = newId(sim, "route"), number = issueNumber(sim, grade, scope);
  const r: SimRoute = { id, scope, grade, number, name: `${GRADE_LABEL[grade]}${number}号`, edges: chain.map((c) => ({ ...c })), since: sim.month, active: true, lowYears: 0, highYears: 0, history: [{ month: sim.month, grade, number, text }] };
  sim.routes[id] = r; ev(sim, "route", `${routeLabel(r)}を指定: ${text}`, cause, { route: id }); return r;
}

// ---- graph analysis ----
interface Analysis { cityNodes: (string | null)[]; T: Float64Array; acc: number[]; edgeTraffic: Map<string, number> }
const edgeSpeed = (e: SimEdge) => SPEED[e.surface] * (0.5 + 0.5 * e.quality / 100) * (1 - Math.min(0.4, e.maxGradePct / 50));
function analyze(sim: SimState, w: World): Analysis {
  const idx = buildIndex(sim), nodeIds = Object.keys(sim.nodes), pos = new Map(nodeIds.map((id, i) => [id, i]));
  const adj: { to: number; edge: string; t: number }[][] = nodeIds.map(() => []);
  for (const e of Object.values(sim.edges)) if (e.open && !e.lost && e.built >= 1) { const a = pos.get(e.a)!, b = pos.get(e.b)!, t = e.lengthKm / edgeSpeed(e); adj[a].push({ to: b, edge: e.id, t }); adj[b].push({ to: a, edge: e.id, t }); }
  const cityNodes = w.cities.map((c) => idx.nodeByCell.get(c.cell) ?? null), nc = w.cities.length, T = new Float64Array(nc * nc).fill(Infinity);
  const edgeTraffic = new Map<string, number>(); const prevEdge: Int32Array[] = [];
  for (let i = 0; i < nc; i++) {
    const src = cityNodes[i]; const dnode = new Float64Array(nodeIds.length).fill(Infinity), pe = new Int32Array(nodeIds.length).fill(-1), pn = new Int32Array(nodeIds.length).fill(-1);
    const eIds: string[] = new Array(nodeIds.length).fill("");
    if (src) {
      const s = pos.get(src)!, h = new MinHeap(64); dnode[s] = 0; h.push(0, s);
      while (h.size) { const { key, val } = h.pop(); if (key > dnode[val]) continue; for (const a of adj[val]) { const nd = key + a.t; if (nd < dnode[a.to]) { dnode[a.to] = nd; pn[a.to] = val; eIds[a.to] = a.edge; h.push(nd, a.to); } } }
      for (let j = 0; j < nc; j++) if (j !== i && cityNodes[j]) T[i * nc + j] = dnode[pos.get(cityNodes[j]!)!];
      for (let j = i + 1; j < nc; j++) {
        const cn = cityNodes[j]; if (!cn || !isFinite(dnode[pos.get(cn)!])) continue;
        const t = dnode[pos.get(cn)!], flow = Math.pow(sim.cities[w.cities[i].id].pop * sim.cities[w.cities[j].id].pop, 0.6) * 1e-3 / (1 + Math.pow(t, 1.2));
        for (let k = pos.get(cn)!; pn[k] >= 0; k = pn[k]) edgeTraffic.set(eIds[k], (edgeTraffic.get(eIds[k]) ?? 0) + flow);
      }
    }
    prevEdge.push(pe);
  }
  const popTot = w.cities.reduce((s, c) => s + sim.cities[c.id].pop, 0), acc: number[] = [];
  for (let i = 0; i < nc; i++) { let s = 0; for (let j = 0; j < nc; j++) if (j !== i) { const t = T[i * nc + j]; if (isFinite(t)) s += sim.cities[w.cities[j].id].pop * Math.exp(-t / 3); } acc.push(popTot ? s / popTot : 0); }
  return { cityNodes, T, acc, edgeTraffic };
}

// ---- macro economy (toy) ----
const macroBudget = (y: number) => Math.pow(1.06, Math.min(y, 1973) - 1950) * Math.pow(1.02, Math.max(0, Math.min(y, 1990) - 1973)) * Math.pow(0.97, Math.max(0, y - 2000));
function popRate(y: number, pop: number): number {
  let r = y < 1975 ? 0.012 : y < 1990 ? 0.004 : y < 2000 ? 0 : -0.006;
  if (pop > 1e6 && y < 1990) r += 0.008; if (pop < 1.5e5 && y >= 1955 && y < 1985) r -= 0.006; if (pop < 3e5 && y >= 2000) r -= 0.01; return r;
}
const unitCost = (e: SimEdge) => 1 + e.maxGradePct * 0.03;

// ---- yearly decisions ----
function yearly(sim: SimState, w: World) {
  const y = yearOf(sim), an = analyze(sim, w), nc = w.cities.length;
  // 1) cities react to how well they are connected
  w.cities.forEach((c, i) => {
    const st = sim.cities[c.id], before = st.pop;
    const g = popRate(y, st.pop) + 0.012 * (an.acc[i] - 0.4) + (rand(sim) - 0.5) * 0.008;
    st.pop = Math.max(2000, Math.round(st.pop * (1 + g)));
    const target = Math.min(1, 0.2 + 0.35 * (c.coastal ? 1 : 0) + 0.2 * c.plains + 0.9 * an.acc[i]); st.industry = Math.round((st.industry + (target - st.industry) * 0.1) * 1000) / 1000;
    st.lowAccessYears = an.acc[i] < 0.02 ? st.lowAccessYears + 1 : 0;
    const base = c.pop0; if (before < 2 * base && st.pop >= 2 * base) ev(sim, "city", `${c.name}の人口が1950年の2倍に`, an.acc[i] > 0.1 ? "道路網で結ばれ産業が集積" : "全国的な人口増", { city: c.id });
    if (before > 0.7 * base && st.pop <= 0.7 * base) ev(sim, "city", `${c.name}の人口が3割減`, st.lowAccessYears > 3 ? "幹線から外れ孤立" : "人口減少局面", { city: c.id });
  });
  // 2) traffic, closures, wear
  const open = Object.values(sim.edges).filter((e) => e.open && !e.lost), mean = open.length ? [...an.edgeTraffic.values()].reduce((s, v) => s + v, 0) / open.length : 0;
  for (const e of Object.values(sim.edges)) e.traffic = Math.round((an.edgeTraffic.get(e.id) ?? 0) * 1e6) / 1e6;
  for (const e of open) {
    e.lowYears = e.traffic < 0.15 * mean ? e.lowYears + 1 : 0;
    if (e.lowYears >= 6 && e.quality < 45 && !isBridgeToCity(sim, w, e)) { e.open = false; ev(sim, "close", `道路区間${e.id}を廃止`, `交通量が${e.lowYears}年連続で平均の15%未満、品質${Math.round(e.quality)}`, { edge: e.id }); }
  }
  // 3) routes: promotion / demotion / retirement
  for (const r of Object.values(sim.routes)) if (r.active) {
    const es = r.edges.map((x) => sim.edges[x.edgeId]), km = es.reduce((s, e) => s + e.lengthKm, 0) || 1, per = es.reduce((s, e) => s + e.traffic * e.lengthKm, 0) / km;
    if (!es.some((e) => e.open)) { r.active = false; ev(sim, "route", `${routeLabel(r)}を廃止`, "全区間が廃止または廃道", { route: r.id }); continue; }
    r.lowYears = per < 0.4 * mean ? r.lowYears + 1 : 0; r.highYears = per > 1.3 * mean ? r.highYears + 1 : 0;
    const prefs = routePrefs(w, es);
    if (r.grade === "national" && r.lowYears >= 6) {
      if (prefs.size === 1) { const p = [...prefs][0], g: Grade = FU_PREFS.has(p) ? "fu" : "ken", old = routeLabel(r); r.grade = g; r.scope = p; r.number = issueNumber(sim, g, p); r.name = `${GRADE_LABEL[g]}${r.number}号`; r.lowYears = 0; r.history.push({ month: sim.month, grade: g, number: r.number, text: "降格" }); ev(sim, "demote", `${old}が${routeLabel(r)}に降格`, "交通量が6年連続で低迷", { route: r.id }); }
      else { r.active = false; ev(sim, "route", `${routeLabel(r)}の指定を解除`, "交通量低迷かつ複数府県にまたがり降格先がない", { route: r.id }); }
    } else if (r.grade !== "national" && r.highYears >= 5 && km >= 40 && Object.values(sim.routes).filter((q) => q.active && q.grade === "national").length < 60) {
      const old = routeLabel(r); r.grade = "national"; r.scope = "JP"; r.number = issueNumber(sim, "national", "JP"); r.name = `酷道${r.number}号`; r.highYears = 0; r.history.push({ month: sim.month, grade: "national", number: r.number, text: "昇格" });
      ev(sim, "promote", `${old}が${routeLabel(r)}に昇格`, "交通量が5年連続で平均の1.3倍超", { route: r.id });
    }
  }
  // 4) suspended / unbuilt projects may resume when the budget has slack
  const slack = sim.macro.maintCoverage >= 1 && sim.macro.budgetBu > 0;
  for (const p of Object.values(sim.projects)) {
    if ((p.status === "suspended" || p.status === "unbuilt") && slack && rand(sim) < (p.status === "suspended" ? 0.5 : 0.12)) { const was = p.status; p.status = "building"; p.stallMonths = 0; p.statusSince = sim.month; ev(sim, "project", `${was === "unbuilt" ? "未成線" : "中断中"}の工事を再開(${projLabel(sim, p)})`, "維持費を賄ってなお予算に余力", { project: p.id }); }
    if (p.status === "unbuilt" && sim.month - p.statusSince >= 360) { p.status = "abolished"; p.statusSince = sim.month; for (const id of p.edgeIds) { const e = sim.edges[id]; if (e && e.built < 1) e.lost = true; } ev(sim, "project", `未成線を計画ごと廃止(${projLabel(sim, p)})`, "30年間着工されず", { project: p.id }); }
  }
  // 5) plan new links and upgrades
  const active = Object.values(sim.projects).filter((p) => p.status === "planned" || p.status === "building").length;
  if (active < MAX_ACTIVE + (y >= 1965 ? 1 : 0) && sim.macro.budgetBu > 0) planNew(sim, w, an, nc);
  planUpgrade(sim, w, y);
  const edges = Object.values(sim.edges), routes = Object.values(sim.routes).filter((r) => r.active);
  sim.stats.push({ year: y, routes: routes.length, km: Math.round(edges.filter((e) => e.open && !e.lost).reduce((s, e) => s + e.lengthKm, 0)), building: Object.values(sim.projects).filter((p) => p.status === "building" || p.status === "planned").length, unbuilt: Object.values(sim.projects).filter((p) => p.status === "unbuilt" || p.status === "suspended").length, open: edges.filter((e) => e.open && !e.lost).length, lost: edges.filter((e) => e.lost).length, budget: Math.round(sim.macro.budgetBu * 100) / 100 });
  if (sim.stats.length > 160) sim.stats.shift();
}
const projLabel = (sim: SimState, p: SimProject) => `${sim.nodes[p.from]?.name ?? "地点"}〜${sim.nodes[p.to]?.name ?? "地点"}`;
function routePrefs(w: World, es: SimEdge[]): Set<string> { const s = new Set<string>(); for (const e of es) for (const k of e.cells) { const p = w.prefOf(k); if (p) s.add(p); } return s; }
function isBridgeToCity(sim: SimState, w: World, e: SimEdge): boolean {
  // would closing e strand a city node (degree 1 in the open network)?
  for (const nid of [e.a, e.b]) { const n = sim.nodes[nid]; if (n.kind !== "city") continue; let deg = 0; for (const o of Object.values(sim.edges)) if (o.open && !o.lost && (o.a === nid || o.b === nid)) deg++; if (deg <= 1) return true; }
  return false;
}
function planNew(sim: SimState, w: World, an: Analysis, nc: number) {
  const cands: { i: number; j: number; score: number }[] = [];
  for (let i = 0; i < nc; i++) for (let j = i + 1; j < nc; j++) {
    const a = w.cities[i], b = w.cities[j]; if (a.island !== b.island) continue;
    const d = dist(a.pos, b.pos); if (d < 40 || d > 450) continue;
    const pa = sim.cities[a.id].pop, pb = sim.cities[b.id].pop, potential = Math.pow(pa * pb, 0.7) / Math.pow(d, 1.2), t = an.T[i * nc + j];
    const service = isFinite(t) ? Math.min(1, d / (t * 40)) : 0;
    if (service > 0.6) continue;
    cands.push({ i, j, score: (potential * (1 - service)) / (d * 1.3 + 10) });
  }
  cands.sort((p, q) => q.score - p.score || p.i - q.i || p.j - q.j);
  const idx = buildIndex(sim);
  let tried = 0;
  for (const c of cands.slice(0, 40)) {
    if (tried >= 8) break;
    const a = w.cities[c.i], b = w.cities[c.j], path = pathfind(w, a.cell, b.cell, { roadCells: idx.roadCells }); if (!path) continue;
    const newKm = path.filter((k, q) => q > 0 && !idx.step.has(`${path[q - 1]}:${k}`)).length * w.cell; if (newKm < 25) continue;
    const est = newKm * 1.3; if (est > Math.max(30, sim.macro.budgetBu * 60)) continue;
    const { chain, created } = layPath(sim, w, path, { open: false, surface: "gravel", quality: 80, built: 0, month: sim.month }); if (!created.length) continue;
    const id = newId(sim, "project"), edges = created.map((e) => sim.edges[e]), cost = Math.round(edges.reduce((s, e) => s + e.lengthKm * unitCost(e), 0) * 100) / 100;
    const na = sim.nodes[idx.nodeByCell.get(a.cell) ?? ""] ?? Object.values(sim.nodes).find((n) => n.cell === a.cell)!, nb = Object.values(sim.nodes).find((n) => n.cell === b.cell)!;
    sim.projects[id] = { id, kind: "new", from: na.id, to: nb.id, edgeIds: created, chain, costBu: cost, spentBu: 0, status: "planned", startMonth: sim.month, stallMonths: 0, statusSince: sim.month, routeId: null, reason: `${a.name}〜${b.name}間の需要に対し交通が不足`, priority: c.score };
    ev(sim, "project", `新規計画: ${a.name}〜${b.name}(${Math.round(created.reduce((s, e) => s + sim.edges[e].lengthKm, 0))}km)`, `需要(人口${Math.round(sim.cities[a.id].pop / 1000)}千×${Math.round(sim.cities[b.id].pop / 1000)}千)に対し所要時間${isFinite(an.T[c.i * nc + c.j]) ? an.T[c.i * nc + c.j].toFixed(1) + "h" : "未接続"}`, { project: id });
    return;
  }
}
function planUpgrade(sim: SimState, w: World, y: number) {
  if (y < 1953) return;
  const busy = new Set(Object.values(sim.projects).filter((p) => p.kind === "upgrade" && (p.status === "planned" || p.status === "building" || p.status === "suspended")).flatMap((p) => p.edgeIds));
  const cand = Object.values(sim.edges).filter((e) => e.open && !e.lost && e.surface !== "paved" && !busy.has(e.id) && e.traffic > 0).sort((a, b) => b.traffic - a.traffic || (a.id < b.id ? -1 : 1))[0];
  if (!cand || cand.quality > 75) return;
  const id = newId(sim, "project");
  sim.projects[id] = { id, kind: "upgrade", from: cand.a, to: cand.b, edgeIds: [cand.id], chain: [{ edgeId: cand.id, dir: 1 }], costBu: Math.round(cand.lengthKm * 0.5 * 100) / 100, spentBu: 0, status: "planned", startMonth: sim.month, stallMonths: 0, statusSince: sim.month, routeId: null, reason: "交通量が多く未舗装/砂利のため舗装化", priority: cand.traffic };
  ev(sim, "project", `舗装化計画: ${sim.nodes[cand.a].name ?? cand.a}〜${sim.nodes[cand.b].name ?? cand.b}`, `交通量が多く品質${Math.round(cand.quality)}`, { project: id, edge: cand.id });
}

// ---- monthly ----
function monthly(sim: SimState, w: World) {
  const y = yearOf(sim);
  if (sim.month % 12 === 0) { sim.macro.mood = Math.max(-1, Math.min(1, sim.macro.mood * 0.6 + (rand(sim) - 0.5) * 0.8)); }
  const econ = Object.values(sim.cities).reduce((s, c) => s + c.pop * c.industry, 0), eraBias = ERA.key === "kobun" ? 0.02 : 0;
  const budget = BUDGET_K * econ * macroBudget(y) * (1 + 0.15 * sim.macro.mood + eraBias); sim.macro.budgetBu = Math.round(budget * 1e4) / 1e4;
  // maintenance first, most-travelled roads first
  const open = Object.values(sim.edges).filter((e) => e.open && !e.lost).sort((a, b) => b.traffic - a.traffic || (a.id < b.id ? -1 : 1));
  let left = budget, need = 0, funded = 0;
  for (const e of open) {
    const cost = e.lengthKm * MAINT[e.surface] * (e.quality < 50 ? 1.5 : 1); need += cost;
    const ok = left >= cost; if (ok) { left -= cost; funded += cost; }
    const decay = DECAY[e.surface] * (1 + e.maxGradePct / 15);
    if (ok) { e.quality = Math.min(100, e.quality + 0.3 - 0.3 * decay); e.weathering = Math.max(0, e.weathering - 0.08); }
    else { e.quality = Math.max(0, e.quality - decay * 2); e.weathering = Math.min(100, e.weathering + 0.04 + (e.quality < 40 ? 0.08 : 0) + (e.lowYears > 0 ? 0.05 : 0)); }
    if (e.weathering >= 100) { e.lost = true; e.open = false; ev(sim, "lost", `道路区間${e.id}が廃道化`, `維持費が賄えず風化が進行(品質${Math.round(e.quality)})`, { edge: e.id }); }
  }
  sim.macro.maintCoverage = need > 0 ? funded / need : 1;
  for (const e of Object.values(sim.edges)) if (!e.open && !e.lost) { e.weathering = Math.min(100, e.weathering + (e.built >= 1 ? 0.3 : 0.03)); if (e.weathering >= 100) { e.lost = true; ev(sim, "lost", `道路区間${e.id}が廃道化`, "供用されないまま風化", { edge: e.id }); } }
  // construction with what is left
  const proj = Object.values(sim.projects).filter((p) => p.status === "planned" || p.status === "building").sort((a, b) => b.priority - a.priority || (a.id < b.id ? -1 : 1));
  for (const p of proj) {
    const totLen = p.edgeIds.reduce((s, id) => s + (sim.edges[id]?.lengthKm ?? 0), 0) || 1, req = Math.max(0.0001, p.costBu / Math.max(24, totLen * 0.8));
    const f = Math.min(req, Math.max(0, left)); left -= f;
    if (p.status === "planned" && f > 0) { p.status = "building"; p.statusSince = sim.month; ev(sim, "project", `着工: ${projLabel(sim, p)}`, "予算が確保された", { project: p.id }); }
    if (p.status !== "building") continue;
    p.spentBu += f; let amt = f;
    if (p.kind === "upgrade") {
      p.stallMonths = f < 0.25 * req ? p.stallMonths + 1 : 0;
      if (p.spentBu >= p.costBu - 1e-9) { const e = sim.edges[p.edgeIds[0]]; if (e && e.open && !e.lost) { e.surface = "paved"; e.quality = 95; } p.status = "open"; p.statusSince = sim.month; completeProject(sim, w, p); }
      else if (p.stallMonths >= 36) { p.status = "suspended"; p.statusSince = sim.month; ev(sim, "project", `舗装化を中断: ${projLabel(sim, p)}`, "予算不足が36か月続いた", { project: p.id }); }
      continue;
    }
    for (const id of p.edgeIds) { const e = sim.edges[id]; if (!e || e.built >= 1) continue; const ec = p.costBu * e.lengthKm / totLen, add = Math.min(amt / ec, 1 - e.built); e.built = Math.min(1, e.built + add); amt -= add * ec; if (e.built >= 1) { e.built = 1; e.open = true; e.builtMonth = sim.month; if (y >= 1965) { e.surface = "paved"; e.quality = 90; } } if (amt <= 1e-9) break; }
    p.stallMonths = f < 0.25 * req ? p.stallMonths + 1 : 0;
    if (p.edgeIds.every((id) => (sim.edges[id]?.built ?? 1) >= 1)) { p.status = "open"; p.statusSince = sim.month; completeProject(sim, w, p); }
    else if (p.stallMonths >= 36) { p.status = "suspended"; p.statusSince = sim.month; ev(sim, "project", `工事中断: ${projLabel(sim, p)}`, `予算不足が36か月続いた(維持費充足率${Math.round(sim.macro.maintCoverage * 100)}%)`, { project: p.id }); }
  }
  for (const p of Object.values(sim.projects)) if (p.status === "suspended" && sim.month - p.statusSince >= 96) { p.status = "unbuilt"; p.statusSince = sim.month; ev(sim, "project", `未成線化: ${projLabel(sim, p)}`, "中断から8年経過しても再開されない", { project: p.id }); }
  for (const p of Object.values(sim.projects)) if (p.status === "suspended" || p.status === "unbuilt") for (const id of p.edgeIds) { const e = sim.edges[id]; if (e && e.built < 1 && !e.lost) e.weathering = Math.min(100, e.weathering + 0.03); }
}
function completeProject(sim: SimState, w: World, p: SimProject) {
  if (p.kind === "upgrade") { ev(sim, "project", `舗装化が完了: ${projLabel(sim, p)}`, "予算を投入", { project: p.id }); return; }
  const es = p.chain.map((c) => sim.edges[c.edgeId]).filter(Boolean), prefs = routePrefs(w, es), km = es.reduce((s, e) => s + e.lengthKm, 0);
  let r: SimRoute | null;
  if (prefs.size > 1 || km >= 120) r = designate(sim, p.chain, "national", "JP", `${projLabel(sim, p)}`, prefs.size > 1 ? "複数府県にまたがる" : "延長120km以上");
  else { const pf = [...prefs][0] ?? "JP-13"; r = designate(sim, p.chain, FU_PREFS.has(pf) ? "fu" : "ken", pf, `${projLabel(sim, p)}`, "単一府県内の路線"); }
  p.routeId = r?.id ?? null; ev(sim, "open", `供用開始: ${projLabel(sim, p)}`, `工事費${p.costBu.toFixed(1)}を投入`, { project: p.id });
}

export function stepMonth(sim: SimState, w: World) {
  if (sim.month % 12 === 0) yearly(sim, w);
  monthly(sim, w); sim.month++;
}
export function advance(sim: SimState, w: World, months: number) { for (let i = 0; i < months; i++) stepMonth(sim, w); }
/** How many months to simulate after being away: capped, with the rest reported rather than silently dropped. */
export function planCatchUp(elapsedWallMs: number, speed: number): { months: number; skipped: number } {
  if (!(elapsedWallMs > 0) || speed <= 0) return { months: 0, skipped: 0 };
  const raw = Math.floor((elapsedWallMs * speed) / MS_PER_MONTH_X1); return { months: Math.min(raw, CATCHUP_CAP_MONTHS), skipped: Math.max(0, raw - CATCHUP_CAP_MONTHS) };
}
export function noteSkipped(sim: SimState, skipped: number) {
  if (skipped > 0) { sim.skippedMonths += skipped; ev(sim, "skip", `放置により${Math.floor(skipped / 12)}年${skipped % 12}か月分の経過を省略`, `復帰時の集約計算は上限${CATCHUP_CAP_MONTHS / 12}年`, {}); }
}
export function summary(sim: SimState) {
  const edges = Object.values(sim.edges), routes = Object.values(sim.routes).filter((r) => r.active), open = edges.filter((e) => e.open && !e.lost);
  const q = (lo: number, hi: number) => open.filter((e) => e.quality >= lo && e.quality < hi).length;
  return {
    ym: ymLabel(sim.startYear, sim.month), routes: routes.length, km: Math.round(open.reduce((s, e) => s + e.lengthKm, 0)),
    building: Object.values(sim.projects).filter((p) => p.status === "building" || p.status === "planned").length,
    unbuilt: Object.values(sim.projects).filter((p) => p.status === "unbuilt" || p.status === "suspended").length,
    good: q(60, 101), fair: q(30, 60), poor: q(0, 30), lost: edges.filter((e) => e.lost).length, closed: edges.filter((e) => !e.open && !e.lost && e.built >= 1).length,
  };
}
export { checkIntegrity, cellDistKm };
