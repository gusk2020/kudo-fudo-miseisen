import { describe, expect, it } from "vitest";
import { potentialWeights } from "../../src/sim/potential17";
import { roleScale } from "../../src/sim/roles";
import { SUB2_SHARE, shareMult, subPrefsOf, subShareOf } from "../../src/sim/subs36";
import { PREF_IDS } from "../../src/core/seat";
import { createSim } from "../../src/sim/engine";
import { realWorld } from "./simhelp";

describe("Stage 36 M3: two sub-capitals, 0.7x each of the sub-capital modifiers", () => {
  it("helpers: one or two sub-capitals; the share is 1 or 0.7; a multiplier keeps 1 + share x (m - 1)", () => {
    expect(subPrefsOf({ subCapital: "JP-27" })).toEqual(["JP-27"]); expect(subPrefsOf({ subCapital: "JP-27", subCapital2: "JP-40" })).toEqual(["JP-27", "JP-40"]);
    expect(subShareOf({})).toBe(1); expect(subShareOf({ subCapital2: "JP-40" })).toBe(SUB2_SHARE); expect(shareMult(2, 0.7)).toBeCloseTo(1.7, 12); expect(shareMult(1, 0.7)).toBe(1);
  });
  it("potential weights: each of the two gets 0.7x of the single sub-capital's uplift, nothing else changes (no compensation for the national total)", () => {
    const order = [...PREF_IDS], one = potentialWeights(order), two = potentialWeights(order, [order[1], order[2]]);
    const target = shareMult(one[order[1]], SUB2_SHARE); expect(two[order[1]]).toBeCloseTo(target, 12); expect(two[order[2]]).toBeCloseTo(target, 12);
    for (const p of order.slice(3)) expect(two[p], p).toBe(one[p]); expect(two[order[0]]).toBe(one[order[0]]);   // the capital and every other prefecture: untouched (no compensation for the national total)
  });
  it("roles: a second sub-capital gets 0.7x of the sub-capital role uplift; a game with one is unchanged", () => {
    const { w, hash } = realWorld(true, true), one = createSim(w, "m", hash, 7, { stage3: true, firstEra: 0, techK: 2, subCapital: "JP-40" }), two = createSim(w, "m", hash, 7, { stage3: true, firstEra: 0, techK: 2, subCapital: "JP-40", subCapital2: "JP-04" });
    expect(two.subCapital2).toBe("JP-04"); const s1 = roleScale(one, w, "JP-40"), s2 = roleScale(two, w, "JP-40");
    expect(s1).toBeGreaterThan(1); expect(s2).toBeCloseTo(shareMult(s1, SUB2_SHARE), 6); expect(roleScale(two, w, "JP-04")).toBeGreaterThan(1);
    expect(roleScale(two, w, "JP-13")).toBe(roleScale(one, w, "JP-13"));   // the capital's own role is untouched
  });
});

describe("Stage 36 M3: the sub-capital sites", () => {
  it("one sub-capital: one site at full strength; two: one site each at 0.7x; the capital's site is the same", async () => {
    const { sitesOf } = await import("../../src/sim/sites");
    const { w, hash } = realWorld(true, true), one = createSim(w, "m", hash, 7, { stage3: true, firstEra: 0, techK: 2, subCapital: "JP-40" }), two = createSim(w, "m", hash, 7, { stage3: true, firstEra: 0, techK: 2, subCapital: "JP-40", subCapital2: "JP-04" });
    const s1 = sitesOf(one, w).filter((s) => s.kind === "sub"), s2 = sitesOf(two, w).filter((s) => s.kind === "sub");
    expect(s1).toHaveLength(1); expect(s1[0].scale ?? 1).toBe(1); expect(s2).toHaveLength(2); expect(s2.map((s) => s.scale)).toEqual([SUB2_SHARE, SUB2_SHARE]); expect(new Set(s2.map((s) => s.pref))).toEqual(new Set(["JP-40", "JP-04"]));
    expect(JSON.stringify(sitesOf(two, w).filter((s) => s.kind === "capital"))).toBe(JSON.stringify(sitesOf(one, w).filter((s) => s.kind === "capital")));
  });
});

describe("Stage 36 M3: the count changes at a relocation event, and a save keeps it", () => {
  it("apply2200: to two (a third prefecture), back to one; a second sub-capital in the capital's prefecture is refused", async () => {
    const { apply2200, open2200 } = await import("../../src/sim/event2200");
    const { w, hash } = realWorld(true, true), sim = createSim(w, "m", hash, 7, { stage3: true, firstEra: 0, techK: 2, subCapital: "JP-27" });
    const go = (ch: Record<string, unknown>) => { sim.month = (2200 - sim.startYear) * 12; sim.e2200 = undefined as never; open2200(sim); apply2200(sim, { era: 0, stance: "heisei", coast: "neutral", focus: "concentrate", ...ch } as never); };
    go({ sub2: "JP-13" }); expect(sim.subCapital2).toBeUndefined();   // the capital's prefecture
    go({ sub2: "JP-40" }); expect(sim.subCapital2).toBe("JP-40"); expect(sim.e2200?.moved).toContain("sub2");
    go({ sub2: null }); expect(sim.subCapital2).toBeUndefined();
  });
  it("a save keeps the second sub-capital (and drops a broken one)", async () => {
    const { parseState } = await import("../../src/core/save"); const { realState } = await import("../../src/core/state");
    const ok = parseState(JSON.parse(JSON.stringify({ ...realState(), subCapital: "JP-27", subCapital2: "JP-40", subPos2: [1, 2] }))).state; expect(ok.subCapital2).toBe("JP-40"); expect(ok.subPos2).toEqual([1, 2]);
    expect(parseState(JSON.parse(JSON.stringify({ ...realState(), subCapital: "JP-27", subCapital2: "JP-27" }))).state.subCapital2).toBeUndefined();
  });
});
