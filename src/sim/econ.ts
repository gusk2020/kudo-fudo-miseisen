/**
 * Stage 12 (Issue #31): the city economy -- why a city grows, why another declines, and who takes the lead. Games from Stage 12 on (`sim.econ`).
 *
 * The population of the nation follows the demographic course (popRate); what this module adds is WHERE people go, as a yearly migration that is zero-sum
 * (the population-weighted mean is taken out, so it moves people and creates none -- the same discipline as the 1945 reconstruction policy):
 *
 *   industry   jobs in industry (the level a city's industry has reached: land, water, port, access -- see ecoIndustry)
 *   logistics  the use its port and airport get
 *   tourism    the pull of the palace's culture site, Fuji and Biwa by TRAVEL TIME over the road and rail network, plus the cities that lie ON the way from the big
 *              cities to the site (a detour of at most 15 %): a palace away from the capital gives the places between them something, one beside it does not
 *   commuting  the residential spill from a crowded capital / sub-capital to the cities it reaches in daily-commute time (land network, fares fall with income);
 *              a sea or air lane counts only when it is fast and frequent enough for a daily trip, weighted by how reliable the weather lets it be, and a lane
 *              that is only good for a weekly trip counts a quarter as much (a second home, not a bed-town)
 *   agglomeration  size attracts (jobs, suppliers, markets), with diminishing returns
 *   rent       ... and past the room the land has (siteCapacity, flat ground, the plain) rent and congestion push back, so a big city stops growing for good reason
 *   shock      a rare local disaster (coast and steep ground carry more risk) takes a few percent, which then comes back slowly
 *
 * Nothing here knows a place name: every input is the road/rail network, the hubs, the sites of government and the land. The parts are kept per city (sim.city12)
 * so the map and the atlas can say WHY a city moved.
 */
import { metroPopOf } from "./metro";
import { dist } from "../core/geom";
import { homeCity, subCity } from "./ceremony";
import { siteCapacity, siteQuality } from "./land";
import { cityIndex, PORT_CAP } from "./hubs";
import { basePop } from "./roles";
import { currentSites } from "./sites";
import type { SimState } from "./types";
import type { WCity, World } from "./world";
import { AIR_ONTIME, RAIL_ACCESS_H, SEA_ONTIME } from "./demand";
import { rand } from "./engine";

export const ECO_PARTS = ["industry", "logistics", "tourism", "commute", "agglomeration", "rent", "shock", "climate"] as const;
export type EcoPart = (typeof ECO_PARTS)[number];
export const ECO_LABEL: Record<EcoPart, string> = { industry: "産業", logistics: "物流", tourism: "観光", commute: "通勤圏", agglomeration: "集積", rent: "地価・混雑", shock: "災害", climate: "低地・海面" };
export interface City12 { p: number[]; h: number[]; adv: number }
/** Weights of the parts in the migration advantage (empirical, not statistics). MIG is the share of its size a city gains per year per unit of advantage. */
export const MIG = 0.012, W_IND = 0.6, W_LOG = 0.6, W_TOUR = 0.6, W_CMT = 1.0, W_AGG = 0.12, W_RENT = 1.3;
/** The people a city's land holds comfortably, as a multiple of its 1950 size (more on a plain). A city above it pays dear rent, one far below it is cheap -- which is what stops a decline. */
export const ROOM_BASE = 2.4, ROOM_PLAIN = 1.2;
export const ADV_MIN = -0.55, ADV_MAX = 1.2;
export const COMMUTE_H = 0.9, CORE_PRESSURE_FROM = 0.9;
export const TOUR_TAU_H = 2.5, TOUR_TRANSIT_DETOUR = 1.15, TOUR_TRANSIT_W = 0.5;
/** Daily-commute limits for the lanes that need no land: door-to-door hours, the weather reliability, the daily volume that counts as frequent. */
export const AIR_COMMUTE_MAX_H = 2.2, SEA_COMMUTE_MAX_H = 2.4, AIR_REL = AIR_ONTIME, SEA_REL = SEA_ONTIME, FREQ_FULL = 600, WEEKLY_W = 0.25, AIR_KMH = 600, AIR_OVERHEAD_H = 1.6, SEA_KMH = 45, SEA_OVERHEAD_H = 0.8;
export const SHOCK_P = 0.006, SHOCK_MIN = 0.03, SHOCK_MAX = 0.08, SHOCK_RECOVER = 0.15;
/** Mass tourism grows with income; inbound travellers come later (a model curve, not a statistic). */
const TOUR_Y: [number, number][] = [[1950, 0.1], [1970, 0.35], [1990, 0.6], [2010, 1], [2030, 1.5], [2060, 1.7], [2110, 1.7]];
const at = (k: [number, number][], y: number) => { if (y <= k[0][0]) return k[0][1]; for (let i = 1; i < k.length; i++) if (y <= k[i][0]) { const [a, va] = k[i - 1], [b, vb] = k[i]; return va + ((vb - va) * (y - a)) / (b - a); } return k[k.length - 1][1]; };
/** Manufacturing carries the economy until the 1970s and then gives way to services, trade and leisure: the pull of industry jobs falls, that of trade (ports, airports) and tourism rises. */
const IND_Y: [number, number][] = [[1950, 0.8], [1975, 1.1], [2000, 0.6], [2030, 0.3], [2110, 0.2]];
const LOG_Y: [number, number][] = [[1950, 0.3], [1970, 0.6], [1990, 1], [2020, 1.4], [2060, 1.5], [2110, 1.4]];
/** Remote work, ageing and a rising bill for big-city land make rent weigh more on the choice of where to live; the pull of sheer size eases. */
const RENT_Y: [number, number][] = [[1950, 0.7], [1990, 1], [2020, 1.5], [2060, 2.3], [2110, 2.6]];
/** Leisure and inbound travel matter more as incomes rise: the weight of the tourism pull. */
const TOURW_Y: [number, number][] = [[1950, 0.5], [2000, 1], [2050, 1.7], [2110, 2]];
const AGG_Y: [number, number][] = [[1950, 1.2], [1990, 1], [2020, 0.6], [2060, 0.3], [2110, 0.2]];
/** How much a low, sea-facing site counts against a city as the sea rises and storms get worse (zero until about 2000). */
const CLIM_Y: [number, number][] = [[1950, 0], [2000, 0.1], [2040, 0.6], [2110, 1.6]];
const exposureMemo = new WeakMap<World, Map<string, number>>();
/** 0..1: the share of the land around a city that lies below 10 m and within a few cells of the sea (the ground a rising sea and a storm surge reach first). */
export function exposure(w: World, c: WCity): number {
  let m = exposureMemo.get(w); if (!m) { m = new Map(); exposureMemo.set(w, m); } const hit = m.get(c.id); if (hit !== undefined) return hit;
  const i0 = c.cell % w.nx, j0 = (c.cell / w.nx) | 0; let n = 0, low = 0;
  for (let dj = -4; dj <= 4; dj++) for (let di = -4; di <= 4; di++) { const a = i0 + di, b = j0 + dj; if (a < 0 || b < 0 || a >= w.nx || b >= w.ny) continue; const k = b * w.nx + a; if (w.t.land[k] !== 1) continue; n++; if (w.t.elev[k] < 10) { let sea = false; for (let q = -3; q <= 3 && !sea; q++) for (let r = -3; r <= 3 && !sea; r++) { const aa = a + r, bb = b + q; if (aa >= 0 && bb >= 0 && aa < w.nx && bb < w.ny && w.t.land[bb * w.nx + aa] === 0) sea = true; } if (sea) low++; } }
  const v = n ? low / n : 0; m.set(c.id, v); return v;
}
/** Real incomes rise, so a fare weighs less: the share of the commuting radius a fare eats. */
const fareFactor = (h: number, y: number) => Math.max(0.2, 1 - 0.35 * h / Math.max(0.6, at([[1950, 0.6], [1975, 1], [2000, 1.6], [2050, 2.2], [2110, 2.4]], y)));
const water = (w: World, c: WCity) => { const i = c.cell % w.nx, j = (c.cell / w.nx) | 0; if (c.coastal) return 1; for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) { const a = i + di, b = j + dj; if (a >= 0 && b >= 0 && a < w.nx && b < w.ny && w.river[b * w.nx + a]) return 0.7; } return 0; };
/** What the land adds to the industry level a city grows toward: room to build a works on, and water and a coast for it. */
export function ecoIndustry(w: World, c: WCity): number { return 0.14 * Math.min(1, siteQuality(w, c) / 0.7) + 0.06 * water(w, c); }

export const city12Of = (sim: SimState, id: string): City12 | undefined => sim.city12?.[id];
/** The part that moved a city most (signed), for the explanation: [label, value]. */
export function mainCause(c: City12): { part: EcoPart; v: number } | null {
  let best = -1, bv = 0; for (let i = 0; i < ECO_PARTS.length; i++) if (Math.abs(c.p[i]) > Math.abs(bv)) { bv = c.p[i]; best = i; } return best < 0 || Math.abs(bv) < 0.02 ? null : { part: ECO_PARTS[best], v: bv };
}

/** Travel time (hours) between two cities by land: the faster of road and rail (rail with its access time). */
const landT = (an: { T: Float64Array; TT: Float64Array }, nc: number, i: number, j: number) => Math.min(an.T[i * nc + j], an.TT[i * nc + j] + RAIL_ACCESS_H);

/**
 * One year of migration. Returns the extra yearly growth of every city (zero-sum apart from the shocks) and keeps the parts for the explanation.
 */
export function ecoYear(sim: SimState, w: World, an: { T: Float64Array; TT: Float64Array }, y: number): Map<string, number> {
  const nc = w.cities.length, idx = cityIndex(w), st = (i: number) => sim.cities[w.cities[i].id], P = w.cities.map((_, i) => st(i).pop);
  const cap = w.cities.map((c) => Math.max(1000, basePop(sim, w, c) * siteCapacity(w, c) * (ROOM_BASE + ROOM_PLAIN * c.plains)));
  const popSum = P.reduce((a, b) => a + b, 0) || 1, wmean = (xs: number[]) => xs.reduce((s, x, i) => s + x * P[i], 0) / popSum;
  const h = sim.hubs;
  // --- industry and logistics
  const ind = w.cities.map((_, i) => st(i).industry);
  const log = w.cities.map((c) => { if (!h) return 0; const p = h.ports[c.id], a = h.airports[c.id]; let v = 0; if (p && p.until === undefined) v += (p.tier / 4) * Math.min(1, p.cargo / PORT_CAP[p.tier]); if (a && a.until === undefined) v += 0.5 * Math.min(1, a.pax / a.cap); return Math.min(1, v); });
  // --- tourism: travel time to each culture/nature site, and the cities on the way from the cores
  const sites = currentSites(sim, w).filter((s) => s.kind === "palace" || s.kind === "culture" || s.kind === "fuji" || s.kind === "biwa"), tourW: Record<string, number> = { palace: 0.5, culture: 1, fuji: 0.7, biwa: 0.5 };
  const cores = [homeCity(w, sim.capital), subCity(w, sim.subCapital)].filter((c): c is WCity => !!c), coreIdx = [...new Set(cores.map((c) => idx.get(c.id)!))];
  const tour = new Array(nc).fill(0), scale = at(TOUR_Y, y);
  for (const s of sites) {
    let si = -1, bd = Infinity; w.cities.forEach((c, i) => { const d = dist(c.pos, s.pos); if (d < bd) { bd = d; si = i; } }); if (si < 0 || bd > 120) continue; const wt = tourW[s.kind] ?? 0.5;
    for (let i = 0; i < nc; i++) {
      if (i === si) { tour[i] += wt * 1.2; continue; }
      const t = landT(an, nc, i, si); if (isFinite(t)) tour[i] += wt * Math.exp(-t / TOUR_TAU_H);
      for (const o of coreIdx) { if (o === si || o === i) continue; const toS = landT(an, nc, o, si), oi = landT(an, nc, o, i), is = landT(an, nc, i, si); if (isFinite(toS) && isFinite(oi) && isFinite(is) && oi + is <= TOUR_TRANSIT_DETOUR * toS) tour[i] += wt * TOUR_TRANSIT_W * Math.min(1, toS / 4) * 0.5; }
    }
    // inbound travellers arrive at the airports and ports: the hub with the most international traffic nearest the site gets the first night
    if (h && y >= 1975) for (const a of Object.values(h.airports)) { if (a.until !== undefined) continue; const ai = idx.get(a.city); if (ai === undefined) continue; const t = ai === si ? 0 : landT(an, nc, ai, si); if (isFinite(t)) tour[ai] += wt * 0.4 * Math.min(1, a.intl / 20000) * Math.exp(-t / TOUR_TAU_H); }
  }
  for (let i = 0; i < nc; i++) tour[i] = Math.tanh(tour[i] * scale);
  // --- commuting: spill from crowded cores into the cities they reach every day
  const cmt = new Array(nc).fill(0), pull = new Array(nc).fill(0);
  for (const o of coreIdx) {
    const pressure = Math.max(0, Math.min(1.5, P[o] / cap[o] - CORE_PRESSURE_FROM)); if (pressure <= 0) continue;
    for (let i = 0; i < nc; i++) {
      if (i === o) continue; let f = 0;
      const t = landT(an, nc, i, o); if (isFinite(t)) f = Math.exp(-Math.pow(t / COMMUTE_H, 2)) * fareFactor(t, y);
      if (h) for (const r of h.routes) {
        if (r.state !== "open" || r.intl) continue; const a = idx.get(r.a), b = idx.get(r.b); if (a === undefined || b === undefined) continue; if (!((a === i && b === o) || (a === o && b === i))) continue;
        const km = dist(w.cities[i].pos, w.cities[o].pos), air = r.mode === "air", door = km / (air ? AIR_KMH : SEA_KMH) + (air ? AIR_OVERHEAD_H : SEA_OVERHEAD_H), lim = air ? AIR_COMMUTE_MAX_H : SEA_COMMUTE_MAX_H, rel = air ? AIR_REL : SEA_REL, freq = Math.min(1, r.vol / FREQ_FULL);
        const daily = door <= lim ? Math.exp(-Math.pow(door / (lim * 0.75), 2)) * rel * freq : 0, weekly = daily > 0 ? 0 : WEEKLY_W * rel * freq * (door <= 5 ? 1 : 0);
        f = Math.max(f, daily + weekly * 0.5);
      }
      if (f > 0.02) { cmt[i] += f * pressure; pull[o] += f * pressure * P[i]; }
    }
  }
  for (const o of coreIdx) cmt[o] -= pull[o] / Math.max(1, P[o]);   // the core pays for what its satellites gain
  // --- agglomeration, rent, shocks
  const agg = P.map((p, i) => Math.tanh(Math.log(Math.max(1, sim.tech?.wk !== undefined ? metroPopOf(sim.metro, w.cities[i].id, p) : p) / 1.5e5) / 1.6)), ratio = P.map((p, i) => Math.min(3, p / cap[i])), mr = wmean(ratio), rent = ratio.map((r) => r - mr);   // signed: a city that has shrunk below its land's room is cheap, and cheap attracts
  const out = new Map<string, number>(), mi = wmean(ind), ml = wmean(log), mt = wmean(tour);
  const wa = W_AGG * at(AGG_Y, y), wr = W_RENT * at(RENT_Y, y), wc = at(CLIM_Y, y), wi = W_IND * at(IND_Y, y), wl = W_LOG * at(LOG_Y, y), wt = W_TOUR * at(TOURW_Y, y);
  const adv = w.cities.map((_, i) => wi * (ind[i] - mi) + wl * (log[i] - ml) + wt * (tour[i] - mt) + W_CMT * Math.max(-1, Math.min(1.5, cmt[i])) + wa * agg[i] - wr * rent[i] - wc * exposure(w, w.cities[i]));
  const ma = wmean(adv);
  // No city is allowed to lose (or gain) faster than ADV_MIN / ADV_MAX per year relative to the nation: a place keeps some people however poor its prospects (kin, land, a
  // local market). The clamp breaks the zero-sum a little, so the mean is taken out again afterwards.
  const clampAdv = adv.map((a) => Math.max(ADV_MIN, Math.min(ADV_MAX, a - ma))), mc = wmean(clampAdv);
  w.cities.forEach((c, i) => {
    const mig = MIG * (clampAdv[i] - mc); let shock = 0;
    const cur = (sim.city12 ??= {})[c.id] ?? (sim.city12[c.id] = { p: [], h: [], adv: 0 });
    const lastShock = cur.p[6] ?? 0;
    if (lastShock < -0.005) shock = -lastShock * SHOCK_RECOVER;   // coming back
    const risk = SHOCK_P * (1 + (c.coastal ? 1 : 0) + (siteQuality(w, c) < 0.5 ? 1 : 0));
    if (rand(sim) < risk) shock = -(SHOCK_MIN + rand(sim) * (SHOCK_MAX - SHOCK_MIN));
    out.set(c.id, mig + shock);
    cur.p = [wi * (ind[i] - mi), wl * (log[i] - ml), wt * (tour[i] - mt), W_CMT * Math.max(-1, Math.min(1.5, cmt[i])), wa * agg[i], -wr * rent[i], shock < 0 && lastShock >= -0.005 ? shock : shock > 0 ? lastShock : 0, -wc * exposure(w, c)].map((x) => Math.round(x * 1000) / 1000);
    cur.adv = Math.round((clampAdv[i] - mc) * 1000) / 1000;
    if ((y - sim.startYear) % 5 === 0 && cur.h.length <= (y - sim.startYear) / 5) cur.h.push(Math.round(P[i]));
  });
  return out;
}
