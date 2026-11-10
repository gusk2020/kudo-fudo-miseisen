import { describe, expect, it } from "vitest";
import { advance, yearOf } from "../../src/sim/engine";
import { clearCrossing, driveOf, evalLink, planIslandLinks, shorePairs } from "../../src/sim/islandlink37";
import { LONG_LINK_FROM_1800, SHORT_LINK_KM } from "../../src/sim/crossing";
import { RECLAIM_FROM_1800 } from "../../src/sim/reclaim34";
import { realWorld, stage3SimOn } from "./simhelp";

const base = realWorld(true, true, 3);
const fresh = (seed = 23) => stage3SimOn(base, 0, seed, { start1800: true } as never) as unknown as { sim: import("../../src/sim/types").SimState; w: import("../../src/sim/world").World };
describe("Stage 37 C1/C2: nothing long or reclaimed by itself before 1950 in an 1800 game", () => {
  const g = fresh(); g.sim.policy!.mode = "auto"; advance(g.sim, g.w, 12 * (1949 - yearOf(g.sim)));
  it("no automatic reclamation before 1950", () => { expect((g.sim.rec34?.log ?? []).filter((l) => l.kind === "fill" && l.y < RECLAIM_FROM_1800)).toEqual([]); });
  it("no long bridge or tunnel is started before 1950; a short one may be", () => {
    for (const p of Object.values(g.sim.projects).filter((q) => q.reason.includes("海峡連絡"))) { const m = /海峡(\d+(?:\.\d+)?)km/.exec(p.reason); expect(m, p.reason).not.toBeNull(); expect(Number(m![1])).toBeLessThanOrEqual(SHORT_LINK_KM); }
    expect(Object.values(g.sim.projects).some((p) => p.reason.includes("島間接続"))).toBe(false); expect(LONG_LINK_FROM_1800).toBe(1950);
  });
});
describe("Stage 37 C3-C5/C8: from 1950 every island is considered", () => {
  const g = fresh(); g.sim.policy!.mode = "auto"; advance(g.sim, g.w, 12 * (2000 - yearOf(g.sim)));
  const isl = Object.values(g.sim.projects).filter((p) => p.reason.includes("島間接続")), at = (p: { startMonth: number }) => Math.floor(g.sim.startYear + p.startMonth / 12);
  it("island links are made, none before 1950, and they are not all to the biggest island", () => {
    expect(isl.length).toBeGreaterThan(8); expect(Math.min(...isl.map(at))).toBeGreaterThanOrEqual(1950);
    const masses = new Map<number, number>(); for (let k = 0; k < g.w.N; k++) if (g.w.t.land[k] === 1) masses.set(g.w.lm[k], (masses.get(g.w.lm[k]) ?? 0) + 1);
    const biggest = [...masses.entries()].sort((a, b) => b[1] - a[1])[0][0]; const ends = isl.map((p) => { const e = g.sim.edges[p.edgeIds[0]]; return e ? [g.w.lm[e.cells[0]], g.w.lm[e.cells[e.cells.length - 1]]] : null; }).filter((x): x is number[] => !!x);
    expect(ends.length).toBeGreaterThan(8); expect(ends.filter((x) => !x.includes(biggest)).length).toBeGreaterThan(3);
  });
  it("the far north is reached: a link ends on 樺太 or a Kuril island (Stage 40: an 1800 start no longer begins with 1950-style roads on Hokkaido's coast, so this comes up to 30 years later than at Stage 39: it is checked in 2030)", () => {
    advance(g.sim, g.w, 12 * (2030 - yearOf(g.sim))); const isl = Object.values(g.sim.projects).filter((p) => p.reason.includes("島間接続"));
    const far = new Set<number>(); for (const c of g.w.cities) if (c.island === 10) far.add(g.w.lm[c.cell]);
    const hit = isl.some((p) => { const e = g.sim.edges[p.edgeIds[0]]; return !!e && (far.has(g.w.lm[e.cells[0]]) || far.has(g.w.lm[e.cells[e.cells.length - 1]])); });
    expect(hit).toBe(true);
  });
  it("no crossing runs over other land, and the links are named after places on both shores", () => {
    for (const p of isl) { const e = g.sim.edges[p.edgeIds[0]]; if (!e) continue; expect(clearCrossing(g.w, e.cells[0], e.cells[e.cells.length - 1])).toBe(true); const nm = (e.facilityName ?? "").replace(/^link:/, ""); const [a, b] = nm.split("〜"); expect(a && b && a !== b, nm).toBeTruthy(); }
  });
  it("the reach grows with the technology: what can be crossed in 1950 can be in 2000, and something can be crossed in 2050 that cannot in 1950", async () => {
    const { chooseStructure } = await import("../../src/sim/crossing"), feas = (gap: number, y: number) => chooseStructure(g.sim, gap, gap, "road", y) !== null, gaps = [3, 10, 25, 40, 60, 90, 120];
    for (const gp of gaps) for (const [y1, y2] of [[1950, 1975], [1975, 2000], [2000, 2050]]) if (feas(gp, y1)) expect(feas(gp, y2), `${gp}km ${y1}->${y2}`).toBe(true);
    expect(gaps.filter((x) => feas(x, 2050)).length).toBeGreaterThan(gaps.filter((x) => feas(x, 1950)).length);
  });
});
describe("Stage 37 C6/C7: the policy, era and economy set the pace", () => {
  const g = fresh(); const set = (d: Partial<import("../../src/sim/eras").Dials>, kind?: "disperse" | "concentrate") => { Object.assign(g.sim.dials, { hwyBuild: 0.8, railBuild: 0.8, seaBias: 0, airBias: 0, growth: 1, ...d }); if (g.sim.kaigen) g.sim.kaigen.recon = { coast: "neutral", focus: kind ?? "concentrate" } as never; return driveOf(g.sim, 1990); };
  it("road/rail emphasis is super-aggressive, sea/air emphasis is realistic, the rest is between", () => {
    const ultra = set({ hwyBuild: 1.4, railBuild: 1.4 }), mid = set({}), real = set({ seaBias: 1.2, hwyBuild: 0.7, railBuild: 0.7 });
    expect([ultra.drive, mid.drive, real.drive]).toEqual(["ultra", "aggressive", "real"]);
    expect(ultra.bar).toBeLessThan(mid.bar); expect(mid.bar).toBeLessThan(real.bar); expect(ultra.perYear).toBeGreaterThan(mid.perYear); expect(mid.perYear).toBeGreaterThanOrEqual(real.perYear);
  });
  it("a dispersed boom with road/rail emphasis multiplies everything (the synergy)", () => {
    const plain = set({ hwyBuild: 1.4, railBuild: 1.4 }), boom = set({ hwyBuild: 1.4, railBuild: 1.4, growth: 1.3 }), all = set({ hwyBuild: 1.4, railBuild: 1.4, growth: 1.3 }, "disperse");
    expect(boom.perYear).toBeGreaterThan(plain.perYear); expect(all.synergy).toBe(true); expect(all.perYear).toBeGreaterThan(boom.perYear * 1.5); expect(all.bar).toBeLessThan(boom.bar); expect(all.maxActive).toBeGreaterThan(boom.maxActive);
    const realBoom = set({ seaBias: 1.2, hwyBuild: 0.7, railBuild: 0.7, growth: 1.3 }, "disperse"); expect(realBoom.synergy).toBe(false);
  });
});
describe("Stage 37 C8: the search is cheap", () => {
  it("the shore-pair table is built once, quickly, and a yearly look costs a few milliseconds", () => {
    const g = fresh(); const t0 = performance.now(); const n = shorePairs(g.w).length; const t1 = performance.now(); shorePairs(g.w); const t2 = performance.now();
    expect(n).toBeGreaterThan(100); expect(t1 - t0).toBeLessThan(1500); expect(t2 - t1).toBeLessThan(5);
    const t3 = performance.now(); planIslandLinks(g.sim, g.w, 1960); expect(performance.now() - t3).toBeLessThan(400); void evalLink;
  });
});
describe("Stage 37 C6/C7: the same world, the same year, different policy -> different number of links started", () => {
  it("super-aggressive >= middle >= realistic, and a dispersed boom is the most", () => {
    const g = fresh(11); g.sim.policy!.mode = "auto"; advance(g.sim, g.w, 12 * (1962 - yearOf(g.sim))); const snap = JSON.stringify(g.sim);
    const run = (d: Partial<import("../../src/sim/eras").Dials>, disperse = false) => { const s = JSON.parse(snap) as import("../../src/sim/types").SimState; Object.assign(s.dials, { hwyBuild: 0.8, railBuild: 0.8, seaBias: 0, airBias: 0, growth: 1, ...d }); if (s.kaigen) s.kaigen.recon = { coast: "neutral", focus: disperse ? "disperse" : "concentrate" } as never; return planIslandLinks(s, g.w, 1970); };
    const real = run({ seaBias: 1.2, hwyBuild: 0.7, railBuild: 0.7 }), mid = run({}), ultra = run({ hwyBuild: 1.4, railBuild: 1.4 }), all = run({ hwyBuild: 1.4, railBuild: 1.4, growth: 1.3 }, true);
    console.log("C6", JSON.stringify({ real, mid, ultra, all }));
    expect(real).toBeLessThanOrEqual(mid); expect(mid).toBeLessThanOrEqual(ultra); expect(all).toBeGreaterThanOrEqual(ultra); expect(all).toBeGreaterThan(real);
  });
});
