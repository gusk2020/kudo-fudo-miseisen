/**
 * Stage 40 / Issue #67, first stage: the foundation for old municipalities that become SIMULATED cities (`w.cities`), without adding any yet.
 *
 * A promoted city is a small definition kept in the game (`sim.oldCities40`: stable id, the 2000-10-01 municipality code and name, prefecture, cell, year of founding, starting people). The world is rebuilt from the terrain every
 * time a game is loaded, so it does not contain these cities; `restoreOldCities` puts them back from the definitions -- the same id, the same cell, in the same order -- before the game is checked and resumed.
 * Rules this foundation keeps (tested): idempotent (a second restore adds nothing), never replaces a city that is there (a different city on the same id or cell is a conflict, not an overwrite), refuses a cell that is not land,
 * leaves a game with no definitions exactly as it was (old saves, 1950 starts), and keeps `sim.cities` (people) and the world's indexes together.
 * The world is changed in place: the caller must own the world (a game's own, never a cached one shared by several games).
 */
import { resetWorldCaches } from "./worldMemo";
import type { SimState } from "./types";
import type { World, WCity } from "./world";

export interface OldCityDef { id: string; code: string; name: string; pref: string; cell: number; year: number; pop0: number }
/** The most promoted cities a game may carry until the cost of more is measured (the second stage). */
export const OLDCITY_MAX = 60;
export const oldCityId = (code: string) => `O-${code}`;

export function conflictOf(w: World, d: OldCityDef): string | null {
  if (!Number.isInteger(d.cell) || d.cell < 0 || d.cell >= w.N || w.t.land[d.cell] !== 1) return `${d.id}: the cell is not land`;
  const same = w.cityById.get(d.id); if (same && same.cell !== d.cell) return `${d.id}: another city has this id`;
  const there = w.cityByCell.get(d.cell); if (there && there.id !== d.id) return `${d.id}: the cell holds ${there.id}`;
  return null;
}
function cityOf(w: World, d: OldCityDef): WCity {
  const k = d.cell, nx = w.nx, coastal = [1, -1, nx, -nx].some((o) => w.t.land[k + o] !== 1);
  return { id: d.id, name: d.name, cell: k, pos: w.cellPos(k), pref: w.prefOf(k) ?? d.pref, island: w.t.island[k], pop0: d.pop0, popSource: "synthetic", coastal, plains: 0.5, kind: "city" };
}
/** Puts the cities of `sim.oldCities40` into the world (in order). Returns what it added and the conflicts it refused. */
export function restoreOldCities(sim: SimState, w: World): { added: number; problems: string[] } {
  const defs = sim.oldCities40; if (!defs?.length) return { added: 0, problems: [] }; let added = 0; const problems: string[] = [];
  for (const d of defs) {
    if (w.cityById.get(d.id)?.cell === d.cell) { sim.cities[d.id] ??= { pop: d.pop0, industry: 0, popSource: "synthetic", lowAccessYears: 0 }; continue; }   // already there (idempotent)
    const bad = conflictOf(w, d); if (bad) { problems.push(bad); continue; }
    const c = cityOf(w, d); w.cities.push(c); w.cityById.set(c.id, c); if (!w.cityByCell.has(c.cell)) w.cityByCell.set(c.cell, c);
    sim.cities[d.id] ??= { pop: d.pop0, industry: 0, popSource: "synthetic", lowAccessYears: 0 }; added++;
  }
  if (added) resetWorldCaches(w);   // (the memos keyed on a world may have looked at its cities)
  return { added, problems };
}
/** Adds a definition to a game and to its world (the foundation's entry point; nothing calls it yet in play). Returns an error text or null. */
export function addOldCity(sim: SimState, w: World, d: OldCityDef): string | null {
  const defs = (sim.oldCities40 ??= []); if (defs.some((x) => x.id === d.id || x.cell === d.cell)) return `${d.id}: already defined`; if (defs.length >= OLDCITY_MAX) return "limit reached";
  const bad = conflictOf(w, d); if (bad) return bad; defs.push({ ...d }); const r = restoreOldCities(sim, w); return r.problems[0] ?? null;
}
