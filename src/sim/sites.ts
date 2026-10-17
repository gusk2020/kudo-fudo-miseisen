/**
 * Development sites (Issue #18): the capital, the sub-capital, the Imperial Palace, Mt. Fuji and Lake Biwa each raise the standing of the region around them.
 *
 * The sites are READ from the map every time (never stored as effects), so a site that was moved before the game began simply has its effect where it now stands, and nothing
 * is left behind at the old place. Position -> effect is one rule: strength = weight x reach, where reach is 0.7 inside the site's own prefecture and falls off as exp(-d/90 km)
 * around it, whichever is larger. No place names.
 *
 * The four dimensions are tied to what the economy model already has (the mapping the Issue asked to be written down):
 *   commerce      商業  passenger attraction of the city (business trips, shopping): scales its mass in the passenger gravity flow.
 *   industry      産業  the city's industrial standing: raises the industry level it grows toward (it enters freight and the regional budget share through `industry`).
 *   manufacturing 工業  goods produced: scales the city's freight generation (road-rail competition in freight) on top of `industry`.
 *   tourism       観光  leisure attraction: also scales passenger mass, and keeps nearby villages from emptying as fast.
 * 産業 and 工業 do overlap -- both raise freight -- but 産業 acts through the slow-moving level of industry and the regional share, 工業 through the volume a city ships at once.
 */
import { dist } from "../core/geom";
import type { Vec } from "../core/types";
import { homeCity, subCity } from "./ceremony";
import { basePop } from "./roles";
import type { SimState } from "./types";
import type { World } from "./world";

export type Dim = "commerce" | "industry" | "manufacturing" | "tourism";
export type SiteKind = "capital" | "sub" | "palace" | "culture" | "fuji" | "biwa";
export interface Site { kind: SiteKind; pos: Vec; pref: string | null }
export type Boost = Record<Dim, number>;
export const SITE_WEIGHTS: Record<SiteKind, Partial<Boost>> = {
  capital: { commerce: 0.15, industry: 0.10, manufacturing: 0.10, tourism: 0.08 },
  sub: { commerce: 0.08, industry: 0.05, manufacturing: 0.05, tourism: 0.04 },
  palace: { tourism: 0.10 },
  culture: { tourism: 0.12, commerce: 0.02 },   // Stage 10: the historic-cultural role real Kyoto has; moves with the palace (roles.ts)
  fuji: { tourism: 0.12 },
  biwa: { tourism: 0.10 },
};
export const SITE_REACH_KM = 90, SITE_SAME_PREF = 0.7, BOOST_CAP = 0.8;
const ZERO = (): Boost => ({ commerce: 0, industry: 0, manufacturing: 0, tourism: 0 });

/** Where each site stands in this world. */
export function sitesOf(sim: SimState, w: World): Site[] {
  const out: Site[] = [], hc = homeCity(w, sim.capital), sc = subCity(w, sim.subCapital);
  if (hc) out.push({ kind: "capital", pos: hc.pos, pref: hc.pref });
  if (sc) out.push({ kind: "sub", pos: sc.pos, pref: sc.pref });
  if (sim.palace) out.push({ kind: "palace", pos: sim.palace.pos, pref: sim.palace.pref });
  // Stage 10: the cultural role sits at the palace when the palace was moved, else at real Kyoto's seat (games created before Stage 10 have none)
  if (sim.roles) { const at = sim.palace && sim.palace.pref === sim.roles.culture ? { pos: sim.palace.pos, pref: sim.palace.pref } : (() => { const c = w.cities.find((x) => x.pref === sim.roles!.culture && x.kind === "capital"); return c ? { pos: c.pos, pref: c.pref } : null; })(); if (at) out.push({ kind: "culture", ...at }); }
  const top = w.t.stats.fujiTopCell; if (top >= 0) out.push({ kind: "fuji", pos: w.cellPos(top), pref: w.prefOf(top) });
  let sx = 0, sy = 0, n = 0; for (let k = 0; k < w.N; k++) if (w.t.land[k] === 2) { const p = w.cellPos(k); sx += p[0]; sy += p[1]; n++; }
  if (n) { const p: Vec = [sx / n, sy / n], k = w.cellOf(p); out.push({ kind: "biwa", pos: p, pref: k >= 0 ? w.prefOf(k) : null }); }
  return out;
}
/** The boost at a point (and the prefecture it lies in). */
export function boostAt(sites: Site[], pos: Vec, pref: string | null): Boost {
  const b = ZERO();
  for (const s of sites) {
    const reach = Math.max(pref && s.pref === pref ? SITE_SAME_PREF : 0, Math.exp(-dist(s.pos, pos) / SITE_REACH_KM));
    for (const [d, v] of Object.entries(SITE_WEIGHTS[s.kind])) b[d as Dim] += v! * reach;
  }
  for (const d of Object.keys(b) as Dim[]) b[d] = Math.min(BOOST_CAP, b[d]);
  return b;
}
const cache = new WeakMap<SimState, { w: World; sites: Site[]; city: Map<string, Boost>; pax: Map<string, number>; goods: Map<string, number> }>();
function entry(sim: SimState, w: World) {
  let e = cache.get(sim); if (e && e.w === w) return e;
  const sites = sitesOf(sim, w), city = new Map<string, Boost>(); for (const c of w.cities) city.set(c.id, boostAt(sites, c.pos, c.pref));
  // The pull on passengers and goods REDISTRIBUTES demand toward the sites rather than adding to the nation's total: the multipliers are rescaled so that the sum of the
  // gravity masses over every city pair (the thing the flow model adds up) is what it was without the sites. (Measured: without this, the sites alone made every line busier by
  // a quarter and the railways stopped starving, which is a different claim from "the capital pulls traffic".)
  const pax = new Map<string, number>(), goods = new Map<string, number>();
  const norm = (dim: (b: Boost) => number, out: Map<string, number>) => {
    const m = w.cities.map((c) => ({ id: c.id, p: basePop(sim, w, c), a: dim(city.get(c.id)!) })); let base = 0, boosted = 0;
    for (let i = 0; i < m.length; i++) for (let j = i + 1; j < m.length; j++) { base += Math.pow(m[i].p * m[j].p, 0.6); boosted += Math.pow(m[i].p * m[i].a * m[j].p * m[j].a, 0.6); }
    const k = boosted > 0 ? Math.pow(base / boosted, 1 / 1.2) : 1; for (const x of m) out.set(x.id, x.a * k);
  };
  norm((b) => 1 + b.commerce + b.tourism, pax); norm((b) => 1 + b.manufacturing, goods);
  e = { w, sites, city, pax, goods }; cache.set(sim, e); return e;
}
const NONE = ZERO();
/** Per-city boost; all zero for a game that does not use the new economy. */
export const cityBoost = (sim: SimState, w: World, cityId: string): Boost => (sim.stage3 ? entry(sim, w).city.get(cityId) ?? NONE : NONE);
export const settlementBoost = (sim: SimState, w: World, cell: number): Boost => (sim.stage3 ? boostAt(entry(sim, w).sites, w.cellPos(cell), w.prefOf(cell)) : NONE);
export const currentSites = (sim: SimState, w: World) => entry(sim, w).sites;
/** Relative pull on passengers / goods (mean 1 over the country). 1 for a game that does not use the new economy. */
export const paxPull = (sim: SimState, w: World, cityId: string) => (sim.stage3 ? entry(sim, w).pax.get(cityId) ?? 1 : 1);
export const goodsPull = (sim: SimState, w: World, cityId: string) => (sim.stage3 ? entry(sim, w).goods.get(cityId) ?? 1 : 1);
