/**
 * Stage 37 (C3-C8): from 1950 an 1800 game looks at EVERY island, not only the strait links the ferry planner knows. Each land mass that no fixed link joins to the rest of the network is
 * considered for a bridge or tunnel to the nearest other land mass (a bigger one, a neighbour in a chain such as the Kurils, a near headland): never fixed to a real crossing or route -- the
 * links this world builds are its own.
 *
 *   TECHNOLOGY  the gap between the two shores must be within what a bridge can span / a tunnel can be driven this year (chooseStructure: grows with the technology clock);
 *   DEMAND      the people on the two masses against the length of the gap, and a road or a settlement near each shore (a rock nobody lives on and no road reaches is left alone);
 *   POLICY      road / rail emphasis builds a lot ("super-aggressive": possible is enough, profit is not asked for), sea / air emphasis builds what pays ("realistic"), anything else a middle
 *               course; the era's boom and a regionally dispersed development policy multiply that (all three together: nationwide, far more links at once);
 *   SAFETY      the straight crossing may not run over any other land, a link joins two shores and never changes the terrain, and the whole search is a one-off table of shore pairs plus a short loop a year.
 * Pure rules over the sim and the world; no place names.
 */
import { dist } from "../core/geom";
import { cycleOf } from "./cycle27";
import { chooseStructure, CROSSING_TAG, ensureAccess, massPop } from "./crossing";
import { ev } from "./engine";
import { createProject } from "./planning";
import { buildIndex, newEdgeDefaults, newId, nodeAtCell } from "./network";
import { stance18 } from "./policy18";
import { nearTown } from "./ferry";
import { nearestPlace } from "../core/gazetteer";
import { modeOf, type SimEdge, type SimState } from "./types";
import type { World } from "./world";
import { worldMemo } from "./worldMemo";

export const ISLAND_TAG = "【島間接続】", LINK_FROM = 1950, MAX_GAP_KM = 150, SCAN_CELLS = 30;
export type Drive = "ultra" | "aggressive" | "real";
export interface DriveInfo { drive: Drive; bar: number; perYear: number; maxActive: number; fundMult: number; boom: boolean; dispersed: boolean; synergy: boolean }
/** One candidate: the nearest shore pair of two land masses. */
export interface ShorePair { a: number; b: number; ca: number; cb: number; gap: number }
const pairMemo = worldMemo<ShorePair[]>();

/** The nearest shore pair of every two land masses within MAX_GAP_KM, computed once per world (the terrain changes only by whole reclaimed cells, which reset this cache). */
export function shorePairs(w: World): ShorePair[] {
  const hit = pairMemo.get(w); if (hit) return hit;
  const nx = w.nx, ny = w.ny, coast: number[] = [], land = w.t.land;
  for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) { const k = j * nx + i; if (land[k] !== 1) continue; if (land[k - 1] === 0 || land[k + 1] === 0 || land[k - nx] === 0 || land[k + nx] === 0) coast.push(k); }
  const B = SCAN_CELLS, bx = Math.ceil(nx / B), buckets = new Map<number, number[]>();
  for (const k of coast) { const key = ((k / nx) | 0) / B | 0; void key; const bkey = (((k / nx) | 0) / B | 0) * bx + ((k % nx) / B | 0); (buckets.get(bkey) ?? buckets.set(bkey, []).get(bkey)!).push(k); }
  const best = new Map<number, ShorePair>(), reach = MAX_GAP_KM / w.cell;
  for (const k of coast) {
    const i = k % nx, j = (k / nx) | 0, bi = (i / B) | 0, bj = (j / B) | 0, la = w.lm[k];
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const arr = buckets.get((bj + dj) * bx + (bi + di)); if (!arr) continue;
      for (const q of arr) { const lb = w.lm[q]; if (lb <= la) continue; const d = Math.hypot((q % nx) - i, ((q / nx) | 0) - j); if (d > reach) continue; const key = la * 100000 + lb, cur = best.get(key); if (!cur || d * w.cell < cur.gap) best.set(key, { a: la, b: lb, ca: k, cb: q, gap: Math.round(d * w.cell * 10) / 10 }); }
    }
  }
  const out = [...best.values()].sort((p, q) => p.gap - q.gap || p.a - q.a || p.b - q.b); pairMemo.set(w, out); return out;
}
/** Is the straight line between two shore cells all water in between (it may not cross any other land)? */
export function clearCrossing(w: World, ca: number, cb: number): boolean {
  const ax = ca % w.nx, ay = (ca / w.nx) | 0, bx = cb % w.nx, by = (cb / w.nx) | 0, n = Math.max(2, Math.ceil(Math.hypot(bx - ax, by - ay) * 2));
  for (let s = 1; s < n; s++) { const t = s / n, k = Math.round(ay + (by - ay) * t) * w.nx + Math.round(ax + (bx - ax) * t); if (k === ca || k === cb) continue; if (w.t.land[k] !== 0 && w.lm[k] !== w.lm[ca] && w.lm[k] !== w.lm[cb]) return false; }
  return true;
}
/** How the world's policy, era and economy set the pace of island links this year. */
export function driveOf(sim: SimState, y: number): DriveInfo {
  const dl = sim.dials, rr = (dl.hwyBuild + dl.railBuild) / 2, seaAir = Math.max(dl.seaBias, dl.airBias, stance18(sim) ? 1.5 : 0);
  const drive: Drive = seaAir >= 0.8 && rr < 1.15 ? "real" : rr >= 0.95 && seaAir < 0.6 ? "ultra" : "aggressive";
  const cyc = cycleOf(sim), boom = dl.growth >= 1.1 || (!!cyc && cyc.phase !== "decline" && cyc.budget >= 1.05), dispersed = sim.kaigen?.recon?.focus === "disperse";
  const synergy = boom && dispersed && drive !== "real" && rr >= 0.95;
  const base = { ultra: { bar: 0.01, perYear: 3, maxActive: 8, fundMult: 1.6 }, aggressive: { bar: 0.04, perYear: 2, maxActive: 4, fundMult: 1 }, real: { bar: 1.2, perYear: 1, maxActive: 2, fundMult: 0.6 } }[drive];
  const grow = 0.5 + Math.min(1.5, Math.max(0, (y - LINK_FROM) / 40));   // (technology: a trickle at first, more at once as the decades pass)
  const k = (boom ? 1.4 : 1) * (dispersed && drive !== "real" ? 1.4 : 1) * (synergy ? 2 : 1) * grow;
  return { drive, boom, dispersed, synergy, bar: base.bar / (synergy ? 3 : boom ? 1.5 : 1), perYear: Math.max(1, Math.round(base.perYear * k)), maxActive: Math.round(base.maxActive * k), fundMult: base.fundMult * (synergy ? 1.5 : 1) };
}
const isLive = (s: string) => s === "concept" || s === "planned" || s === "building" || s === "suspended";
/** Union-find over the land masses fixed links already join (built, or a live project). */
function components(sim: SimState, w: World): Map<number, number> {
  const parent = new Map<number, number>(), find = (x: number): number => { let p = parent.get(x) ?? x; if (p !== x) { p = find(p); parent.set(x, p); } return p; };
  const live = new Set<string>(); for (const p of Object.values(sim.projects)) if (isLive(p.status)) for (const id of p.edgeIds) live.add(id);
  for (const e of Object.values(sim.edges)) { if ((e.facility !== "bridge" && e.facility !== "tunnel") || e.cells.length < 2 || !(e.built >= 1 || live.has(e.id))) continue; const a = w.lm[e.cells[0]], b = w.lm[e.cells[e.cells.length - 1]]; if (a !== b) parent.set(find(a), find(b)); }
  const out = new Map<number, number>(); for (let k = 0; k < w.N; k++) if (w.t.land[k] === 1 && !out.has(w.lm[k])) out.set(w.lm[k], find(w.lm[k])); return out;
}
const nearNode = (sim: SimState, w: World, cell: number, km: number) => { for (const n of Object.values(sim.nodes)) if (w.lm[n.cell] === w.lm[cell] && dist(w.cellPos(n.cell), w.cellPos(cell)) <= km) return true; return false; };
export interface LinkEval { ok: boolean; why: string; pair: ShorePair; fac?: "bridge" | "tunnel"; cost?: number; score?: number }
/** Pairs of land masses a link was given up on (project abolished) within COOLING_YEARS: not tried again at once. */
export const COOLING_YEARS_37 = 12;
function coolingPairs(sim: SimState, w: World, y: number): Set<number> {
  const out = new Set<number>();
  for (const p of Object.values(sim.projects)) {
    if (!p.reason.includes(ISLAND_TAG) || (p.status !== "abolished" && p.status !== "unbuilt")) continue;
    if (y - (sim.startYear + Math.floor(p.statusSince / 12)) >= COOLING_YEARS_37) continue;
    const a = sim.nodes[p.from]?.cell, b = sim.nodes[p.to]?.cell; if (a === undefined || b === undefined) continue; const la = w.lm[a], lb = w.lm[b]; out.add(Math.min(la, lb) * 100000 + Math.max(la, lb));
  }
  return out;
}
export function evalLink(sim: SimState, w: World, pr: ShorePair, y: number, d: DriveInfo, comp: Map<number, number>, cool: Set<number> = new Set()): LinkEval {
  if (comp.get(pr.a) === comp.get(pr.b)) return { ok: false, why: "joined", pair: pr };
  if (cool.has(pr.a * 100000 + pr.b)) return { ok: false, why: "cooling", pair: pr };
  if (!clearCrossing(w, pr.ca, pr.cb)) return { ok: false, why: "over-land", pair: pr };
  const s = chooseStructure(sim, pr.gap, pr.gap, "road", y); if (!s) return { ok: false, why: "no-structure", pair: pr };
  const popA = massPop(sim, w, pr.a), popB = massPop(sim, w, pr.b), small = Math.min(popA, popB), big = Math.max(popA, popB), roads = (nearNode(sim, w, pr.ca, 60) ? 1 : 0) + (nearNode(sim, w, pr.cb, 60) ? 1 : 0);
  if (small + big < 200 && roads < 2) return { ok: false, why: "empty", pair: pr, fac: s.fac, cost: s.cost };   // nobody to serve
  const score = (small + 0.15 * big + 400 * roads) / (Math.max(pr.gap, 1) * 250);
  if (score < d.bar) return { ok: false, why: "demand", pair: pr, fac: s.fac, cost: s.cost, score };
  const months = Math.max(24, pr.gap * 0.8), need = s.cost / months, pool = sim.macro.budgetBu * sim.dials.roadShare * sim.dials.austerity * 0.2;
  if (need > 0.6 * d.fundMult * pool) return { ok: false, why: "funds", pair: pr, fac: s.fac, cost: s.cost, score };
  return { ok: true, why: "ok", pair: pr, fac: s.fac, cost: s.cost, score };
}
function startLink(sim: SimState, w: World, ev0: LinkEval, y: number): boolean {
  const { pair: pr, fac, cost } = ev0, idx = buildIndex(sim, "road");
  ensureAccess(sim, w, pr.ca); ensureAccess(sim, w, pr.cb);
  const a = nodeAtCell(sim, w, idx, pr.ca, "junction"), b = nodeAtCell(sim, w, idx, pr.cb, "junction"); if (a === b) return false;
  const na = (w.cityByCell.get(pr.ca)?.name ?? nearTown(w, pr.ca) ?? "島").replace(/市$/, ""), nb0 = (w.cityByCell.get(pr.cb)?.name ?? nearTown(w, pr.cb) ?? "島").replace(/市$/, ""), nb = nb0 === na ? `${(nearestPlace(w.cellPos(pr.cb), new Set([na, `${na}市`]))?.name ?? nb0).replace(/市$/, "")}沖` : nb0, pa = w.cellPos(pr.ca), pb = w.cellPos(pr.cb), id = newId(sim, "edge");
  const e: SimEdge = { ...newEdgeDefaults(), id, a, b, cells: [pr.ca, pr.cb], lengthKm: Math.round(Math.hypot(pa[0] - pb[0], pa[1] - pb[1]) * 10) / 10, surface: "paved", quality: 92, built: 0, open: false, state: "closed", standard: "standard", maxGradePct: 1, builtMonth: null, region: w.prefOf(pr.ca) ?? w.prefOf(pr.cb) ?? "", facility: fac!, facilityName: `link:${na}〜${nb}${fac === "bridge" ? "大橋" : "海底トンネル"}` };
  sim.edges[id] = e;
  const reason = `${CROSSING_TAG}${ISLAND_TAG}${na}〜${nb}の島間接続(海峡${pr.gap}km、${fac === "bridge" ? "橋" : "トンネル"})。この世界線で新しく生まれた連絡で、実在の路線ではない`;
  const p = createProject(sim, "new", "JP", a, b, [id], [{ edgeId: id, dir: 1 }], cost!, reason, ev0.score ?? 1); p.status = "concept";
  ev(sim, "crossing", `島間接続の構想(道路): ${na}〜${nb}`, `${reason}(工費の目安${cost!.toFixed(1)})`, { project: p.id });
  return true;
}
/** One year's decision (an 1800 game, from 1950). Returns the projects started. */
export function planIslandLinks(sim: SimState, w: World, y: number): number {
  if (!sim.rules1800 || !sim.crossings || !sim.tech || y < LINK_FROM) return 0;
  const d = driveOf(sim, y), live = Object.values(sim.projects).filter((p) => p.reason.includes(ISLAND_TAG) && isLive(p.status)).length; if (live >= d.maxActive) return 0;
  const comp = components(sim, w), cool = coolingPairs(sim, w, y), ok: LinkEval[] = [];
  for (const pr of shorePairs(w)) { const r = evalLink(sim, w, pr, y, d, comp, cool); if (r.ok) ok.push(r); }
  ok.sort((p, q) => (q.score ?? 0) / Math.sqrt(Math.max(1, q.cost ?? 1)) - (p.score ?? 0) / Math.sqrt(Math.max(1, p.cost ?? 1)) || p.pair.gap - q.pair.gap);
  let n = 0; const used = new Set<number>();
  for (const r of ok) { if (n >= d.perYear || live + n >= d.maxActive) break; const ka = comp.get(r.pair.a)!, kb = comp.get(r.pair.b)!; if (used.has(ka) || used.has(kb)) continue; if (startLink(sim, w, r, y)) { used.add(ka); used.add(kb); n++; } }
  void modeOf; return n;
}
