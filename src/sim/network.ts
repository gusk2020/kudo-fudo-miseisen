/** Road graph operations: nodes, edges, splitting, and laying a grid path onto the network. */
import { dist } from "../core/geom";
import type { Vec } from "../core/types";
import type { EdgeState, RouteEdgeRef, SimEdge, SimNode, SimState, Standard, Surface } from "./types";
import { cellDistKm, type World } from "./world";

export const pad = (n: number, w = 6) => String(n).padStart(w, "0");
export function newId(sim: SimState, kind: "node" | "edge" | "route" | "project"): string {
  const n = ++sim.next[kind]; return `${{ node: "n", edge: "e", route: "r", project: "p" }[kind]}.${pad(n)}`;
}
export function newEdgeDefaults(): Omit<SimEdge, "id" | "a" | "b" | "cells" | "surface" | "quality" | "built" | "open" | "maxGradePct" | "builtMonth" | "region" | "standard" | "state"> {
  return { lengthKm: 0, weathering: 0, lost: false, traffic: 0, lowYears: 0, through: 0, local: 0, peakThrough: 0, zeroYears: 0, reviveYears: 0, congYears: 0, nick: false, hist: [], bypassOf: [], bypassedBy: [], throughDropYears: 0 };
}
/** The prefecture most of an edge's cells lie in (its budget region). */
export function regionOfCells(w: World, cells: number[]): string {
  const c = new Map<string, number>(); for (const k of cells) { const p = w.prefOf(k); if (p) c.set(p, (c.get(p) ?? 0) + 1); }
  let best = "JP", n = 0; for (const [p, v] of [...c.entries()].sort()) if (v > n) { n = v; best = p; } return best;
}
/** Change service state; keeps the legacy open/lost flags consistent and records the change in the edge's own history. */
export function setEdgeState(sim: SimState, e: SimEdge, st: EdgeState, why: string) {
  if (e.state === st) return; e.state = st; e.open = st === "open"; e.lost = st === "lost";
  if (st === "open") { e.zeroYears = 0; e.reviveYears = 0; }
  pushHist(sim, e, `${{ open: "供用(再開)", dormant: "休止", closed: "閉鎖", lost: "廃道化" }[st]}: ${why}`);
}
export function pushHist(sim: SimState, e: SimEdge, t: string) { e.hist.push({ m: sim.month, t }); if (e.hist.length > 40) e.hist.splice(1, e.hist.length - 40); }
export interface NetIndex { nodeByCell: Map<number, string>; cellEdge: Map<number, string>; step: Map<string, { edge: string; i: number }>; roadCells: Set<number> }
export function buildIndex(sim: SimState): NetIndex {
  const nodeByCell = new Map<number, string>(), cellEdge = new Map<number, string>(), step = new Map<string, { edge: string; i: number }>(), roadCells = new Set<number>();
  for (const n of Object.values(sim.nodes)) nodeByCell.set(n.cell, n.id);
  for (const e of Object.values(sim.edges)) {
    for (let i = 0; i < e.cells.length; i++) { roadCells.add(e.cells[i]); if (i > 0 && i < e.cells.length - 1) cellEdge.set(e.cells[i], e.id); if (i + 1 < e.cells.length) { step.set(`${e.cells[i]}:${e.cells[i + 1]}`, { edge: e.id, i }); step.set(`${e.cells[i + 1]}:${e.cells[i]}`, { edge: e.id, i }); } }
  }
  return { nodeByCell, cellEdge, step, roadCells };
}
export function edgeLengthKm(w: World, sim: SimState, e: Pick<SimEdge, "a" | "b" | "cells">): number {
  const pts = edgePoints(w, sim, e); let s = 0; for (let i = 1; i < pts.length; i++) s += dist(pts[i - 1], pts[i]); return s;
}
export function edgePoints(w: World, sim: SimState, e: Pick<SimEdge, "a" | "b" | "cells">): Vec[] {
  const pts: Vec[] = e.cells.map((k) => w.cellPos(k));
  pts[0] = sim.nodes[e.a].pos; pts[pts.length - 1] = sim.nodes[e.b].pos; return pts;
}
/** Smoothed vector shape for drawing (two Chaikin passes); node endpoints stay exact. */
export function edgeShape(w: World, sim: SimState, e: Pick<SimEdge, "a" | "b" | "cells">): Vec[] {
  let p = edgePoints(w, sim, e);
  for (let it = 0; it < 2 && p.length > 2; it++) {
    const q: Vec[] = [p[0]];
    for (let i = 0; i + 1 < p.length; i++) { const a = p[i], b = p[i + 1]; q.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]); }
    q.push(p[p.length - 1]); p = q;
  }
  return p;
}
export function maxGradePct(w: World, cells: number[]): number {
  let m = 0; for (let i = 1; i < cells.length; i++) m = Math.max(m, Math.abs(w.elevM(cells[i]) - w.elevM(cells[i - 1])) / (cellDistKm(w, cells[i], cells[i - 1]) * 1000) * 100);
  return Math.round(m * 10) / 10;
}
export function nodeAtCell(sim: SimState, w: World, idx: NetIndex, cell: number, kind: SimNode["kind"] = "junction"): string {
  const have = idx.nodeByCell.get(cell); if (have) return have;
  const city = w.cityByCell.get(cell), id = newId(sim, "node");
  sim.nodes[id] = city ? { id, kind: "city", cell, pos: city.pos, cityId: city.id, name: city.name } : { id, kind, cell, pos: w.cellPos(cell) };
  idx.nodeByCell.set(cell, id); return id;
}
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

/** Split an edge at an interior cell index; routes and projects that reference it are rewritten in place. */
export function splitEdge(sim: SimState, w: World, edgeId: string, at: number, nodeId: string): string {
  const e = sim.edges[edgeId]; const id2 = newId(sim, "edge");
  const e2: SimEdge = { ...clone(e), id: id2, a: nodeId, b: e.b, cells: e.cells.slice(at) };
  const origLen = e.lengthKm; e.b = nodeId; e.cells = e.cells.slice(0, at + 1);
  e.lengthKm = edgeLengthKm(w, sim, e); e2.lengthKm = edgeLengthKm(w, sim, e2);
  const f1 = origLen > 0 ? e.lengthKm / (e.lengthKm + e2.lengthKm) : 0.5; e2.traffic = e.traffic * (1 - f1); e.traffic *= f1;
  e.maxGradePct = maxGradePct(w, e.cells); e2.maxGradePct = maxGradePct(w, e2.cells);
  sim.edges[id2] = e2;
  for (const l of sim.links) { if (l.oldEdges.includes(edgeId)) l.oldEdges.push(id2); if (l.newEdges.includes(edgeId)) l.newEdges.push(id2); }
  if (e.bypassedBy.length) e2.bypassedBy = [...e.bypassedBy]; if (e.bypassOf.length) e2.bypassOf = [...e.bypassOf];
  const rewrite = (list: RouteEdgeRef[]) => { for (let i = 0; i < list.length; i++) if (list[i].edgeId === edgeId) { const d = list[i].dir; list.splice(i, 1, ...(d === 1 ? [{ edgeId, dir: 1 as const }, { edgeId: id2, dir: 1 as const }] : [{ edgeId: id2, dir: -1 as const }, { edgeId, dir: -1 as const }])); i++; } };
  for (const r of Object.values(sim.routes)) rewrite(r.edges);
  for (const p of Object.values(sim.projects)) { rewrite(p.chain); const k = p.edgeIds.indexOf(edgeId); if (k >= 0) p.edgeIds.splice(k + 1, 0, id2); }
  return id2;
}
export interface LayOpts { open: boolean; surface: Surface; quality: number; built: number; month: number; standard?: Standard }
/**
 * Lay a grid path onto the network. Steps that already run along an existing edge are shared (designation overlap);
 * everything else becomes new edges. Crossings/touches of existing roads become junctions. Returns the ordered chain.
 */
export function layPath(sim: SimState, w: World, pathCells: number[], o: LayOpts): { chain: RouteEdgeRef[]; created: string[] } {
  const cells = pathCells.filter((c, i) => i === 0 || c !== pathCells[i - 1]);
  const chain: RouteEdgeRef[] = [], created: string[] = [];
  if (cells.length < 2 || cells[0] === cells[cells.length - 1]) return { chain, created };
  let idx = buildIndex(sim); const n = cells.length;
  const shared = (i: number) => idx.step.has(`${cells[i]}:${cells[i + 1]}`);       // step i -> i+1
  // 1) make sure every breakpoint cell is a node (splitting existing edges where a path touches their interior)
  const bp: number[] = [];
  for (let i = 0; i < n; i++) {
    const c = cells[i], inNet = idx.nodeByCell.has(c) || idx.cellEdge.has(c), sp = i > 0 && shared(i - 1), sn = i < n - 1 && shared(i);
    if (i === 0 || i === n - 1 || idx.nodeByCell.has(c) || w.cityByCell.has(c) || (inNet && !(sp && sn)) || sp !== sn) bp.push(i);
  }
  for (const i of bp) {
    const c = cells[i]; if (idx.nodeByCell.has(c)) continue;
    const eid = idx.cellEdge.get(c);
    if (eid) { const e = sim.edges[eid], at = e.cells.indexOf(c); const nid = nodeAtCell(sim, w, idx, c, "junction"); splitEdge(sim, w, eid, at, nid); }
    else nodeAtCell(sim, w, idx, c, i === 0 || i === n - 1 ? "end" : "junction");
    idx = buildIndex(sim);
  }
  // 2) walk breakpoint to breakpoint
  const addNew = (seg: number[]) => {
    const a = idx.nodeByCell.get(seg[0])!, b = idx.nodeByCell.get(seg[seg.length - 1])!;
    if (a === b) return;
    // one mountain pass per new edge, at the highest interior cell when it clearly stands above both ends
    let hi = -1, he = -1e9;
    for (let k = 2; k < seg.length - 2; k++) if (w.elevM(seg[k]) > he) { he = w.elevM(seg[k]); hi = k; }
    const base = Math.max(w.elevM(seg[0]), w.elevM(seg[seg.length - 1]));
    const parts: number[][] = hi > 0 && he - base >= 250 && !idx.nodeByCell.has(seg[hi]) ? [seg.slice(0, hi + 1), seg.slice(hi)] : [seg];
    if (parts.length === 2) nodeAtCell(sim, w, idx, seg[hi], "pass");
    for (const part of parts) {
      const pa = idx.nodeByCell.get(part[0])!, pb = idx.nodeByCell.get(part[part.length - 1])!, id = newId(sim, "edge");
      const e: SimEdge = { ...newEdgeDefaults(), id, a: pa, b: pb, cells: part, surface: o.surface, quality: o.quality, built: o.built, open: o.open, state: o.open ? "open" : "closed", standard: o.standard ?? "rural", maxGradePct: maxGradePct(w, part), builtMonth: o.open ? o.month : null, region: regionOfCells(w, part) };
      e.lengthKm = edgeLengthKm(w, sim, e); sim.edges[id] = e; created.push(id); chain.push({ edgeId: id, dir: 1 });
    }
    void a; void b;
  };
  idx = buildIndex(sim);
  for (let q = 0; q + 1 < bp.length; q++) {
    const s = bp[q], t = bp[q + 1], seg = cells.slice(s, t + 1);
    if (shared(s)) { const hit = idx.step.get(`${cells[s]}:${cells[s + 1]}`)!, e = sim.edges[hit.edge]; chain.push({ edgeId: e.id, dir: idx.nodeByCell.get(cells[s]) === e.a ? 1 : -1 }); }
    else { addNew(seg); idx = buildIndex(sim); }
  }
  return { chain, created };
}
/** Structural self-check used by tests and by load: returns a list of problems (empty = consistent). */
export function checkIntegrity(sim: SimState): string[] {
  const bad: string[] = [];
  for (const e of Object.values(sim.edges)) {
    if (!sim.nodes[e.a] || !sim.nodes[e.b]) bad.push(`edge ${e.id}: missing node`);
    else {
      if (e.cells[0] !== sim.nodes[e.a].cell || e.cells[e.cells.length - 1] !== sim.nodes[e.b].cell) bad.push(`edge ${e.id}: end cells differ from nodes`);
      if (e.a === e.b) bad.push(`edge ${e.id}: loop`);
    }
    if (e.built < 0 || e.built > 1 || e.quality < 0 || e.quality > 100 || e.weathering < 0 || e.weathering > 100) bad.push(`edge ${e.id}: out of range`);
  }
  const seen = new Set<string>();
  for (const r of Object.values(sim.routes)) {
    const key = `${r.grade}:${r.scope}:${r.number}`;
    if (r.active) { if (seen.has(key)) bad.push(`route number duplicated: ${key}`); seen.add(key); }
    let prev: string | null = null;
    for (const ref of r.edges) {
      const e = sim.edges[ref.edgeId]; if (!e) { bad.push(`route ${r.id}: missing edge ${ref.edgeId}`); continue; }
      const from = ref.dir === 1 ? e.a : e.b, to = ref.dir === 1 ? e.b : e.a;
      if (prev !== null && prev !== from) bad.push(`route ${r.id}: chain broken at ${ref.edgeId}`);
      prev = to;
    }
  }
  for (const r of Object.values(sim.routes)) for (const id of r.oldEdges ?? []) if (!sim.edges[id]) bad.push(`route ${r.id}: missing old edge ${id}`);
  for (const p of Object.values(sim.projects)) for (const id of p.edgeIds) if (!sim.edges[id]) bad.push(`project ${p.id}: missing edge ${id}`);
  return bad;
}
