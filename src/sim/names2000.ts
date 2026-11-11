/** Stage 40: names for the game's settlements and post towns from the 2000-10-01 municipalities (core/gazetteer2000.ts). Only new games of the 1800 start use it: older games keep the names they have. */
import { gameName, nearestOld, type OldKind, type OldPlace } from "../core/gazetteer2000";
import type { World } from "./world";
import type { SimState, Settlement } from "./types";

/** Stems and names already in use by the game's cities and settlements (a name is used once). */
export function usedNames(sim: SimState, w: World): Set<string> {
  const s = new Set<string>(); for (const c of w.cities) { s.add(c.name); s.add(c.name.replace(/市$/, "")); }
  for (const v of Object.values(sim.settlements)) { s.add(v.name); s.add(v.name.replace(/[町村市宿]$/, "")); }
  return s;
}
/** The kind a settlement of `pop` people has in the game: the game's own designation, not the old municipality's. */
export const kindOfPop = (pop: number): OldKind => (pop >= 50000 ? "city" : pop >= 8000 ? "town" : "village");
/** Gives the nearest unused old municipality's name to a settlement of the game (by the cell's position), and records where the name came from. Returns false if no name is left (the caller keeps its own). */
export function nameFromOld(sim: SimState, w: World, v: Settlement, taken: Set<string>, suffix?: string): boolean {
  const p: OldPlace | null = nearestOld(w.cellPos(v.cell), taken); if (!p) return false;
  v.name = suffix ? p.stem + suffix : gameName(p, kindOfPop(v.pop)); v.origin = { code: p.code, name: p.name, pref: p.pref };
  taken.add(p.stem); taken.add(p.name); taken.add(v.name); return true;
}
