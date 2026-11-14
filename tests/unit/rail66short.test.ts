import { describe, expect, it } from "vitest";
import { advance, yearOf } from "../../src/sim/engine";
import { RAIL_RETRY_YEARS, railNetVersion, railShortWaiting } from "../../src/sim/planning";
import type { World } from "../../src/sim/world";
import type { SimState } from "../../src/sim/types";
import { stage3Sim } from "./simhelp";

/** Issue #66 (priority 3): a new rail line whose path search finds under 15 km of new track is not searched again until the rail network changes or the wait (RAIL_RETRY_YEARS) is over. Before it, a 鉄道重視 1800 game spent every one of its
 *  five yearly path searches on such outcomes and on technology failures, and its railway stood still 1925-1950 (seed 7: +106 km; with the memory +1104 km; over 11 seeds the stalls went 4 -> 0, see docs/ISSUE66.md). */
const railKm = (s: SimState) => Object.values(s.edges).filter((e) => e.mode === "rail" && e.built >= 1 && e.state === "open").reduce((a, e) => a + e.lengthKm, 0);
const W = { cities: [{ id: "A" }, { id: "B" }] } as unknown as World, C = { a: 0, b: 1 };
const S = (o: Partial<SimState>) => ({ rules1800: true, ...o }) as unknown as SimState;
describe("Issue #66: the memory of 'short' rail searches", () => {
  it("waits only while the rail network is the same and fewer than RAIL_RETRY_YEARS have passed; never in a 1950 game; an absent memory waits for nothing", () => {
    const s = S({ railShort: { "A:B::": [1925, 7000123] } });
    expect(railShortWaiting(s, W, C, 1925, 7000123), "same year, same network").toBe(true); expect(railShortWaiting(s, W, C, 1925 + RAIL_RETRY_YEARS - 1, 7000123), "last year of the wait").toBe(true);
    expect(railShortWaiting(s, W, C, 1925 + RAIL_RETRY_YEARS, 7000123), "the wait is over").toBe(false); expect(railShortWaiting(s, W, C, 1926, 7000124), "the network changed: search again at once").toBe(false);
    expect(railShortWaiting(S({}), W, C, 1925, 7000123), "no memory").toBe(false); expect(railShortWaiting({ ...s, rules1800: undefined } as SimState, W, C, 1925, 7000123), "a 1950 start never waits").toBe(false);
    expect(railShortWaiting(s, W, { a: 1, b: 0 }, 1925, 7000123), "another pair is not held back").toBe(false);
  });
  it("the network version changes when rail is added, and ignores roads and ferries", () => {
    const e = (o: object) => ({ cells: [1, 2, 3], ...o }), a = S({ edges: { r1: e({ mode: "rail" }), x: e({}), f: e({ mode: "rail", facility: "ferry" }) } as never }), b = S({ edges: { r1: e({ mode: "rail" }), r2: e({ mode: "rail" }), x: e({}) } as never });
    expect(railNetVersion(a)).toBe(1e6 + 3); expect(railNetVersion(b)).toBe(2e6 + 6);
  });
  it("fixed seed 7, 鉄道重視 1800 game: the railway keeps growing 1925 -> 1950 (+106 km before the memory), the memory is saved and restored, entries stay bounded, and a 1950 game never creates it", () => {
    const g = stage3Sim("heisei", 7, true, 2, 2, true, undefined, undefined, { start1800: true } as never); g.sim.policy!.mode = "auto";
    advance(g.sim, g.w, 12 * (1925 - yearOf(g.sim))); const k25 = railKm(g.sim); advance(g.sim, g.w, 12 * (1950 - yearOf(g.sim))); const k50 = railKm(g.sim);
    expect(k50 - k25, `1925 ${Math.round(k25)} -> 1950 ${Math.round(k50)} km (measured +1104; +106 before)`).toBeGreaterThan(500);
    const mem = g.sim.railShort ?? {}; expect(Object.keys(mem).length, "entries older than the wait are dropped").toBeLessThan(400); for (const [k, [y, v]] of Object.entries(mem)) { expect(k).toMatch(/^[A-Za-z0-9._-]*:[A-Za-z0-9._-]*:\d*:\d*$/); expect(1950 - y).toBeLessThanOrEqual(RAIL_RETRY_YEARS); expect(v).toBeGreaterThan(0); }
    expect(JSON.parse(JSON.stringify(g.sim)).railShort).toEqual(g.sim.railShort);
    const h = stage3Sim("heisei", 7, true, 0, 2, true); h.sim.policy!.mode = "auto"; advance(h.sim, h.w, 12 * 30); expect(h.sim.railShort).toBeUndefined();
  }, 900000);
});
