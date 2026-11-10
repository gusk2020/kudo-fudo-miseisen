import { describe, expect, it } from "vitest";
import { cycleOf, since1800 } from "../../src/sim/cycle27";
import { econPhase } from "../../src/sim/rules1800";

const at = (year: number, rules1800 = true) => cycleOf({ startYear: 1800, month: (year - 1800) * 12, e2200: undefined, ...(rules1800 ? { rules1800: true as const } : {}) });
describe("Stage 36 M5: the 100-year cycle of an 1800 game", () => {
  it("each century: 50 years 好況, 30 停滞, 20 不況 -- the same phases as rules1800.econPhase, reset at every century", () => {
    const map = { rebuild: "boom", balance: "stagnation", decline: "recession" } as const;
    for (let y = 1800; y < 2100; y += 1) expect(map[at(y + 0.5)!.phase], String(y)).toBe(econPhase(y));
    expect(since1800(1849.9)).toBeLessThan(50); expect(since1800(1850)).toBe(50); expect(since1800(1880)).toBe(100); expect(since1800(1900)).toBe(0);
  });
  it("the purse climbs in the boom and falls through the recession, and is the same in every century", () => {
    const b = (y: number) => at(y)!.budget;
    expect(b(1825)).toBeGreaterThan(b(1865)); expect(b(1865)).toBeGreaterThan(b(1895)); expect(b(1925)).toBeCloseTo(b(1825), 9); expect(b(2095)).toBeCloseTo(b(1895), 9);
  });
  it("a game without the 1800 rules keeps the old rule: no cycle before its first relocation", () => { expect(at(1950, false)).toBeNull(); });
});
