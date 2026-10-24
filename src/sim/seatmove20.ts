/** Stage 20: a seat of government put on the map becomes its prefecture's 県庁所在地.
 *  The prefecture has exactly one such city: the chosen point's (a new city, or a town of the data that stands there). The old one stays on the map as an ordinary city with all its people (`former`: it is not
 *  stripped of them at the start, only the yearly settling moves them, gradually). A new city starts with a small slice of the old one's census size, so no people are created. The role coordinates
 *  (capitalPos / subPos / palacePos) are kept apart from this city: the city is where the 県庁所在地 is, the role point is where the player put the seat. */
import { cityNameOf, nearestPlace } from "../core/gazetteer";
import type { TerrainResult } from "../core/terrain";
import type { Vec } from "../core/types";
import type { WCity } from "./world";

export type SeatRole = "capital" | "sub" | "palace";
export interface SeatMove { pref: string; pos: Vec; by: SeatRole; /** Stage 22: set for a move made by the 2200 event */ since?: number }
export interface MoveResult { pref: string; by: SeatRole; cityId: string; name: string; former: string | null; near: string; km: number; adopted: boolean }
export const PEOPLE_PER_KM2 = 2500, MIN_CITY_POP = 2000, ADOPT_KM = 25, NEW_SHARE = 0.01, NEW_POP_MIN = 300, NEW_POP_MAX = 20000;

/** The moves a game's seat settings amount to: one per prefecture (a capital or sub-capital point first, then a palace point), only for points the player put on the map. */
export function movesOfSettings(seats: { capital: string; sub: string; palace: string }, pos: { capitalPos?: Vec; subPos?: Vec; palacePos?: Vec }): SeatMove[] {
  const out: SeatMove[] = [], seen = new Set<string>();
  for (const [by, p, pref] of [["capital", pos.capitalPos, seats.capital], ["sub", pos.subPos, seats.sub], ["palace", pos.palacePos, seats.palace]] as [SeatRole, Vec | undefined, string][]) { if (!p || seen.has(pref)) continue; seen.add(pref); out.push({ pref, pos: [p[0], p[1]], by }); }
  return out;
}
const cellCentre = (t: TerrainResult, k: number): Vec => { const g = t.grid; return [g.x0 + ((k % g.nx) + 0.5) * g.cell, g.y0 + (((k / g.nx) | 0) + 0.5) * g.cell]; };

/** Applies the moves to the world's city list (in place). `capFor` gives the most people a land cell's place can hold (Infinity = no limit). */
export function applySeatMoves(cities: WCity[], t: TerrainResult, cellOf: (p: Vec) => number, moves: SeatMove[], capFor: (k: number) => number, coastalPlains: (k: number) => { coastal: boolean; plains: number }): MoveResult[] {
  const res: MoveResult[] = [];
  for (const m of moves) {
    const old = cities.find((c) => c.kind === "capital" && c.pref === m.pref); let k = cellOf(m.pos); if (k < 0 || t.land[k] !== 1) { k = nearestLand(t, cellOf, m.pos); if (k < 0) continue; }
    const taken = new Set(cities.map((c) => c.name)), np = nearestPlace(m.pos, taken), np0 = nearestPlace(m.pos);   // (a name is never given to two cities: the nearest place not already a city of the game)
    if (old && (old.cell === k || (old.island === t.island[k] && Math.hypot(old.pos[0] - m.pos[0], old.pos[1] - m.pos[1]) <= ADOPT_KM))) { res.push({ pref: m.pref, by: m.by, cityId: old.id, name: old.name, former: null, near: np0?.place ?? old.name, km: np0?.km ?? 0, adopted: true }); continue; }
    // a city or town of the data within ADOPT_KM of the point (on the same island) is the 県庁所在地 now: the point is in it
    const adopt = cities.filter((c) => c !== old && c.island === t.island[k] && Math.hypot(c.pos[0] - m.pos[0], c.pos[1] - m.pos[1]) <= ADOPT_KM).sort((a, b) => Math.hypot(a.pos[0] - m.pos[0], a.pos[1] - m.pos[1]) - Math.hypot(b.pos[0] - m.pos[0], b.pos[1] - m.pos[1]))[0];
    if (adopt && adopt.kind !== "capital") {
      if (old) { old.kind = "city"; old.former = true; } adopt.kind = "capital"; adopt.pref = m.pref; adopt.moved = m.by; res.push({ pref: m.pref, by: m.by, cityId: adopt.id, name: adopt.name, former: old?.id ?? null, near: adopt.name, km: Math.round(Math.hypot(adopt.pos[0] - m.pos[0], adopt.pos[1] - m.pos[1]) * 10) / 10, adopted: true }); continue;
    }
    const name = np ? np.name : cityNameOf("島"), cp = coastalPlains(k), slice = old ? Math.round(Math.max(NEW_POP_MIN, Math.min(NEW_POP_MAX, old.pop0 * NEW_SHARE))) : NEW_POP_MIN, take = old ? Math.min(slice, Math.max(0, old.pop0 - MIN_CITY_POP)) : slice;
    if (old) { old.pop0 -= take; old.kind = "city"; old.former = true; }
    const id = `M${m.since ? "22" : "20"}-${m.pref}`, nc: WCity = { id, name, cell: k, pos: cellOf(m.pos) === k ? [m.pos[0], m.pos[1]] : cellCentre(t, k), pref: m.pref, island: t.island[k], pop0: take || NEW_POP_MIN, popSource: "synthetic", coastal: cp.coastal, plains: cp.plains, kind: "capital", moved: m.by, capPop: Math.max(MIN_CITY_POP, capFor(k)) };
    if (!isFinite(nc.capPop!)) delete nc.capPop;
    cities.push(nc); res.push({ pref: m.pref, by: m.by, cityId: id, name, former: old?.id ?? null, near: np?.place ?? name, km: np?.km ?? 0, adopted: false });
  }
  return res;
}
function nearestLand(t: TerrainResult, cellOf: (p: Vec) => number, p: Vec): number {
  const k0 = cellOf(p); if (k0 < 0) return -1; const { nx, ny } = t.grid, i0 = k0 % nx, j0 = (k0 / nx) | 0; let best = -1, bd = Infinity;
  for (let r = 0; r < 4 && best < 0; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) { if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue; const a = i0 + di, b = j0 + dj; if (a < 0 || b < 0 || a >= nx || b >= ny) continue; const k = b * nx + a; if (t.land[k] !== 1) continue; const q = cellCentre(t, k), d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d < bd) { bd = d; best = k; } }
  return best;
}
