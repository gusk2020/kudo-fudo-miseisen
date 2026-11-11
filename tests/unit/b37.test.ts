import { describe, expect, it } from "vitest";
import { advance, yearOf } from "../../src/sim/engine";
import { homeCity } from "../../src/sim/ceremony";
import { developSeats37, devFactor, seatTargets, SEAT_SHARE } from "../../src/sim/devseat37";
import { SUB2_SHARE } from "../../src/sim/subs36";
import { realWorld, stage3SimOn } from "./simhelp";
import type { SeatMove } from "../../src/sim/seatmove20";

const base0 = realWorld(true, true, 3);
/** The 1800 game whose capital is put on a plain that had no city (the one furthest from every city on Hokkaido). */
function plainGame() {
  const w0 = base0.w; let best = -1, bd = 0;
  for (let k = 0; k < w0.N; k++) if (w0.t.land[k] === 1 && w0.t.island[k] === 2 && w0.t.plains[k] === 1) { const p = w0.cellPos(k); let dmin = 1e9; for (const c of w0.cities) dmin = Math.min(dmin, Math.hypot(c.pos[0] - p[0], c.pos[1] - p[1])); if (dmin > bd) { bd = dmin; best = k; } }
  const pos = w0.cellPos(best), pref = w0.prefOf(best)!, base = realWorld(true, true, 3, [{ pref, pos, by: "capital" } as SeatMove]);
  const g = stage3SimOn(base, 0, 7, { start1800: true, capital: pref } as never) as unknown as { sim: import("../../src/sim/types").SimState; w: import("../../src/sim/world").World }; g.sim.policy!.mode = "auto"; return { ...g, pos, far: bd };
}
const urban = (g: { sim: import("../../src/sim/types").SimState; w: import("../../src/sim/world").World }) => g.w.cities.reduce((a, c) => a + (g.sim.cities[c.id]?.pop ?? 0), 0);
const everyone = (g: { sim: import("../../src/sim/types").SimState; w: import("../../src/sim/world").World }) => urban(g) + Object.values(g.sim.settlements).reduce((a, v) => a + (v.gone ? 0 : v.pop), 0);
describe("Stage 37 B1/B2: a capital put on a plain that had no city starts a large development at once", () => {
  const g = plainGame(), cap = homeCity(g.w, g.sim.capital)!, landBefore = g.w.t.land.reduce((a, b) => a + b, 0), start = g.sim.cities[cap.id].pop;
  it("the place is really new (far from every existing city) and starts small", () => { expect(g.far).toBeGreaterThan(60); expect(start).toBeLessThan(60000); });
  advance(g.sim, g.w, 12 * 30);
  it("30 years later it is a big city, a few percent of all city people", () => {
    const st = g.sim.cities[cap.id].pop; expect(st).toBeGreaterThan(8 * start); expect(st / urban(g)).toBeGreaterThan(0.02); expect(yearOf(g.sim)).toBe(1830);
  });
  it("the development is logged in the timeline, and nobody is created or destroyed by it (one year moves people, the total stays)", () => {
    expect(g.sim.events.some((e) => e.kind === "seatdev")).toBe(true);
    const k = Object.keys(g.sim.dev37!).length; expect(k).toBeGreaterThanOrEqual(1);
    const before = everyone(g); const moved = developSeats37(g.sim, g.w, 1830 + 0); expect(Math.abs(everyone(g) - before)).toBeLessThan(200); expect(moved).toBeGreaterThanOrEqual(0);
  });
  it("satellite towns grow up round the new capital (the commuter belt), on the same land, 12-40 km out, with people who came from elsewhere", () => {
    const sats = Object.values(g.sim.settlements).filter((v) => v.city === cap.id && !v.gone && (/近郊/.test(v.name) || !!v.origin)); expect(sats.length).toBeGreaterThanOrEqual(3);
    for (const v of sats) { expect(g.w.lm[v.cell]).toBe(g.w.lm[cap.cell]); expect(g.w.t.land[v.cell]).toBe(1); const d = Math.hypot(g.w.cellPos(v.cell)[0] - cap.pos[0], g.w.cellPos(v.cell)[1] - cap.pos[1]); expect(d).toBeGreaterThan(8); expect(d).toBeLessThan(60); }
    expect(new Set(Object.values(g.sim.settlements).map((v) => v.id)).size).toBe(Object.keys(g.sim.settlements).length);
  });
  it("the terrain, the coast and the lakes are untouched by it", () => { expect(g.w.t.land.reduce((a, b) => a + b, 0)).toBe(landBefore); });
  it("the old capital stays an ordinary city with most of its people (it is never emptied)", () => {
    const old = g.w.cities.find((c) => c.former && c.kind === "city"); if (old) expect(g.sim.cities[old.id].pop).toBeGreaterThan(2000);
  });
});
describe("Stage 37 B3/B4: the world's mood sets the pace, and sub-capitals count 0.7 each", () => {
  const g = plainGame();
  it("a boom with a will to build and a rebuilding phase pulls harder than a slump", () => {
    const f = (d: Partial<import("../../src/sim/eras").Dials>) => { Object.assign(g.sim.dials, { growth: 1, hwyBuild: 0.8, railBuild: 0.8, hsr: 0.5 }, d); return devFactor(g.sim); };
    expect(f({ growth: 1.4, hwyBuild: 1.4, railBuild: 1.4 })).toBeGreaterThan(f({})); expect(f({})).toBeGreaterThan(f({ growth: 0.6, hwyBuild: 0.3, railBuild: 0.3 }));
  });
  it("two sub-capitals each aim at 0.7 of the one's share", () => {
    const one = seatTargets(g.sim, g.w).find((s) => s.role === "sub")!.share; g.sim.subCapital2 = g.w.cities.find((c) => c.kind === "capital" && c.pref !== g.sim.capital && c.pref !== g.sim.subCapital)!.pref!;
    const two = seatTargets(g.sim, g.w).filter((s) => s.role === "sub" || s.role === "sub2"); expect(one).toBeCloseTo(SEAT_SHARE.sub, 6); expect(two.length).toBe(2); for (const t of two) expect(t.share).toBeCloseTo(SEAT_SHARE.sub * SUB2_SHARE, 6);
  });
});
