import { describe, expect, it } from "vitest";
import { advance, yearOf } from "../../src/sim/engine";
import { checkIntegrity } from "../../src/sim/network";
import { POP_1800_FACTOR } from "../../src/sim/rules1800";
import type { SimState } from "../../src/sim/types";
import { stage3Sim } from "./simhelp";

const railKm = (sim: SimState) => Object.values(sim.edges).filter((e) => e.mode === "rail" && e.built >= 1).length;
const air = (sim: SimState) => (sim.hubs?.routes ?? []).filter((r) => r.mode === "air" && !r.intl && r.state === "open").length;
const hwy = (sim: SimState) => Object.values(sim.edges).filter((e) => e.mode !== "rail" && e.standard === "highgrade" && e.built >= 1).length;
describe("Stage 36 M2: an 1800 start", () => {
  it("starts in 1800 with no railway, scaled population; rail only from 1830, scheduled air only from 1920, expressways only from 1930", () => {
    const base = stage3Sim("heisei", 7, true, 0, 2, true), { sim, w } = stage3Sim("heisei", 7, true, 0, 2, true, undefined, undefined, { start1800: true });
    expect(sim.startYear).toBe(1800); expect(sim.rules1800).toBe(true); expect(railKm(sim)).toBe(0); expect(railKm(base.sim)).toBeGreaterThan(0);
    const tot = (s: SimState) => Object.values(s.cities).reduce((a, c) => a + c.pop, 0); expect(tot(sim) / tot(base.sim)).toBeLessThan(POP_1800_FACTOR * 1.2);
    sim.policy!.mode = "auto";
    advance(sim, w, 12 * 29); expect(yearOf(sim)).toBe(1829); expect(railKm(sim)).toBe(0); expect(air(sim)).toBe(0); expect(hwy(sim)).toBe(0);
    advance(sim, w, 12 * 90); expect(yearOf(sim)).toBe(1919); expect(air(sim)).toBe(0); expect(hwy(sim)).toBe(0);
    expect(railKm(sim)).toBeGreaterThan(0);   // the railway did come after 1830
    expect(checkIntegrity(sim)).toEqual([]);
  }, 900000);
});
