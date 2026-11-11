import { describe, expect, it } from "vitest";
import { generateTerrain } from "../../src/core/terrain";
import { defaultState } from "../../src/core/state";
import { RANGE_LAKE } from "../../src/core/ranges";
import { advance, createSim, yearOf } from "../../src/sim/engine";
import { buildWorld, townsForSeats } from "../../src/sim/world";
import { mayStand, isAbolished, abolishSubmerged } from "../../src/sim/muni39sim";
import { loadDem } from "./helpers";
import type { RangeDef } from "../../src/core/ranges";

const dem = loadDem();
function make(edits: Record<string, number> | undefined) {
  const s = defaultState(); s.islands = true; if (edits) s.rangeEdits = edits; const t = generateTerrain(s, dem), ids = townsForSeats(t, ["JP-13", "JP-27"]);
  return { s, t, w: buildWorld(t, s.seed, ids, 3), ids };
}
const base = make(undefined);
void ({} as RangeDef);
describe("Stage 39 B/C: towns can be founded on a range worn to plain, named from its highest peak", () => {
  const flat = make({ hida: 0, kanto: 0.3 });
  it("the terrain keeps the ORIGINAL elevation apart from the edited one", () => {
    expect(flat.t.elev0).toBeTruthy(); expect(base.t.elev0).toBeTruthy(); let lower = 0, same = 0;
    for (let k = 0; k < flat.t.elev.length; k++) { if (flat.t.land[k] !== 1) continue; if (flat.t.elev[k] < flat.t.elev0![k] - 100) lower++; if (base.t.elev0![k] === flat.t.elev0![k]) same++; }
    let landN = 0; for (let k = 0; k < flat.t.land.length; k++) if (flat.t.land[k] === 1) landN++;
    expect(lower).toBeGreaterThan(200); expect(same).toBeGreaterThan(landN * 0.9);   // the original ground is the same whatever was edited
  });
  it("only ranges worn to 0.3 or less make a flat zone, with spread-out seeds on ground a city may stand on", () => {
    const ids = flat.t.flat!.map((z) => z.id).sort(); expect(ids).toEqual(["hida", "kanto"]); expect(base.t.flat!.length).toBe(0); expect(make({ hida: 0.4 }).t.flat!.length).toBe(0);
    for (const z of flat.t.flat!) { expect(z.seeds.length).toBeGreaterThanOrEqual(1); for (const sd of z.seeds) { expect(flat.t.elev[sd.cell]).toBeLessThan(1300); expect(sd.areaKm2).toBeGreaterThanOrEqual(400); } }
  });
  it("the towns are in the world (after the terrain is confirmed), named from the peak, at fixed cells, with room from their real area", () => {
    const z = flat.w.cities.filter((c) => c.zone); expect(z.length).toBeGreaterThanOrEqual(2); expect(new Set(z.map((c) => c.name)).size).toBe(z.length);
    expect(z.some((c) => c.name === "奥穂高市")).toBe(true); expect(z.some((c) => c.name === "雲取市")).toBe(true);
    for (const c of z) { expect(c.kind).toBe("city"); expect(c.pref).toBeTruthy(); expect(c.capPop!).toBeGreaterThan(c.pop0); expect(c.zone!.apt).toBeGreaterThanOrEqual(0.35); expect(flat.w.t.land[c.cell]).toBe(1); }
    expect(base.w.cities.filter((c) => c.zone).length).toBe(0);
  });
  it("editing moves no existing municipality: every city of the unedited world stands where it stood", () => {
    const pos = new Map(base.w.cities.map((c) => [c.id, c.pos])); let n = 0;
    for (const c of flat.w.cities) { const p = pos.get(c.id); if (!p) continue; n++; expect(c.pos, c.id).toEqual(p); }
    expect(n).toBeGreaterThan(50);
  });
});
describe("Stage 39 G: a municipality under a lake the player made is abolished (never moved), its people go to the others", () => {
  const lake = make({ kiso: RANGE_LAKE, hida: RANGE_LAKE, akaishi: RANGE_LAKE, ou: RANGE_LAKE, chugoku: RANGE_LAKE, kii: RANGE_LAKE, shikoku: RANGE_LAKE, kyushu: RANGE_LAKE, hidaka: RANGE_LAKE, kanto: RANGE_LAKE });
  it("an office point covered by the new lake is flagged, not moved; a city off the lake is untouched", () => {
    const sub = lake.w.cities.filter((c) => c.submerged); const pos = new Map(base.w.cities.map((c) => [c.id, c.pos]));
    for (const c of sub) expect(c.pos, c.id).toEqual(pos.get(c.id));
    for (const c of lake.w.cities) { if (c.submerged || !pos.get(c.id)) continue; expect(c.pos, c.id).toEqual(pos.get(c.id)); }
    console.log("M39 submerged", sub.map((c) => c.name).join(","));
  });
});
describe("Stage 39 G (simulation): a municipality whose office the new lake covers is abolished; people, roads and records are kept", () => {
  const pick = base.w.cities.find((c) => c.kind === "city" && base.t.elev[c.cell] < 100 && c.pref !== "JP-13" && c.pref !== "JP-27" && !c.zone)!;
  const s = defaultState(); s.islands = true; s.creations = [{ id: 1, kind: "lake", pos: pick.pos, level: 3 }];
  const t = generateTerrain(s, dem), ids = townsForSeats(t, ["JP-13", "JP-27"]), w = buildWorld(t, s.seed, ids, 3), opts = { stage3: true, firstEra: 0, techK: 2, start1800: true, subCapital: "JP-27" } as never;
  const sim = createSim(w, "m", t.hash, 7, opts), ref = createSim(base.w, "m", base.t.hash, 7, opts), total = (x: typeof sim, ww: typeof w) => ww.cities.reduce((a, c) => a + (x.cities[c.id]?.pop ?? 0), 0);
  it("the office point is covered, flagged, and NOT moved", () => { const c = w.cities.find((x) => x.id === pick.id)!; expect(w.t.land[c.cell]).toBe(2); expect(c.submerged).toBe(true); expect(c.pos).toEqual(pick.pos); expect(c.cell).toBe(pick.cell); });
  it("it is abolished at the start: no people, on record, with its roads untouched and a timeline entry; the rest of the nation holds exactly the people it held", () => {
    const rec = sim.abolished39?.[pick.id]; expect(rec).toBeTruthy(); expect(rec!.pop).toBeGreaterThan(0); expect(isAbolished(sim, pick.id)).toBe(true); expect(sim.cities[pick.id].pop).toBe(0);
    expect(Math.abs(total(sim, w) - total(ref, base.w))).toBeLessThanOrEqual(2); expect(sim.events.some((e) => e.kind === "muni39" && e.refs?.city === pick.id)).toBe(true);
    const edges = Object.keys(sim.edges).length; expect(edges).toBeGreaterThan(150);   /* (Stage 40: an 1800 start is a sparse network, about 230 sections; the point is that abolishing takes none away) */ expect(abolishSubmerged(sim, w)).toBe(0); expect(Object.keys(sim.edges).length).toBe(edges);   // abolishing again does nothing, and takes no road away
  });
  it("it stays abolished through the years (never revived, never counted again) and the nation's people keep adding up", () => {
    const sim2 = createSim(w, "m", t.hash, 7, opts); sim2.policy!.mode = "auto"; advance(sim2, w, 12 * 30);
    expect(sim2.cities[pick.id].pop).toBe(0); expect(sim2.abolished39![pick.id]).toBeTruthy(); expect(yearOf(sim2)).toBe(1830);
    const ref2 = createSim(base.w, "m", base.t.hash, 7, opts); ref2.policy!.mode = "auto"; advance(ref2, base.w, 12 * 30);
    expect(Math.abs(total(sim2, w) - total(ref2, base.w)) / total(ref2, base.w)).toBeLessThan(0.02);   // same nation (the natural-growth model is the same)
  });
  it("the abolition survives a save: the record is part of the game", () => { const back = JSON.parse(JSON.stringify(sim)) as typeof sim; expect(back.abolished39![pick.id].pop).toBe(sim.abolished39![pick.id].pop); expect(isAbolished(back, pick.id)).toBe(true); });
});
describe("Stage 39 E/F in the simulation: the ground at the office point decides, from the start", () => {
  const g = make({ hida: 0 }), sim = createSim(g.w, "m", g.t.hash, 7, { stage3: true, firstEra: 0, techK: 2, start1800: true, subCapital: "JP-27" } as never);
  const cell = g.w.cities.find((c) => c.kind === "city")!.cell, w2 = (e: number) => ({ ...g.w, elevM: () => e }) as typeof g.w;
  it("a 市 needs ground under 1300 m; 1299 is allowed, 1300 and above is not (before 1950, with or without a road)", () => {
    expect(mayStand(sim, w2(1299), cell, "city", 1900, 90000)).toBe(true); expect(mayStand(sim, w2(1300), cell, "city", 1900, 90000)).toBe(false); expect(mayStand(sim, w2(1400), cell, "city", 1949, 90000)).toBe(false);
    expect(mayStand(sim, w2(1400), cell, "town", 1900, 20000)).toBe(false); expect(mayStand(sim, w2(1399), cell, "town", 1900, 20000)).toBe(true); expect(mayStand(sim, w2(1500), cell, "village", 1900, 2000)).toBe(false); expect(mayStand(sim, w2(1499), cell, "village", 1900, 2000)).toBe(true);
  });
  it("after 1950 a road and demand relax it a little, in steps; water and made land never", () => {
    const sim2 = JSON.parse(JSON.stringify(sim)) as typeof sim; const e = Object.values(sim2.edges).find((x) => x.built >= 1 && x.facility !== "ferry")!, at = e.cells[0];
    const hi = 1300 + 40;   // a little over the limit, at the end of a built road
    expect(mayStand(sim2, { ...g.w, elevM: () => hi } as typeof g.w, at, "city", 1949, 400000)).toBe(false);
    expect(mayStand(sim2, { ...g.w, elevM: () => hi } as typeof g.w, at, "city", 2030, 400000)).toBe(true);
    expect(mayStand(sim2, { ...g.w, elevM: () => 1300 + 650 } as typeof g.w, at, "city", 2030, 400000)).toBe(false);   // far too high for 2030's technology
    expect(mayStand(sim2, { ...g.w, elevM: () => hi, t: { ...g.w.t, land: new Uint8Array(g.w.t.land.length) } } as typeof g.w, at, "city", 2100, 400000)).toBe(false);   // under water: never
  });
});
void advance; void yearOf; void isAbolished;
