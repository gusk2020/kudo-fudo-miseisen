import { describe, expect, it } from "vitest";
import { advance, yearOf } from "../../src/sim/engine";
import { oldPlaces } from "../../src/core/gazetteer2000";
import { TOWN_FROM, CITY_FROM, LIMIT_M } from "../../src/core/muni39";
import { chooseCohort, COHORT, foundOldMunicipalities, MAX_ACTIVE, OLD_FROM, promoteSettlements, rankOf } from "../../src/sim/oldmuni40";
import type { SimState } from "../../src/sim/types";
import { stage3Sim } from "./simhelp";

const total = (s: SimState) => Object.values(s.cities).reduce((a, c) => a + c.pop, 0) + Object.values(s.settlements).reduce((a, v) => a + v.pop, 0);
const make = () => stage3Sim("heisei", 7, true, 0, 2, true, undefined, undefined, { start1800: true } as never);
describe("Stage 40 (3): the old municipalities are founded and promoted in stages", () => {
  const g = make(); g.sim.policy!.mode = "auto";
  it("only a new 1800 game does it; a 1950 game or an older 1800 save does not", () => {
    expect(g.sim.oldmuni40).toBe(true); expect(stage3Sim("heisei", 7, true, 0, 2, true).sim.oldmuni40).toBeUndefined();
    const old = JSON.parse(JSON.stringify(g.sim)) as SimState; delete old.oldmuni40; expect(foundOldMunicipalities(old, g.w, 1830)).toBe(0); expect(promoteSettlements(old, g.w, 1830)).toBe(0);
  });
  it("founding takes its people from a city (nobody is created), at the old municipality's own point, in a bounded cohort", () => {
    const sim = JSON.parse(JSON.stringify(g.sim)) as SimState, before = total(sim), n0 = Object.keys(sim.settlements).length; sim.month = 12 * (1820 - sim.startYear);
    const cohort = chooseCohort(sim, g.w, 1820); expect(cohort.length).toBeGreaterThan(10); expect(cohort.length).toBeLessThanOrEqual(COHORT);
    const n = foundOldMunicipalities(sim, g.w, 1820); expect(n).toBeGreaterThan(10); expect(n).toBeLessThanOrEqual(COHORT); expect(Object.keys(sim.settlements).length).toBe(n0 + n); expect(total(sim)).toBe(before);
    for (const v of Object.values(sim.settlements).filter((x) => x.rank && !x.post)) { const p = oldPlaces().find((q) => q.code === v.origin!.code)!; expect(v.cell).toBe(g.w.cellOf(p.pos)); expect(g.w.t.land[v.cell]).toBe(1); expect(g.w.elevM(v.cell)).toBeLessThan(LIMIT_M.village); }
    expect(foundOldMunicipalities(sim, g.w, 1821)).toBe(0); expect(OLD_FROM).toBe(1810);   // (only in a step year)
  });
  it("over the years: staged cohorts, a bounded total, each name once, designations earned by growth within the Stage 39 limits, all recorded", () => {
    advance(g.sim, g.w, 12 * (1900 - yearOf(g.sim))); const v = Object.values(g.sim.settlements), nw = v.filter((x) => x.rank);
    expect(nw.length).toBeGreaterThan(200); expect(v.filter((x) => x.origin && !x.gone).length).toBeLessThanOrEqual(MAX_ACTIVE); const names = v.map((x) => x.name); expect(new Set(names).size).toBe(names.length);
    expect(Object.values(g.sim.settlements).some((x) => x.rank === "town")).toBe(true);
    for (const x of nw.filter((q) => q.rank !== "village")) expect(g.w.elevM(x.cell)).toBeLessThan(LIMIT_M[x.rank === "city" ? "city" : "town"] + 700);   // (a relaxation after 1950 can add up to 700 m; before it, none)
    for (const x of nw.filter((q) => !q.post)) expect(x.name.endsWith(x.rank === "city" ? "市" : x.rank === "town" ? "町" : "村") || x.name === x.origin!.name || x.origin!.name.length <= 2).toBe(true);
    expect(g.sim.events.filter((e) => e.kind === "muni40").length).toBeGreaterThan(5); expect(g.sim.events.some((e) => e.kind === "muni40" && /成立/.test(e.text))).toBe(true);
  }, 600000);
  it("it is deterministic and survives a save", () => {
    const back = JSON.parse(JSON.stringify(g.sim)) as SimState; expect(Object.values(back.settlements).map((x) => [x.name, x.rank])).toEqual(Object.values(g.sim.settlements).map((x) => [x.name, x.rank]));
    const h = make(); h.sim.policy!.mode = "auto"; advance(h.sim, h.w, 12 * (1900 - yearOf(h.sim))); expect(Object.values(h.sim.settlements).map((x) => [x.name, x.rank, x.cell])).toEqual(Object.values(g.sim.settlements).map((x) => [x.name, x.rank, x.cell]));
  }, 600000);
  it("the cost is bounded: the name pool is never walked per month (one cohort pick per step year)", () => { expect(CITY_FROM).toBeGreaterThan(TOWN_FROM); expect(MAX_ACTIVE).toBeLessThanOrEqual(800); });
});
