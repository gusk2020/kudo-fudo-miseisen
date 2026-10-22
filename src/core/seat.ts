/**
 * The seats of government (Issue #15): the capital, the sub-capital and the Imperial Palace are three independent settings, each one of the 49 prefectures
 * (the three Hokkaido prefectures and Okinawa included). They are administrative settings, never terrain, and nothing links them: moving the palace does not
 * move the capital (`PALACE_LINKS` is the empty extension point for a future political / traffic-demand effect).
 *
 * Stored values are prefecture ids (JP-13, HK-SAP ...). Games saved by the previous stage stored a CITY id (C-JP-27) in `capital`; `prefOfSeat` reads both.
 * Every prefecture's representative point is its 県庁所在地 (the city of that name in the data); the palace may also be placed by hand anywhere inside its prefecture.
 */
import { realToWorld } from "./body";
import { JAPAN } from "./data";
import type { ProjectState, Vec } from "./types";

export const PREF_IDS: string[] = JAPAN.prefectures.map((p) => p.id);
/** Issue #20: the same 49 ids by the latitude of each 県庁所在地 alone (kept for reference; the pickers now list REGION_BLOCKS). */
export const PREF_IDS_NS: string[] = [...PREF_IDS].sort((a, b) => {
  const y = (id: string) => JAPAN.cities.find((c) => c.pref === id && c.kind === "capital")?.pos[1] ?? -1e9;
  return y(b) - y(a) || (a < b ? -1 : 1);
});
/**
 * Stage 10 (Issue #26): what the prefecture pickers list -- the eight regional blocks plus Okinawa, north to south, and within each block north to south by
 * the latitude of its 県庁所在地 (so the country is never shuffled by latitude alone: 新潟 stays in 中部, 鳥取 in 中国). Hokkaido is this world's three prefectures.
 */
export const REGION_BLOCKS: { name: string; prefs: string[] }[] = ([
  ["北海道", ["HK-SAP", "HK-HAK", "HK-NEM"]], ["東北", ["JP-02", "JP-03", "JP-04", "JP-05", "JP-06", "JP-07"]], ["関東", ["JP-08", "JP-09", "JP-10", "JP-11", "JP-12", "JP-13", "JP-14"]],
  ["中部", ["JP-15", "JP-16", "JP-17", "JP-18", "JP-19", "JP-20", "JP-21", "JP-22", "JP-23"]], ["近畿", ["JP-24", "JP-25", "JP-26", "JP-27", "JP-28", "JP-29", "JP-30"]],
  ["中国", ["JP-31", "JP-32", "JP-33", "JP-34", "JP-35"]], ["四国", ["JP-36", "JP-37", "JP-38", "JP-39"]], ["九州", ["JP-40", "JP-41", "JP-42", "JP-43", "JP-44", "JP-45", "JP-46"]], ["沖縄", ["JP-47"]],
] as [string, string[]][]).map(([name, prefs]) => {
  const y = (id: string) => JAPAN.cities.find((c) => c.pref === id && c.kind === "capital")?.pos[1] ?? -1e9;
  return { name, prefs: prefs.filter((p) => PREF_IDS.includes(p)).sort((a, b) => y(b) - y(a) || (a < b ? -1 : 1)) };
});
/** The 49 ids in picker order (block by block). */
export const PREF_IDS_BLOCK: string[] = REGION_BLOCKS.flatMap((b) => b.prefs);
export const prefName = (id: string): string => JAPAN.prefectures.find((p) => p.id === id)?.name ?? id;
/** A prefecture id from a stored value: a prefecture id as is, a legacy city id ("C-JP-27") by its prefecture, anything else -> null. */
export function prefOfSeat(v: unknown): string | null {
  if (typeof v !== "string") return null; if (PREF_IDS.includes(v)) return v;
  if (v.startsWith("C-") && PREF_IDS.includes(v.slice(2))) return v.slice(2);
  const c = JAPAN.cities.find((x) => x.id === v); return c?.pref && PREF_IDS.includes(c.pref) ? c.pref : null;
}
export const DEFAULT_CAPITAL = "JP-13", DEFAULT_SUB = "JP-27", DEFAULT_PALACE = "JP-13";
export interface Seats { capital: string; sub: string; palace: string }
/** The effective seats of a map state: the chosen ones, else Tokyo / Osaka / Tokyo (Osaka and Tokyo swap if the capital alone was set to Osaka). */
export function seatsOf(s: Pick<ProjectState, "capital" | "subCapital" | "palace">): Seats {
  const capital = prefOfSeat(s.capital) ?? DEFAULT_CAPITAL, sub = prefOfSeat(s.subCapital) ?? (capital === DEFAULT_SUB ? DEFAULT_CAPITAL : DEFAULT_SUB);
  return { capital, sub, palace: prefOfSeat(s.palace) ?? DEFAULT_PALACE };
}
/** The capital and the sub-capital must be different prefectures; the palace may share either. */
export const seatsValid = (x: Seats) => x.capital !== x.sub;
/** The 県庁所在地's real position, in the game's world frame (world = real while no body is deformed). */
export function prefPoint(s: Pick<ProjectState, "bodies">, prefId: string): Vec | null {
  const c = JAPAN.cities.find((x) => x.pref === prefId && x.kind === "capital"); if (!c) return null;
  const body = c.island === "okinawa" ? "kyushu" : (c.island as "honshu"); return realToWorld(body, s.bodies[body], c.pos);
}
/** Where the palace is drawn: the chosen point, else its prefecture's representative point. */
export function palaceWorld(s: Pick<ProjectState, "bodies" | "capital" | "subCapital" | "palace" | "palacePos">): Vec | null {
  if (s.palacePos && s.palacePos.length === 2) return s.palacePos; return prefPoint(s, seatsOf(s).palace);
}
/** Stage 19: where the capital / sub-capital stand: the point chosen on the map, else the 県庁所在地. */
export function seatPos(s: Pick<ProjectState, "bodies" | "capital" | "subCapital" | "capitalPos" | "subPos">, which: "capital" | "sub"): Vec | null {
  const p = which === "capital" ? s.capitalPos : s.subPos; if (p && p.length === 2) return p; return prefPoint(s, seatsOf(s)[which]);
}
/** Extension point: effects of where the palace stands on politics / traffic demand. Deliberately empty -- the brief says not to link them yet. */
export const PALACE_LINKS: { id: string; note: string }[] = [];
