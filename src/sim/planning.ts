/**
 * Yearly planning. Every prefecture keeps its own queue and purse, so many regions build at the same time.
 * Cost control ("performance budget"): at most MAX_PATHFINDS route searches per year, regions take turns.
 */
import { dist } from "../core/geom";
import { buildIndex, layPath, newId, nodeAtCell } from "./network";
import { ev, projLabel, rand } from "./engine";
import { CAPACITY, type Analysis } from "./demand";
import { KIND_LABEL, type ProjectKind, type SimEdge, type SimProject, type SimState, type Standard } from "./types";
import { pathfind, type World } from "./world";

export const MAX_PATHFINDS = 12, REGIONS_PER_YEAR = 14, MAX_ACTIVE_PER_REGION = 2;
const UNIT: Record<Standard, number> = { rural: 1, standard: 1.8, highgrade: 4 };
interface Cand { score: number; kind: ProjectKind; edge?: SimEdge; vid?: string; a?: number; b?: number; reason: string }

export function activeProjects(sim: SimState) { return Object.values(sim.projects).filter((p) => p.status === "planned" || p.status === "building" || p.status === "suspended"); }
export function createProject(sim: SimState, kind: ProjectKind, region: string, from: string, to: string, edgeIds: string[], chain: SimProject["chain"], cost: number, reason: string, priority: number, replaces: string[] = []): SimProject {
  const id = newId(sim, "project");
  const p: SimProject = { id, kind, region, replaces, from, to, edgeIds, chain, costBu: Math.round(cost * 100) / 100, spentBu: 0, status: "planned", startMonth: sim.month, stallMonths: 0, statusSince: sim.month, routeId: null, reason, priority };
  sim.projects[id] = p; return p;
}
const nodeName = (sim: SimState, id: string) => sim.nodes[id]?.name ?? "地点";

export function* planYearGen(sim: SimState, w: World, an: Analysis, y: number): Generator<void> {
  const regions = w.t.prefOrder, n = regions.length, B = sim.macro.budgetBu; let pf = MAX_PATHFINDS;
  const start = ((y - sim.startYear) * REGIONS_PER_YEAR) % n, slice = Array.from({ length: REGIONS_PER_YEAR }, (_, i) => regions[(start + i) % n]);
  const live = activeProjects(sim), busy = new Set(live.flatMap((p) => p.edgeIds)), perRegion = new Map<string, number>();
  for (const p of live) if (p.status !== "suspended") perRegion.set(p.region, (perRegion.get(p.region) ?? 0) + 1);
  const edgesBy = new Map<string, SimEdge[]>(); for (const e of Object.values(sim.edges)) (edgesBy.get(e.region) ?? edgesBy.set(e.region, []).get(e.region)!).push(e);
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
      else if (e.state === "open" && e.surface !== "paved" && d >= 150 && e.quality < 80) cands.push({ score: 1 + d / 400, kind: "upgrade", edge: e, reason: `需要${Math.round(d)}台/日で未舗装・砂利のため舗装化` });
      else if ((e.state === "closed" || e.state === "lost") && e.reviveYears >= 3 && e.region === r) cands.push({ score: 2.5 + (an.potential.get(e.id) ?? 0) / 60, kind: "restore", edge: e, reason: `沿線需要${Math.round(an.potential.get(e.id) ?? 0)}台/日が${e.reviveYears}年続いている` });
    }
    for (const i of cityBy.get(r) ?? []) for (let j = 0; j < nc; j++) {
      const a = w.cities[i], b = w.cities[j]; if (j === i || a.island !== b.island) continue; const d = dist(a.pos, b.pos); if (d < 30 || d > 160) continue;
      const t = an.T[i * nc + j], service = isFinite(t) ? Math.min(1, d / (t * 40)) : 0; if (service > 0.6) continue;
      const unmet = (Math.pow(sim.cities[a.id].pop * sim.cities[b.id].pop, 0.7) / Math.pow(d, 1.2)) * (1 - service) / (d * 1.3 + 10);
      cands.push({ score: Math.log10(1 + unmet) * 1.2, kind: "new", a: i, b: j, reason: `${a.name}〜${b.name}間の需要に対し${isFinite(t) ? `所要時間${t.toFixed(1)}h` : "未接続"}` });
    }
    cands.sort((p, q) => q.score - p.score || (p.kind < q.kind ? -1 : 1)); let made = false;
    for (const c of cands.slice(0, 6)) { if (made) break; made = tryPlan(sim, w, c, r, purse, () => pf-- > 0, () => pf > 0, y); }
    yield;   // one region per slice: keeps every main-thread task short
    if (pf <= 0) break;
  }
}
function tryPlan(sim: SimState, w: World, c: Cand, region: string, purse: number, spend: () => boolean, canSpend: () => boolean, y: number): boolean {
  const std: Standard = y >= 1965 ? "standard" : "rural";
  if (c.kind === "upgrade" && c.edge) { const e = c.edge, cost = e.lengthKm * 0.5; if (cost > purse) return false; const p = createProject(sim, "upgrade", region, e.a, e.b, [e.id], [{ edgeId: e.id, dir: 1 }], cost, c.reason, c.score); ev(sim, "project", `舗装化計画: ${projLabel(sim, p)}(${KIND_LABEL.upgrade})`, c.reason, { project: p.id, edge: e.id }); return true; }
  if (c.kind === "restore" && c.edge) { const e = c.edge, cost = e.lengthKm * (e.state === "lost" ? 1.2 : 0.4); if (cost > purse) return false; const p = createProject(sim, "restore", region, e.a, e.b, [e.id], [{ edgeId: e.id, dir: 1 }], cost, c.reason, c.score); ev(sim, "project", `復旧計画: ${projLabel(sim, p)}`, c.reason, { project: p.id, edge: e.id }); return true; }
  if ((c.kind === "improve" || c.kind === "bypass") && c.edge) {
    const e = c.edge, target: Standard = e.standard === "rural" ? "standard" : "highgrade";
    if (c.kind === "bypass" && canSpend()) {
      const old = new Set(e.cells.slice(1, -1)), near = new Set<number>(); for (const k of old) near.add(k);
      if (!spend()) return false;
      const path = pathfind(w, e.cells[0], e.cells[e.cells.length - 1], { bias: (k) => (near.has(k) ? 3 : 1), margin: 12 });
      const shared = path ? path.filter((k) => old.has(k)).length : 99;
      if (path && shared === 0 && path.length >= 3) {
        const idx = buildIndex(sim); if (path.slice(1, -1).some((k) => idx.nodeByCell.has(k) || idx.cellEdge.has(k))) return planImprove(sim, e, region, purse, c);   // would cut another road: improve in place instead
        const l = layPath(sim, w, path, { open: false, surface: "paved", quality: 90, built: 0, month: sim.month, standard: target });
        if (l.created.length) {
          const es = l.created.map((id) => sim.edges[id]), cost = es.reduce((s, x) => s + x.lengthKm * UNIT[target] * (1 + x.maxGradePct * 0.03), 0);
          if (cost > purse * 1.5) { for (const x of es) { x.built = 0; } }  // kept as a (slow) plan; the region's purse decides how long it takes
          const p = createProject(sim, "bypass", region, e.a, e.b, l.created, l.chain, cost, c.reason, c.score, [e.id]);
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
    const l = layPath(sim, w, path, { open: false, surface: "gravel", quality: 70, built: 0, month: sim.month, standard: "rural" }); if (!l.created.length) return false;
    const es = l.created.map((id) => sim.edges[id]), a = nodeAtCell(sim, w, idx, v.cell, "village"), cost = es.reduce((s, x) => s + x.lengthKm * 0.8, 0);
    const p = createProject(sim, "access", region, a, nodeAtCell(sim, w, idx, city.cell, "junction"), l.created, l.chain, cost, c.reason, c.score);
    ev(sim, "project", `集落アクセス道の計画: ${v.name}`, c.reason, { project: p.id }); return true;
  }
  if (c.kind === "new" && c.a !== undefined && c.b !== undefined && canSpend()) {
    const a = w.cities[c.a], b = w.cities[c.b]; if (!spend()) return false;
    const idx = buildIndex(sim), path = pathfind(w, a.cell, b.cell, { roadCells: idx.roadCells }); if (!path) return false;
    const newKm = path.filter((k, q) => q > 0 && !idx.step.has(`${path[q - 1]}:${k}`)).length * w.cell; if (newKm < 15 || newKm * 1.3 > Math.max(30, purse)) return false;
    const l = layPath(sim, w, path, { open: false, surface: "gravel", quality: 80, built: 0, month: sim.month, standard: std }); if (!l.created.length) return false;
    const es = l.created.map((id) => sim.edges[id]), cost = es.reduce((s, x) => s + x.lengthKm * UNIT[std] * (1 + x.maxGradePct * 0.03), 0);
    const reg = a.pref === b.pref ? region : "JP";
    const p = createProject(sim, "new", reg, nodeAtCell(sim, w, idx, a.cell, "junction"), nodeAtCell(sim, w, idx, b.cell, "junction"), l.created, l.chain, cost, c.reason, c.score);
    ev(sim, "project", `新規計画: ${a.name}〜${b.name}(${Math.round(es.reduce((s, x) => s + x.lengthKm, 0))}km)`, c.reason, { project: p.id }); return true;
  }
  return false;
}
function planImprove(sim: SimState, e: SimEdge, region: string, purse: number, c: Cand): boolean {
  const target: Standard = e.standard === "rural" ? "standard" : "highgrade", cost = e.lengthKm * UNIT[target] * 0.6; if (cost > purse * 1.5) return false;
  const p = createProject(sim, "improve", region, e.a, e.b, [e.id], [{ edgeId: e.id, dir: 1 }], cost, c.reason, c.score);
  ev(sim, "project", `改良計画: ${nodeName(sim, e.a)}〜${nodeName(sim, e.b)}(${target === "standard" ? "2車線化" : "高規格化"})`, c.reason, { project: p.id, edge: e.id }); return true;
}
void rand;
