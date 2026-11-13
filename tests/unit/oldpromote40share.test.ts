import { describe, expect, it } from "vitest";
import { advance, yearOf } from "../../src/sim/engine";
import { restoreOldCities, syncOldCities } from "../../src/sim/oldcity40";
import type { SimState } from "../../src/sim/types";
import { stage3Sim } from "./simhelp";

/** Issue #67 (audit of PR #71, point 3): two games on ONE world object (as a test's cached world is) must not disturb each other; in the app every game builds its own world. */
const sig = (s: SimState) => JSON.stringify([Object.keys(s.cities).sort().map((k) => [k, s.cities[k].pop]), Object.keys(s.routes).length, Object.keys(s.projects).length, Object.keys(s.edges).length, s.rngState, s.oldCities40?.map((d) => d.id)]);
const A = stage3Sim("heisei", 7, true, 0, 2, true, undefined, undefined, { start1800: true } as never), w = A.w;
describe("two games on one world", () => {
  it("run alternately year by year they equal the same two games run one after the other, and neither keeps the other's promoted cities", () => {
    A.sim.policy!.mode = "auto"; advance(A.sim, w, 12 * (1962 - yearOf(A.sim))); expect(A.sim.oldCities40?.length ?? 0).toBeGreaterThan(0);   // A has promoted cities
    const a0 = JSON.stringify(A.sim), B = stage3Sim("heisei", 11, true, 0, 2, true, undefined, undefined, { start1800: true } as never); B.sim.policy!.mode = "auto";   // B is created on the same world: the world drops A's cities
    expect(w.cities.some((c) => c.id.startsWith("O-"))).toBe(false); const b0 = JSON.stringify(B.sim);
    // solo: A alone for 8 years, then B alone for 8 years (each given its cities back by the sync at the start of advance)
    const soloA = JSON.parse(a0) as SimState, soloB = JSON.parse(b0) as SimState; soloA.policy!.mode = "auto"; soloB.policy!.mode = "auto"; advance(soloA, w, 12 * 8); const sa = sig(soloA); advance(soloB, w, 12 * 8); const sb = sig(soloB);
    // alternately: one year each
    const altA = JSON.parse(a0) as SimState, altB = JSON.parse(b0) as SimState; altA.policy!.mode = "auto"; altB.policy!.mode = "auto"; for (let i = 0; i < 8; i++) { advance(altA, w, 12); advance(altB, w, 12); }
    expect(sig(altA), "game A is the same game however it shares the world").toBe(sa); expect(sig(altB), "game B too").toBe(sb);
    // B has no promoted city of A's; A keeps its own
    expect(altB.oldCities40?.some((d) => altA.oldCities40?.some((x) => x.id === d.id && x.cell === d.cell))).toBeFalsy(); expect(w.cityById.size).toBeGreaterThan(0);
  }, 900000);
  it("loading a promoted game into a world that holds another game's promoted cities removes the other's and restores its own", () => {
    const s = JSON.parse(JSON.stringify(A.sim)) as SimState; const other = stage3Sim("heisei", 11, true, 0, 2, true, undefined, undefined, { start1800: true } as never); void other; const r = restoreOldCities(s, w); expect(r.problems).toEqual([]); syncOldCities(s, w); const mine = (s.oldCities40 ?? []).map((d) => d.id).sort(); expect(mine.length).toBeGreaterThan(0); expect(w.cities.filter((c) => c.id.startsWith("O-")).map((c) => c.id).sort()).toEqual(mine);
  });
});
