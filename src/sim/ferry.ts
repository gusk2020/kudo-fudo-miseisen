/**
 * Ferries and the land masses they join (Issue #15).
 *
 * A "land mass" (World.lm) is a piece of land a road cannot leave on its own: Honshu, Kyushu, Shikoku, Hokkaido, Okinawa and each added island are all different.
 * A ferry is an edge of its own kind (facility "ferry", not a road): it has no pavement, no decay and no surface, and it is DRAWN as a sea route, never as a road
 * across the water. Its endpoints are two port cities; the road or rail on each side is ordinary road or rail.
 *
 * Everything here is a pure function of the world plus the sim's own edges: no place names, no coordinates.
 */
import { dist } from "../core/geom";
import { pathfind } from "./world";
import type { Vec } from "../core/types";
import { capacityOf } from "./demand";
import { buildIndex, layPath, newEdgeDefaults, newId, nodeAtCell, nodeSplitAt, pushHist, setEdgeState } from "./network";
import { ev } from "./engine";
import { createProject } from "./planning";
import { techAt } from "./tech";
import { modeOf, type Mode, type SimEdge, type SimState } from "./types";
import type { World, WCity } from "./world";

/** The longest single crossing a ferry service will run. Okinawa to Kyushu is the longest the data needs (about 640 km). */
export const MAX_FERRY_KM = 760;
/** Pairs closer than this get a ferry even when they are already joined through another mass (short straits are served directly). */
export const SHORT_STRAIT_KM = 120;
export const FERRY_SPEED_KMH = 28, FERRY_WAIT_H = 0.7;

export interface Crossing { la: number; lb: number; a: WCity; b: WCity; km: number; gapKm: number }
const cache = new WeakMap<World, { ports: Map<string, Crossing | null>; gaps: Map<string, number> }>();
const memo = (w: World) => { let m = cache.get(w); if (!m) { m = { ports: new Map(), gaps: new Map() }; cache.set(w, m); } return m; };
export const lmOfCity = (w: World, c: WCity) => w.lm[c.cell];
export const citiesOf = (w: World, lm: number) => w.cities.filter((c) => w.lm[c.cell] === lm);
/** The land masses that hold at least one city (the only ones a service can start or end on). */
export const servedMasses = (w: World) => [...new Set(w.cities.map((c) => w.lm[c.cell]).filter((x) => x > 0))].sort((p, q) => p - q);

/** Shortest distance between the coasts of two masses (km), measured cell to cell on the 5 km grid. */
export function gapKm(w: World, la: number, lb: number): number {
  const m = memo(w), key = la < lb ? `${la}:${lb}` : `${lb}:${la}`; const hit = m.gaps.get(key); if (hit !== undefined) return hit;
  const coast = (lm: number) => { const out: number[] = []; for (let k = 0; k < w.N; k++) if (w.lm[k] === lm) { const i = k % w.nx, j = (k / w.nx) | 0; let edge = false; for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= w.nx || b >= w.ny || w.t.land[b * w.nx + a] === 0) { edge = true; break; } } if (edge) out.push(k); } return out; };
  const A = coast(la), B = coast(lb); let best = Infinity;
  const step = Math.max(1, Math.floor(Math.sqrt((A.length * B.length) / 400000)));
  for (let x = 0; x < A.length; x += step) { const ax = A[x] % w.nx, ay = (A[x] / w.nx) | 0; for (let y = 0; y < B.length; y += step) { const d = Math.hypot(ax - (B[y] % w.nx), ay - ((B[y] / w.nx) | 0)); if (d < best) best = d; } }
  const km = Math.round(best * w.cell * 10) / 10; m.gaps.set(key, km); return km;
}
/** The best pair of port cities between two masses: the closest coastal cities (any city if none is coastal), ties by id. */
export function crossingPorts(w: World, la: number, lb: number): Crossing | null {
  const m = memo(w), key = la < lb ? `${la}:${lb}` : `${lb}:${la}`; if (m.ports.has(key)) return m.ports.get(key)!;
  const [x, y] = la < lb ? [la, lb] : [lb, la], A = citiesOf(w, x), B = citiesOf(w, y); let best: Crossing | null = null, bd = Infinity;
  for (const a of A) for (const b of B) {
    const d = dist(a.pos, b.pos) * (a.coastal ? 1 : 1.35) * (b.coastal ? 1 : 1.35);
    if (d < bd - 1e-9 || (Math.abs(d - bd) < 1e-9 && best && a.id + b.id < best.a.id + best.b.id)) { bd = d; best = { la: x, lb: y, a, b, km: Math.round(dist(a.pos, b.pos) * 10) / 10, gapKm: 0 }; }
  }
  if (best) best.gapKm = gapKm(w, x, y);
  m.ports.set(key, best && best.km <= MAX_FERRY_KM ? best : null); return m.ports.get(key)!;
}
/** The masses to pass through to get from `from` to `to` (inclusive), by total ferry distance; null when no chain of crossings reaches it. */
export function massRoute(w: World, from: number, to: number): number[] | null {
  if (from === to) return [from];
  const nodes = servedMasses(w), dist2 = new Map<number, number>(nodes.map((n) => [n, Infinity])), prev = new Map<number, number>(); dist2.set(from, 0);
  const todo = new Set(nodes);
  while (todo.size) {
    let u = -1, ud = Infinity; for (const n of todo) { const d = dist2.get(n)!; if (d < ud) { ud = d; u = n; } } if (u < 0) break; todo.delete(u); if (u === to) break;
    for (const v of nodes) if (v !== u && todo.has(v)) { const c = crossingPorts(w, u, v); if (!c) continue; const nd = ud + c.km + 60; if (nd < dist2.get(v)!) { dist2.set(v, nd); prev.set(v, u); } }
  }
  if (!isFinite(dist2.get(to) ?? Infinity)) return null; const out = [to]; while (out[0] !== from) out.unshift(prev.get(out[0])!); return out;
}

/** The ferry edge of this mode joining two port cities (either direction), if one exists. */
export function findFerry(sim: SimState, w: World, ca: WCity, cb: WCity, mode: Mode = "road"): SimEdge | null {
  const na = nodeCell(sim, ca.cell), nb = nodeCell(sim, cb.cell); if (!na || !nb) return null;
  for (const e of Object.values(sim.edges)) if (e.facility === "ferry" && modeOf(e) === mode && ((e.a === na && e.b === nb) || (e.a === nb && e.b === na))) return e;
  return null;
}
const nodeCell = (sim: SimState, cell: number): string | null => { for (const n of Object.values(sim.nodes)) if (n.cell === cell) return n.id; return null; };
/** Start a ferry service between two ports. Not designated as a numbered route; it carries whatever route is laid across it. */
export function makeFerry(sim: SimState, w: World, ca: WCity, cb: WCity, mode: Mode = "road", reason = "島・半島の間を結ぶ航路(1950年の既存の連絡)"): SimEdge {
  const old = findFerry(sim, w, ca, cb, mode); if (old) return old;
  return makeFerryAt(sim, w, ca, cb, mode, reason, `ferry:${ca.name.replace(/市$/, "")}〜${cb.name.replace(/市$/, "")}${mode === "rail" ? "鉄道連絡船" : "フェリー"}`);
}
/** The same for any two end points that have a cell and a position (a lakeshore port is not a city). */
export function makeFerryAt(sim: SimState, w: World, ca: { cell: number; pos: Vec }, cb: { cell: number; pos: Vec }, mode: Mode, reason: string, facilityName: string): SimEdge {
  const idx = buildIndex(sim, mode), a = nodeSplitAt(sim, w, idx, ca.cell), b = nodeSplitAt(sim, w, idx, cb.cell), id = newId(sim, "edge");
  const km = Math.round(dist(ca.pos, cb.pos) * 10) / 10, rail = mode === "rail";
  const e: SimEdge = {
    ...newEdgeDefaults(), id, a, b, cells: [ca.cell, cb.cell], lengthKm: km, surface: "paved", quality: 90, built: 1, open: true, state: "open", standard: "rural", maxGradePct: 0, builtMonth: sim.month,
    region: w.prefOf(ca.cell) ?? "JP-13", facility: "ferry", facilityName, ...(rail ? { mode: "rail" as const, op: "jnr" } : {}),
  };
  sim.edges[id] = e; pushHist(sim, e, `${reason}`); return e;
}
/** Is there a bridge or a tunnel (a fixed link) joining these two masses for this mode? Open ones only, unless `anyState` (a closed one still counts as built). */
export function fixedLink(sim: SimState, w: World, la: number, lb: number, mode: Mode, anyState = false): SimEdge | null {
  for (const e of Object.values(sim.edges)) {
    if ((e.facility !== "bridge" && e.facility !== "tunnel") || modeOf(e) !== mode || e.built < 1 || (!anyState && e.state !== "open")) continue;
    const ma = w.lm[e.cells[0]], mb = w.lm[e.cells[e.cells.length - 1]]; if ((ma === la && mb === lb) || (ma === lb && mb === la)) return e;
  }
  return null;
}

/**
 * The ferry network a new game starts with: every land mass is joined to the rest by sea, so that even a distant island is reachable on day one without
 * any bridge being forced into 1950. A pair gets a service when it joins two parts not yet joined (nearest first, up to MAX_FERRY_KM) or when it is a short strait.
 * Railways get a connecting steamer only where both port cities have a railway and no fixed rail link already joins the masses.
 */
export function seedFerries(sim: SimState, w: World): number {
  const masses = servedMasses(w), pairs: Crossing[] = [];
  for (let i = 0; i < masses.length; i++) for (let j = i + 1; j < masses.length; j++) { const c = crossingPorts(w, masses[i], masses[j]); if (c) pairs.push(c); }
  pairs.sort((p, q) => p.km - q.km || (p.a.id + p.b.id < q.a.id + q.b.id ? -1 : 1));
  const comp = new Map<number, number>(masses.map((m) => [m, m])), root = (x: number): number => (comp.get(x) === x ? x : (comp.set(x, root(comp.get(x)!)), comp.get(x)!)); let n = 0;
  const railNode = new Set<string>(); for (const e of Object.values(sim.edges)) if (modeOf(e) === "rail" && e.facility !== "ferry") { railNode.add(e.a); railNode.add(e.b); }
  for (const c of pairs) {
    const joins = root(c.la) !== root(c.lb); if (!joins && c.km > SHORT_STRAIT_KM) continue;
    if (joins) comp.set(root(c.la), root(c.lb));
    if (!fixedLink(sim, w, c.la, c.lb, "road")) { makeFerry(sim, w, c.a, c.b, "road"); n++; }
    const na = nodeCell(sim, c.a.cell), nb = nodeCell(sim, c.b.cell);
    if (na && nb && railNode.has(na) && railNode.has(nb) && !fixedLink(sim, w, c.la, c.lb, "rail")) { makeFerry(sim, w, c.a, c.b, "rail", "鉄道連絡船(1950年の既存の連絡)"); n++; }
  }
  ev(sim, "seed", `1950年の航路: フェリー・連絡船${n}本(島や海を隔てた地域をまず船でつなぐ)`, "初期条件。橋やトンネルを1950年に強制せず、まず航路で結ぶ(合成。実在の航路表ではない)", {}); return n;
}

// ---------------------------------------------------------------- Issue #18: Lake Biwa ferries ----------
/**
 * A lake is NOT the sea: its two shores are one land mass, so none of the strait logic (bridges, tunnels, `lm`) applies. A lake ferry is an ordinary ferry edge between two PORTS on
 * the lakeshore, named 【湖】 so it is told apart. Ports are shore cells (not cities); each is joined to the road network (an existing road if one passes within 20 km, else a rural
 * access road is laid), so the ferry connects to the roads like any other link. Everything is derived from the lake as it stands on the map: a lake moved or resized before the
 * game began gets its ports and routes where it now is, nothing where it used to be.
 * Era / demand / cost: the long route (along the lake) runs from 1950; a second, cross route is opened by the yearly review only when the long one is busy, the era has the
 * appetite for roads, and the port works cost under 2% of the year's budget. An unused service is closed by the ordinary edge review.
 */
/** Stage 8: how many lake services a lake of this many cells may have at once (a small lake stays at one), and when the extra crossings exist. */
export const LAKE_NARROW_KM: [number, number] = [3, 16];
export const LAKE_EXTRA_CELLS = 40, LAKE_BRIDGE_TAG = "【湖上橋】", LAKE_POP_DEMAND = 600000;
export const maxLakeRoutes = (cells: number) => Math.max(1, Math.min(4, 1 + Math.floor(cells / 20)));
export const LAKE_TAG = "【湖】", LAKE_MIN_CELLS = 4, LAKE_CROSS_CELLS = 20, LAKE_MIN_KM = 12, LAKE_PORT_COST_PER_KM = 0.004, LAKE_SNAP_KM = 20, LAKE_CROSS_LOAD = 0.5, LAKE_CROSS_YEAR = 1965;
export const isLakeFerry = (e: SimEdge) => e.facility === "ferry" && (e.facilityName ?? "").startsWith(`ferry:${LAKE_TAG}`);
export interface LakeCrossing { id: "long" | "narrow" | "cross" | "cross2" | "cross3"; portA: number; portB: number; km: number; nameA: string; nameB: string }
/** The ferry routes the lake allows (pure function of the map). `long` follows the lake's long axis; `cross` (big lakes only) its short one. */
export function lakeCrossings(w: World): LakeCrossing[] {
  const lake: number[] = []; for (let k = 0; k < w.N; k++) if (w.t.land[k] === 2) lake.push(k); if (lake.length < LAKE_MIN_CELLS) return [];
  const N8: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]], shore: number[] = [], seen = new Set<number>();
  for (const k of lake) { const i = k % w.nx, j = (k / w.nx) | 0; for (const [di, dj] of N8) { const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= w.nx || b >= w.ny) continue; const q = b * w.nx + a; if (w.t.land[q] === 1 && w.lm[q] > 0 && !seen.has(q)) { seen.add(q); shore.push(q); } } }
  if (shore.length < 2) return [];
  const pts = lake.map((k) => w.cellPos(k)), mx = pts.reduce((s, p) => s + p[0], 0) / pts.length, my = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  let sxx = 0, syy = 0, sxy = 0; for (const p of pts) { sxx += (p[0] - mx) ** 2; syy += (p[1] - my) ** 2; sxy += (p[0] - mx) * (p[1] - my); }
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy), u: Vec = [Math.cos(ang), Math.sin(ang)], n: Vec = [-u[1], u[0]];
  const town = (k: number) => { let best = w.cities[0], bd = Infinity; for (const c of w.cities) { const d = dist(c.pos, w.cellPos(k)); if (d < bd) { bd = d; best = c; } } return best.name.replace(/市$/, ""); };
  const pick = (axis: Vec, near: Vec | null, at = 0, id: LakeCrossing["id"] = near ? "cross" : "long"): LakeCrossing | null => {
    const proj = (k: number, ax: Vec) => { const p = w.cellPos(k); return (p[0] - mx) * ax[0] + (p[1] - my) * ax[1]; }, other: Vec = [-axis[1], axis[0]];
    const cand = near ? shore.filter((k) => Math.abs(proj(k, other) - at) < w.cell * (at ? 1.6 : 3)) : shore;
    if (cand.length < 2) return null; let lo = cand[0], hi = cand[0]; for (const k of cand) { if (proj(k, axis) < proj(lo, axis)) lo = k; if (proj(k, axis) > proj(hi, axis)) hi = k; }
    if (w.lm[lo] !== w.lm[hi]) return null; const km = Math.round(dist(w.cellPos(lo), w.cellPos(hi)) * 10) / 10; if (km < LAKE_MIN_KM) return null;
    const na = town(lo), nb = town(hi); return { id, portA: lo, portB: hi, km, nameA: na, nameB: nb === na ? `${nb}対岸` : nb };
  };
  const out: LakeCrossing[] = [], l = pick(u, null); if (l) out.push(l);
  const add = (c: LakeCrossing | null) => { if (c && c.km >= LAKE_MIN_KM && !out.some((o) => (o.portA === c.portA && o.portB === c.portB) || (o.portA === c.portB && o.portB === c.portA))) out.push(c); };
  // Stage 8: the narrows -- the shortest stretch of open water between two shores of the same land (where a lake is first bridged); listed before the wide crossings
  if (lake.length >= LAKE_CROSS_CELLS) {
    let best: [number, number, number] | null = null;
    for (let x = 0; x < shore.length; x++) for (let y = x + 1; y < shore.length; y++) {
      const a = shore[x], b = shore[y]; if (w.lm[a] !== w.lm[b]) continue; const pa = w.cellPos(a), pb = w.cellPos(b), d = dist(pa, pb); if (d < LAKE_NARROW_KM[0] || d > LAKE_NARROW_KM[1] || (best && d >= best[2])) continue;
      let wet = 0; const S = 12; for (let k = 1; k < S; k++) { const c = w.cellOf([pa[0] + ((pb[0] - pa[0]) * k) / S, pa[1] + ((pb[1] - pa[1]) * k) / S]); if (c >= 0 && w.t.land[c] === 2) wet++; }
      if (wet >= 0.7 * (S - 1)) best = [a, b, d];
    }
    if (best) { const na = town(best[0]), nb = town(best[1]); out.push({ id: "narrow", portA: best[0], portB: best[1], km: Math.round(best[2] * 10) / 10, nameA: na, nameB: nb === na ? `${nb}対岸` : nb }); }
  }
  if (lake.length >= LAKE_CROSS_CELLS) add(pick(n, [0, 0]));
  // Stage 8: a big lake has room for more crossings, a quarter of the way along its length from each end (a small one never gets them)
  if (lake.length >= LAKE_EXTRA_CELLS) { const half = Math.sqrt(Math.max(sxx, syy) / pts.length) * 1.2; add(pick(n, [0, 0], half, "cross2")); add(pick(n, [0, 0], -half, "cross3")); }
  return out;
}
/** The nearest city's name, without 市 (a port or a shore is named after its town). */
export function nearTown(w: World, k: number): string { let best = w.cities[0], bd = Infinity; for (const c of w.cities) { const d = dist(c.pos, w.cellPos(k)); if (d < bd) { bd = d; best = c; } } return best.name.replace(/市$/, ""); }
/** Stage 8: a road bridge straight across a lake between two shore cells (drawn as a bridge across the water, never as a road on land). */
export function makeLakeBridgeAt(sim: SimState, w: World, ca: { cell: number; pos: Vec }, cb: { cell: number; pos: Vec }, facilityName: string, reason: string, mode: Mode = "road"): SimEdge {
  const idx = buildIndex(sim, mode), a = nodeSplitAt(sim, w, idx, ca.cell), b = nodeSplitAt(sim, w, idx, cb.cell), id = newId(sim, "edge"), km = Math.round(dist(ca.pos, cb.pos) * 10) / 10;
  const cells = [ca.cell, cb.cell];   // like a ferry or a strait link, only its two shore ends are cells (every road cell is land); it is drawn straight across
  const e: SimEdge = { ...newEdgeDefaults(), id, a, b, cells, lengthKm: km, surface: "paved", quality: 90, built: 1, open: true, state: "open", standard: "rural", maxGradePct: 0, builtMonth: sim.month, region: w.prefOf(ca.cell) ?? "JP-13", facility: "bridge", facilityName, ...(mode === "rail" ? { mode: "rail" as const, op: "jnr" } : {}) };
  sim.edges[id] = e; pushHist(sim, e, reason); return e;
}
/** What the port works cost (budget units, a rough proportional figure). */
export const lakePortCost = (c: LakeCrossing) => Math.round((0.05 + LAKE_PORT_COST_PER_KM * c.km) * 1000) / 1000;
export const lakeFerryName = (c: LakeCrossing) => `ferry:${LAKE_TAG}${c.nameA}港〜${c.nameB}港湖上フェリー${c.id === "long" ? "" : "(横断)"}`;
export const lakeEdge = (sim: SimState, c: LakeCrossing): SimEdge | null => Object.values(sim.edges).find((e) => isLakeFerry(e) && e.facilityName === lakeFerryName(c)) ?? null;
/** A port is useful only if roads reach it: share a road that already passes within LAKE_SNAP_KM, else lay a rural access road to the nearest road (or city). Returns the cell the port ends up at. */
function connectPort(sim: SimState, w: World, cell: number): number {
  const idx = buildIndex(sim, "road"), R = Math.ceil(LAKE_SNAP_KM / w.cell), ci = cell % w.nx, cj = (cell / w.nx) | 0, lay = (to: number, margin: number) => { const path = pathfind(w, cell, to, { margin }); if (path && path.length > 1) layPath(sim, w, path, { open: true, surface: "unpaved", quality: 40, built: 1, month: sim.month, standard: "rural" }); };
  if (idx.nodeByCell.has(cell)) return cell;
  let best = -1, bd = Infinity; for (const q of idx.nodeByCell.keys()) { if (w.lm[q] !== w.lm[cell]) continue; const d = Math.hypot((q % w.nx) - ci, ((q / w.nx) | 0) - cj); if (d < bd) { bd = d; best = q; } }
  if (best >= 0) lay(best, bd <= R ? 6 : 24);   // an existing road node within reach, else the nearest one (a longer access road)
  return cell;
}
function openLake(sim: SimState, w: World, c: LakeCrossing, reason: string): SimEdge {
  const pa = connectPort(sim, w, c.portA), pb = connectPort(sim, w, c.portB);
  return makeFerryAt(sim, w, { cell: pa, pos: w.cellPos(pa) }, { cell: pb, pos: w.cellPos(pb) }, "road", reason, lakeFerryName(c));
}
/** The lake ferry a new game starts with: the long route (1950, like the sea ferries). */
export function seedLakeFerries(sim: SimState, w: World): number {
  const c = lakeCrossings(w).find((x) => x.id === "long"); if (!c || lakeEdge(sim, c)) return 0;
  const e = openLake(sim, w, c, `湖上フェリー(1950年の既存の連絡。湖岸の港${c.nameA}港・${c.nameB}港、港の整備費${lakePortCost(c)})`);
  ev(sim, "seed", `1950年の湖上フェリー: ${c.nameA}港〜${c.nameB}港(${e.lengthKm}km)`, "湖は海ではない。同じ陸地の湖岸の港を結ぶ(合成。実在の航路表ではない)", { edge: e.id }); return 1;
}
/**
 * Yearly (Stage 8): the lake's services grow with it. A new crossing opens when an existing lake service is busy or the towns round the lake are big
 * enough, never beyond what the lake's size allows (maxLakeRoutes), and only when the era builds roads and the port works are affordable. A busy lake
 * ferry is replaced by a bridge once the open water is within what the year's technology can span: the bridge is built as a project and, when it opens,
 * the ferry closes and the routes that used it (国道1号 among them) move onto the bridge. Unused services close through the ordinary edge review.
 */
export function reviewLakeFerries(sim: SimState, w: World, y: number): number {
  const cs = lakeCrossings(w); if (!cs.length) return 0;
  let lakeCells = 0; for (let k = 0; k < w.N; k++) if (w.t.land[k] === 2) lakeCells++;
  const open = Object.values(sim.edges).filter((e) => isLakeFerry(e) && e.state === "open" && e.built >= 1), load = (e: SimEdge) => (e.through + e.local + 0.4 * e.freight) / capacityOf(e);
  const busiest = open.reduce((m, e) => Math.max(m, load(e)), 0), lc = lakeCentre(w);
  const shorePop = w.cities.filter((c) => dist(c.pos, lc) < Math.sqrt(lakeCells) * w.cell + 25).reduce((s, c) => s + (sim.cities[c.id]?.pop ?? 0), 0);
  let n = 0;
  const live = Object.values(sim.edges).filter((e) => isLakeFerry(e) && (e.state === "open" || e.state === "dormant") && e.built >= 1).length;
  const next = cs.find((c) => !lakeEdge(sim, c)), cost = next ? lakePortCost(next) : 0, bridges = Object.values(sim.edges).filter((e) => e.facility === "bridge" && (e.facilityName ?? "").includes("湖上大橋") && e.built >= 1).length;
  if (next && live + bridges < maxLakeRoutes(lakeCells) && y >= LAKE_CROSS_YEAR && (busiest >= LAKE_CROSS_LOAD || shorePop >= LAKE_POP_DEMAND) && sim.dials.hwyBuild >= 0.3 && sim.macro.budgetBu * 0.02 >= cost) {
    const e = openLake(sim, w, next, `湖上フェリーの新設(${busiest >= LAKE_CROSS_LOAD ? `湖の航路の混雑${Math.round(busiest * 100)}%` : `湖岸の人口${Math.round(shorePop / 1000)}千人`}。港の整備費${cost})`);
    ev(sim, "ferry", `湖上フェリー新設: ${next.nameA}港〜${next.nameB}港`, `${y}年、${busiest >= LAKE_CROSS_LOAD ? "湖の航路が混み" : "湖岸の町が育ち"}、港の整備費${cost}を負担できた(湖の大きさで最大${maxLakeRoutes(lakeCells)}航路)`, { edge: e.id }); n++;
  }
  if (sim.tech && !Object.values(sim.projects).some((p) => p.reason.startsWith(LAKE_BRIDGE_TAG) && (p.status === "planned" || p.status === "building" || p.status === "concept"))) {
    const span = techAt(sim.tech.k, y).bridgeKm;
    // a busy lake ferry within the span is replaced; failing that, when the lake's services are busy, the narrows (or any crossing within the span) get a bridge of their own
    const ferryC = open.map((e) => ({ e, a: sim.nodes[e.a].cell, b: sim.nodes[e.b].cell, water: Math.max(0.5, dist(w.cellPos(e.cells[0]), w.cellPos(e.cells[e.cells.length - 1])) - w.cell), l: load(e) })).filter((c) => c.water <= span && c.l >= LAKE_BRIDGE_LOAD).sort((p, q) => q.l - p.l)[0];
    const spanned = (a: number, b: number) => Object.values(sim.edges).some((e) => e.facility === "bridge" && (e.facilityName ?? "").includes("湖上大橋") && [sim.nodes[e.a]?.cell, sim.nodes[e.b]?.cell].sort().join() === [a, b].sort().join());
    const lakeC = busiest >= LAKE_BRIDGE_LOAD ? cs.map((c) => ({ c, water: Math.max(0.5, c.km - w.cell) })).filter((x) => x.water <= span && !spanned(x.c.portA, x.c.portB)).sort((p, q) => p.water - q.water)[0] : undefined;
    const pick = sim.dials.hwyBuild < 0.35 ? null : ferryC && !spanned(ferryC.a, ferryC.b) ? { a: ferryC.a, b: ferryC.b, water: ferryC.water, l: ferryC.l, replace: true } : lakeC ? { a: connectPort(sim, w, lakeC.c.portA), b: connectPort(sim, w, lakeC.c.portB), water: lakeC.water, l: busiest, replace: false } : null;
    if (pick) {
      const na = nearTown(w, pick.a), nb = nearTown(w, pick.b), nbx = nb === na ? `${nb}対岸` : nb;
      const be = makeLakeBridgeAt(sim, w, { cell: pick.a, pos: w.cellPos(pick.a) }, { cell: pick.b, pos: w.cellPos(pick.b) }, `bridge:${na}〜${nbx}湖上大橋`, pick.replace ? "湖上フェリーに代わる橋として計画" : "湖の狭い所に架ける橋として計画");
      be.built = 0; be.open = false; be.state = "closed"; be.builtMonth = null; be.standard = "standard";
      const cost = Math.round(pick.water * 2.2 * 1.8 * (1 + pick.water / 15) * 100) / 100;
      const p = createProject(sim, "new", "JP", be.a, be.b, [be.id], [{ edgeId: be.id, dir: 1 }], cost, `${LAKE_BRIDGE_TAG}${pick.replace ? `${na}〜${nbx}の湖上フェリーは混雑(${Math.round(pick.l * 100)}%)` : `湖の航路が混雑(${Math.round(pick.l * 100)}%)`}。湖面${pick.water}kmは橋で渡せる技術がある`, 2.5 + Math.min(2, pick.l));
      ev(sim, "project", `湖上の架橋計画: ${na}〜${nbx}`, `${p.reason}(工費の目安${cost})`, { project: p.id, edge: be.id }); n++;
    }
  }
  return n;
}
export const LAKE_BRIDGE_LOAD = 0.6;
function lakeCentre(w: World): Vec { let x = 0, y = 0, c = 0; for (let k = 0; k < w.N; k++) if (w.t.land[k] === 2) { const p = w.cellPos(k); x += p[0]; y += p[1]; c++; } return c ? [x / c, y / c] : [0, 0]; }
