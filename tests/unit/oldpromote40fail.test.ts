import { beforeAll, describe, expect, it } from "vitest";
import { advance, yearOf } from "../../src/sim/engine";
import { OLDCITY_MAX, syncOldCities } from "../../src/sim/oldcity40";
import { promoteOldCities, promotionCandidates } from "../../src/sim/oldpromote40";
import { pathfind } from "../../src/sim/world";
import type { SimState } from "../../src/sim/types";
import { stage3Sim } from "./simhelp";

/** Issue #67 (audit of PR #71, point 1-2): the failure paths of a promotion must really run, and leave NOTHING changed: the whole game (id counters, random state, events, network, people, definitions), the world's cities, and the future. */
const g = stage3Sim("heisei", 7, true, 0, 2, true, undefined, undefined, { start1800: true } as never), { sim, w } = g;
let S = "", Y = 0, chosen = "";
const sigOf = (s: SimState) => JSON.stringify([Object.keys(s.cities).sort(), Object.keys(s.cities).sort().map((k) => s.cities[k].pop), Object.keys(s.routes).length, Object.keys(s.projects).length, Object.keys(s.edges).length, s.rngState, s.next]);
beforeAll(() => {
  sim.policy!.mode = "auto"; advance(sim, w, 12 * (1960 - yearOf(sim)));
  Y = sim.startYear + Math.ceil((yearOf(sim) - sim.startYear + 1) / 10) * 10;   // the next step year
  // a certain candidate: a settlement with an old name is made big enough (a fixed, explicit set-up, not luck)
  for (const v of Object.values(sim.settlements)) { if (v.gone || !v.origin || v.post) continue; const pop = v.pop; v.pop = 60000; if (promotionCandidates(sim, w, Y).some((c) => c.id === "O-" + v.origin!.code)) { chosen = v.id; break; } v.pop = pop; }
  S = JSON.stringify(sim);
}, 900000);
const fresh = () => { const s = JSON.parse(S) as SimState; syncOldCities(s, w); s.policy!.mode = "auto"; return s; };
const cityIds = () => w.cities.map((c) => c.id).join(",");
describe("Issue #67: a promotion that fails changes nothing", () => {
  it("the set-up really has a candidate (the failure paths below are not skipped)", () => { expect(chosen).not.toBe(""); const s = fresh(); expect(promotionCandidates(s, w, Y).length).toBeGreaterThan(0); });
  it("the same state promotes when nothing is wrong (so the failures below are real failures)", () => { const s = fresh(), n0 = s.oldCities40?.length ?? 0, nGone = Object.values(s.settlements).filter((v) => v.gone).length; const n = promoteOldCities(s, w, Y); expect(n).toBeGreaterThan(0); expect(s.oldCities40!.length).toBe(n0 + n); expect(Object.values(s.settlements).filter((v) => v.gone).length).toBe(nGone + n); syncOldCities(fresh(), w); });
  const cases: [string, (s: SimState) => number][] = [
    ["no road can be found", (s) => promoteOldCities(s, w, Y, () => null)],
    ["a degenerate road that lays nothing", (s) => promoteOldCities(s, w, Y, (ww, a, b, o) => { const p = pathfind(ww, a, b, o); return p ? [p[0], p[0]] : p; })],
    ["a road found, but a second try from the same cell each time (every road empty)", (s) => promoteOldCities(s, w, Y, (ww, a) => [a, a])],
  ];
  for (const [label, run] of cases) it(`${label}: the whole game, the world and the future are unchanged`, () => {
    const s = fresh(), before = JSON.stringify(s), ids = cityIds(), nDefs = s.oldCities40?.length ?? 0; const n = run(s);
    expect(n, "nothing was promoted").toBe(0); expect(JSON.stringify(s), "the whole game is byte-identical (counters, rng, events, network, people)").toBe(before); expect(cityIds(), "the world's cities are as they were").toBe(ids); expect(s.oldCities40?.length ?? 0).toBe(nDefs);
    const ref = fresh(); advance(s, w, 12 * 5); const after = sigOf(s); syncOldCities(ref, w); advance(ref, w, 12 * 5); expect(after, "the future is the same as a game that never tried").toBe(sigOf(ref));
  }, 600000);
  it("the cap: a game at the limit promotes nothing and is unchanged", () => { const s = fresh(); s.oldCities40 = Array.from({ length: OLDCITY_MAX }, (_, i) => ({ id: "O-9" + String(i).padStart(4, "0"), code: "9" + i, name: "x", pref: "JP-01", cell: 0, year: 1900, pop0: 1 })); const before = JSON.stringify(s); expect(promoteOldCities(s, w, Y)).toBe(0); expect(JSON.stringify(s)).toBe(before); });
  it("a taken id or cell excludes the candidate before anything is touched", () => { const s = fresh(), code = s.settlements[chosen].origin!.code, cell = s.settlements[chosen].cell; expect(promotionCandidates(s, w, Y).some((c) => c.id === "O-" + code)).toBe(true); s.oldCities40 = [{ id: "O-" + code, code, name: "x", pref: "JP-01", cell: 0, year: 1900, pop0: 1 }]; expect(promotionCandidates(s, w, Y).some((c) => c.id === "O-" + code), "id taken").toBe(false); s.oldCities40 = [{ id: "O-99999", code: "99999", name: "y", pref: "JP-01", cell, year: 1900, pop0: 1 }]; syncOldCities(s, w); expect(promotionCandidates(s, w, Y).some((c) => c.id === "O-" + code), "cell taken").toBe(false); syncOldCities(fresh(), w); });
});
