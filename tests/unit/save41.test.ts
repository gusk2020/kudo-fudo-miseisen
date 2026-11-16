import { describe, expect, it } from "vitest";
import { homeCity, performRoad0, previewNational, subCity } from "../../src/sim/ceremony";
import { checkIntegrity } from "../../src/sim/network";
import { sanitizeSim } from "../../src/core/save2";
import type { Vec } from "../../src/core/types";
import { stage3Sim } from "./simhelp";

/**
 * Stage 41 / field report A: "route number duplicated: national:JP:0" when loading a manual slot saved by the current version.
 * Cause: every relocation makes a 国道0号 and a LATER one is a route of its own told by its year (`gen`, ceremony.ts, Stage 25), so two 国道0号 are by design; the integrity check keyed routes by grade:scope:number alone and refused the save.
 * Since 1800-start games relocate every 100 years (1900, 2000, ...), a second 国道0号 now comes after 100 years of play, not after 2200.
 */
const line = (a: Vec, b: Vec, n = 20): Vec[] => Array.from({ length: n + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n] as Vec);
function twoRoad0() {
  const g = stage3Sim("heisei", 7, true, 0, 2, true, undefined, undefined, { start1800: true } as never), { sim, w } = g, a = homeCity(w, sim.capital)!, b = subCity(w, sim.subCapital)!;
  const mk = (year: number) => { sim.month = (year - sim.startYear) * 12; const p = previewNational(w, line(a.pos, b.pos), sim.capital, sim.subCapital, { year }); const r = performRoad0(sim, w, p); if (!r) throw new Error("road0 not laid: " + p.reasons.join()); return r; };
  const first = mk(1900), second = mk(2000); return { g, sim, first, second };
}
describe("Stage 41 A: two 国道0号 (one per relocation) are a valid game and survive a save", () => {
  it("the second 国道0号 is a route of its own (told by its year) and the integrity check accepts it", () => {
    const { sim, first, second } = twoRoad0(); const r0 = Object.values(sim.routes).filter((r) => r.grade === "national" && r.scope === "JP" && r.number === 0);
    expect(r0.length).toBe(2); expect(r0.map((r) => r.gen)).toEqual([undefined, 2000]); expect(first.routeId).not.toBe(second.routeId);
    expect(checkIntegrity(sim), "a game with two 国道0号 has no integrity problem").toEqual([]);
  }, 600000);
  it("a save of that game loads (the field report: it was refused with 'route number duplicated: national:JP:0')", () => {
    const { sim } = twoRoad0(); const back = sanitizeSim(JSON.parse(JSON.stringify(sim)));
    expect(back.problems).toEqual([]); expect(back.sim, "loaded").not.toBeNull(); expect(Object.values(back.sim!.routes).filter((r) => r.number === 0 && r.scope === "JP").length).toBe(2);
  }, 600000);
  it("a REAL duplicate is still refused: two routes with the same grade, scope, number and year", () => {
    const { sim } = twoRoad0(); const r0 = Object.values(sim.routes).filter((r) => r.number === 0 && r.scope === "JP"); r0[1].gen = r0[0].gen;   // (a second one without a year of its own)
    expect(checkIntegrity(sim).some((m) => m.includes("route number duplicated"))).toBe(true);
  }, 600000);
  it("a save made before the check knew it (the later 国道0号 without its year) is repaired in memory: the later one gets its year from its own history, nothing is deleted, the stored text is untouched", () => {
    const { sim } = twoRoad0(); const raw = JSON.parse(JSON.stringify(sim)), before = JSON.stringify(raw); const later = Object.values(raw.routes as Record<string, any>).find((r: any) => r.number === 0 && r.scope === "JP" && r.gen)!; const id = (later as any).id; delete (later as any).gen; (later as any).name = "国道0号";
    const text = JSON.stringify(raw), back = sanitizeSim(JSON.parse(text)); expect(back.sim, "loaded").not.toBeNull(); expect(back.problems.join()).toContain("作成年を付けて");
    const r2 = back.sim!.routes[id]; expect(r2.gen).toBe(2000); expect(r2.name).toBe("国道0号(2000年)"); expect(Object.values(back.sim!.routes).length).toBe(Object.values(sim.routes).length); expect(text, "the stored text is not touched").toBe(JSON.stringify(raw)); expect(before).not.toBe(text);
    expect(checkIntegrity(back.sim!)).toEqual([]);
  }, 600000);
});
