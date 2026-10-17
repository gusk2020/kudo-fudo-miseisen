import { describe, expect, it } from "vitest";
import { realToWorld } from "../../src/core/body";
import { JAPAN, lonLatToReal } from "../../src/core/data";
import { parseState } from "../../src/core/save";
import { mapStateHash, sanitizeSim } from "../../src/core/save2";
import { PREF_IDS } from "../../src/core/seat";
import { defaultState } from "../../src/core/state";
import { REAL_ALPS, generateTerrain } from "../../src/core/terrain";
import { createSim, settleKaigen, stepMonth, yearOf } from "../../src/sim/engine";
import { CAND_1945, CAND_1989, CAND_2019 } from "../../src/sim/kaigen";
import { coastSide, reconGrowth } from "../../src/sim/recon";
import { basePop, computeRoles, prefMass, roleScale } from "../../src/sim/roles";
import { cityBoost, currentSites } from "../../src/sim/sites";
import type { SimState } from "../../src/sim/types";
import { buildWorld, pathfind, type World } from "../../src/sim/world";
import { loadDem } from "./helpers";
import { city, realWorld, stage3Sim } from "./simhelp";

const gen = (alps?: { ne?: true; sw?: true }) => { const s = defaultState(); s.islands = true; if (alps) s.alpsRemoved = alps; const t = generateTerrain(s, loadDem()); return { s, t, w: buildWorld(t, s.seed) }; };
/** Cells within `km` of a real Alps crest line. */
function zoneCells(w: World, key: "ne" | "sw", km: number): number[] {
  const s = defaultState(), pts = REAL_ALPS[key].line.map(([lon, lat]) => realToWorld("honshu", s.bodies.honshu, lonLatToReal(lon, lat))), out: number[] = [];
  for (let k = 0; k < w.N; k++) { if (w.t.land[k] !== 1) continue; const p = w.cellPos(k); let d = Infinity; for (let q = 0; q + 1 < pts.length; q++) { const a = pts[q], b = pts[q + 1], dx = b[0] - a[0], dy = b[1] - a[1], t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy))); d = Math.min(d, Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)); } if (d <= km) out.push(k); }
  return out;
}
const maxStep = (w: World, cells: number[]) => { let m = 0; const inSet = new Set(cells); for (const k of cells) for (const o of [1, -1, w.nx, -w.nx]) { const n = k + o; if (inSet.has(n) && w.t.land[n] === 1 && !w.river[k] && !w.river[n]) m = Math.max(m, Math.abs(w.t.elev[k] - w.t.elev[n])); } return m; };

describe("Stage 10: the real Alps are taken out of the DEM when 北 / 南 is chosen", () => {
  const base = gen(), ne = gen({ ne: true }), sw = gen({ sw: true }), both = gen({ ne: true, sw: true });
  it("北 levels the Hida range only, 南 the Akaishi range only; outside the zones nothing moves; Fuji and the lake stay", () => {
    const zN = zoneCells(base.w, "ne", REAL_ALPS.ne.core), zS = zoneCells(base.w, "sw", REAL_ALPS.sw.core), hi = (w: World, z: number[]) => Math.max(...z.map((k) => w.t.elev[k]));
    expect(hi(base.w, zN)).toBeGreaterThan(2000); expect(hi(base.w, zS)).toBeGreaterThan(2000);   // the 5 km grid averages the peaks
    expect(hi(ne.w, zN)).toBeLessThan(1200); expect(hi(sw.w, zS)).toBeLessThan(1200); expect(hi(both.w, zN)).toBeLessThan(1200); expect(hi(both.w, zS)).toBeLessThan(1200);
    // the other side is untouched, cell for cell, except where a river now runs a different course (the river pass cuts valleys along the streams, and a
    // levelled massif sends its water another way): every other changed cell lies in the zone that was chosen, and none ends up above the new low level (a filled gorge rises to it, no higher)
    const wideS = zoneCells(base.w, "sw", REAL_ALPS.sw.edge + 2), wideN = zoneCells(base.w, "ne", REAL_ALPS.ne.edge + 2), river = (a: World, b: World, k: number) => a.river[k] === 1 || b.river[k] === 1;
    for (const [x, own, other] of [[ne, wideN, wideS], [sw, wideS, wideN]] as const) {
      const mine = new Set(own); let inOwn = 0;
      for (let k = 0; k < base.w.N; k++) { if (x.w.t.elev[k] === base.w.t.elev[k] || river(x.w, base.w, k)) continue; expect(mine.has(k), `cell ${k}`).toBe(true); expect(x.w.t.elev[k]).toBeLessThan(Math.max(base.w.t.elev[k], 1031)); inOwn++; }
      expect(inOwn).toBeGreaterThan(50); expect(other.filter((k) => !river(x.w, base.w, k)).every((k) => x.w.t.elev[k] === base.w.t.elev[k])).toBe(true);
    }
    for (const k of [...wideN, ...wideS]) expect(both.w.t.elev[k]).toBeGreaterThan(0);
    expect(Array.from(both.w.t.land)).toEqual(Array.from(base.w.t.land));
    expect(both.t.stats.fujiTopCell).toBe(base.t.stats.fujiTopCell); expect(both.w.t.elev[both.t.stats.fujiTopCell]).toBe(base.w.t.elev[base.t.stats.fujiTopCell]);
  });
  it("no gap and no step: the levelled ground joins its surroundings smoothly (largest 5 km step far below the original massif's)", () => {
    for (const [x, key] of [[ne, "ne"], [sw, "sw"]] as const) {
      const z = zoneCells(base.w, key, REAL_ALPS[key].edge + 3), core = zoneCells(base.w, key, REAL_ALPS[key].core);
      // no step: no pair of neighbouring cells is steeper than it was in the original terrain (+ the low hills), or than a 9% slope where the original was gentler
      for (const k of z) for (const o of [1, -1, base.w.nx, -base.w.nx]) { const n = k + o; if (base.w.t.land[n] !== 1 || x.w.river[k] || x.w.river[n] || base.w.river[k] || base.w.river[n]) continue; expect(Math.abs(x.w.t.elev[k] - x.w.t.elev[n])).toBeLessThanOrEqual(Math.max(450, Math.abs(base.w.t.elev[k] - base.w.t.elev[n]) + 150)); }
      expect(maxStep(x.w, core)).toBeLessThan(0.4 * maxStep(base.w, core)); expect(z.every((k) => Number.isFinite(x.w.t.elev[k]))).toBe(true);
    }
  });
  it("building across the old massif gets easier: the way from Toyama to Matsumoto (straight over the Hida range) climbs far less, and the south is unchanged", () => {
    const at = (w: World, lon: number, lat: number) => w.cellOf(realToWorld("honshu", defaultState().bodies.honshu, lonLatToReal(lon, lat)));
    const climb = (w: World, a: [number, number], b: [number, number]) => { const p = pathfind(w, at(w, ...a), at(w, ...b), { margin: 18 })!; return Math.max(...p.map((k) => w.t.elev[k])); };
    const N1: [number, number] = [137.21, 36.70], N2: [number, number] = [137.97, 36.24], S1: [number, number] = [137.9, 35.6], S2: [number, number] = [138.45, 35.6];   // 富山 -> 松本 / 伊那 -> 甲府盆地の西
    expect(climb(ne.w, N1, N2)).toBeLessThan(climb(base.w, N1, N2) - 400); expect(climb(sw.w, S1, S2)).toBeLessThan(climb(base.w, S1, S2) - 400);
    expect(climb(ne.w, S1, S2)).toBe(climb(base.w, S1, S2));
  });
  it("saves keep the flag, the map hash knows it, older saves (no flag) keep their hash and terrain", () => {
    const s = defaultState(); s.alpsRemoved = { ne: true }; const back = parseState(JSON.parse(JSON.stringify(s))).state;
    expect(back.alpsRemoved).toEqual({ ne: true }); expect(mapStateHash(back)).not.toBe(mapStateHash(defaultState()));
    const old = defaultState(); expect(mapStateHash(parseState(JSON.parse(JSON.stringify(old))).state)).toBe(mapStateHash(old)); expect(parseState(JSON.parse(JSON.stringify(old))).state.alpsRemoved).toBeUndefined();
    const junk = parseState({ ...JSON.parse(JSON.stringify(old)), alpsRemoved: { ne: "yes" } }).state; expect(junk.alpsRemoved).toBeUndefined();
    expect(gen().t.hash).toBe(base.t.hash); expect(ne.t.hash).not.toBe(base.t.hash);
  });
});

describe("Stage 10: the seats swap roles with the real Tokyo / Osaka / Kyoto", () => {
  const { w } = realWorld(true), total = w.cities.reduce((s, c) => s + c.pop0, 0);
  it("default seats change nothing; every capital/sub-capital pair is a permutation of the prefectures' role masses (no double assignment, total kept)", () => {
    expect(computeRoles(w, "JP-13", "JP-27", "JP-13").prof).toEqual({});
    const prefs = w.t.prefOrder.filter((p) => prefMass(w, p) > 0);
    for (const c of prefs) for (const s of prefs) {
      if (c === s) continue; const r = computeRoles(w, c, s, "JP-13"), got = prefs.map((p) => r.prof[p] ?? p);
      expect(new Set(got).size).toBe(prefs.length);                       // each mass held by exactly one prefecture
      expect(r.prof[c] ?? c).toBe("JP-13"); expect(r.prof[s] ?? s).toBe("JP-27");
      expect(r.capMetro.length).toBeLessThanOrEqual(3); expect(r.subMetro.length).toBeLessThanOrEqual(3); expect(r.capMetro.some((p) => r.subMetro.includes(p))).toBe(false);
      expect([c, s].some((p) => r.capMetro.includes(p) || r.subMetro.includes(p))).toBe(false);
      const sum = w.cities.reduce((a, x) => a + basePop({ roles: r }, w, x), 0); expect(Math.abs(sum - total)).toBeLessThan(w.cities.length);
    }
  });
  it("Sapporo as capital: Sapporo carries Tokyo's 1950 size, Tokyo Sapporo's (reduced, not zero); the clusters follow access, not names", () => {
    const r = computeRoles(w, "HK-SAP", "JP-27", "JP-13"), pop = (pref: string) => w.cities.filter((c) => c.pref === pref).reduce((s, c) => s + basePop({ roles: r }, w, c), 0);
    expect(Math.abs(pop("HK-SAP") - prefMass(w, "JP-13"))).toBeLessThan(5); expect(Math.abs(pop("JP-13") - prefMass(w, "HK-SAP"))).toBeLessThan(5); expect(pop("JP-13")).toBeGreaterThan(100000);
    expect(r.capMetro).toContain("HK-HAK"); expect(r.capMetro.every((p) => !["JP-14", "JP-11", "JP-12"].includes(p))).toBe(true);
    expect(roleScale({ roles: r }, w, "JP-14")).toBeLessThan(1); expect(roleScale({ roles: r }, w, "HK-HAK")).toBeGreaterThan(1);
  });
  it("Takamatsu as sub-capital takes Osaka's role; the palace moves Kyoto's cultural role (and may share a seat)", () => {
    const r = computeRoles(w, "JP-13", "JP-37", "JP-13"); expect(r.prof["JP-37"]).toBe("JP-27"); expect(r.prof["JP-27"]).toBe("JP-37"); expect(r.subMetro).toContain("JP-36");
    expect(computeRoles(w, "JP-13", "JP-27", "JP-13").culture).toBe("JP-26"); expect(computeRoles(w, "JP-13", "JP-27", "JP-40").culture).toBe("JP-40"); expect(computeRoles(w, "HK-SAP", "JP-27", "HK-SAP").culture).toBe("HK-SAP");
    const a = stage3Sim("heisei", 7, false, 0, 2, true), b = stage3Sim("heisei", 7, false, 0, 2, true, { palace: "JP-40" });
    const tour = (x: { sim: SimState; w: World }, n: string) => cityBoost(x.sim, x.w, city(x.w, n).id).tourism;
    expect(tour(a, "京都市")).toBeGreaterThan(tour(b, "京都市") + 0.1); expect(tour(b, "福岡市")).toBeGreaterThan(tour(a, "福岡市") + 0.1);
    expect(currentSites(b.sim, b.w).filter((s) => s.kind === "culture").map((s) => s.pref)).toEqual(["JP-40"]);
  });
  it("a new game starts from the swapped sizes (no bonus on top); older saves keep what they had", () => {
    const a = stage3Sim("heisei", 7, false, 0, 2, true), b = stage3Sim("heisei", 7, false, 0, 2, true, { capital: "HK-SAP", sub: "JP-27" });
    const p = (x: { sim: SimState; w: World }, n: string) => x.sim.cities[city(x.w, n).id].pop;
    expect(p(b, "札幌市")).toBe(Math.round(city(w, "札幌市").pop0 * roleScale(b.sim, w, "HK-SAP"))); expect(p(b, "東京")).toBeLessThan(p(a, "東京") / 10);
    expect(Object.values(b.sim.cities).reduce((s, c) => s + c.pop, 0)).toBeCloseTo(Object.values(a.sim.cities).reduce((s, c) => s + c.pop, 0), -2);
    const raw = JSON.parse(JSON.stringify(b.sim)); delete raw.roles; expect(sanitizeSim(raw).sim?.roles).toBeUndefined();
    const bad = JSON.parse(JSON.stringify(b.sim)); bad.roles = { prof: 5 }; expect(sanitizeSim(bad).sim?.roles).toBeUndefined();
    expect(sanitizeSim(JSON.parse(JSON.stringify(b.sim))).sim?.roles).toEqual(b.sim.roles);
    const legacy = createSim(w, "m", realWorld(true).hash, 7, { stage3: true, era: "heisei" }); expect(legacy.roles).toBeUndefined();
  });
  it("1950-1980: with Sapporo as capital, Sapporo outgrows Tokyo and gets the bigger airport; Tokyo stays a regional city", () => {
    const run = (seats?: { capital: string; sub: string }) => { const x = stage3Sim("heisei", 7, true, 0, 2, true, seats); while (yearOf(x.sim) < 1980) { stepMonth(x.sim, x.w); if (x.sim.kaigen?.pending) settleKaigen(x.sim, 0, true); if (x.sim.policy?.pending) x.sim.policy.pending = null; } return x; };
    const a = run(), b = run({ capital: "HK-SAP", sub: "JP-27" }), p = (x: ReturnType<typeof run>, n: string) => x.sim.cities[city(x.w, n).id].pop;
    expect(p(a, "東京")).toBeGreaterThan(10 * p(a, "札幌市")); expect(p(b, "札幌市")).toBeGreaterThan(10 * p(b, "東京")); expect(p(b, "東京")).toBeGreaterThan(100000);
    const ap = (x: ReturnType<typeof run>, n: string) => x.sim.hubs?.airports[city(x.w, n).id]?.pax ?? 0;
    expect(ap(b, "札幌市")).toBeGreaterThan(ap(b, "東京")); expect(ap(a, "東京")).toBeGreaterThan(ap(a, "札幌市"));
  });
});

describe("Stage 10: the 1945 reconstruction policy", () => {
  it("only the 1945 candidates carry it; the four combinations are spread evenly and each meets several stances", () => {
    const by = new Map<string, Set<string>>(); for (const c of CAND_1945) { expect(c.recon).toBeDefined(); const k = `${c.recon!.coast}/${c.recon!.focus}`; (by.get(k) ?? by.set(k, new Set()).get(k)!).add(c.stance); }
    expect(by.size).toBe(4); const n = CAND_1945.map((c) => `${c.recon!.coast}/${c.recon!.focus}`); for (const k of by.keys()) { const m = n.filter((x) => x === k).length; expect(m).toBeGreaterThanOrEqual(3); expect(m).toBeLessThanOrEqual(4); expect(by.get(k)!.size).toBeGreaterThanOrEqual(3); }
    expect([...CAND_1989, ...CAND_2019].every((c) => c.recon === undefined)).toBe(true);
  });
  it("the two coasts come from the real seas (not names)", () => {
    const { w } = realWorld(true), sd = (n: string) => coastSide(w, city(w, n).id);
    for (const n of ["新潟市", "金沢市", "秋田市", "富山市", "鳥取市", "福井市"]) expect(sd(n), n).toBeLessThan(-0.3);
    for (const n of ["東京", "静岡市", "高知市", "名古屋市", "仙台市", "宮崎市", "大阪市", "広島市"]) expect(sd(n), n).toBeGreaterThan(0.3);
    expect(Math.abs(sd("長野市"))).toBeLessThan(0.6);
    expect(JAPAN.cities.length).toBeGreaterThan(0); expect(PREF_IDS.length).toBe(49);
  });
  it("its growth effect is a redistribution (zero national sum), kept after 1989, and the Japan Sea policy shifts people to that coast", () => {
    const run = (first: number) => { const x = stage3Sim("heisei", 7, true, first, 2, true); while (yearOf(x.sim) < 1992) { stepMonth(x.sim, x.w); if (x.sim.kaigen?.pending) settleKaigen(x.sim, 0, true); if (x.sim.policy?.pending) x.sim.policy.pending = null; } return x; };
    const p = run(0), j = run(5); expect(j.sim.kaigen!.recon).toEqual({ coast: "japansea", focus: "concentrate" }); expect(j.sim.kaigen!.eras.length).toBeGreaterThanOrEqual(2);
    const g = reconGrowth(j.sim, j.w, 1991); let s = 0, n = 0; for (const c of j.w.cities) { s += (g.get(c.id) ?? 0) * j.sim.cities[c.id].pop; n += j.sim.cities[c.id].pop; } expect(Math.abs(s / n)).toBeLessThan(1e-9);
    expect([...g.values()].some((v) => Math.abs(v) > 1e-4)).toBe(true);
    const share = (x: ReturnType<typeof run>) => { let a = 0, t = 0; for (const c of x.w.cities) { const v = x.sim.cities[c.id].pop; t += v; if (coastSide(x.w, c.id) < -0.2) a += v; } return a / t; };
    expect(share(j)).toBeGreaterThan(share(p) * 1.1);
  });
});

describe("Stage 10: the Seto Inland Sea has more services", () => {
  it("1950: ports on the inland sea are joined across it (more than one crossing per pair of shores), none drawn over land, none of them international, older games unchanged", async () => {
    const { innerSeaPorts, isInnerSeaFerry } = await import("../../src/sim/ferry"), { landShare, seaPath } = await import("../../src/render/seaPath");
    const x = stage3Sim("heisei", 7, false, 0, 2, true), w = x.w, inner = Object.values(x.sim.edges).filter(isInnerSeaFerry);
    const names = innerSeaPorts(w).map((c) => c.name); for (const n of ["岡山市", "広島市", "高松市", "松山市", "徳島市", "神戸市", "大阪市", "大分市", "北九州市"]) expect(names, n).toContain(n);
    for (const n of ["新潟市", "東京", "高知市", "福岡市", "奈良市", "京都市", "名古屋市"]) expect(names, n).not.toContain(n);
    expect(inner.length).toBeGreaterThanOrEqual(5);
    const shores = new Set(inner.map((e) => [w.lm[e.cells[0]], w.lm[e.cells[e.cells.length - 1]]].sort().join("-"))); expect(shores.size).toBeGreaterThanOrEqual(2);
    for (const e of inner) { expect(w.lm[e.cells[0]]).not.toBe(w.lm[e.cells[e.cells.length - 1]]); const p = seaPath(w, e.cells[0], e.cells[e.cells.length - 1]); expect(landShare(w, p), e.facilityName).toBe(0); }
    const legacy = createSim(w, "m", realWorld(true).hash, 7, { stage3: true, era: "heisei" }); expect(Object.values(legacy.edges).filter(isInnerSeaFerry).length).toBe(0);
  });
});
