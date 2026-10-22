/**
 * Stage 10 (Issue #26): the 1945 reconstruction policy. Only the FIRST era choice carries it (CAND_1945); the 1989 / 2019 / later choices never re-assign it.
 * Two axes, handed out evenly over the candidates (like the transport stances, and independent of them):
 *   coast  太平洋側重視 / 日本海側重視   -- by REAL geography: which sea a city lies nearer to (see `coastSide`), never by prefecture name
 *   focus  一極集中 / 地方分散          -- toward or away from the seats of government (closeness to the capital and the sub-capital the player chose)
 *
 * The coast axis is about the real seas, the focus axis about the chosen seats -- so a Sapporo capital with a 日本海側 policy is two separate effects, never confused.
 *
 * What it acts on, from 1950 on (full strength through the reconstruction years, easing to half by 2000 and staying there -- what was built and who moved stays):
 *   population  a yearly growth difference, REDISTRIBUTED (the population-weighted mean is taken out, so the national course is unchanged)
 *   industry    the level a city's industry grows toward
 *   budget      the regional share of the road purse (renormalised: the national purse is unchanged)
 *   planning    the priority of new links between two cities (the reason text says so)
 * Older games (no `recon` on their era timeline) are unaffected.
 */
import { realToLonLat } from "../core/data";
import { homeCity, subCity } from "./ceremony";
import type { Recon } from "./kaigen";
import type { SimState } from "./types";
import type { World } from "./world";

export const RECON_LABEL = { pacific: "太平洋側重視", japansea: "日本海側重視", concentrate: "一極集中", disperse: "地方分散" } as const;
export const RECON_GROWTH = 0.0035, RECON_INDUSTRY = 0.08, RECON_SHARE = 0.25, RECON_PLAN = 0.25, CORE_KM = 150, SUB_CORE = 0.7;
/** Stage 14 (Issue #35): measured at Stage 13, choosing 日本海側重視 moved the Sea-of-Japan side's share of the nation's people by about two points in fifty years and its road and rail by nothing --
 * the four terms above were far smaller than the demand-driven planner and the economy they sit on. A game made from Stage 14 on takes them RECON_BOOST times as strong. The terms are still
 * leans, not orders: a city's own geography, its distances and the economy decide the rest, so the Pacific side still grows where it has the demand, and the order of the two coasts changes
 * with the policy and the conditions, it is not fixed. Older games keep the strength they were made with. */
export const RECON_BOOST = 2.5;
/** Stage 15: the policy is also a PRIORITY, not only a multiplier on demand. A multiplier of at most ~1.6 cannot lift a corridor whose demand is a third of a Pacific-belt corridor's, and the planner builds one or two new links a year
 * nationwide, so a policy that only scaled the score never reached the small cities of the other coast. Games from Stage 15 on add RECON_ADD x boost x lean to the corridor's score as well (in the score's own units: a typical new corridor scores 0.5 to 2.5). */
export const RECON_ADD = 0.35;
const boost = (sim: SimState) => (sim.seats14 ? RECON_BOOST : 1);
export const reconFade = (y: number) => (y < 1975 ? 1 : y < 2000 ? 1 - 0.5 * ((y - 1975) / 25) : 0.5);
export const reconText = (r: Recon) => `${RECON_LABEL[r.coast]}・${RECON_LABEL[r.focus]}`;

// ---- the two seas, by real longitude / latitude (outlines of the sea areas; land inside them is ignored) ----
/** The Sea of Japan, bounded by the main islands' spine, the Korea / Tsushima strait, Tsugaru and Soya; includes the Genkai sea off northern Kyushu. */
const JAPAN_SEA: [number, number][] = [[127.0, 34.3], [129.3, 33.6], [130.3, 33.55], [130.95, 33.95], [131.5, 34.4], [132.5, 34.9], [133.5, 35.1], [134.5, 35.2], [135.3, 35.35], [136.2, 35.45],
  [137.5, 36.3], [138.6, 36.9], [140.0, 38.2], [140.4, 40.0], [140.35, 41.0], [140.2, 41.4], [140.2, 41.9], [140.6, 42.8], [141.4, 43.0], [141.9, 44.5], [141.95, 45.45], [142.0, 46.0], [142.0, 50.0], [141.5, 53.0], [140.0, 48.0], [130.5, 42.5], [129.5, 37.0], [128.5, 35.0]];
/** The Sea of Okhotsk (with the Nemuro strait): neither side. */
const OKHOTSK: [number, number][] = [[141.95, 45.45], [142.3, 44.0], [144.5, 43.6], [145.2, 43.3], [145.9, 43.4], [146.5, 44.5], [150.0, 47.0], [143.0, 52.0], [142.2, 46.2]];
const bbox = (p: [number, number][]) => [Math.min(...p.map((q) => q[0])), Math.max(...p.map((q) => q[0])), Math.min(...p.map((q) => q[1])), Math.max(...p.map((q) => q[1]))];
const JS_BOX = bbox(JAPAN_SEA), OK_BOX = bbox(OKHOTSK);
function inPoly(poly: [number, number][], x: number, y: number): boolean { const b = poly === JAPAN_SEA ? JS_BOX : poly === OKHOTSK ? OK_BOX : null; if (b && (x < b[0] || x > b[1] || y < b[2] || y > b[3])) return false; let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; }
/** Sea cells: 1 = Sea of Japan, 2 = Pacific side (Pacific, Seto Inland Sea, East China Sea), 0 = land / lake / Okhotsk. Real-map games: the world frame is the real one. */
export function seaClass(w: World, k: number): 0 | 1 | 2 {
  if (w.t.land[k] !== 0) return 0; const [lon, lat] = realToLonLat(w.cellPos(k)); if (inPoly(OKHOTSK, lon, lat)) return 0; return inPoly(JAPAN_SEA, lon, lat) ? 1 : 2;
}
const sideMemo = new WeakMap<World, Map<string, number>>();
const CAP_CELLS = 80;
/** -1 (on the Sea of Japan) .. +1 (on the Pacific side), from the distances to the nearest sea of each kind; inland cities in between. Computed once per world
 * (two breadth-first sweeps over the grid with typed arrays: about a tenth of a second on a phone). */
export function coastSide(w: World, cityId: string): number {
  let m = sideMemo.get(w);
  if (!m) {
    // the world frame is the real one here, so longitude depends on the column only and latitude on the row only
    const cls = new Uint8Array(w.N), lon = Float64Array.from({ length: w.nx }, (_, i) => realToLonLat(w.cellPos(i))[0]), lat = Float64Array.from({ length: w.ny }, (_, j) => realToLonLat(w.cellPos(j * w.nx))[1]);
    // scanline: per row, where each outline's edges cross that latitude; a cell is inside when an odd number of crossings lie west of it (same rule as inPoly)
    const cross = (poly: [number, number][], y: number) => { const xs: number[] = []; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if (yi > y !== yj > y) xs.push(((xj - xi) * (y - yi)) / (yj - yi) + xi); } return xs.sort((p, q) => p - q); };
    const inside = (xs: number[], x: number) => { let n = 0; for (const v of xs) if (x < v) n++; return n % 2 === 1; };
    for (let j = 0; j < w.ny; j++) { const cj = cross(JAPAN_SEA, lat[j]), co = cross(OKHOTSK, lat[j]); for (let i = 0; i < w.nx; i++) { const k = j * w.nx + i; if (w.t.land[k] !== 0) continue; const x = lon[i]; cls[k] = co.length && inside(co, x) ? 0 : cj.length && inside(cj, x) ? 1 : 2; } }
    const dist = (c: 1 | 2) => {
      const d = new Uint8Array(w.N).fill(255), q = new Int32Array(w.N); let n = 0; for (let k = 0; k < w.N; k++) if (cls[k] === c) { d[k] = 0; q[n++] = k; }
      const nx = w.nx, ny = w.ny;
      for (let h = 0; h < n; h++) { const k = q[h], dk = d[k]; if (dk >= CAP_CELLS) continue; const i = k % nx, j = (k / nx) | 0, nd = dk + 1;
        if (i + 1 < nx && d[k + 1] > nd) { d[k + 1] = nd; q[n++] = k + 1; } if (i > 0 && d[k - 1] > nd) { d[k - 1] = nd; q[n++] = k - 1; }
        if (j + 1 < ny && d[k + nx] > nd) { d[k + nx] = nd; q[n++] = k + nx; } if (j > 0 && d[k - nx] > nd) { d[k - nx] = nd; q[n++] = k - nx; } }
      return d;
    };
    const dj = dist(1), dp = dist(2); m = new Map(); for (const c of w.cities) { const a = Math.min(CAP_CELLS, dj[c.cell]), b = Math.min(CAP_CELLS, dp[c.cell]); m.set(c.id, (a - b) / (a + b + 1)); } sideMemo.set(w, m);
  }
  return m.get(cityId) ?? 0;
}
/** 0..1: how close a city stands to the seats of government chosen for this game. */
export function coreness(sim: SimState, w: World, cityId: string): number {
  const c = w.cityById.get(cityId); if (!c) return 0; const hc0 = homeCity(w, sim.capital), sc0 = subCity(w, sim.subCapital), hc = sim.capitalPos && hc0 ? { ...hc0, pos: sim.capitalPos } : hc0, sc = sim.subPos && sc0 ? { ...sc0, pos: sim.subPos } : sc0;   // (Stage 19: a seat put on the map counts from that point)
  const f = (p: { pos: [number, number] | number[] } | null | undefined, wt: number) => (p ? wt * Math.exp(-Math.hypot(p.pos[0] - c.pos[0], p.pos[1] - c.pos[1]) / CORE_KM) : 0);
  return Math.max(f(hc, 1), f(sc, SUB_CORE));
}
export const reconOf = (sim: SimState): Recon | null => sim.kaigen?.recon ?? null;
const sgnC = (r: Recon) => (r.coast === "pacific" ? 1 : -1), sgnF = (r: Recon) => (r.focus === "concentrate" ? 1 : -1);
/** Per city: the raw lean of the policy (coast and focus terms), before the national mean is taken out. */
function lean(sim: SimState, w: World, r: Recon, id: string, meanCore: number) { return { coast: sgnC(r) * coastSide(w, id), focus: sgnF(r) * (coreness(sim, w, id) - meanCore) }; }
function meanCoreOf(sim: SimState, w: World): number { let s = 0, p = 0; for (const c of w.cities) { const n = sim.cities[c.id]?.pop ?? 0; s += n * coreness(sim, w, c.id); p += n; } return p ? s / p : 0; }
/** The yearly growth difference of every city (population-weighted mean 0: people move, the nation does not grow). Empty without a policy. */
export function reconGrowth(sim: SimState, w: World, y: number): Map<string, number> {
  const r = reconOf(sim), out = new Map<string, number>(); if (!r) return out; const f = reconFade(y), mc = meanCoreOf(sim, w); let s = 0, p = 0;
  for (const c of w.cities) { const l = lean(sim, w, r, c.id, mc), g = RECON_GROWTH * boost(sim) * f * (l.coast + l.focus), n = sim.cities[c.id]?.pop ?? 0; out.set(c.id, g); s += g * n; p += n; }
  const mean = p ? s / p : 0; for (const [k, v] of out) out.set(k, v - mean); return out;
}
/** Added to the industry level a city grows toward. */
export function reconIndustry(sim: SimState, w: World, cityId: string, y: number, meanCore?: number): number {
  const r = reconOf(sim); if (!r) return 0; const l = lean(sim, w, r, cityId, meanCore ?? meanCoreOf(sim, w)); return RECON_INDUSTRY * boost(sim) * reconFade(y) * (l.coast + l.focus);
}
/** Multiplies a city's weight in the regional budget split (the shares are renormalised, so only the split changes). */
export function reconShare(sim: SimState, w: World, cityId: string, y: number, meanCore?: number): number {
  const r = reconOf(sim); if (!r) return 1; const l = lean(sim, w, r, cityId, meanCore ?? meanCoreOf(sim, w)); return Math.max(sim.seats14 ? 0.25 : 0.3, 1 + RECON_SHARE * boost(sim) * reconFade(y) * (l.coast + l.focus));
}
export const reconMeanCore = meanCoreOf;
/** Priority factor of a new link between cities i and j, and the words for the plan's reason. */
export function reconCorridor(sim: SimState, w: World, i: number, j: number, y: number, meanCore: number): { f: number; why: string; add: number } {
  const r = reconOf(sim); if (!r) return { f: 1, why: "", add: 0 }; const a = w.cities[i], b = w.cities[j], la = lean(sim, w, r, a.id, meanCore), lb = lean(sim, w, r, b.id, meanCore);
  const v = ((la.coast + lb.coast) / 2) * 1 + (la.focus + lb.focus) / 2, f = Math.max(sim.seats14 ? 0.25 : 0.5, 1 + RECON_PLAN * boost(sim) * reconFade(y) * v);
  const add = sim.pop15 ? RECON_ADD * boost(sim) * reconFade(y) * v : 0, eff = f + (add ? add / 2 : 0);
  return { f, add, why: Math.abs(eff - 1) >= 0.05 ? `復興方針(${reconText(r)})により${eff > 1 ? "優先" : "後回し"}` : "" };
}

/** Stage 15: how far a region (prefecture) as a whole is favoured by the policy, -1..1: the people-weighted mean of its cities' lean (the same lean the budget, growth and corridor terms use). */
export function reconRegionLean(sim: SimState, w: World, region: string, meanCore: number): number {
  const r = reconOf(sim); if (!r) return 0; let s = 0, p = 0;
  for (const c of w.cities) if (c.pref === region) { const l = lean(sim, w, r, c.id, meanCore), n = sim.cities[c.id]?.pop ?? 0; s += n * (l.coast + l.focus); p += n; }
  return p ? s / p : 0;
}
/** Regions the policy favours work faster: one more new link a year and one more job at a time (Stage 15 games). */
export const FAVOURED_LEAN = 0.5;
/** Stage 15: in a region the policy favours, a paved two-lane trunk road that carries POLICY_TRUNK_MIN vehicles a day or more is built up to an ordinary road at the priority POLICY_TRUNK_SCORE (a typical jam-driven job scores 3 or more, a paving job 1 to 2), fading with the policy. */
export const POLICY_TRUNK_MIN = 30, POLICY_TRUNK_SCORE = 2.4;

/** Stage 16 (phone check: the 日本海側 policy moved the statistics but not the map -- the national railway was laid in 1950 and the busy-corridor planner never reaches a coast with little traffic): in a region the policy
 * favours, the trunk lines are built UP AHEAD of the jam, at the policy's own priority, the way the Stage 15 paving rule already did for the roads. An ordinary two-lane road that carries POLICY_HWY_SHARE of its capacity
 * becomes an expressway, a conventional railway that carries POLICY_RAIL_SHARE of its capacity a high-speed line; both at a score that a typical jam-driven job (3 or more) still beats, so the policy goes first where
 * nothing is jammed and never ahead of a real jam. Fading with the policy like every other term. Games from Stage 16 on (those whose world carries the provincial towns). */
export const POLICY_HWY_SHARE = 0.1, POLICY_HWY_SCORE = 2.9, POLICY_RAIL_SHARE = 0.05, POLICY_RAIL_SCORE = 3.3, POLICY_TRUNK_KM = 10;
