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
/** Extension point: effects of where the palace stands on politics / traffic demand. Deliberately empty -- the brief says not to link them yet. */
export const PALACE_LINKS: { id: string; note: string }[] = [];
