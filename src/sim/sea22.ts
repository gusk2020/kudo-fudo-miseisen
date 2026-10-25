/**
 * Stage 22: domestic ocean routes and island routes (no foreign routes). Two kinds of sea service join the coastal ferries and straits of the earlier stages:
 *   - 外洋航路: long-distance routes between port cities -- Honshu / Hokkaido / Shikoku / Kyushu between themselves, along the Pacific and the Sea of Japan, out to the
 *     Ryukyu and the Ogasawara islands. Opened year by year where the demand of the two ends (their people, over the distance) and the era's policy make them worth it;
 *     put to rest (休止) when nobody uses them for years, reopened when the demand or the policy comes back. Never more than the policy allows.
 *   - 離島航路: the lifeline of an inhabited island (the residents of src/data/islets.json): one route to the nearest port of a bigger land, and one to its nearest inhabited neighbour
 *     of the same island group. They are kept whatever their earnings (policy, not profit); an island of very few people waits longer for its route, a big one gets it first.
 * The policy: 海路重視 opens them faster and keeps more; 空路重視 weakens the long passenger routes (the plane competes); 道路・鉄道重視 build slowly but never close a needed route; 均衡 follows demand.
 * Both are ordinary ferry edges of the network (they carry the trips the demand model routes over them, are drawn over the sea, never over land) and are tagged in their names.
 */
import { dist } from "../core/geom";
import { MinHeap } from "../core/heap";
import { ISLET_ISLAND_BASE } from "./islands20";
import { ev, yearOf } from "./engine";
import { makeFerry, makeFerryAt, maxFerryKm, nearTown } from "./ferry";
import { stanceAt } from "./kaigen";
import { setEdgeState } from "./network";
import { modeOf, type SimEdge, type SimState } from "./types";
import type { WCity, World } from "./world";

export const OCEAN_TAG = "外洋航路", ISLAND_TAG = "離島航路";
export const OCEAN_MIN_KM = 250, OCEAN_FROM = 1960, OCEAN_IDLE_YEARS = 6, OCEAN_REST_YEARS = 15, OCEAN_MAX_RESTS = 2, ISLAND_NEIGHBOUR_KM = 120;
export const isOcean = (e: SimEdge) => e.facility === "ferry" && (e.facilityName ?? "").endsWith(`(${OCEAN_TAG})`);
export const isIslandRoute = (e: SimEdge) => e.facility === "ferry" && (e.facilityName ?? "").endsWith(`(${ISLAND_TAG})`);
/** The policy's pull on sea routes: [new ocean routes a year, ocean routes kept at most, island routes opened a year, long-passenger factor]. */
export function seaPolicy(stance: string): { perYear: number; cap: number; islands: number; longPax: number; threshold: number } {
  if (stance === "kairo") return { perYear: 3, cap: 34, islands: 8, longPax: 1.4, threshold: 0.45 };
  if (stance === "kuuro") return { perYear: 1, cap: 12, islands: 4, longPax: 0.6, threshold: 1.3 };
  if (stance === "shubun" || stance === "shoka") return { perYear: 1, cap: 16, islands: 4, longPax: 0.9, threshold: 1.0 };
  return { perYear: 2, cap: 22, islands: 5, longPax: 1, threshold: 0.8 };
}
const PORT_POP = 100000;
// ---- distance over the sea: a 3x3-coarse grid of the world's cells (a coarse cell is water when any of its cells is sea, so narrow straits -- Akashi, Kanmon -- stay open), Dijkstra over it ----
interface SeaGrid { cx: number; cy: number; water: Uint8Array }
const seaMemo = new WeakMap<World, SeaGrid>();
function seaGrid(w: World): SeaGrid {
  let g = seaMemo.get(w); if (g) return g; const cx = Math.ceil(w.nx / SEA_F), cy = Math.ceil(w.ny / SEA_F), water = new Uint8Array(cx * cy);
  for (let k = 0; k < w.N; k++) if (w.t.land[k] === 0) water[(Math.floor(((k / w.nx) | 0) / SEA_F) * cx) + Math.floor((k % w.nx) / SEA_F)] = 1;
  g = { cx, cy, water }; seaMemo.set(w, g); return g;
}
const SEA_F = 3, coarse = (w: World, g: SeaGrid, k: number) => (Math.floor(((k / w.nx) | 0) / SEA_F) * g.cx) + Math.floor((k % w.nx) / SEA_F);
/** The coarse cell and its eight neighbours that exist (a neighbour is never read across the edge of a row). */
function around(g: SeaGrid, k: number): number[] {
  const i = k % g.cx, j = (k / g.cx) | 0, out: number[] = [];
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const a = i + di, b = j + dj; if (a >= 0 && b >= 0 && a < g.cx && b < g.cy) out.push(b * g.cx + a); }
  return out;
}
/** One Dijkstra over the sea from one or many ports at once: the km to every coarse cell (Infinity where the sea does not reach) and, per cell, which seed it came from. Stops early at `target` (or past `maxKm`). */
function sweep(w: World, seeds: number[], stop?: { target: number; maxKm: number }): { d: Float64Array; who: Int32Array } {
  const g = seaGrid(w), d = new Float64Array(g.cx * g.cy).fill(Infinity), who = new Int32Array(g.cx * g.cy).fill(-1), step = w.cell * SEA_F, h = new MinHeap(1024);
  seeds.forEach((c, n) => { const k = coarse(w, g, c); if (d[k] > 0) { d[k] = 0; who[k] = n; h.push(0, k); } });
  while (h.size) {
    const { key: dk, val: k } = h.pop(); if (dk > d[k]) continue; const i = k % g.cx, j = (k / g.cx) | 0; if (stop && (dk > stop.maxKm || (Math.abs(i - (stop.target % g.cx)) <= 1 && Math.abs(j - ((stop.target / g.cx) | 0)) <= 1))) break;   // (stops once next to the target: a port is read from the cells around it)
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue; const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= g.cx || b >= g.cy) continue; const n = b * g.cx + a; if (!g.water[n]) continue;
      const nd = dk + step * (di && dj ? 1.4142 : 1); if (nd < d[n]) { d[n] = nd; who[n] = who[k]; h.push(nd, n); }
    }
  }
  return { d, who };
}
/** The best of a field around a port cell: a port stands on the shore, so the sea one coarse cell away counts (plus that step). Returns the km and the coarse cell it was read at. */
function reach(w: World, g: SeaGrid, d: Float64Array, cell: number): { km: number; at: number } {
  let km = Infinity, at = -1; for (const n of around(g, coarse(w, g, cell))) { const dd = d[n] + w.cell * SEA_F; if (dd < km) { km = dd; at = n; } } return { km, at };
}
/** Km over the sea between two ports (Infinity: the sea does not join them). `field` may hold the search from `a` already (many pairs share one port). */
export function seaKm(w: World, a: number, b: number, field?: Float64Array): number { return reach(w, seaGrid(w), field ?? sweep(w, [a]).d, b).km; }
const nearMemo = new WeakMap<World, { d: Float64Array; who: Int32Array }>();
/** For every coarse sea cell, the nearest of `ports` by sea (one search from all of them). */
function nearestPortField(w: World, ports: WCity[]) { let r = nearMemo.get(w); if (!r) { r = sweep(w, ports.map((c) => c.cell)); nearMemo.set(w, r); } return r; }
interface Cand { a: WCity; b: WCity; km: number; base: number }   // km: over the sea
const candMemo = new WeakMap<World, Cand[]>();
/** The pairs of port cities an ocean route could join (domestic, OCEAN_MIN_KM .. maxFerryKm, by straight distance; the drawing follows the sea). */
export function oceanCandidates(w: World): Cand[] { const g = oceanCandidatesGen(w); for (;;) { const r = g.next(); if (r.done) return r.value; } }
/** The same, a few sea searches at a time (the first year of ocean routes would otherwise be one long task on a phone). */
export function* oceanCandidatesGen(w: World): Generator<void, Cand[]> {
  const hit = candMemo.get(w); if (hit) return hit;
  const ports = w.cities.filter((c) => c.coastal && (c.kind === "capital" || c.pop0 >= PORT_POP || c.island >= ISLET_ISLAND_BASE)), out: Cand[] = [];
  const pre: { a: WCity; b: WCity; straight: number; s: number }[] = [];
  for (let i = 0; i < ports.length; i++) for (let j = i + 1; j < ports.length; j++) { const a = ports[i], b = ports[j], straight = dist(a.pos, b.pos); if (straight < OCEAN_MIN_KM * 0.8 || straight > maxFerryKm(w)) continue; pre.push({ a, b, straight, s: Math.sqrt(Math.max(1, a.pop0) * Math.max(1, b.pop0)) / Math.pow(straight, 1.1) * (w.lm[a.cell] === w.lm[b.cell] ? 1 : 2) }); }
  pre.sort((p, q) => q.s - p.s);   // (the sea distance is asked only of the 160 best pairs by the straight line: the search per port is the costly part)
  let n = 0; const fields = new Map<number, Float64Array>();   // (one search per port, kept only until the candidates are made)
  for (const { a, b, straight } of pre.slice(0, 160)) {
    if (++n % 8 === 0) yield;
    let f = fields.get(a.cell); if (!f) { f = sweep(w, [a.cell]).d; fields.set(a.cell, f); }
    const km = seaKm(w, a.cell, b.cell, f); if (!isFinite(km) || km < OCEAN_MIN_KM || km > maxFerryKm(w)) continue;
    // what the sea saves: the way by land (a fixed link or a ferry is needed between land masses) against the way by sea; a route far longer than the land way is worth nothing
    const land = w.lm[a.cell] === w.lm[b.cell] ? straight * 1.3 : straight * 1.3 + 250, gain = Math.max(0, Math.min(2.5, land / km)); if (gain < 0.75) continue;
    out.push({ a, b, km, base: (Math.sqrt(Math.max(1, a.pop0) * Math.max(1, b.pop0)) / Math.pow(km, 1.1) / 120) * gain });
  }
  out.sort((p, q) => q.base - p.base || (p.a.id + p.b.id < q.a.id + q.b.id ? -1 : 1)); candMemo.set(w, out); return out;
}
/** Each inhabited island's lifeline: to the nearest port city on another land mass (a bigger land), and to its nearest inhabited neighbour of the same group. */
const linkMemo = new WeakMap<World, ReturnType<typeof islandLinks>>();
export function islandLinks(w: World): { cell: number; name: string; pop: number; km: number; to: { cell: number; pos: [number, number]; name: string; city?: WCity }; kind: "hub" | "next" }[] {
  const hit = linkMemo.get(w); if (hit) return hit;
  const out: ReturnType<typeof islandLinks> = []; const isl = (w.islets ?? []).filter((s) => !s.existing && (s.islet.pop ?? 0) > 0 && s.cells.length), hubs = w.cities.filter((c) => c.coastal && c.island > 0 && c.island < ISLET_ISLAND_BASE);
  for (const s of isl) {
    // the nearest port of the big lands (one search from all of them: an island's own little port never counts)
    const f = nearestPortField(w, hubs), { km: bd, at } = reach(w, seaGrid(w), f.d, s.cell), best = at >= 0 && f.who[at] >= 0 ? hubs[f.who[at]] : null;
    if (best && bd <= maxFerryKm(w)) out.push({ cell: s.cell, name: s.islet.name, pop: s.islet.pop!, km: bd, to: { cell: best.cell, pos: best.pos as [number, number], name: best.name, city: best }, kind: "hub" });
    let nb: (typeof isl)[number] | null = null, nd = Infinity; for (const t of isl) { if (t === s || t.islet.group !== s.islet.group || w.lm[t.cell] === w.lm[s.cell]) continue; const d = dist(t.pos, s.pos); if (d < nd) { nd = d; nb = t; } }
    if (nb && nd <= ISLAND_NEIGHBOUR_KM && s.islet.name < nb.islet.name) out.push({ cell: s.cell, name: s.islet.name, pop: Math.min(s.islet.pop!, nb.islet.pop ?? 0), km: seaKmTo(w, s.cell, nb.cell), to: { cell: nb.cell, pos: nb.pos as [number, number], name: nb.islet.name }, kind: "next" });
  }
  out.sort((p, q) => q.pop - p.pop || (p.name < q.name ? -1 : 1)); linkMemo.set(w, out); return out;
}
/** The short way between two islands of a group: the search stops at the other island. */
const seaKmTo = (w: World, a: number, b: number) => { const g = seaGrid(w), { d } = sweep(w, [a], { target: coarse(w, g, b), maxKm: maxFerryKm(w) }); return reach(w, g, d, b).km; };
const pairKey = (a: number, b: number) => (a < b ? a * 1e7 + b : b * 1e7 + a);
/** The ferries by their two end cells, taken once per review (the yearly review asks for many pairs). */
const ferryEnds = (sim: SimState) => { const m = new Map<number, SimEdge>(); for (const e of Object.values(sim.edges)) if (e.facility === "ferry" && modeOf(e) === "road") m.set(pairKey(e.cells[0], e.cells[e.cells.length - 1]), e); return m; };
/** The yearly review: open, rest and reopen. Deterministic (no random numbers). */
export function reviewSea22(sim: SimState, w: World): void { const g = reviewSea22Gen(sim, w); while (!g.next().done); }
/** The yearly review of the sea routes, one route (or a few sea searches) per slice. */
export function* reviewSea22Gen(sim: SimState, w: World): Generator<void> {
  const y = yearOf(sim), pol = seaPolicy(stanceAt(sim, y)), ends = ferryEnds(sim);
  // 離島航路: lifelines, biggest islands first; a few a year
  let opened = 0;
  for (const l of islandLinks(w)) {
    if (opened >= pol.islands) break; if (l.pop < 100 && y < 1965) continue;   // (the smallest islands wait for the 1960s' state support for remote islands)
    const ex = ends.get(pairKey(l.cell, l.to.cell)); if (ex) { if (ex.state !== "open") { setEdgeState(sim, ex, "open", "離島の生活航路として再開"); ev(sim, "ferry", `${l.name}の航路を再開`, "離島の生活航路(政策的に維持)", { edge: ex.id }); } continue; }
    const e = makeFerryAt(sim, w, { cell: l.cell, pos: w.cellPos(l.cell) }, { cell: l.to.cell, pos: l.to.pos }, "road", `${l.name}(住民約${l.pop}人)の生活航路${l.kind === "next" ? "(島どうし)" : ""}`, `ferry:${l.name}〜${l.to.name.replace(/市$/, "")}(${ISLAND_TAG})`);
    if (isFinite(l.km)) e.lengthKm = Math.round(l.km * 10) / 10;   // (worked out with the links: the way over the sea)
    ev(sim, "ferry", `${l.name}〜${l.to.name.replace(/市$/, "")}の離島航路が開設`, `住民約${l.pop}人の生活交通(収支によらず維持)`, { edge: e.id }); opened++; yield;
  }
  if (y < OCEAN_FROM) return;
  // 外洋航路: rest the idle ones (never a lifeline), reopen the ones the policy and the demand call for, then open new ones up to the policy's cap
  const live = Object.values(sim.edges).filter((e) => isOcean(e));
  for (const e of live) {
    if (e.state === "open") { const used = e.through + e.local + e.freight * 0.4; (e as SimEdge & { idle22?: number }).idle22 = used < 20 ? ((e as SimEdge & { idle22?: number }).idle22 ?? 0) + 1 : 0; if (((e as SimEdge & { idle22?: number }).idle22 ?? 0) >= OCEAN_IDLE_YEARS * (stanceAt(sim, y) === "kairo" ? 2 : 1)) { setEdgeState(sim, e, "dormant", "外洋航路の利用が少ない年が続いた"); { const x = e as SimEdge & { rested22?: number; rests22?: number }; x.rested22 = y; x.rests22 = (x.rests22 ?? 0) + 1; } ev(sim, "ferry", `${(e.facilityName ?? "").replace("ferry:", "")}を休止`, "利用が少ない年が続いた(港と航路は残る)", { edge: e.id }); } }
  }
  const openN = live.filter((e) => e.state === "open").length; let room = Math.max(0, Math.min(pol.perYear, pol.cap - openN));
  if (!room) return;
  const cands = yield* oceanCandidatesGen(w); yield;
  for (const c of cands) {
    if (!room) break; const long = c.km > 600 ? pol.longPax : 1, score = c.base * long * (sim.cities[c.a.id] && sim.cities[c.b.id] ? Math.sqrt((sim.cities[c.a.id].pop / Math.max(1, c.a.pop0)) * (sim.cities[c.b.id].pop / Math.max(1, c.b.pop0))) : 1);
    if (score < pol.threshold) break;
    const ex = ends.get(pairKey(c.a.cell, c.b.cell));
    if (ex) { if (isOcean(ex) && ex.state === "dormant") {
      const x = ex as SimEdge & { rested22?: number; rests22?: number }; if ((x.rested22 !== undefined && y - x.rested22 < OCEAN_REST_YEARS) || (x.rests22 ?? 0) >= OCEAN_MAX_RESTS) continue;   // (a rested route stays so for a while, and one that has rested twice for good: reopened at once it would only be idle again and rest again, for ever)
      setEdgeState(sim, ex, "open", "外洋航路を再開(需要・政策)"); (ex as SimEdge & { idle22?: number }).idle22 = 0; ev(sim, "ferry", `${(ex.facilityName ?? "").replace("ferry:", "")}を再開`, "需要と政策により再開", { edge: ex.id }); room--; } continue; }
    const e = makeFerry(sim, w, c.a, c.b, "road", `外洋航路(${Math.round(c.km)}km)を開設: 両端の人口と距離、海路の方針から`); e.facilityName = `ferry:${c.a.name.replace(/市$/, "")}〜${c.b.name.replace(/市$/, "")}(${OCEAN_TAG})`; e.lengthKm = Math.round(c.km * 10) / 10;   // (the way over the sea, not the straight line: a route round a peninsula is as long as it is)
    ev(sim, "ferry", `${c.a.name.replace(/市$/, "")}〜${c.b.name.replace(/市$/, "")}の外洋航路が開設(${Math.round(c.km)}km)`, "長距離の旅客・貨物の海上輸送", { edge: e.id }); room--; yield;
  }
  void nearTown;
}
