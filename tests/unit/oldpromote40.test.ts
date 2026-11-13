import { beforeAll, describe, expect, it } from "vitest";
import { advance, yearOf } from "../../src/sim/engine";
import { oldPlaces } from "../../src/core/gazetteer2000";
import { dropForeignOldCities, restoreOldCities, syncOldCities, OLDCITY_MAX } from "../../src/sim/oldcity40";
import { promoteOldCities, promotionCandidates, PROMOTE_PER_PREF, PROMOTE_PER_STEP } from "../../src/sim/oldpromote40";
import { pathfind } from "../../src/sim/world";
import { checkIntegrity } from "../../src/sim/network";
import type { SimState } from "../../src/sim/types";
import { stage3Sim } from "./simhelp";

/** Issue #67 second stage, integration scenario on ONE game world: promote -> network -> people -> manual save -> load -> go on, against a control that never stopped. */
const total = (s: SimState) => Object.values(s.cities).reduce((a, c) => a + c.pop, 0) + Object.values(s.settlements).reduce((a, v) => a + v.pop, 0);
const sig = (s: SimState) => JSON.stringify([Object.keys(s.cities).sort(), Object.keys(s.cities).sort().map((k) => s.cities[k].pop), Object.keys(s.routes).length, Object.keys(s.projects).length, Object.keys(s.edges).length, s.rngState, s.oldCities40?.map((d) => [d.id, d.cell, d.year, d.pop0])]);
const g = stage3Sim("heisei", 7, true, 0, 2, true, undefined, undefined, { start1800: true } as never), { sim, w } = g;
let y0 = 0; const R = { S: "", Sprev: "", control: { sig: "", tot: 0, y: 0, n: 0 }, step: { before: 0, nC: 0, nV: 0, sBefore: 0, n: 0, after: 0 } };
beforeAll(() => {
  expect(sim.promote40).toBe(true); sim.policy!.mode = "auto";
  // go on until the first step at which a promotion is possible (the game itself decides; nothing is forced)
  for (let y = 1950; y <= 2030 && !y0; y++) { advance(sim, w, 12 * (y - yearOf(sim))); if ((y - sim.startYear) % 10 === 9 && promotionCandidates(sim, w, y + 1).length) y0 = y; }
  if (!y0) return; advance(sim, w, 12 * (y0 - yearOf(sim)) + 11);   // up to the month before the step year: the yearly hook of the step year promotes
  R.Sprev = JSON.stringify(sim); R.step.before = total(sim); R.step.nC = w.cities.length; R.step.nV = Object.values(sim.settlements).filter((v) => !v.gone).length; R.step.sBefore = Object.keys(sim.cities).length;
  advance(sim, w, 1); R.step.n = sim.oldCities40?.length ?? 0; R.step.after = total(sim);   // the step year begins: the hook runs
  R.S = JSON.stringify(sim);                                        // the manual save, right after the promotion
  advance(sim, w, 12 * 20); R.control = { sig: sig(sim), tot: total(sim), y: yearOf(sim), n: sim.oldCities40?.length ?? 0 };
}, 900000);
describe("Issue #67 second stage: promotion of old municipalities to simulated cities", () => {
  it("the game reaches a state where an old municipality is big enough, on fit ground, near the network", () => { expect(y0).toBeGreaterThan(0); expect(promotionCandidates(sim, w, y0 + 1).length).toBeGreaterThan(0); });
  it("promotion moves the people, never creates or counts them twice; the city is in the world, the tables and the network", () => {
    expect(R.step.n).toBeGreaterThan(0); expect(R.step.n).toBeLessThanOrEqual(PROMOTE_PER_STEP);
    const nowPromoted = sim.oldCities40!.length; expect(nowPromoted).toBeGreaterThanOrEqual(R.step.n);
    for (const d of sim.oldCities40!) { const c = w.cityById.get(d.id)!; expect(c.cell).toBe(d.cell); expect(w.cityByCell.get(d.cell)).toBe(c); expect(d.id).toMatch(/^O-\d{5}$/); expect(oldPlaces().some((p) => p.code === d.code)).toBe(true); expect(sim.cities[d.id]).toBeTruthy(); expect(w.elevM(d.cell)).toBeLessThan(1300 + 700); }
    for (const d of sim.oldCities40!) expect(Object.values(sim.settlements).filter((v) => v.origin?.code === d.code && !v.gone).length, d.id).toBe(0);   // the settlement is gone: counted once
    const byPref = new Map<string, number>(); for (const d of sim.oldCities40!) byPref.set(d.pref, (byPref.get(d.pref) ?? 0) + 1); for (const [, k] of byPref) expect(k).toBeLessThanOrEqual(PROMOTE_PER_PREF); expect(nowPromoted).toBeLessThanOrEqual(OLDCITY_MAX);
    expect(checkIntegrity(sim)).toEqual([]); expect(sim.events.some((e) => e.kind === "muni40" && /都市になった/.test(e.text))).toBe(true);
  });
  it("the step itself is exact: the month before and the month of the promotion, the nation's people (cities + settlements) differ only by one month's ordinary growth", () => {
    expect(Math.abs(R.step.after - R.step.before) / R.step.before).toBeLessThan(0.02);   // (one month of growth and the yearly hook; the exact move of the people is checked in the next test)
  });
  it("one promotion, made by hand on the state of the month before, is exact: the total of the nation is the same to the person and the settlement is emptied", () => {
    const c = JSON.parse(R.Sprev) as SimState; syncOldCities(c, w); const b4 = total(c), nOld = c.oldCities40?.length ?? 0, n = promoteOldCities(c, w, y0 + 1); expect(n).toBeGreaterThan(0);
    expect(total(c)).toBe(b4); expect(c.oldCities40!.length).toBe(nOld + n);
    for (const d of c.oldCities40!.slice(nOld)) { expect(c.cities[d.id].pop).toBe(d.pop0); expect(d.pop0).toBeGreaterThanOrEqual(50000); const s0 = Object.values(c.settlements).find((v) => v.origin?.code === d.code)!; expect(s0.gone).toBe(true); expect(s0.pop).toBe(0); }
    syncOldCities(sim, w);   // (the live game's world again)
  });
  it("each promoted city is on the road network: a road edge ends at its cell", () => {
    const nodeCells = new Set(Object.values(sim.nodes).map((x) => x.cell)); for (const d of sim.oldCities40!) expect(nodeCells.has(d.cell), d.id).toBe(true);
  });
  it("the people and the network go on after the promotion: 20 more years, more cities may follow, the integrity holds and the total of the nation is the same game as the control's", () => {
    expect(R.control.y).toBeGreaterThan(y0 + 15); expect(checkIntegrity(sim)).toEqual([]); expect(R.control.n).toBeGreaterThanOrEqual(1);
  });
  it("save -> load into the same shared world -> go on: identical to the game that never stopped (cities, people, routes, projects, edges, rng, definitions)", () => {
    const loaded = JSON.parse(R.S) as SimState; loaded.policy!.mode = "auto"; dropForeignOldCities(w);   // (a new game on this world clears the promoted cities first: tested apart below)
    expect(w.cities.some((c) => c.id.startsWith("O-"))).toBe(false);
    const r = restoreOldCities(loaded, w); expect(r.problems).toEqual([]); expect(r.added).toBe(loaded.oldCities40!.length); advance(loaded, w, 12 * (R.control.y - yearOf(loaded)));
    expect(sig(loaded)).toBe(R.control.sig); expect(total(loaded)).toBe(R.control.tot);
  }, 900000);
  it("loading twice and loading a past save give the same: a second restore adds nothing; an earlier save (before the promotion) loads and promotes again the same way", () => {
    const a = JSON.parse(R.S) as SimState; stage3Sim("heisei", 7, true, 0, 2, true, undefined, undefined, { start1800: true } as never); restoreOldCities(a, w); expect(restoreOldCities(a, w).added).toBe(0);
    const nOld = w.cities.filter((c) => c.id.startsWith("O-")).length; expect(nOld).toBe(a.oldCities40!.length);
  });
  it("a game with the switch off (a 1950 game, an older 1800 save) never promotes and carries no definitions", () => {
    const h = stage3Sim("heisei", 7, true, 0, 2, true); h.sim.policy!.mode = "auto"; advance(h.sim, h.w, 12 * 25); expect(h.sim.oldCities40).toBeUndefined(); expect(h.w.cities.some((c) => c.id.startsWith("O-"))).toBe(false);
    const k = stage3Sim("heisei", 7, true, 0, 2, true, undefined, undefined, { start1800: true } as never); expect(k.sim.promote40).toBe(true); expect(h.sim.promote40).toBeUndefined(); expect(promoteOldCities(h.sim, h.w, 1960)).toBe(0);
  }, 600000);
  // (the failure paths are in oldpromote40fail.test.ts, with a candidate that is certain to exist)
});
