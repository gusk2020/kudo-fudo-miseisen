/**
 * Stage 41 #2: the NIGHT VIEW -- the ground as a satellite would see it after dark. A pure function of the game (no drawing, no change to the game): a grid of light, one value per land cell of the world.
 * What shines is people and activity, not lines on a map:
 *   - a city's light grows with its population and the work done there (`city12` migration advantage, a port, an airport add a little), and shrinks as it declines;
 *   - the small settlements (villages and towns) add a faint scatter around it -- the residential glow between the big places;
 *   - a road or railway adds light ONLY where it is in service, in proportion to the traffic it carries and to the size of the places it joins -- an empty mountain road, a closed or abandoned line, or a planned one stay dark;
 *   - sea routes and air routes are never lit (a ferry edge is skipped); a port or airport shows only through its city;
 *   - everything is multiplied by how electrified the world is (`electrification(year)`): nearly dark in 1800, clear by 2000.
 * The tone is compressed (1 - exp(-k x)) so a metropolis saturates while a village stays a spark. Deterministic, no random numbers.
 */
import { modeOf, type SimEdge, type SimState } from "./types";
import type { World } from "./world";

/** 0 (dark) .. 1 (fully lit): none before 1850, slow growth, ~0.3 in 1950, 1 from 2000. */
export const electrification = (year: number): number => (year <= 1850 ? 0 : year >= 2000 ? 1 : Math.pow((year - 1850) / 150, 2.2));
export interface NightField { nx: number; ny: number; v: Float32Array; year: number; e: number; lit: { cities: number; edges: number; settlements: number } }
const K_TONE = 1.9;
/** 0..1 from the size of a place on a log scale (500 people = 0, 12 million = 1): lights follow how many people there are, not linearly -- a village is a spark, a metropolis a blaze, and nothing in between is lost. */
export const lightOf = (pop: number): number => Math.max(0, Math.min(1, Math.log10(Math.max(pop, 500) / 500) / Math.log10(12e6 / 500)));

/** Light of an edge: 0 unless open, built, on land (not a ferry), and carrying something. */
export function edgeActivity(e: SimEdge): number {
  if (e.state !== "open" || !e.open || e.lost || e.facility === "ferry" || (e.built ?? 1) < 1) return 0;
  const flow = (e.through ?? 0) + (e.local ?? 0) + (e.traffic ?? 0) * 0;
  return flow > 0 ? Math.log1p(flow) : 0;
}
function splat(v: Float32Array, nx: number, ny: number, ci: number, cj: number, amp: number, sigma: number) {
  const r = Math.ceil(sigma * 2.6), s2 = 2 * sigma * sigma;
  for (let j = Math.max(0, cj - r); j <= Math.min(ny - 1, cj + r); j++) for (let i = Math.max(0, ci - r); i <= Math.min(nx - 1, ci + r); i++) { const d2 = (i - ci) * (i - ci) + (j - cj) * (j - cj); if (d2 <= r * r) v[j * nx + i] += amp * Math.exp(-d2 / s2); }
}
export function nightField(sim: SimState, w: World, year: number): NightField {
  const { nx, ny, cell } = w, v = new Float32Array(nx * ny), e = electrification(year), lit = { cities: 0, edges: 0, settlements: 0 };
  const out: NightField = { nx, ny, v, year, e, lit }; if (e <= 0) return out;
  const cellIJ = (k: number): [number, number] => [k % nx, (k / nx) | 0];
  const popOf = (id: string | undefined) => (id ? sim.cities[id]?.pop ?? 0 : 0);
  // --- cities: people, work, harbour and airport
  const hubs = sim.hubs; let maxPop = 1; for (const id in sim.cities) maxPop = Math.max(maxPop, sim.cities[id].pop);
  for (const id in sim.cities) {
    const c = sim.cities[id], wc = w.cityById.get(id); if (!wc || c.pop <= 0) continue;
    const adv = sim.city12?.[id]?.adv ?? 0, work = 1 + Math.max(-0.3, Math.min(0.5, adv * 0.5)), fac = 1 + (hubs?.ports[id] && !hubs.ports[id].until ? 0.08 : 0) + (hubs?.airports[id] && !hubs.airports[id].until ? 0.08 : 0);
    const k = wc.cell, [ci, cj] = cellIJ(k), lo = lightOf(c.pop), amp = Math.pow(lo, 1.4) * work * fac, sigma = 0.8 + 1.6 * lo;   // (cells of 5 km: a metropolis glows ~15 km out)
    splat(v, nx, ny, ci, cj, amp, sigma); lit.cities++;
  }
  // --- the faint residential scatter of villages and towns
  for (const id in sim.settlements) { const s = sim.settlements[id]; if (s.gone || s.pop <= 0 || s.cell < 0 || s.cell >= nx * ny) continue; const [i, j] = cellIJ(s.cell); splat(v, nx, ny, i, j, 0.35 * Math.pow(lightOf(s.pop), 1.4), 0.7); lit.settlements++; }
  // --- roads and railways in service: traffic x the size of the places they join (never the line alone)
  let maxFlow = 0; const acts: [SimEdge, number][] = [];
  for (const id in sim.edges) { const ed = sim.edges[id], a = edgeActivity(ed); if (a > 0) { acts.push([ed, a]); maxFlow = Math.max(maxFlow, a); } }
  for (const [ed, a] of acts) {
    const na = sim.nodes[ed.a], nb = sim.nodes[ed.b], pa = popOf(na?.cityId), pb = popOf(nb?.cityId);
    const places = Math.min(1, lightOf((pa + pb) / 2) * 1.3 + 0.04), amp = 0.22 * (a / (maxFlow || 1)) * places * (modeOf(ed) === "rail" ? 0.8 : 1);
    if (amp < 0.006) continue; lit.edges++; for (const k of ed.cells) { if (k < 0 || k >= nx * ny) continue; const [i, j] = cellIJ(k); splat(v, nx, ny, i, j, amp, 0.6); }
  }
  // --- tone: electrification, compression, and only on land
  for (let k = 0; k < nx * ny; k++) { const L = w.t.land[k] === 0 ? 0 : v[k] * e; v[k] = 1 - Math.exp(-K_TONE * L); }
  void cell; return out;
}
/** Stage 43 (B4): every light is the same daylight white (昼白色, about 5000 K: a faint cool tint, never orange or yellow); only the brightness follows the light value 0..1.
 *  (The Stage 41 colours ran from dim orange to pale yellow; the owner asked for one white throughout.) */
export const NIGHT_WHITE: [number, number, number] = [255, 250, 244];
export function nightColour(x: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, x)), k = Math.min(1, 0.3 + 0.95 * t); return [Math.round(NIGHT_WHITE[0] * k), Math.round(NIGHT_WHITE[1] * k), Math.round(NIGHT_WHITE[2] * k)];
}
