import { describe, expect, it } from "vitest";
import { advance, yearOf } from "../../src/sim/engine";
import { RAIL_RETRY_YEARS, railFailCooling, railFailKey } from "../../src/sim/planning";
import { techAt } from "../../src/sim/tech";
import type { World } from "../../src/sim/world";
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
    const fails = Object.entries(g.sim.railFail ?? {}); expect(fails.length).toBeGreaterThan(0); for (const [k, [y, km]] of fails) { expect(k).toMatch(/^[A-Za-z0-9._-]*:[A-Za-z0-9._-]*:\d*:\d*$/); expect(km).toBeGreaterThanOrEqual(0); expect(y).toBeGreaterThanOrEqual(1810); expect(y).toBeLessThanOrEqual(1900); }   // (the cooldown memory is used, and holds years)
    const back = JSON.parse(JSON.stringify(g.sim)) as SimState; expect(back.railFail).toEqual(g.sim.railFail); expect(RAIL_RETRY_YEARS).toBe(6);
  }, 900000);
  it("a balanced 1800 game keeps its railway (fixed seed 7: 1860 -> 1343 km, 1900 -> 2181 km; 1365 / 2275 before the ship upgrades of #66 B changed every ferry speed) and a 1950 game never uses the memory", () => {
    const g = make(7, 0, true); g.sim.policy!.mode = "auto"; advance(g.sim, g.w, 12 * (1860 - yearOf(g.sim))); expect(Math.round(railKm(g.sim))).toBe(1343); advance(g.sim, g.w, 12 * (1900 - yearOf(g.sim))); expect(Math.round(railKm(g.sim))).toBe(2181);
    const h = make(7, 0, false); h.sim.policy!.mode = "auto"; advance(h.sim, h.w, 12 * 30); expect(h.sim.railFail).toBeUndefined();
  }, 900000);
  it("the memory of failed lines is keyed by city ids (stable when the city list changes), cools for 6 years only while the technology stands, and a longer tunnel ends it at once", () => {
    const w1 = { cities: [{ id: "A" }, { id: "B" }, { id: "C" }] } as unknown as World, w2 = { cities: [{ id: "C" }, { id: "A" }, { id: "B" }] } as unknown as World;   // the same cities in another order (a city added or removed earlier in the list)
    expect(railFailKey(w1, { a: 0, b: 2 })).toBe(railFailKey(w2, { a: 1, b: 0 })); expect(railFailKey(w1, { a: 0, b: 1 })).not.toBe(railFailKey(w1, { a: 0, b: 2 }));
    const k = 2; let y0 = 1850; while (techAt(k, y0 + 1).tunnelKm <= techAt(k, y0).tunnelKm) y0++;   // a year whose next year can dig a longer tunnel
    const sim = { rules1800: true, tech: { k }, railFail: { [railFailKey(w1, { a: 0, b: 2 })]: [y0 - 3, techAt(k, y0 - 3).tunnelKm] } } as unknown as SimState, c = { a: 0, b: 2 };
    expect(railFailCooling(sim, w1, c, y0 - 3)).toBe(true);                                                       // the same year: cooling
    expect(railFailCooling(sim, w1, c, y0 - 3 + RAIL_RETRY_YEARS)).toBe(false);                                   // 6 years on: tried again
    const stored = (sim.railFail as Record<string, [number, number]>)[railFailKey(w1, c)]; expect(techAt(k, y0 + 1).tunnelKm).toBeGreaterThan(stored[1]); expect(railFailCooling(sim, w1, c, y0 + 1)).toBe(false);   // the technology moved: no waiting
    expect(railFailCooling({ ...sim, rules1800: undefined } as unknown as SimState, w1, c, y0 - 3)).toBe(false); expect(railFailCooling({ ...sim, railFail: undefined } as unknown as SimState, w1, c, y0 - 3)).toBe(false);   // a 1950 game / an old save: never cooling
  });
});
