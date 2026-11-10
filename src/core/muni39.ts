/**
 * Stage 39: the municipalities the game's land can hold, and the towns that grow on mountains turned to plains.
 *
 * The game has no legal 市町村 classification of its own, so this file defines the one thing the rules need: a kind by size (村 / 町 / 市), the highest ground each kind may be NEWLY founded on, the
 * ways the 1950s-onward civil engineering relaxes that, and the names a new town takes from the highest peak of the range it grows on.
 *
 * Two elevations are kept apart (the user's rule): the EDITED elevation decides whether a municipality may exist at its (fixed) office point; the ORIGINAL elevation (before any range edit) decides
 * how well a place can develop (its aptitude) -- but the penalty is bounded, so mountains worn to plain are never kept small for ever by what they used to be.
 * Pure functions: no DOM, no simulation state.
 */
export type MuniKind = "village" | "town" | "city";
export const MUNI_LABEL: Record<MuniKind, string> = { village: "村", town: "町", city: "市" };
/** Highest ground (m) a kind may be newly founded on: the limit itself is forbidden (1300 m is no place for a 市). */
export const LIMIT_M: Record<MuniKind, number> = { city: 1300, town: 1400, village: 1500 };
/** The size at which a settlement counts as a 町 / 市 (the game's own classification). */
export const TOWN_FROM = 8000, CITY_FROM = 50000;
export const kindByPop = (pop: number): MuniKind => (pop >= CITY_FROM ? "city" : pop >= TOWN_FROM ? "town" : "village");
/** May this kind be founded (or kept) on ground of this edited elevation? The limit itself is on the forbidden side. */
export const allowedAt = (kind: MuniKind, elevM: number): boolean => elevM < LIMIT_M[kind];
/** The biggest kind the ground allows (null = none: 1500 m and above). */
export const maxKindAt = (elevM: number): MuniKind | null => (elevM < LIMIT_M.city ? "city" : elevM < LIMIT_M.town ? "town" : elevM < LIMIT_M.village ? "village" : null);

/** 1950 onward: how many metres above its limit a place may be founded, by technology (the decades), road/rail access (0..1) and demand (0..1). Never before 1950, and never without a connection and people who want it. */
export const EXCEPTION_FROM = 1950, EXCEPTION_MAX_M = 700, EXCEPTION_YEARS = 100;
export function exceptionAllowanceM(year: number, access: number, demand: number): number {
  if (year < EXCEPTION_FROM || !(access > 0) || !(demand > 0)) return 0;
  const tech = Math.min(1, (year - EXCEPTION_FROM) / EXCEPTION_YEARS), a = Math.max(0, Math.min(1, access)), d = Math.max(0, Math.min(1, demand));
  return EXCEPTION_MAX_M * tech * a * d;
}
export interface EligibleIn { kind: MuniKind; elevM: number; year: number; access: number; demand: number; /** under water, or made from the sea: no exception, ever */ noException?: boolean }
export function eligible(i: EligibleIn): boolean {
  if (allowedAt(i.kind, i.elevM)) return true;
  if (i.noException) return false;
  return i.elevM - LIMIT_M[i.kind] < exceptionAllowanceM(i.year, i.access, i.demand);   // strictly inside the allowance: the boundary stays on the forbidden side
}

/** The aptitude (0.35 .. 1) a place has for developing, from its ORIGINAL elevation: high ground used to be hard to live on, but never worse than 0.35 -- worn to plain it can still grow. */
export const APT_FLOOR = 0.35, APT_FALL_M = 4500;
export const aptitudeOf = (elev0M: number): number => Math.max(APT_FLOOR, 1 - Math.max(0, elev0M) / APT_FALL_M);

// ---- names: from the highest peak of the range ----
export interface Peak { name: string; elevM: number; lon: number; lat: number }
/** The highest peak of each range as the game draws it (the range's own crest line). 奥羽山脈 is the part from 青森 to 福島 the game draws, so its peak is 岩手山 (its own highest peak, 燧ヶ岳, lies beyond the drawn line). */
export const RANGE_PEAKS: Record<string, Peak> = {
  hidaka: { name: "幌尻岳", elevM: 2053, lon: 142.68, lat: 42.72 },
  ou: { name: "岩手山", elevM: 2038, lon: 141.0, lat: 39.85 },
  kanto: { name: "雲取山", elevM: 2017, lon: 138.94, lat: 35.86 },
  hida: { name: "奥穂高岳", elevM: 3190, lon: 137.65, lat: 36.29 },
  kiso: { name: "木曽駒ヶ岳", elevM: 2956, lon: 137.80, lat: 35.79 },
  akaishi: { name: "北岳", elevM: 3193, lon: 138.24, lat: 35.67 },
  kii: { name: "八経ヶ岳", elevM: 1915, lon: 135.93, lat: 34.16 },
  chugoku: { name: "大山", elevM: 1729, lon: 133.54, lat: 35.37 },
  shikoku: { name: "石鎚山", elevM: 1982, lon: 133.12, lat: 33.77 },
  kyushu: { name: "祖母山", elevM: 1756, lon: 131.30, lat: 32.82 },
};
const MOUNTAIN_END = ["山", "岳", "嶽", "峰", "嶺"];
/** The name of a peak without its mountain word: 富士山 -> 富士, 八ヶ岳 -> 八ヶ, 幌尻岳 -> 幌尻. A one-letter stem (大山 -> 大, 北岳 -> 北) keeps the mountain word so the name stays a name (大山, 北岳); null when nothing usable is left. */
export function peakStem(name: string): string | null {
  const n = (name ?? "").trim(); if (!n) return null;
  const last = n[n.length - 1]; if (!MOUNTAIN_END.includes(last)) return n.length >= 1 ? n : null;
  const stem = n.slice(0, -1); if (stem.length >= 2) return stem; return n.length >= 2 ? n : null;
}
const DIRS = ["", "北", "南", "東", "西", "中", "上", "下"];
/** The name of the n-th town (0-based) of a range's flat zone, of the given kind: 雲取市, 北雲取市, 南雲取市 ... A name already taken is changed by a fixed rule (the mountain word back, then 新, then a number), so the same game always names its towns the same way. */
export function townName(peakName: string, n: number, kind: MuniKind, taken: ReadonlySet<string>): string | null {
  const stem = peakStem(peakName); if (!stem) return null; const suf = MUNI_LABEL[kind], dir = DIRS[n % DIRS.length], lap = Math.floor(n / DIRS.length);
  const base = `${dir}${stem}`, cands = [`${base}${suf}`, `${base}山${suf}`.replace("山山", "山"), `新${base}${suf}`];
  for (const c of cands) if (!taken.has(c) && c !== suf) return lap ? `${c.slice(0, -1)}${lap + 1}${suf}` : c;
  for (let i = 2; i < 100; i++) { const c = `${base}${i}${suf}`; if (!taken.has(c)) return c; }
  return null;
}

// ---- the flat zones: where towns may be founded after a range is worn to plain ----
export interface ZoneSeed { cell: number; areaKm2: number }
export interface FlatZone { id: string; name: string; peak: string | null; factor: number; cells: number; areaKm2: number; seeds: ZoneSeed[] }
export const ZONE_FACTOR_MAX = 0.3;          // a range with a relief factor of 0.3 or less (down to 0) is a flat zone
export const SEED_SPACING_KM = 28, SEEDS_MAX = 8, SEED_MIN_AREA_KM2 = 400;
/** Chooses the town sites of one zone, spread out (SEED_SPACING_KM apart), on ground the city kind may stand on, plainest first; each seed owns the zone cells nearest to it (its catchment). Deterministic. */
export function planSeeds(zoneCells: number[], nx: number, cell: number, elevAt: (k: number) => number, plainAt: (k: number) => number, taken: ReadonlySet<number>): ZoneSeed[] {
  const order = [...zoneCells].sort((a, b) => plainAt(b) - plainAt(a) || a - b), seeds: number[] = [];
  const d = (a: number, b: number) => Math.hypot(((a % nx) - (b % nx)), (((a / nx) | 0) - ((b / nx) | 0))) * cell;
  for (const k of order) { if (seeds.length >= SEEDS_MAX) break; if (taken.has(k) || !allowedAt("city", elevAt(k))) continue; if (seeds.every((s) => d(s, k) >= SEED_SPACING_KM)) seeds.push(k); }
  const area = seeds.map(() => 0); for (const k of zoneCells) { let b = -1, bd = Infinity; seeds.forEach((s, i) => { const dd = d(s, k); if (dd < bd) { bd = dd; b = i; } }); if (b >= 0) area[b] += cell * cell; }
  return seeds.map((s, i) => ({ cell: s, areaKm2: Math.round(area[i]) })).filter((s) => s.areaKm2 >= SEED_MIN_AREA_KM2);
}
