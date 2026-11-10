import { describe, expect, it } from "vitest";
import { generateTerrain } from "../../src/core/terrain";
import { defaultState } from "../../src/core/state";
import { advance, createSim, yearOf } from "../../src/sim/engine";
import { buildWorld, townsForSeats } from "../../src/sim/world";
import { mayStand, reclaimedCell } from "../../src/sim/muni39sim";
import { highGroundCap } from "../../src/sim/devseat37";
import { eligible, exceptionAllowanceM, CITY_FROM, TOWN_FROM, LIMIT_M } from "../../src/core/muni39";
import { loadDem } from "./helpers";

const dem = loadDem(), OPTS = { stage3: true, firstEra: 0, techK: 2, start1800: true, subCapital: "JP-27" } as never;
function make(edits?: Record<string, number>) {
  const s = defaultState(); s.islands = true; if (edits) s.rangeEdits = edits; const t = generateTerrain(s, dem), ids = townsForSeats(t, ["JP-13", "JP-27"]);
  return { t, w: buildWorld(t, s.seed, ids, 3) };
}
const total = (sim: ReturnType<typeof createSim>, w: ReturnType<typeof make>["w"]) => w.cities.reduce((a, c) => a + (sim.cities[c.id]?.pop ?? 0), 0);

describe("Stage 39 E: the 1500 m limit holds for the villages of the very first year", () => {
  for (const [label, edits] of [["unedited", undefined], ["hida raised to 2", { hida: 2, akaishi: 2 }]] as const) it(`no 村 stands on ground of 1500 m or more (${label})`, () => {
    const g = make(edits as Record<string, number> | undefined), sim = createSim(g.w, "m", g.t.hash, 7, OPTS), v = Object.values(sim.settlements);
    expect(v.length).toBeGreaterThan(100); for (const s of v) expect(g.w.elevM(s.cell), s.id).toBeLessThan(LIMIT_M.village);
  });
  it("no city is moved to satisfy it: every city keeps its own cell", () => { const a = make(), b = make({ hida: 2 }); for (const c of b.w.cities) { const o = a.w.cities.find((x) => x.id === c.id); if (o) expect(c.cell).toBe(o.cell); } });
});
describe("Stage 39 F: 1949 / 1950 boundary and what never relaxes", () => {
  it("nothing relaxes before 1950, and in 1950 itself the allowance is still zero", () => {
    expect(exceptionAllowanceM(1949, 1, 1)).toBe(0); expect(exceptionAllowanceM(1950, 1, 1)).toBe(0); expect(exceptionAllowanceM(1951, 1, 1)).toBeGreaterThan(0);
    expect(exceptionAllowanceM(2000, 0, 1)).toBe(0); expect(exceptionAllowanceM(2000, 1, 0)).toBe(0);
  });
  it("the limit itself is forbidden; a little over it opens only with a road, demand and the years", () => {
    const base = { kind: "city" as const, elevM: 1300, access: 1, demand: 1 }; expect(eligible({ ...base, year: 1949 })).toBe(false); expect(eligible({ ...base, year: 1950 })).toBe(false); expect(eligible({ ...base, year: 2040, access: 0 })).toBe(false); expect(eligible({ ...base, year: 2040, noException: true })).toBe(false);   /* the limit itself is forbidden until F relaxes it, and never relaxes for made land */
    expect(eligible({ ...base, elevM: 1320, year: 1949 })).toBe(false); expect(eligible({ ...base, elevM: 1320, year: 2040 })).toBe(true); expect(eligible({ ...base, elevM: 1320, year: 2040, access: 0 })).toBe(false);
  });
});
describe("Stage 39 F/G: made land and water get no exception; high ground caps a seat city", () => {
  const g = make({ hida: 0 }), sim = createSim(g.w, "m", g.t.hash, 7, OPTS), at = g.w.cities.find((c) => c.kind === "city")!.cell, hi = { ...g.w, elevM: () => 1320 } as typeof g.w;
  it("a reclaimed cell is never relaxed, an ordinary one is (same height, road and year)", () => {
    const s2 = JSON.parse(JSON.stringify(sim)) as typeof sim; const e = Object.values(s2.edges).find((x) => x.built >= 1 && x.facility !== "ferry")!, cell = e.cells[0];
    expect(mayStand(s2, hi, cell, "city", 2040, 400000)).toBe(true); s2.rec34 = { ...(s2.rec34 ?? {}), log: [{ k: cell }] } as never; expect(reclaimedCell(s2, cell)).toBe(true); expect(mayStand(s2, hi, cell, "city", 2040, 400000)).toBe(false);
  });
  it("highGroundCap: unlimited on low ground; on ground a city may not stand it holds the seat at the biggest size a 町 / 村 may have", () => {
    const at2 = (e: number) => highGroundCap(sim, { ...g.w, elevM: () => e } as typeof g.w, at, 100000, 1900);
    expect(at2(500)).toBe(Infinity); expect(at2(1350)).toBeLessThanOrEqual(CITY_FROM - 1); expect(at2(1450)).toBeLessThanOrEqual(TOWN_FROM - 1);
  });
});
describe("Stage 39 D: a range worn right down grows a large city over the years; people are conserved; the save round-trips", () => {
  const flat = make({ hida: 0 }), ref = make(), z = flat.w.cities.filter((c) => c.zone && c.zone.range === "hida");
  const run = (g: ReturnType<typeof make>) => { const s = createSim(g.w, "m", g.t.hash, 7, OPTS); s.policy!.mode = "auto"; advance(s, g.w, 12 * 120); return s; };
  const a = run(flat), b = run(ref);
  it("the zone city exists and grows well beyond its founding size, but stays far below Tokyo (not a copy of it)", () => {
    expect(z.length).toBeGreaterThan(0); const main = z.find((c) => c.zone!.n === 0)!, p = a.cities[main.id].pop, tokyo = Math.max(...flat.w.cities.map((c) => a.cities[c.id]?.pop ?? 0));
    expect(yearOf(a)).toBe(1920); expect(p).toBeGreaterThan(4000); expect(p).toBeLessThan(tokyo * 0.6);
  });
  it("the nation's people are the same as in the unedited world (they move, they are not created)", () => { expect(Math.abs(total(a, flat.w) - total(b, ref.w)) / total(b, ref.w)).toBeLessThan(0.03); });
  it("deterministic and save-safe: the same run gives the same people, and the saved state reads back identically", () => {
    const c = run(flat); expect(total(c, flat.w)).toBe(total(a, flat.w)); const back = JSON.parse(JSON.stringify(a)) as typeof a;
    for (const cc of z) expect(back.cities[cc.id].pop).toBe(a.cities[cc.id].pop); expect(total(back, flat.w)).toBe(total(a, flat.w));
  });
});
