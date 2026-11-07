import { describe, expect, it } from "vitest";
import { advance, yearOf } from "../../src/sim/engine";
import { nextYear2200 } from "../../src/sim/event2200";
import { stage3Sim } from "./simhelp";

describe("Stage 36 M4: an 1800 game -- ordinary era changes every 20-40 years, relocation every 100 years from 1800", () => {
  it("eras from 1800, gaps of 20-40 years, never a repeated name; the relocation opens in 1900 (遷都のみ手動) and stops the clock", () => {
    const { sim, w } = stage3Sim("heisei", 7, true, 0, 2, true, undefined, undefined, { start1800: true });
    const k = sim.kaigen!; expect(k.free).toBe(true); expect(k.eras[0].start).toBe(1800); expect(k.next).toBeGreaterThanOrEqual(1820); expect(k.next).toBeLessThanOrEqual(1840);
    expect(sim.relocFirst).toBe(1900); expect(nextYear2200(sim)).toBe(1900);
    sim.policy!.mode = "autoReloc"; advance(sim, w, 12 * 99 + 11); expect(yearOf(sim)).toBe(1899); expect(sim.e2200).toBeUndefined();
    const starts = k.eras.map((e) => e.start); expect(starts.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < starts.length; i++) { const g = starts[i] - starts[i - 1]; expect(g, `gap ${i}`).toBeGreaterThanOrEqual(20); expect(g, `gap ${i}`).toBeLessThanOrEqual(40); }
    expect(starts.some((y) => y === 1989 || y === 2019)).toBe(false); expect(new Set(k.eras.map((e) => e.name)).size).toBe(k.eras.length);
    advance(sim, w, 3); expect(sim.e2200?.state).toBe("pending"); expect(sim.e2200?.sched).toBe(1900); const m = sim.month; advance(sim, w, 6); expect(sim.month).toBe(m);
  }, 900000);
});

describe("Stage 36 M4: a relocation always renames the era in an 1800 game", () => {
  it("常に自動: the seats stay, the era changes at 1900 and 2000 (historical candidates), and the ordinary schedule goes on", () => {
    const { sim, w } = stage3Sim("heisei", 7, true, 0, 2, true, undefined, undefined, { start1800: true });
    sim.policy!.mode = "auto"; const cap = sim.capital, sub = sim.subCapital; advance(sim, w, 12 * 201);
    const k = sim.kaigen!, at = (y: number) => k.eras.filter((e) => e.start === y);
    expect(sim.relocSkipped).toEqual([1900, 2000]); expect(at(1900)).toHaveLength(1); expect(at(2000)).toHaveLength(1); expect(k.reloc?.[0]?.chosen).toBe(at(1900)[0].name);
    expect(sim.capital).toBe(cap); expect(sim.subCapital).toBe(sub); expect(new Set(k.eras.map((e) => e.name)).size).toBe(k.eras.length);
  }, 900000);
});
