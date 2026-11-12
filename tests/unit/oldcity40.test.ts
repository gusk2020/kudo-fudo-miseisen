import { describe, expect, it } from "vitest";
import { generateTerrain } from "../../src/core/terrain";
import { defaultState } from "../../src/core/state";
import { createSim, advance, yearOf } from "../../src/sim/engine";
import { buildWorld, townsForSeats } from "../../src/sim/world";
import { addOldCity, conflictOf, OLDCITY_MAX, oldCityId, restoreOldCities, type OldCityDef } from "../../src/sim/oldcity40";
import { validateSimAgainstWorld } from "../../src/core/save2";
import type { SimState } from "../../src/sim/types";
import { loadDem } from "./helpers";

/** Issue #67 first stage: promoted old municipalities are stored in the game and restored into a freshly built world, deterministically; nothing adds any in play yet. */
const dem = loadDem(), OPTS = { stage3: true, firstEra: 0, techK: 2, start1800: true, subCapital: "JP-27" } as never;
function fresh() { const s = defaultState(); s.islands = true; const t = generateTerrain(s, dem), ids = townsForSeats(t, ["JP-13", "JP-27"]); return { t, w: buildWorld(t, s.seed, ids, 3), s }; }   // (each call builds its own world: the restore changes it in place)
const freeCells = (w: ReturnType<typeof fresh>["w"], n: number) => { const out: number[] = []; for (let k = 0; k < w.N && out.length < n; k += 211) if (w.t.land[k] === 1 && !w.cityByCell.has(k) && w.prefOf(k)) out.push(k); return out; };
const def = (w: ReturnType<typeof fresh>["w"], cell: number, code: string, year = 1900): OldCityDef => ({ id: oldCityId(code), code, name: "試験" + code + "市", pref: w.prefOf(cell)!, cell, year, pop0: 60000 });
describe("Issue #67 first stage: define, save, restore", () => {
  const a = fresh(), sim = createSim(a.w, "m", a.t.hash, 7, OPTS), cells = freeCells(a.w, 3), nCities = a.w.cities.length;
  it("a game with no definitions is exactly as it was (restore does nothing); the cap is the stated one", () => {
    expect(sim.oldCities40).toBeUndefined(); expect(restoreOldCities(sim, a.w)).toEqual({ added: 0, problems: [] }); expect(a.w.cities.length).toBe(nCities); expect(OLDCITY_MAX).toBe(60);
  });
  it("adding a definition puts the city in the world, its indexes and the people table, with a stable id and its own cell", () => {
    expect(addOldCity(sim, a.w, def(a.w, cells[0], "99001"))).toBeNull(); expect(addOldCity(sim, a.w, def(a.w, cells[1], "99002"))).toBeNull();
    const c = a.w.cityById.get("O-99001")!; expect(c.cell).toBe(cells[0]); expect(c.pos).toEqual(a.w.cellPos(cells[0])); expect(a.w.cityByCell.get(cells[0])).toBe(c); expect(a.w.cities.at(-2)).toBe(c); expect(a.w.cities.length).toBe(nCities + 2);
    expect(sim.cities["O-99001"].pop).toBe(60000); expect(c.pref).toBe(a.w.prefOf(cells[0])); expect(c.island).toBe(a.w.t.island[cells[0]]);
  });
  it("refusals: the same id or cell twice, a cell that is sea, a cell another city holds, and the cap", () => {
    expect(addOldCity(sim, a.w, def(a.w, cells[2], "99001"))).toMatch(/already/); expect(addOldCity(sim, a.w, def(a.w, cells[0], "99003"))).toMatch(/already/);
    const sea = [...Array(a.w.N).keys()].find((k) => a.w.t.land[k] !== 1)!; expect(conflictOf(a.w, def(a.w, sea, "99004"))).toMatch(/not land/);
    const held = a.w.cities[0]; expect(conflictOf(a.w, { ...def(a.w, held.cell, "99005") })).toMatch(/holds/);
    const full = createSim(fresh().w, "m", a.t.hash, 7, OPTS); full.oldCities40 = Array.from({ length: OLDCITY_MAX }, (_, i) => def(a.w, cells[0], String(i))); expect(addOldCity(full, a.w, def(a.w, cells[2], "99006"))).toBe("limit reached");
  });
  it("a save and a freshly built world bring back the same cities: id, cell, order, people; a second restore adds nothing; the game is accepted by the load check", () => {
    const saved = JSON.parse(JSON.stringify(sim)) as SimState, b = fresh();   // a new world, as a load builds it
    expect(b.w.cityById.has("O-99001")).toBe(false); const r = restoreOldCities(saved, b.w); expect(r).toEqual({ added: 2, problems: [] });
    expect(b.w.cities.map((c) => c.id)).toEqual(a.w.cities.map((c) => c.id)); expect(b.w.cities.map((c) => c.cell)).toEqual(a.w.cities.map((c) => c.cell)); expect(saved.cities["O-99002"].pop).toBe(sim.cities["O-99002"].pop);
    expect(restoreOldCities(saved, b.w).added).toBe(0); expect(b.w.cities.length).toBe(nCities + 2); expect(validateSimAgainstWorld(saved, b.w, b.t.hash)).toBeNull();
    const broken = JSON.parse(JSON.stringify(saved)) as SimState; broken.oldCities40![0].cell = 0; expect(validateSimAgainstWorld(broken, fresh().w, b.t.hash)).toMatch(/昇格/);   // a definition on a cell that is not land is refused by the check
  });
  it("the people table is not overwritten when the city is already in it (a restored game keeps its people), and a conflict on load is reported, not applied", () => {
    const saved = JSON.parse(JSON.stringify(sim)) as SimState; saved.cities["O-99001"].pop = 123456; const b = fresh(); restoreOldCities(saved, b.w); expect(saved.cities["O-99001"].pop).toBe(123456);
    const clash = JSON.parse(JSON.stringify(sim)) as SimState, c = fresh(); clash.oldCities40![0].cell = c.w.cities[0].cell; const r = restoreOldCities(clash, c.w); expect(r.problems.length).toBeGreaterThan(0); expect(c.w.cityById.has("O-99001")).toBe(false);
  });
  it("the restored game goes on: the game after a save and restore is the same game (a few years, same people and roads) as the one that never stopped", () => {
    const x = fresh(), y = fresh(), sx = createSim(x.w, "m", x.t.hash, 7, OPTS), cs = freeCells(x.w, 1); sx.policy!.mode = "auto"; expect(addOldCity(sx, x.w, def(x.w, cs[0], "99010"))).toBeNull();
    const sy = JSON.parse(JSON.stringify(sx)) as SimState; restoreOldCities(sy, y.w); sy.policy!.mode = "auto";
    advance(sx, x.w, 12 * 12); advance(sy, y.w, 12 * 12); expect(yearOf(sx)).toBe(yearOf(sy));
    const sig = (s: SimState) => JSON.stringify([Object.values(s.cities).map((c) => c.pop), Object.keys(s.edges).length, s.rngState]);
    expect(sig(sy)).toBe(sig(sx)); expect(sy.cities["O-99010"].pop).toBe(sx.cities["O-99010"].pop);
  }, 600000);
});
