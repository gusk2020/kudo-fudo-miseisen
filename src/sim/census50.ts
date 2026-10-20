/**
 * Stage 15 (Issue #35, phone check of Stage 14): the starting populations of the cities.
 *
 * Until now every city started at (its modern figure from the map data) x POP_1950_SCALE, one factor for the whole country. Two things were wrong with that:
 *   - the figure for a big city is its whole modern METROPOLIS (Tokyo 35.7 M, which already contains Yokohama, Kawasaki, Saitama, Chiba ... that are separate cities
 *     of this game), so the biggest city was counted twice and began at 44% of every city's people (Kanto 50%; the real 1950 figure is about 21%);
 *   - the postwar growth was NOT uniform: the country grew 1.5x, Tokyo's region 3x, a rural prefecture hardly at all. One factor puts today's concentration into 1950.
 * So from Stage 15 on, a new game starts each PREFECTURE at its 1950 census population x the share of it living in cities (the 市部 share, approximate), split among
 * that prefecture's cities by their map-data sizes. The countryside (the rest of the census figure) is the separate rural model's. A prefecture whose listed cities are few is capped (LISTED_CAP) so one listed city never carries a whole prefecture's towns. The country's sum stays near what it was. Hokkaido's sub-prefectures are one census prefecture.
 *
 * Figures: Statistics Bureau 1950 census prefecture populations (thousands, rounded) and the urban-municipality share (rounded to 0.01, approximate: this is a game
 * start, not a statistic). Older games never read this: they carry no `roles.p15`.
 */
import type { WCity, World } from "./world";

const T: Record<string, [number, number]> = {
  HK: [4296, 0.43], "JP-02": [1283, 0.27], "JP-03": [1347, 0.22], "JP-04": [1663, 0.33], "JP-05": [1309, 0.22], "JP-06": [1357, 0.22], "JP-07": [2062, 0.24],
  "JP-08": [2039, 0.17], "JP-09": [1550, 0.26], "JP-10": [1601, 0.33], "JP-11": [2146, 0.26], "JP-12": [2139, 0.27], "JP-13": [6278, 0.88], "JP-14": [2488, 0.62],
  "JP-15": [2461, 0.26], "JP-16": [1008, 0.3], "JP-17": [957, 0.35], "JP-18": [752, 0.3], "JP-19": [811, 0.24], "JP-20": [2061, 0.21], "JP-21": [1544, 0.26],
  "JP-22": [2471, 0.43], "JP-23": [3391, 0.52], "JP-24": [1461, 0.27], "JP-25": [861, 0.13], "JP-26": [1833, 0.53], "JP-27": [3857, 0.76], "JP-28": [3310, 0.56],
  "JP-29": [764, 0.18], "JP-30": [983, 0.36], "JP-31": [600, 0.26], "JP-32": [913, 0.17], "JP-33": [1661, 0.33], "JP-34": [2081, 0.45], "JP-35": [1541, 0.37],
  "JP-36": [878, 0.26], "JP-37": [946, 0.26], "JP-38": [1521, 0.35], "JP-39": [873, 0.34], "JP-40": [3530, 0.55], "JP-41": [945, 0.15], "JP-42": [1645, 0.38],
  "JP-43": [1827, 0.25], "JP-44": [1253, 0.28], "JP-45": [1091, 0.24], "JP-46": [1804, 0.22], "JP-47": [698, 0.3],
};
const key = (pref: string | null) => (pref && pref.startsWith("HK-") ? "HK" : pref);
const memo = new WeakMap<World, Map<string, number>>();
/** Each city's starting population under the census rule (cities of a prefecture without a census row keep their map-data figure). */
export const LISTED_CAP = 2.5;   // a prefecture carries at most this many times the map's own figure for its listed cities: the map lists only ~60 cities, and a prefecture with one listed city (Hyogo: Kobe) would otherwise put its whole urban population into it
export function censusPops(w: World): Map<string, number> {
  let m = memo.get(w); if (m) return m; m = new Map();
  const sum = new Map<string, number>(); for (const c of w.cities) { const k = key(c.pref); if (k && T[k]) sum.set(k, (sum.get(k) ?? 0) + c.pop0); }
  for (const c of w.cities) { const k = key(c.pref), row = k ? T[k] : undefined, s = k ? sum.get(k) : 0; m.set(c.id, row && s ? Math.round(Math.min(row[0] * 1000 * row[1], LISTED_CAP * s) * c.pop0 / s) : c.pop0); }
  memo.set(w, m); return m;
}
/** The starting population of a city: the census rule for a Stage 15 game, the map-data figure otherwise. */
export const startPop = (w: World, c: WCity, p15: boolean | undefined): number => (p15 ? censusPops(w).get(c.id) ?? c.pop0 : c.pop0);
