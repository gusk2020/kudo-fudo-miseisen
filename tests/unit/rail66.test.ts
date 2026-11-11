import { describe, expect, it } from "vitest";
import { advance, yearOf } from "../../src/sim/engine";
import { RAIL_RETRY_YEARS } from "../../src/sim/planning";
import type { SimState } from "../../src/sim/types";
import { stage3Sim } from "./simhelp";

/** Issue #66 (A): a 鉄道重視 1800 game no longer stalls after 1860. Cause: the same unbuildable (technology-failed) corridors took all MAX_RAIL_PATHFINDS tries of every year. */
const railKm = (s: SimState) => Object.values(s.edges).filter((e) => e.mode === "rail" && e.built >= 1 && e.state === "open").reduce((a, e) => a + e.lengthKm, 0);
const make = (seed: number, firstEra: number, o1800: boolean) => stage3Sim("heisei", seed, true, firstEra, 2, true, undefined, undefined, o1800 ? ({ start1800: true } as never) : undefined);
describe("Issue #66 A: rail-priority games keep building", () => {
  for (const seed of [7, 11]) it(`seed ${seed}: the railway starts early under 鉄道重視 and keeps growing 1860-1900 (before the fix: +0 to +15 km in 40 years)`, () => {
    const g = make(seed, 2, true); expect(g.sim.kaigen?.eras[0]?.stance).toBe("shoka"); g.sim.policy!.mode = "auto";
    advance(g.sim, g.w, 12 * (1830 - yearOf(g.sim))); const k30 = railKm(g.sim); advance(g.sim, g.w, 12 * (1860 - yearOf(g.sim))); const k60 = railKm(g.sim); advance(g.sim, g.w, 12 * (1900 - yearOf(g.sim))); const k00 = railKm(g.sim);
    expect(k30, `by 1830 (measured 626-730)`).toBeGreaterThan(400); expect(k00 - k60, `1860->1900: ${k60} -> ${k00} (measured +365 to +1028)`).toBeGreaterThan(200);
    const fails = Object.entries(g.sim.railFail ?? {}); expect(fails.length).toBeGreaterThan(0); for (const [, y] of fails) { expect(y).toBeGreaterThanOrEqual(1810); expect(y).toBeLessThanOrEqual(1900); }   // (the cooldown memory is used, and holds years)
    const back = JSON.parse(JSON.stringify(g.sim)) as SimState; expect(back.railFail).toEqual(g.sim.railFail); expect(RAIL_RETRY_YEARS).toBe(6);
  }, 900000);
  it("a balanced 1800 game keeps its railway (fixed seed 7: 1860 -> 1343 km, 1900 -> 2181 km; 1365 / 2275 before the ship upgrades of #66 B changed every ferry speed) and a 1950 game never uses the memory", () => {
    const g = make(7, 0, true); g.sim.policy!.mode = "auto"; advance(g.sim, g.w, 12 * (1860 - yearOf(g.sim))); expect(Math.round(railKm(g.sim))).toBe(1343); advance(g.sim, g.w, 12 * (1900 - yearOf(g.sim))); expect(Math.round(railKm(g.sim))).toBe(2181);
    const h = make(7, 0, false); h.sim.policy!.mode = "auto"; advance(h.sim, h.w, 12 * 30); expect(h.sim.railFail).toBeUndefined();
  }, 900000);
});
