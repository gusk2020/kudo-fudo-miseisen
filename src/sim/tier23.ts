/**
 * Stage 23: two steps of city development above an ordinary city -- the game's own system, not Japan's.
 *
 *   政令特区   a city that has kept a large share of the nation's people for a few years. It takes on a character (工業 / エネルギー / 学術研究 / 物流) chosen from what the place has --
 *              its industry, port, relief, access to the network, its people and the era's policy -- and builds that facility over ten years. A second, different facility may follow.
 *   政令指定都市  a 特区 that has kept growing, with two or more facilities for years: it is divided into wards (区) with their own people and roles.
 *
 * Neither is a title for show. Every facility is a development SITE (sites.ts): it raises the city's commerce / industry / manufacturing / tourism standing by its level, which the
 * model already turns into the city's growth, the industry it grows toward, its passenger and freight mass in the gravity flow and its share of the regional budget -- with the
 * pull REDISTRIBUTED (the nation's totals do not move). Nothing here edits a city's people: the wards divide the city's own population (they add up to it exactly), so the
 * conservation of population is by construction.
 *
 * Neither is permanent. A step is taken only after the condition has held for some years, and given up only after it has failed for longer (the grace years, so a city on the line does not
 * flip every year); a city that falls back keeps its history. No random numbers: a game is reproduced from its seed. Games from before Stage 23 have no `sim.tier23` and are untouched.
 */
import { stanceAt } from "./kaigen";
import { invalidateSites } from "./sites";
import { ev, yearOf } from "./engine";
import type { Analysis } from "./demand";
import type { WCity, World } from "./world";
import type { SimState } from "./types";

export type ZoneKind = "industry" | "energy" | "academic" | "logistics";
export const ZONE_LABEL: Record<ZoneKind, string> = { industry: "工業特区", energy: "エネルギー特区", academic: "学術研究特区", logistics: "物流産業特区" };
export const FACILITY_LABEL: Record<ZoneKind, string> = { industry: "工業団地", energy: "エネルギー基地", academic: "学術研究機関", logistics: "物流ターミナル" };
export type WardRole = "center" | "industry" | "port" | "academic" | "residential";
export interface Ward { id: string; name: string; role: WardRole; w: number }
export interface Facility { k: ZoneKind; y: number }
export interface Zone { tier: 1 | 2; kind: ZoneKind; since: number; tierSince: number; facs: Facility[]; down: number; wards?: Ward[]; wardsAt?: number; wardPop0?: number }
export interface TierHist { y: number; tier: 0 | 1 | 2; kind?: ZoneKind }
export interface Tier23 { zones: Record<string, Zone>; hist: Record<string, TierHist[]>; cnt: Record<string, number> }

/** Shares of the nation's people (they follow the nation up and down: the thresholds are relative, so a shrinking country keeps its structure). */
export const ZONE_UP = 0.007, ZONE_DOWN = 0.005, CITY_UP = 0.0125, CITY_DOWN = 0.009;
export const UP_YEARS = 3, DOWN_YEARS_ZONE = 8, DOWN_YEARS_CITY = 10, CITY_MIN_ZONE_YEARS = 10, CITY_MIN_FACS = 2, FAC_RAMP_YEARS = 10, SECOND_FAC_YEARS = 8, MAX_FACS = 3;
export const WARD_PEOPLE = 150000, WARD_MIN = 4, WARD_MAX = 16, WARD_STEP_YEARS = 10;

export const newTier23 = (): Tier23 => ({ zones: {}, hist: {}, cnt: {} });
export const tierOf = (sim: SimState, id: string): 0 | 1 | 2 => sim.tier23?.zones[id]?.tier ?? 0;
/** A facility's strength 0..1: it comes up over ten years (people and jobs follow the buildings, not the other way round). */
export const facLevel = (f: Facility, y: number) => Math.max(0, Math.min(1, Math.round(((y - f.y) / FAC_RAMP_YEARS) * 10) / 10));

const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; };

/** How well a place suits each character: what it has, 0..~1. */
function scores(sim: SimState, w: World, an: Analysis, c: WCity, i: number, y: number): Record<ZoneKind, number> {
  const st = sim.cities[c.id], stance = stanceAt(sim, y), cap = c.pref === sim.capital || c.pref === sim.subCapital;
  const g = w.t.grid, ci = c.cell % w.nx, cj = (c.cell / w.nx) | 0; let hi = 0;
  for (let dj = -4; dj <= 4; dj++) for (let di = -4; di <= 4; di++) { const a = ci + di, b = cj + dj; if (a >= 0 && b >= 0 && a < w.nx && b < w.ny) hi = Math.max(hi, w.t.elev[b * w.nx + a]); }
  void g; const relief = Math.min(1, Math.max(0, hi) / 1200), acc = Math.min(1, an.acc[i] ?? 0), port = c.coastal ? 1 : 0, air = st.airport !== undefined ? 1 : 0;
  return {
    industry: 0.55 * st.industry + 0.25 * c.plains + 0.25 * acc + (stance === "shoka" || stance === "shubun" ? 0.08 : 0),
    energy: 0.25 * port + 0.35 * relief + 0.15 * st.industry + 0.15 * (1 - c.plains),
    academic: 0.25 * Math.min(1, st.pop / 1500000) + 0.35 * acc + (cap ? 0.3 : 0) + 0.15 * (1 - port) + (stance === "heisei" ? 0.05 : 0),
    logistics: 0.3 * port + 0.3 * acc + 0.15 * air + (stance === "kairo" ? 0.12 : stance === "kuuro" ? 0.08 : 0),
  };
}
const KINDS: ZoneKind[] = ["industry", "energy", "academic", "logistics"];
/** The character that suits best -- but a character already common across the nation pays less (the market for it fills up), so the zones differ from one another. */
function best(sim: SimState, sc: Record<ZoneKind, number>, skip: Set<ZoneKind> = new Set()): ZoneKind | null {
  const have: Record<ZoneKind, number> = { industry: 0, energy: 0, academic: 0, logistics: 0 }; for (const z of Object.values(sim.tier23?.zones ?? {})) for (const f of z.facs) have[f.k]++;
  let k: ZoneKind | null = null, bv = -1; for (const x of KINDS) { if (skip.has(x)) continue; const v = sc[x] / (1 + 0.18 * have[x]); if (v > bv + 1e-9) { bv = v; k = x; } } return k;
}

// ---- wards ----
const NAMES: Record<WardRole, string[]> = { center: ["中央"], industry: ["工業", "臨海", "東工", "北工"], port: ["港", "湾岸"], academic: ["学園", "文教"], residential: ["北", "南", "東", "西", "北東", "北西", "南東", "南西", "緑", "丘", "川", "新", "桜", "旭", "若葉", "青葉", "山手", "海辺", "駅前", "岬"] };
function makeWards(z: Zone, c: WCity, n: number): Ward[] {
  const roles: WardRole[] = ["center"]; let ind = z.facs.filter((f) => f.k === "industry" || f.k === "energy").length; while (ind-- > 0 && roles.length < 3) roles.push("industry");
  if (c.coastal && z.facs.some((f) => f.k === "logistics" || f.k === "energy")) roles.push("port"); if (z.facs.some((f) => f.k === "academic")) roles.push("academic");
  while (roles.length < n) roles.push("residential"); roles.length = Math.max(n, 1);
  const fixed: Record<string, number> = { center: 0.16, industry: 0.11, port: 0.08, academic: 0.07 }; const used = new Map<WardRole, number>(), res = roles.filter((r) => r === "residential").length;
  const fixedSum = roles.reduce((a, r) => a + (r === "residential" ? 0 : fixed[r]), 0), raw = roles.map((r, k) => (r === "residential" ? (1 - fixedSum) / Math.max(1, res) * (0.7 + 0.6 * hash(c.id + ":" + k)) : fixed[r])), tot = raw.reduce((a, b) => a + b, 0);
  return roles.map((r, k) => { const u = used.get(r) ?? 0; used.set(r, u + 1); const pool = NAMES[r]; const name = (pool[u % pool.length] + (u >= pool.length ? String(Math.floor(u / pool.length) + 1) : "")) + "区"; return { id: `${c.id}:W${k + 1}`, name, role: r, w: raw[k] / tot }; });
}
/** The wards' people: they divide the city's own population exactly (largest remainder), so the sum is never different from the city. */
export function wardPops(zone: Zone | undefined, pop: number): { ward: Ward; pop: number }[] {
  if (!zone?.wards?.length) return []; const ws = zone.wards, tot = ws.reduce((a, x) => a + x.w, 0) || 1, raw = ws.map((x) => (pop * x.w) / tot), fl = raw.map(Math.floor);
  let rest = Math.round(pop) - fl.reduce((a, b) => a + b, 0); const order = raw.map((v, i) => [v - fl[i], i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; rest > 0 && k < order.length; k++, rest--) fl[order[k][1]]++;
  return ws.map((ward, i) => ({ ward, pop: fl[i] }));
}
const wantWards = (pop: number) => Math.max(WARD_MIN, Math.min(WARD_MAX, Math.floor(pop / WARD_PEOPLE)));

/** The yearly review. Cheap: one pass over the cities, the heavy part (the sites) is rebuilt only when something actually changed. */
export function reviewTiers(sim: SimState, w: World, an: Analysis, y: number): void {
  const t = sim.tier23; if (!t) return; let total = 0; for (const c of w.cities) total += sim.cities[c.id].pop; if (total <= 0) return;
  let changed = false; const note = (id: string, tier: 0 | 1 | 2, kind?: ZoneKind) => { (t.hist[id] ??= []).push({ y, tier, ...(kind ? { kind } : {}) }); changed = true; };
  w.cities.forEach((c, i) => {
    const st = sim.cities[c.id], share = st.pop / total, z = t.zones[c.id];
    if (!z) {
      if (share >= ZONE_UP) {
        const n = (t.cnt[c.id] ?? 0) + 1; t.cnt[c.id] = n;
        if (n >= UP_YEARS) { const k = best(sim, scores(sim, w, an, c, i, y))!; t.zones[c.id] = { tier: 1, kind: k, since: y, tierSince: y, facs: [{ k, y }], down: 0 }; delete t.cnt[c.id]; note(c.id, 1, k); ev23(sim, c, `${c.name}が${ZONE_LABEL[k]}に指定された`, `人口が全国の${(share * 100).toFixed(2)}%に達し、${FACILITY_LABEL[k]}の整備が始まる`); }
      } else if (t.cnt[c.id]) { t.cnt[c.id] = Math.max(0, t.cnt[c.id] - 1); if (!t.cnt[c.id]) delete t.cnt[c.id]; }
      return;
    }
    // facilities come up (and a second, a third arrive) -- a change of level is a change of the sites
    if (z.facs.some((f) => facLevel(f, y) < 1 || facLevel(f, y - 1) < 1)) changed = true;
    if (z.facs.length < MAX_FACS && z.facs.every((f) => y - f.y >= SECOND_FAC_YEARS) && (z.facs.length < 2 || z.tier === 2)) {
      const sc = scores(sim, w, an, c, i, y), k = best(sim, sc, new Set(z.facs.map((f) => f.k))); if (k && sc[k] >= 0.4) { z.facs.push({ k, y }); changed = true; ev23(sim, c, `${c.name}に${FACILITY_LABEL[k]}が加わった`, `${ZONE_LABEL[z.kind]}の${c.name}で、土地と交通に合った施設が増える`); }
    }
    if (z.tier === 1) {
      if (share < ZONE_DOWN) { z.down++; if (z.down >= DOWN_YEARS_ZONE) { delete t.zones[c.id]; note(c.id, 0); ev23(sim, c, `${c.name}の${ZONE_LABEL[z.kind]}指定が解かれた`, "人口と産業が続けて衰え、特区の条件を満たさなくなった"); return; } } else z.down = 0;
      if (share >= CITY_UP && y - z.tierSince >= CITY_MIN_ZONE_YEARS && z.facs.length >= CITY_MIN_FACS && z.facs.every((f) => facLevel(f, y) >= 0.5)) {
        const n = (t.cnt[c.id] ?? 0) + 1; t.cnt[c.id] = n;
        if (n >= UP_YEARS) { z.tier = 2; z.tierSince = y; z.down = 0; z.wardPop0 = st.pop; z.wards = makeWards(z, c, wantWards(st.pop)); z.wardsAt = y; delete t.cnt[c.id]; note(c.id, 2, z.kind); ev23(sim, c, `${c.name}が政令指定都市になった`, `${z.wards.length}の区を置く(人口 約${Math.round(st.pop / 1000)}千人)`); }
      } else if (t.cnt[c.id]) delete t.cnt[c.id];
    } else {
      if (share < CITY_DOWN || z.facs.length < CITY_MIN_FACS) { z.down++; if (z.down >= DOWN_YEARS_CITY) { z.tier = 1; z.tierSince = y; z.down = 0; delete z.wards; delete z.wardsAt; delete z.wardPop0; note(c.id, 1, z.kind); ev23(sim, c, `${c.name}の政令指定都市の指定が解かれた(政令特区に戻る)`, "人口と都市機能が続けて落ちた。区の置き方は履歴に残る"); return; } } else z.down = 0;
      // a city that has grown a great deal gets another ward now and then (the people are divided, never added)
      if (z.wards && z.wards.length < Math.min(WARD_MAX, wantWards(st.pop)) && y - (z.wardsAt ?? y) >= WARD_STEP_YEARS) {
        const res = z.wards.filter((x) => x.role === "residential"), big = res.sort((a, b) => b.w - a.w || (a.id < b.id ? -1 : 1))[0];
        if (big) { const half = big.w / 2, u = z.wards.length; big.w = half; const pool = NAMES.residential, nm = pool[(u + hash(c.id) * 7 | 0) % pool.length]; z.wards.push({ id: `${c.id}:W${u + 1}`, name: (z.wards.some((x) => x.name === nm + "区") ? nm + "新" : nm) + "区", role: "residential", w: half }); z.wardsAt = y; changed = true; }
      }
    }
  });
  if (changed) invalidateSites(sim);
}
function ev23(sim: SimState, c: WCity, text: string, why: string) { ev(sim, "city", text, why, { city: c.id }); }
/** The designation history of a city (for the atlas); includes steps back. */
export const tierHistory = (sim: SimState, id: string): TierHist[] => sim.tier23?.hist[id] ?? [];
