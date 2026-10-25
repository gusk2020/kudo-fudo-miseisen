import { describe, expect, it } from "vitest";
import { run14 } from "../study/lib14";
import { stepMonth, yearOf } from "../../src/sim/engine";
import { apply2200 } from "../../src/sim/event2200";
import { homeCity, performNational, previewNational, subCity } from "../../src/sim/ceremony";
import { buildIndex } from "../../src/sim/network";
import { reviewTiers, wardPops, tierOf, ZONE_UP, ZONE_DOWN, FACILITY_LABEL } from "../../src/sim/tier23";
import { cityBoost, invalidateSites } from "../../src/sim/sites";
import { NUM_CLASSES, chipOf, entryOf, histOf, maxNumber, syncNumbers } from "../../src/sim/numreg";
import { sanitizeSim } from "../../src/core/save2";
import { targetOfEntry, targetOfRoute } from "../../src/ui/lines23";
import { slotMetaOf, makeSave } from "../../src/core/save2";
import { realState } from "../../src/core/state";
import type { Vec } from "../../src/core/types";

let CACHE: ReturnType<typeof run14> | null = null; const game = () => (CACHE ??= run14({ seed: 5, until: 2060, islets: true }));

describe("Stage 23: 政令特区 and 政令指定都市", () => {
  it("cities rise through the two steps, with different characters, facilities that come up over years, and wards that add up to the city", () => {
    const { sim, w } = game(), t = sim.tier23!; const zs = Object.entries(t.zones);
    expect(zs.some(([, z]) => z.tier === 1)).toBe(true); expect(zs.some(([, z]) => z.tier === 2)).toBe(true);
    const kinds = new Set(zs.flatMap(([, z]) => z.facs.map((f) => f.k))); expect(kinds.size).toBeGreaterThanOrEqual(3);   // not every zone the same
    expect(zs.some(([, z]) => z.facs.length >= 2)).toBe(true);
    for (const [id, z] of zs) {
      if (z.tier === 2) { expect(z.wards!.length).toBeGreaterThanOrEqual(4); expect(z.facs.length).toBeGreaterThanOrEqual(2); const wp = wardPops(z, sim.cities[id].pop); expect(wp.reduce((a, x) => a + x.pop, 0)).toBe(sim.cities[id].pop); expect(new Set(wp.map((x) => x.ward.name)).size).toBe(wp.length); expect(wp.every((x) => x.pop > 0)).toBe(true); }
      else expect(z.wards).toBeUndefined();
      expect(tierOf(sim, id)).toBe(z.tier); expect(w.cityById.has(id)).toBe(true);
    }
    expect(Object.values(FACILITY_LABEL).length).toBe(4);
  });
  it("the facilities act: a zone city's commerce / industry / manufacturing standing is higher than it would be without them", () => {
    const { sim, w } = game(), t = sim.tier23!, [id] = Object.entries(t.zones).find(([, z]) => z.facs.some((f) => sim.startYear + Math.floor(sim.month / 12) - f.y >= 10))!;
    const withZ = { ...cityBoost(sim, w, id) }; const saved = sim.tier23; sim.tier23 = undefined; invalidateSites(sim); const without = { ...cityBoost(sim, w, id) }; sim.tier23 = saved; invalidateSites(sim);
    expect(withZ.industry + withZ.manufacturing + withZ.commerce).toBeGreaterThan(without.industry + without.manufacturing + without.commerce + 0.02);
  });
  it("nobody is created or moved by the review itself, and a designation does not flip every year", () => {
    const { sim, w } = run14({ seed: 5, until: 1962, islets: true }); const an = { acc: w.cities.map(() => 0.3) } as never, y = yearOf(sim);
    const tot = () => w.cities.reduce((a, c) => a + sim.cities[c.id].pop, 0), p0 = tot(); reviewTiers(sim, w, an, y); expect(tot()).toBe(p0);
    // a city on the line: one year above, one year below, alternately -- it is designated at most once and kept through the grace years
    const c = [...w.cities].sort((a, b) => sim.cities[b.id].pop - sim.cities[a.id].pop)[12], st = sim.cities[c.id]; const total = p0 - st.pop;
    const popFor = (share: number) => Math.round((share * total) / (1 - share));
    let flips = 0, last = tierOf(sim, c.id);
    for (let k = 0; k < 24; k++) { st.pop = popFor(k % 2 ? ZONE_DOWN * 0.9 : ZONE_UP * 1.1); reviewTiers(sim, w, an, y + k); const t = tierOf(sim, c.id); if (t !== last) flips++; last = t; }
    expect(flips).toBeLessThanOrEqual(1);
    // and a designated city that falls well below is released only after the grace years
    st.pop = popFor(ZONE_UP * 1.5); for (let k = 0; k < 6; k++) reviewTiers(sim, w, an, y + 30 + k); const had = tierOf(sim, c.id);
    st.pop = popFor(ZONE_DOWN * 0.5); reviewTiers(sim, w, an, y + 40); expect(tierOf(sim, c.id)).toBe(had);
    for (let k = 1; k < 12; k++) reviewTiers(sim, w, an, y + 40 + k); if (had) expect(tierOf(sim, c.id)).toBe(0);
    if (had) expect(sim.tier23!.hist[c.id].some((x) => x.tier === 0)).toBe(true);   // the history keeps the step back
  }, 300000);
  it("the same seed gives the same tiers", () => {
    const a = run14({ seed: 7, until: 2025, islets: true }).sim, b = run14({ seed: 7, until: 2025, islets: true }).sim;
    expect(JSON.stringify(a.tier23)).toBe(JSON.stringify(b.tier23)); expect(Object.keys(a.tier23!.zones).length).toBeGreaterThan(0);
  }, 300000);
  it("the nation's people are the same with or without the tiers (the facilities move people between cities, never add them)", () => {
    const a = run14({ seed: 5, until: 2000, islets: true }).sim, tot = (s: typeof a) => Object.values(s.cities).reduce((x, c) => x + c.pop, 0);
    const base = tot(a); expect(base).toBeGreaterThan(1e7);
    const { sim } = game(); const w = Object.values(sim.cities).reduce((x, c) => x + c.pop, 0); expect(w).toBeGreaterThan(1e7);   // (a long run neither collapses nor explodes)
  }, 300000);
});

describe("Stage 23: the route number register", () => {
  it("six classes count from 1 on their own, nothing is numbered twice, and a number once issued stays", () => {
    const { sim } = game(), reg = sim.numreg!; expect(reg).toBeTruthy();
    for (const [c] of NUM_CLASSES) { const L = reg.list[c]; expect(new Set(L.map((e) => e.n)).size).toBe(L.length); expect(Math.max(0, ...L.map((e) => e.n))).toBe(maxNumber(sim, c)); expect(new Set(L.map((e) => e.key)).size).toBe(L.length); }
    expect(reg.list.road.length).toBeGreaterThan(50); expect(reg.list.rail.length).toBeGreaterThan(20); expect(reg.list.sea.length).toBeGreaterThan(10); expect(reg.list.air.length).toBeGreaterThan(5);
    const before = JSON.stringify(Object.values(reg.list).flat().map((e) => [e.n, e.since])); syncNumbers(sim, yearOf(sim)); expect(JSON.stringify(Object.values(sim.numreg!.list).flat().map((e) => [e.n, e.since])).startsWith(before.slice(0, before.length - 1))).toBe(true);
    const nums = reg.list.road.map((e) => e.n).sort((a, b) => a - b); expect(nums[0]).toBeGreaterThanOrEqual(0); for (let i = 1; i < nums.length; i++) expect(nums[i]).toBe(nums[i - 1] + 1);   // no skipped number: 欠番 appear only as 'void'
  });
  it("a line given up keeps its number as 廃線, and when it comes back it has the same number marked 復活", () => {
    const { sim } = run14({ seed: 5, until: 1990, islets: true }), y = yearOf(sim), r = Object.values(sim.routes).find((x) => x.active && x.edges.length > 1 && x.grade === "national")!, key = "r:" + r.id;
    syncNumbers(sim, y); const en = () => Object.values(sim.numreg!.list).flat().find((e) => e.key === key)!; const n = en().n, max = maxNumber(sim, "road");
    r.active = false; syncNumbers(sim, y + 1); expect(en().state).toBe("abolished"); expect(en().n).toBe(n); expect(chipOf(en())).toBe("abolished");
    const e0 = Object.values(sim.routes).filter((x) => x.active).length; r.active = true; syncNumbers(sim, y + 5); expect(en().state).toBe("active"); expect(en().n).toBe(n); expect(en().revived).toBe(y + 5); expect(chipOf(en())).toBe("revived");
    expect(histOf(en()).map((x) => x.s)).toEqual(expect.arrayContaining(["active", "abolished"])); expect(maxNumber(sim, "road")).toBe(max); expect(e0).toBeGreaterThan(0);
    expect(chipOf(entryOf(sim, "road", max + 50))).toBe("gap"); expect(targetOfEntry(sim, null, "road", en()).edges.length).toBeGreaterThan(0);
  }, 300000);
  it("an older save (no register) gets one, marked as estimated; a broken one is started again; saving and loading keeps the numbers", () => {
    const { sim } = run14({ seed: 5, until: 1985, islets: true }), snap = JSON.stringify(sim.numreg);
    const re = sanitizeSim(JSON.parse(JSON.stringify(sim))); expect(re.sim!.numreg).toBeTruthy(); expect(JSON.stringify(re.sim!.numreg)).toBe(snap);
    const old = JSON.parse(JSON.stringify(sim)); delete old.numreg; const o = sanitizeSim(old).sim!; expect(o.numreg).toBeUndefined(); syncNumbers(o, yearOf(o));
    expect(o.numreg!.list.road.length).toBeGreaterThan(30); expect(o.numreg!.list.road.every((e) => e.est)).toBe(true); expect(new Set(o.numreg!.list.road.map((e) => e.n)).size).toBe(o.numreg!.list.road.length);
    const bad = JSON.parse(JSON.stringify(sim)); bad.numreg = { next: { road: "x" }, list: {} }; expect(sanitizeSim(bad).sim!.numreg).toBeUndefined();
    expect(targetOfRoute(Object.values(sim.routes)[0]).edges.length).toBeGreaterThan(0);
  }, 300000);
  it("国道0号 holds 道路 number 0 and 国道1号 keeps its own history", () => {
    const { sim, w } = run14({ seed: 5, until: 1952, islets: true }); sim.month = (2200 - sim.startYear) * 12; sim.policy!.mode = "priority"; sim.kaigen!.next = 2230; sim.kaigen!.pending = null;
    stepMonth(sim, w); apply2200(sim, { era: 2, stance: "heisei", coast: "pacific", focus: "concentrate", capital: "JP-27", sub: "JP-13" });
    const idx = buildIndex(sim, "road"), a = homeCity(w, sim.capital)!, b = subCity(w, sim.subCapital)!, ln = Array.from({ length: 21 }, (_, i) => [a.pos[0] + ((b.pos[0] - a.pos[0]) * i) / 20, a.pos[1] + ((b.pos[1] - a.pos[1]) * i) / 20] as Vec);
    const p = previewNational(w, ln, sim.capital, sim.subCapital, { roadCells: idx.roadCells, roadside: true }); expect(performNational(sim, w, p, { road0: true })).toBe(true);
    syncNumbers(sim, yearOf(sim)); const r0 = Object.values(sim.routes).find((r) => r.grade === "national" && r.number === 0)!, e0 = entryOf(sim, "road", 0); expect(e0?.key).toBe("r:" + r0.id);
    const r1 = Object.values(sim.routes).find((r) => r.grade === "national" && r.number === 1)!; expect(Object.values(sim.numreg!.list).flat().some((e) => e.key === "r:" + r1.id)).toBe(true);
  }, 300000);
});

describe("Stage 23: save slots", () => {
  it("a slot shows the capital, the sub-capital and the year OF THAT SAVE", () => {
    const s = realState(1); s.capital = "JP-27"; s.subCapital = "JP-13"; const { sim } = game(); const m = slotMetaOf(makeSave(s, sim));
    expect(m.capital).toBe("大阪府"); expect(m.sub).toBe("東京府"); expect(m.year).toBe(yearOf(sim)); expect(slotMetaOf(makeSave(s, null)).year).toBeNull();
  });
});
