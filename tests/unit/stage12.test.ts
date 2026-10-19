import { describe, expect, it } from "vitest";
import { sanitizeSim } from "../../src/core/save2";
import { AIR_ONTIME, SEA_ONTIME, weatherFactor } from "../../src/sim/demand";
import { ecoYear, ECO_PARTS, exposure, mainCause, MIG } from "../../src/sim/econ";
import { advance, createSim } from "../../src/sim/engine";
import { H_TUNNEL, hardnessAt, routeBurden, siteCapacity, siteQuality, tunnelLimitKm, upkeepMult } from "../../src/sim/land";
import { modeOf } from "../../src/sim/types";
import { KANTO_RIDGE } from "../study/kanto";
import { city, realWorld, ridgeWorld, stage3Sim, stage3SimOn } from "./simhelp";

const kanto = () => ridgeWorld({ ne: KANTO_RIDGE }, true, undefined, { lonLat: [139.0, 35.55], scale: 1.6 });

describe("Stage 12: the land model (Issue #30)", () => {
  it("open ground costs 1; hard ground costs more, faster than its length, and a run longer than the year's tunnel limit cannot be built", () => {
    const { w } = kanto(); w.barrier = true; w.land12 = true;
    const flat = realWorld(true).w; expect(routeBurden(flat, "road", [city(flat, "名古屋市").cell]).costMult).toBe(1);
    const hard: number[] = []; for (let k = 0; k < w.N; k++) if (w.t.land[k] === 1 && hardnessAt(w, k) >= H_TUNNEL) hard.push(k);
    expect(hard.length).toBeGreaterThan(50);
    const b1 = routeBurden(w, "road", hard.slice(0, 1), tunnelLimitKm(undefined, 1950)); expect(b1.costMult).toBeGreaterThan(1); expect(b1.runKm).toBe(w.cell);
    const a = routeBurden(w, "rail", Array(2).fill(hard[0])), b = routeBurden(w, "rail", Array(8).fill(hard[0]));
    expect(b.costMult).toBeGreaterThan(a.costMult);
    expect(routeBurden(w, "rail", Array(8).fill(hard[0]), 20).ok).toBe(false);   // 40 km of tunnel against a 20 km limit
    expect(routeBurden(w, "rail", Array(8).fill(hard[0]), 60).ok).toBe(true);
  });
  it("technology lets longer tunnels through as the years pass; a game without it keeps the 1950 figure", () => {
    const tech = { k: 2 }; expect(tunnelLimitKm(tech, 1950)).toBeLessThan(tunnelLimitKm(tech, 2000)); expect(tunnelLimitKm(undefined, 2100)).toBe(tunnelLimitKm(undefined, 1950));
  });
  it("a game started on the era timeline uses the land model; the older single-era flow does not", () => {
    const { w } = kanto(); const s1 = createSim(w, "m", "h", 7, { stage3: true, firstEra: 0, techK: 2, subCapital: "JP-27" }); expect(s1.econ).toBe(true); expect(w.land12).toBe(true);
    const w2 = realWorld(false).w; const s2 = createSim(w2, "m", "h", 7, { era: "heisei", stage3: true, techK: 2 }); expect(s2.econ).toBeUndefined(); expect(w2.land12).toBe(false);
  });
  it("the 1950 network never runs open over a range: every hard stretch is a tunnel of a length 1950 could dig", () => {
    const { w } = kanto(), { sim } = stage3SimOn({ w, hash: "x" }, 0, 7), limit = tunnelLimitKm(sim.tech, 1950);
    const gift = new Set<string>(); for (const r of Object.values(sim.routes)) if (r.grade === "national" && r.number === 1) for (const x of r.edges) gift.add(x.edgeId);   // the opening ceremony's 国道1号 is the story's gift: it may exceed what 1950 could dig
    let openHard = 0, longest = 0;
    for (const e of Object.values(sim.edges)) { if (e.built < 1 || e.facility === "ferry") continue; if (e.facility !== "tunnel") { /* the two end cells are nodes: a town may stand on a range */ for (const k of e.cells.slice(1, -1)) if (hardnessAt(w, k) >= H_TUNNEL) openHard++; } else if (!gift.has(e.id)) longest = Math.max(longest, routeBurden(w, modeOf(e), e.cells).runKm); }
    expect(openHard).toBe(0); expect(longest).toBeLessThanOrEqual(limit + w.cell);
  });
  it("a line through a range is dearer to keep than the same line on the plain; with the model off it is 1", () => {
    const { w } = kanto(); const { sim } = stage3SimOn({ w, hash: "x" }, 0, 7);
    const es = Object.values(sim.edges).filter((e) => e.built >= 1), dear = es.filter((e) => upkeepMult(w, e) > 1.5);
    expect(dear.length).toBeGreaterThan(0); expect(es.filter((e) => upkeepMult(w, e) === 1).length).toBeGreaterThan(es.length / 2);
    const old = { ...w, land12: false } as typeof w; expect(upkeepMult(old, { cells: [...dear[0].cells] })).toBe(1);
  });
});

describe("Stage 12: the drawn range and the barrier are one field (Issue #30 audit item 6)", () => {
  it("the construction barrier is never smaller than the drawn-range closeness, and is zero where neither a range nor an edited Fuji stands", () => {
    const { w } = kanto(); let below = 0, ridged = 0, far = 0;
    for (let k = 0; k < w.N; k++) { if (w.t.barrier[k] < w.t.ridge[k] - 1e-6) below++; if (w.t.ridge[k] > 0.15) ridged++; }
    expect(below).toBe(0); expect(ridged).toBeGreaterThan(100);
    const none = realWorld(true).w; for (let k = 0; k < none.N; k++) if (none.t.barrier[k] > 0) far++;
    expect(far).toBe(0);   // the untouched map has no barrier at all: the real Tokaido calibration is untouched
  });
});

describe("Stage 12: cities on bad land", () => {
  it("no real city is squeezed on the untouched map; a city under a placed range is, and the national total holds", () => {
    const a = realWorld(true).w; for (const c of a.cities) expect(siteCapacity(a, c), c.name).toBe(1);
    const { w } = kanto(), kawagoe = city(w, "川越市"), hachi = city(w, "八王子市");
    expect(siteQuality(w, kawagoe)).toBeLessThan(0.15); expect(siteCapacity(w, kawagoe)).toBeLessThan(0.5); expect(siteCapacity(w, hachi)).toBeLessThan(0.5);
    const { sim } = stage3SimOn({ w, hash: "x" }, 0, 7), { sim: base } = stage3SimOn(realWorld(true), 0, 7);
    expect(sim.cities[kawagoe.id].pop).toBeLessThan(0.5 * base.cities[kawagoe.id].pop);
    const tot = (s: typeof sim) => Object.values(s.cities).reduce((x, c) => x + c.pop, 0); expect(Math.abs(tot(sim) / tot(base) - 1)).toBeLessThan(0.002);
  });
});

describe("Stage 12: the city economy", () => {
  const { sim, w } = stage3Sim("heisei", 7, true, 0, 2, true); sim.policy!.mode = "auto"; advance(sim, w, 12 * 12);
  it("migration moves people, it does not create them (the shocks aside)", () => {
    const n = w.cities.length, an = { T: new Float64Array(n * n).fill(Infinity), TT: new Float64Array(n * n).fill(Infinity) };
    const out = ecoYear(sim, w, an, 1962), P = w.cities.map((c) => sim.cities[c.id].pop), tot = P.reduce((a, b) => a + b, 0);
    // the migration part (MIG x each city's advantage over the mean, which ecoYear records as `adv`) sums to nothing; what is left of `out` is the shocks and their recovery, which are drawn at random
    // and so differ with every change that moves the random stream (a shock of 3-8 % on a big city alone is 0.5 % of the nation)
    const move = w.cities.reduce((s, c, i) => s + P[i] * MIG * sim.city12![c.id].adv, 0) / tot; expect(Math.abs(move)).toBeLessThan(0.0002);
    const shocks = w.cities.reduce((s, c, i) => s + P[i] * ((out.get(c.id) ?? 0) - MIG * sim.city12![c.id].adv), 0) / tot; expect(Math.abs(shocks)).toBeLessThan(0.02);
  });
  it("every city keeps the parts of its advantage and a size history; the main cause can be named", () => {
    expect(Object.keys(sim.city12!).length).toBe(w.cities.length); const d = sim.city12![city(w, "名古屋市").id]; expect(d.p.length).toBe(ECO_PARTS.length); expect(d.h.length).toBeGreaterThanOrEqual(2);
    expect(Object.values(sim.city12!).some((c) => mainCause(c) !== null)).toBe(true);
  });
  it("exposure is high only on low ground beside the sea", () => { const hi = w.cities.map((c) => exposure(w, c)); expect(Math.max(...hi)).toBeGreaterThan(0.3); expect(Math.min(...hi)).toBe(0); });
  it("weather costs air and sea trips; the north loses more; an older game loses none", () => {
    const n = w.cities.findIndex((c) => c.name === "札幌市"), s = w.cities.findIndex((c) => c.name === "福岡市");
    expect(weatherFactor(sim, w, "air", n, n)).toBeLessThan(weatherFactor(sim, w, "air", s, s)); expect(weatherFactor(sim, w, "sea", n, s)).toBeLessThan(weatherFactor(sim, w, "air", n, s)); expect(SEA_ONTIME).toBeLessThan(AIR_ONTIME);
    const old = { ...sim, econ: undefined } as typeof sim; expect(weatherFactor(old, w, "air", n, s)).toBe(1);
  });
  it("a damaged city12 record is dropped by the loader, a good one survives the round trip", () => {
    const good = JSON.parse(JSON.stringify(sim)); expect(sanitizeSim(good).sim?.city12).toBeTruthy();
    const bad = JSON.parse(JSON.stringify(sim)); bad.city12[Object.keys(bad.city12)[0]].p = "x"; const r = sanitizeSim(bad); expect(r.sim?.city12).toBeUndefined();
  });
  it("40 years: some cities clearly gain on the nation and some clearly lose (not one-directional growth)", () => {
    const { sim: s, w: ww } = stage3Sim("heisei", 11, true, 0, 2, true); s.policy!.mode = "auto"; advance(s, ww, 12 * 40);
    const big = ww.cities.filter((c) => c.pop0 >= 150000), r = big.map((c) => { const h = s.city12![c.id].h; return h[h.length - 1] / h[0]; }).sort((a, b) => a - b), med = r[Math.floor(r.length / 2)];
    expect(r.filter((x) => x > 1.15 * med).length).toBeGreaterThanOrEqual(2); expect(r.filter((x) => x < 0.87 * med).length).toBeGreaterThanOrEqual(2);
  }, 120000);
});
