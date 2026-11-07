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
  it("potential weights: each of the two gets 0.7x of the single sub-capital's uplift, the capital and the palace are not scaled down, the mean stays 1", () => {
    const order = [...PREF_IDS], one = potentialWeights(order), two = potentialWeights(order, [order[1], order[2]]);
    const target = shareMult(one[order[1]], SUB2_SHARE); expect(two[order[1]]).toBeCloseTo(target, 12); expect(two[order[2]]).toBeCloseTo(target, 12);
    expect(Object.values(two).reduce((a, b) => a + b, 0) / order.length).toBeCloseTo(1, 12);
    expect(two[order[0]] / one[order[0]]).toBeGreaterThan(0.9);   // the capital: only the common renormalisation, no 0.7
  });
  it("roles: a second sub-capital gets 0.7x of the sub-capital role uplift; a game with one is unchanged", () => {
    const { w, hash } = realWorld(true, true), one = createSim(w, "m", hash, 7, { stage3: true, firstEra: 0, techK: 2, subCapital: "JP-40" }), two = createSim(w, "m", hash, 7, { stage3: true, firstEra: 0, techK: 2, subCapital: "JP-40", subCapital2: "JP-04" });
    expect(two.subCapital2).toBe("JP-04"); const s1 = roleScale(one, w, "JP-40"), s2 = roleScale(two, w, "JP-40");
    expect(s1).toBeGreaterThan(1); expect(s2).toBeCloseTo(shareMult(s1, SUB2_SHARE), 6); expect(roleScale(two, w, "JP-04")).toBeGreaterThan(1);
    expect(roleScale(two, w, "JP-13")).toBe(roleScale(one, w, "JP-13"));   // the capital's own role is untouched
  });
});
