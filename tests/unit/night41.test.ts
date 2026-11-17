import { describe, expect, it } from "vitest";
import { advance } from "../../src/sim/engine";
import { edgeActivity, electrification, lightOf, nightField } from "../../src/sim/night41";
import { stage3Sim } from "./simhelp";
import { GRAIN_MAX_DOTS, grainRadiusKm, grainsOf } from "../../src/render/night";

/** Stage 41 #2: the night view's light. Pure function of the game; dark at 1800, blazing cities and lit corridors by 2000, only what is in service, never the sea or the air. */
const game = () => { const g = stage3Sim("heisei", 7, true, 0, 2, true, undefined, undefined, { start1800: true } as never); g.sim.policy!.mode = "auto"; advance(g.sim, g.w, 12 * 60); return g; };
const stats = (v: Float32Array) => { let max = 0, sum = 0, n = 0; for (const x of v) { max = Math.max(max, x); sum += x; if (x > 0.05) n++; } return { max, mean: sum / v.length, lit: n }; };
describe("Stage 41 #2: night field", () => {
  it("electrification: none by 1850 (1800 is dark), rising, full from 2000", () => {
    expect(electrification(1800)).toBe(0); expect(electrification(1850)).toBe(0); expect(electrification(1900)).toBeGreaterThan(0); expect(electrification(1900)).toBeLessThan(electrification(1950)); expect(electrification(1950)).toBeLessThan(0.5); expect(electrification(2000)).toBe(1); expect(electrification(2200)).toBe(1);
    expect(lightOf(100)).toBe(0); expect(lightOf(12e6)).toBe(1); expect(lightOf(1e5)).toBeLessThan(lightOf(1e6));
  });
  it("the same game: all dark in 1800, faintly lit in 1900, clearly lit in 2000; cities are the brightest and lines add light only between populated places", () => {
    const { sim, w } = game(), d0 = nightField(sim, w, 1800), d1 = nightField(sim, w, 1900), d2 = nightField(sim, w, 2000);
    expect(stats(d0.v)).toEqual({ max: 0, mean: 0, lit: 0 }); const a = stats(d1.v), b = stats(d2.v); expect(b.mean).toBeGreaterThan(a.mean * 3); expect(b.lit).toBeGreaterThan(a.lit); expect(b.max).toBeGreaterThan(0.5);
    const big = [...w.cities].filter((c) => sim.cities[c.id]).sort((x, y) => sim.cities[y.id].pop - sim.cities[x.id].pop); const top = d2.v[big[0].cell], small = d2.v[big[big.length - 1].cell]; expect(top).toBeGreaterThan(small);
    expect(d2.lit.edges).toBeGreaterThan(0); expect(d2.lit.cities).toBeGreaterThan(10);
    for (let k = 0; k < w.nx * w.ny; k++) if (w.t.land[k] === 0) { expect(d2.v[k], "the sea is never lit").toBe(0); }
  }, 600000);
  it("only a line in service lights: a closed / lost / unbuilt line and a ferry give no light, and traffic raises it", () => {
    const { sim } = game(), es = Object.values(sim.edges), open = es.find((e) => e.state === "open" && e.open && !e.lost && e.facility !== "ferry" && ((e.through ?? 0) + (e.local ?? 0)) > 0)!;
    expect(open, "a line in service with traffic exists").toBeTruthy(); expect(edgeActivity(open)).toBeGreaterThan(0);
    for (const bad of [{ state: "closed" }, { state: "dormant" }, { lost: true }, { open: false }, { built: 0.5 }, { facility: "ferry" }] as Partial<typeof open>[]) expect(edgeActivity({ ...open, ...bad } as typeof open), JSON.stringify(bad)).toBe(0);
    expect(edgeActivity({ ...open, through: (open.through ?? 0) + 5000 })).toBeGreaterThan(edgeActivity(open));
  }, 600000);
  it("closing every line darkens the corridors but not the cities; a city that shrinks gets dimmer; deterministic", () => {
    const { sim, w } = game(), full = nightField(sim, w, 2000), again = nightField(sim, w, 2000); expect(Array.from(again.v)).toEqual(Array.from(full.v));
    const s2 = JSON.parse(JSON.stringify(sim)); for (const e of Object.values(s2.edges) as any[]) { e.state = "closed"; e.open = false; } const nol = nightField(s2, w, 2000); expect(nol.lit.edges).toBe(0); expect(stats(nol.v).mean).toBeLessThan(stats(full.v).mean);
    const top = [...w.cities].filter((c) => sim.cities[c.id]).sort((x, y) => sim.cities[y.id].pop - sim.cities[x.id].pop)[0]; expect(nol.v[top.cell], "the city itself still shines").toBeGreaterThan(0.3);
    const s3 = JSON.parse(JSON.stringify(sim)); s3.cities[top.id].pop = Math.floor(s3.cities[top.id].pop / 20); expect(nightField(s3, w, 2000).v[top.cell]).toBeLessThan(full.v[top.cell]);
  }, 600000);
  it("Issue #88 grains: the same field gives the same grains, each inside its own lit cell, more in brighter cells, never more than the cap; the radius grows with the setting; the field itself is not touched", () => {
    const { sim, w } = game(), f = nightField(sim, w, 2000), g = { x0: w.t.grid.x0, y0: w.t.grid.y0, cell: w.t.grid.cell }, snap = Array.from(f.v), a = grainsOf(f, g), b = grainsOf(f, g); expect(a).toEqual(b); expect(Array.from(f.v)).toEqual(snap);
    expect(a.length / 3).toBeGreaterThan(500); expect(a.length / 3).toBeLessThanOrEqual(GRAIN_MAX_DOTS * 1.3);
    const per = new Map<number, number>(); for (let i = 0; i < a.length; i += 3) { const k = w.cellOf([a[i], a[i + 1]]); expect(f.v[k], "a grain stands in a lit cell").toBeGreaterThan(0.01); per.set(k, (per.get(k) ?? 0) + 1); expect(a[i + 2]).toBeGreaterThan(0); expect(a[i + 2]).toBeLessThanOrEqual(1); }
    const lit = [...per.keys()].sort((x, y) => f.v[y] - f.v[x]); expect(per.get(lit[0])!).toBeGreaterThanOrEqual(per.get(lit[lit.length - 1])!); expect(Math.max(...per.values())).toBeLessThanOrEqual(5);
    expect(grainsOf(f, g, 300).length / 3, "thinned to about the cap when asked").toBeLessThan(per.size + 300);
    expect(grainRadiusKm(0)).toBeCloseTo(0.35, 5); expect(grainRadiusKm(50)).toBeGreaterThan(grainRadiusKm(10)); expect(grainRadiusKm(99)).toBeCloseTo(3.2, 5);
  }, 600000);
});
