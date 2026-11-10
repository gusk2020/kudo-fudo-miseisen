/**
 * Stage 40: the municipalities of 2000-10-01 as a pool of NAMES for the game's places.
 * Source: 国土数値情報 行政区域データ N03 v2.2 (2000年10月1日), 国土交通省. 出典: 国土交通省国土数値情報ダウンロードサイト(https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N03-v2_2.html)。
 * 編集・加工: tools/build_gazetteer.py が市町村ごとに名称・コード・所属・代表点(最大の領域の重心)・面積だけを抽出した(境界のポリゴンは含まない)。
 * These are NAMES and starting points, not a claim about 1800: the game's 1800 is fiction, the prefecture borders are still computed from the terrain, and nothing here is invented -- a name the data does not hold is never made up.
 * Wards (区: the 23 special wards and the wards of the designated cities) are left out: they are parts of a city, and their bare names (中央区, 北区 ...) collide dozens of times.
 */
import raw from "../data/gazetteer2000.json";
import { lonLatToReal } from "./data";
import type { Vec } from "./types";

export type OldKind = "city" | "town" | "village";
export interface OldPlace { code: string; pref: string; county: string; name: string; stem: string; kind: OldKind; pos: Vec; areaKm2: number }
const KIND: Record<string, OldKind> = { 市: "city", 町: "town", 村: "village" };
/** 「田老町」→「田老」. A one-letter stem (大町 → 大) keeps its suffix so it stays a name. */
export function stemOf(name: string): string { const last = name[name.length - 1]; return KIND[last] && name.length > 2 ? name.slice(0, -1) : name; }
let POOL: OldPlace[] | null = null;
export const GAZETTEER_2000 = { source: (raw as { source: string }).source, url: (raw as { url: string }).url, license: (raw as { license: string }).license, note: (raw as { note: string }).note, count: (raw as { count: number }).count };
/** Every usable entry (市・町・村), in the file's order (by code). Built once, on first use. */
export function oldPlaces(): readonly OldPlace[] {
  if (POOL) return POOL; const out: OldPlace[] = [];
  for (const r of (raw as unknown as { items: [string, string, string, string, string, number, number, number, number][] }).items) {
    const [code, pref, name, county, , lon, lat, area] = r, k = KIND[name[name.length - 1]]; if (!k) continue;   // (区 and 所属未定地 are not municipalities of this kind)
    out.push({ code, pref, county, name, stem: stemOf(name), kind: k, pos: lonLatToReal(lon, lat), areaKm2: area });
  }
  return (POOL = out);
}
/** The name a place is given in the game: the stem plus the suffix of the kind it has now (a 村 that grew is a 町: the old name is kept, the designation is the game's own). */
export const gameName = (p: OldPlace, kind: OldKind): string => (p.stem === p.name ? p.name : p.stem + (kind === "city" ? "市" : kind === "town" ? "町" : "村"));
/**
 * The nearest unused old municipality to a point. `taken` holds the stems and names already in use (cities, settlements); a name in it is skipped, which is how a same-named municipality in another prefecture
 * (大和町, 中央町 ...) is resolved: the nearest one wins and the rest wait. Ties go to the smaller code, so the answer is the same on every run.
 */
export function nearestOld(p: Vec, taken: ReadonlySet<string>, kinds?: readonly OldKind[], maxKm = Infinity): OldPlace | null {
  let best: OldPlace | null = null, bd = maxKm;
  for (const q of oldPlaces()) { if (kinds && !kinds.includes(q.kind)) continue; if (taken.has(q.stem) || taken.has(q.name)) continue; const d = Math.hypot(q.pos[0] - p[0], q.pos[1] - p[1]); if (d < bd || (d === bd && best && q.code < best.code)) { bd = d; best = q; } }
  return best;
}
