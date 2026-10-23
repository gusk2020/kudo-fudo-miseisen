/** Stage 20: what a place is called. The name of a seat put on the map is the nearest REAL place name the data holds (a city of the 55, a provincial town, an added island's town, or an island of src/data/islets.json) with 「市」,
 *  never 「市市」. Nothing is invented: when the nearest known place is far, the name is still that place's and the description says how far. */
import { EXTRA, JAPAN, TOWNS } from "./data";
import { ISLETS, isletPos } from "./islets";
import type { Vec } from "./types";

export interface Place { name: string; pos: Vec; kind: "city" | "town" | "islet"; reach: number }
let PLACES: Place[] | null = null;
function places(): Place[] {
  if (PLACES) return PLACES; const l: Place[] = [];
  for (const c of [...JAPAN.cities, ...EXTRA.cities]) l.push({ name: c.name, pos: c.pos, kind: "city", reach: 0 });
  for (const t of TOWNS) l.push({ name: t.name, pos: t.pos, kind: "town", reach: 0 });
  for (const s of ISLETS) l.push({ name: s.name, pos: isletPos(s), kind: "islet", reach: Math.max(s.len, s.wid) / 2 });
  return (PLACES = l);
}
/** 「市」 once: a name already ending in 市 is not given a second one. */
export const cityNameOf = (name: string): string => (name.endsWith("市") ? name : name + "市");
export interface NearName { name: string; place: string; km: number; kind: Place["kind"] }
/** The nearest known place to a point (an island counts from its shore, so a point on an island is always that island's). */
export function nearestPlace(p: Vec): NearName | null {
  let best: Place | null = null, bd = Infinity;
  for (const q of places()) { const d = Math.max(0, Math.hypot(q.pos[0] - p[0], q.pos[1] - p[1]) - q.reach); if (d < bd || (d === bd && best && q.kind === "islet")) { bd = d; best = q; } }
  return best ? { name: cityNameOf(best.name), place: best.name, km: Math.round(bd * 10) / 10, kind: best.kind } : null;
}
