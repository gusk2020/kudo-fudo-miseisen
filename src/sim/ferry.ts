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
import { buildIndex, newEdgeDefaults, newId, nodeAtCell, pushHist } from "./network";
import { ev } from "./engine";
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
  const idx = buildIndex(sim, mode), a = nodeAtCell(sim, w, idx, ca.cell, "junction"), b = nodeAtCell(sim, w, idx, cb.cell, "junction"), id = newId(sim, "edge");
  const km = Math.round(dist(ca.pos, cb.pos) * 10) / 10, rail = mode === "rail";
  const e: SimEdge = {
    ...newEdgeDefaults(), id, a, b, cells: [ca.cell, cb.cell], lengthKm: km, surface: "paved", quality: 90, built: 1, open: true, state: "open", standard: "rural", maxGradePct: 0, builtMonth: sim.month,
    region: w.prefOf(ca.cell) ?? "JP-13", facility: "ferry", facilityName: `ferry:${ca.name.replace(/市$/, "")}〜${cb.name.replace(/市$/, "")}${rail ? "鉄道連絡船" : "フェリー"}`, ...(rail ? { mode: "rail" as const, op: "jnr" } : {}),
  };
  sim.edges[id] = e; pushHist(sim, e, `${reason}`); return e;
}
/** Is there a bridge or a tunnel (a fixed link, open) joining these two masses for this mode? */
export function fixedLink(sim: SimState, w: World, la: number, lb: number, mode: Mode): SimEdge | null {
  for (const e of Object.values(sim.edges)) {
    if ((e.facility !== "bridge" && e.facility !== "tunnel") || modeOf(e) !== mode || e.built < 1 || e.state !== "open") continue;
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
