/**
 * Stage 17 (step A): the development-potential rank (1..49) of every prefecture, from the three seats of government. A pure function: nothing in the
 * simulation reads it yet (population, industry, traffic and city birth are not connected). The rank is a potential, not a forced population order.
 */
import { JAPAN, realToLonLat } from "../core/data";
import { mulberry32 } from "../core/rng";
import { PREF_IDS } from "../core/seat";
import type { TerrainResult } from "../core/terrain";

export type Dispersal = "concentrate" | "disperse";
export interface PotentialInput { capital: string; sub: string; palace: string; mode: Dispersal; seed: number }
export interface PotentialData { points: Record<string, [number, number]>; borders: Record<string, number> }   // points: prefecture -> [lon, lat] of its 県庁所在地; borders: "a|b" (a<b) -> shared border length

const R = 6371, rad = (d: number) => (d * Math.PI) / 180;
/** Great-circle distance in km. */
export function greatCircleKm(a: [number, number], b: [number, number]): number {
  const dLat = rad(b[1] - a[1]), dLon = rad(b[0] - a[0]), h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
/** Geometric centre of points on the sphere: the mean of their unit vectors, back to lon/lat. */
export function sphericalCentroid(ps: [number, number][]): [number, number] {
  let x = 0, y = 0, z = 0; for (const [lo, la] of ps) { x += Math.cos(rad(la)) * Math.cos(rad(lo)); y += Math.cos(rad(la)) * Math.sin(rad(lo)); z += Math.sin(rad(la)); }
  return [(Math.atan2(y, x) * 180) / Math.PI, (Math.atan2(z, Math.hypot(x, y)) * 180) / Math.PI];
}
export const borderKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** The prefecture capitals' lon/lat (from the data) and the shared border lengths (from the prefecture grid of a terrain: one unit per shared cell edge). */
export function potentialData(t?: TerrainResult): PotentialData {
  const points: PotentialData["points"] = {}; for (const c of JAPAN.cities) if (c.kind === "capital" && c.pref && PREF_IDS.includes(c.pref)) { const [lo, la] = realToLonLat(c.pos); points[c.pref] = [lo, la]; }
  const borders: PotentialData["borders"] = {};
  if (t) { const { nx, ny } = t.grid, at = (k: number) => (t.land[k] === 1 && t.pref[k] ? t.prefOrder[t.pref[k] - 1] : null);
    for (let k = 0; k < nx * ny; k++) { const a = at(k); if (!a) continue; for (const n of [(k % nx) + 1 < nx ? k + 1 : -1, k + nx < nx * ny ? k + nx : -1]) { if (n < 0) continue; const b = at(n); if (b && b !== a) { const key = borderKey(a, b); borders[key] = (borders[key] ?? 0) + 1; } } } }
  return { points, borders };
}

/** rank (1..49) -> prefecture id, as an array of 49 ids where index 0 is rank 1. */
export function potentialOrder(inp: PotentialInput, d: PotentialData): string[] {
  const ids = PREF_IDS.filter((p) => d.points[p]), order: string[] = [], taken = new Set<string>(), pt = (p: string) => d.points[p];
  const take = (p: string | undefined) => { if (p && !taken.has(p)) { taken.add(p); order.push(p); return true; } return false; };
  const centre = sphericalCentroid([inp.capital, inp.sub, inp.palace].map(pt));
  const free = () => ids.filter((p) => !taken.has(p));
  // 1-3: the seats (a prefecture already ranked is skipped; its place goes to the nearest free prefecture)
  for (const s of [inp.capital, inp.sub, inp.palace]) { if (!take(s)) { const near = free().sort((a, b) => greatCircleKm(pt(s), pt(a)) - greatCircleKm(pt(s), pt(b)) || (a < b ? -1 : 1))[0]; take(near); } }
  // 4-6: the three free prefectures farthest from the centre, the farthest taking rank 6
  const far = free().sort((a, b) => greatCircleKm(centre, pt(b)) - greatCircleKm(centre, pt(a)) || (a < b ? -1 : 1)).slice(0, 3); for (const p of far.reverse()) take(p);
  // neighbours: by shared border length, then (if too few) by the distance between capitals
  const near = (of: string, n: number) => {
    const adj = free().filter((p) => d.borders[borderKey(of, p)]).sort((a, b) => d.borders[borderKey(of, b)] - d.borders[borderKey(of, a)] || (a < b ? -1 : 1)), got: string[] = adj.slice(0, n);
    if (got.length < n) for (const p of free().filter((q) => !got.includes(q)).sort((a, b) => greatCircleKm(pt(of), pt(a)) - greatCircleKm(pt(of), pt(b)) || (a < b ? -1 : 1)).slice(0, n - got.length)) got.push(p);
    for (const p of got) take(p);
  };
  const plan: string[] = inp.mode === "concentrate" ? [inp.capital, inp.sub, inp.capital, inp.sub, inp.capital] : [inp.capital, inp.sub];
  for (const of of plan) near(of, 2);
  // the rest: shuffled by the game's seed (Fisher-Yates over the ids in data order, so a seed always gives the same result)
  const rest = free(), rnd = mulberry32(inp.seed >>> 0); for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
  for (const p of rest) take(p);
  return order;
}
/** prefecture id -> rank (1 = strongest potential). */
export const potentialRanks = (inp: PotentialInput, d: PotentialData): Record<string, number> => Object.fromEntries(potentialOrder(inp, d).map((p, i) => [p, i + 1]));
