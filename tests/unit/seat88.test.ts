import { describe, expect, it } from "vitest";
import { stepMonth } from "../../src/sim/engine";
import { apply2200 } from "../../src/sim/event2200";
import { applySeatMoves } from "../../src/sim/seatmove20";
import { sanitizeSim } from "../../src/core/save2";
import type { Vec } from "../../src/core/types";
import { run14 } from "../study/lib14";

/** Issue #88 (field report): at a relocation, sub-capital and palace were put at two different map points of 札幌県 and both ended up at the point given last. */
const toEve = () => { const r = run14({ seed: 5, until: 1952, islets: true }); const sim = r.sim; sim.relocFirst = 2200; sim.month = (2200 - sim.startYear) * 12; sim.policy!.mode = "priority"; sim.kaigen!.next = 2230; sim.kaigen!.pending = null; return { ...r, sim }; };
describe("Issue #88: two seats in one prefecture at a relocation keep their own points", () => {
  it("sub-capital and palace in 札幌県 at two points: both points are kept, the first seat keeps the 県庁所在地, the second is an extra point; saved and loaded unchanged", () => {
    const { sim, w } = toEve(); stepMonth(sim, w); expect(sim.e2200?.state).toBe("pending");
    const sap = w.cities.find((c) => c.name === "札幌市")!.pos, A: Vec = [sap[0] + 60, sap[1] + 40], B: Vec = [sap[0] - 30, sap[1] - 45];
    expect(apply2200(sim, { era: 0, stance: "heisei", coast: "neutral", focus: "disperse", sub: "HK-SAP", subPos: A, palace: "HK-SAP", palacePos: B })).toBe(true);
    expect(sim.subCapital).toBe("HK-SAP"); expect(sim.subPos).toEqual(A); expect(sim.palace).toEqual({ pref: "HK-SAP", pos: B });
    const mv = (sim.moves20 ?? []).filter((m) => m.pref === "HK-SAP" && m.since === 2200); expect(mv.length, "both moves are recorded: the second no longer replaces the first").toBe(2);
    expect(mv.find((m) => m.by === "sub")!.extra).toBeUndefined(); expect(mv.find((m) => m.by === "palace")!.extra).toBe(true); expect(mv.find((m) => m.by === "sub")!.pos).toEqual(A); expect(mv.find((m) => m.by === "palace")!.pos).toEqual(B);
    void applySeatMoves;
    const back = sanitizeSim(JSON.parse(JSON.stringify(sim))).sim!; expect(back.subPos).toEqual(A); expect(back.palace!.pos).toEqual(B); expect(back.moves20!.filter((m) => m.pref === "HK-SAP" && m.since === 2200).length).toBe(2);
  }, 900000);
  it("a seat decided again in the same year replaces only ITS OWN earlier move, and different prefectures are untouched", () => {
    const { sim, w } = toEve(); stepMonth(sim, w); const sap = w.cities.find((c) => c.name === "札幌市")!.pos, A: Vec = [sap[0] + 60, sap[1] + 40];
    apply2200(sim, { era: 0, stance: "heisei", coast: "neutral", focus: "disperse", sub: "HK-SAP", subPos: A, palace: "JP-26" });
    const mv = (sim.moves20 ?? []).filter((m) => m.since === 2200); expect(mv.length).toBe(1); expect(mv[0].by).toBe("sub"); expect(mv[0].extra).toBeUndefined(); expect(sim.palace!.pref).toBe("JP-26");
  }, 900000);
});
