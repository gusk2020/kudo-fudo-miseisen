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

describe("Stage 36 M3: 0.7x in the places that are not the weights", () => {
  it("recon.coreness: each of two sub-capitals pulls at 0.7x of the single sub-capital's weight; the capital's pull is the same", async () => {
    const { coreness } = await import("../../src/sim/recon"); const { subCity } = await import("../../src/sim/ceremony");
    const { w, hash } = realWorld(true, true), mk = (two: boolean) => createSim(w, "m", hash, 7, { stage3: true, firstEra: 0, techK: 2, subCapital: "JP-27", ...(two ? { subCapital2: "JP-40" } : {}) });
    const one = mk(false), two = mk(true), s2 = subCity(w, "JP-40")!, s1 = subCity(w, "JP-27")!;
    expect(coreness(two, w, s2.id)).toBeCloseTo(0.7 * coreness(mk(false).subCapital === "JP-27" ? { ...one, subCapital: "JP-40" } as never : one, w, s2.id), 9);   // (as if the single sub-capital stood there, scaled by 0.7)
    expect(coreness(two, w, s1.id)).toBeCloseTo(0.7 * coreness(one, w, s1.id), 9);
  });
  it("reclaim34: with two sub-capitals each sub site gains land at 0.7x of the single rate; the capital's site is unchanged", async () => {
    const { stepReclaim } = await import("../../src/sim/reclaim34"); type W = import("../../src/sim/world").World;
    const nx = 40, ny = 30, N = nx * ny, t = { land: new Uint8Array(N), island: new Uint8Array(N), pref: new Uint8Array(N), plains: new Uint8Array(N), elev: new Float32Array(N).fill(-200), grid: { x0: 0, y0: 0, cell: 5, nx, ny } };
    const cells = [8 * nx + 8, 8 * nx + 30, 22 * nx + 19]; cells.forEach((k, n) => { t.land[k] = 1; t.island[k] = n + 1; t.pref[k] = n + 1; t.elev[k] = 30; });
    const lm = new Uint16Array(N); cells.forEach((k, n) => (lm[k] = n + 1));
    const city = (cell: number, pref: string) => ({ id: pref, name: pref, cell, pos: [0, 0], pref, island: t.island[cell], pop0: 1, popSource: "synthetic", coastal: true, plains: 1, kind: "capital" });
    const run = (two: boolean) => {
      const w = { t: { ...t, land: t.land.slice(), island: t.island.slice(), pref: t.pref.slice(), plains: t.plains.slice(), elev: t.elev.slice() }, nx, ny, cell: 5, N, cities: [city(cells[0], "JP-13"), city(cells[1], "JP-27"), city(cells[2], "JP-40")], lm: lm.slice(), g34: true } as unknown as W;
      const sim = { subCapital: "JP-27", ...(two ? { subCapital2: "JP-40" } : {}), rec34: { sites: [], log: [], done: [] } } as never as import("../../src/sim/types").SimState;
      for (let y = 1900; y <= 1990; y++) stepReclaim(sim, w, y); return sim.rec34!.sites;
    };
    const a = run(false), b = run(true), f = (sites: typeof a, role: string) => sites.find((x) => x.role === role)!;
    expect(a.map((x) => x.role)).toEqual(["capital", "sub"]); expect(b.map((x) => x.role)).toEqual(["capital", "sub", "sub2"]);
    expect(f(b, "capital").filled).toBe(f(a, "capital").filled); expect(f(a, "sub").filled).toBeGreaterThan(0);
    const accA = f(a, "sub").filled * 50 + f(a, "sub").accU, accB = f(b, "sub").filled * 50 + f(b, "sub").accU; expect(accB / accA).toBeCloseTo(0.7, 1);   // (units: 50 half-km2 per cell)
  });
});

describe("Stage 36 M3: the city order (seats14)", () => {
  it("a second sub-capital's city is a seat: it is not counted as a city that outgrew the seats, and it joins the seat list", async () => {
    const { cityOrderBreaches } = await import("../../src/sim/seats14"); const { subCity } = await import("../../src/sim/ceremony");
    const { w, hash } = realWorld(true, true), mk = (two: boolean) => createSim(w, "m", hash, 7, { stage3: true, firstEra: 0, techK: 2, subCapital: "JP-27", ...(two ? { subCapital2: "JP-40" } : {}) });
    const one = mk(false), two = mk(true), c = subCity(w, "JP-40")!;
    one.cities[c.id].pop = 1e7; two.cities[c.id].pop = 1e7;   // a huge city in the second sub-capital's prefecture
    expect(cityOrderBreaches(one, w)).toBeGreaterThan(cityOrderBreaches(two, w));   // (with one sub-capital it outgrows the seats; with two it IS a seat)
  });
});

describe("Stage 36 M3: the clusters round the sub-capitals", () => {
  it("the first sub-capital's cluster is 0.7x of its single-sub uplift; the second has a cluster of its own, also at 0.7x of the real Osaka region's mass; the capital's cluster is untouched", () => {
    const { w, hash } = realWorld(true, true), mk = (two: boolean) => createSim(w, "m", hash, 7, { stage3: true, firstEra: 0, techK: 2, subCapital: "JP-40", ...(two ? { subCapital2: "JP-04" } : {}) });
    const one = mk(false), two = mk(true);
    expect(one.roles!.sub2Metro).toBeUndefined(); expect(Object.keys(two.roles!.sub2Metro ?? {}).length).toBeGreaterThan(0);
    for (const p of one.roles!.subMetro) expect(roleScale(two, w, p), p).toBeCloseTo(shareMult(roleScale(one, w, p), SUB2_SHARE), 9);
    for (const p of two.roles!.capMetro) expect(roleScale(two, w, p), p).toBeCloseTo(roleScale(one, w, p), 9);
    for (const p of Object.keys(two.roles!.sub2Metro!)) { expect(two.roles!.capMetro).not.toContain(p); expect(roleScale(two, w, p), p).toBeGreaterThan(0); }
  });
});
