import { describe, expect, it } from "vitest";
import { run14 } from "../study/lib14";
import { advance, stepMonth, yearOf } from "../../src/sim/engine";
import { apply2200, close2200, waiting2200 } from "../../src/sim/event2200";
import { SimRunner } from "../../src/sim/runner";
import { potentialWeights } from "../../src/sim/potential17";
import { PREF_IDS } from "../../src/core/seat";
import { makeSave, sanitizeSim, slotMetaOf } from "../../src/core/save2";
import { realState } from "../../src/core/state";
import { fitView } from "../../src/ui/lines23";
import { prefName } from "../../src/core/seat";

const tot = (s: ReturnType<typeof run14>["sim"]) => Object.values(s.cities).reduce((a, c) => a + c.pop, 0);
const share = (r: ReturnType<typeof run14>, pref: string) => r.w.cities.filter((c) => c.pref === pref).reduce((a, c) => a + r.sim.cities[c.id].pop, 0) / tot(r.sim);
const MOVE = { era: 1, stance: "heisei" as const, coast: "neutral" as const, focus: "concentrate" as const, capital: "JP-40", sub: "JP-04", palace: "JP-40" };

describe("Stage 24: the 2200 event", () => {
  it("time waits for 国道0号 (drawn, or given up) after the choice; giving it up is recorded; a fast-forward stops there too", () => {
    const r = run14({ seed: 5, until: 1952, islets: true }), { sim, w } = r; sim.month = (2200 - sim.startYear) * 12; sim.policy!.mode = "auto"; sim.kaigen!.next = 2230; sim.kaigen!.pending = null;
    stepMonth(sim, w); expect(sim.e2200?.state).toBe("pending"); apply2200(sim, MOVE); expect(sim.e2200?.state).toBe("road0"); expect(waiting2200(sim)).toBe(true);
    const m = sim.month; for (let i = 0; i < 6; i++) stepMonth(sim, w); advance(sim, w, 30); expect(sim.month).toBe(m);
    close2200(sim); expect(sim.e2200?.state).toBe("done"); expect(sim.e2200?.skipped).toBe(true); expect(waiting2200(sim)).toBe(false); stepMonth(sim, w); if (sim.policy?.pending) { sim.policy.pending = null; } expect(sim.month).toBeGreaterThanOrEqual(m);
  }, 300000);
  it("the seats the player chose are the ones the game and its save show", () => {
    const r = run14({ seed: 5, until: 2202, islets: true, e2200: MOVE as never }); const s = realState(1);   // (the map state still says 東京 / 大阪)
    expect(r.sim.capital).toBe("JP-40"); expect(r.sim.subCapital).toBe("JP-04"); const m = slotMetaOf(makeSave(s, r.sim)); expect(m.capital).toBe(prefName("JP-40")); expect(m.sub).toBe(prefName("JP-04"));
  }, 300000);
  it("the development order is drawn again from the new seats by the starting rule, and it works: the new capital grows, the old one eases, nobody is created", () => {
    const keep = run14({ seed: 5, until: 2230, islets: true }), move = run14({ seed: 5, until: 2230, islets: true, e2200: MOVE as never });
    const o = move.sim.pot17!.order; expect(new Set(o).size).toBe(49); expect(o.length).toBe(49); expect([...o].sort()).toEqual([...PREF_IDS].sort()); expect(o.slice(0, 3)).toEqual(["JP-40", "JP-04", "JP-40"].filter((x, i, a) => a.indexOf(x) === i).concat(o.slice(2, 3)).slice(0, 3));
    const w = potentialWeights(o), mean = Object.values(w).reduce((a, b) => a + b, 0) / 49; expect(mean).toBeCloseTo(1, 6); expect(w["JP-40"]).toBeGreaterThan(w["JP-47"]);
    expect(move.sim.pot17!.hist.some((h) => h.y >= 2200 && h.order[0] === "JP-40")).toBe(true);
    expect(share(move, "JP-40")).toBeGreaterThan(share(keep, "JP-40") * 15); expect(share(move, "JP-13")).toBeLessThan(share(keep, "JP-13"));   // the move acts on the people
    const a = tot(keep.sim), b = tot(move.sim); expect(Math.abs(a - b) / a).toBeLessThan(0.01);   // moved, not made: the nation is the same size
    for (const c of move.w.cities) expect(move.sim.cities[c.id].pop).toBeGreaterThanOrEqual(2000 - 1);
  }, 900000);
});

describe("Stage 24/25: the pacing never changes the simulation", () => {
  it("the same months, in any pacing, give the same game (the speed only changes how often it is drawn)", () => {
    const a = run14({ seed: 9, until: 1955, islets: true }), b = run14({ seed: 9, until: 1955, islets: true });
    const ra = new SimRunner(a.sim, a.w), rb = new SimRunner(b.sim, b.w); ra.request(24); rb.request(24);
    while (a.sim.month < 24 + 5 * 12) { ra.request(1); ra.pump(1e9); if (a.sim.policy?.pending) break; }   // one month at a time, as ×1
    let g = 0; while (!rb.idle || rb.pending > 0) { rb.pump(0.2); g++; if (g > 1e6) break; }                  // many tiny slices
    ra.settle(); rb.settle(); const n = Math.min(a.sim.month, b.sim.month); expect(n).toBeGreaterThan(0);
    advance(a.sim, a.w, 0); const hash = (s: typeof a.sim) => JSON.stringify([s.rngState, Object.keys(s.edges).length, Object.values(s.cities).map((c) => c.pop)]);
    // bring both to the same month, then compare
    const target = Math.max(a.sim.month, b.sim.month); while (a.sim.month < target) { stepMonth(a.sim, a.w); if (a.sim.policy?.pending) break; } while (b.sim.month < target) { stepMonth(b.sim, b.w); if (b.sim.policy?.pending) break; }
    expect(a.sim.month).toBe(b.sim.month); expect(hash(a.sim)).toBe(hash(b.sim));
  }, 600000);
  it("Stage 25: an old save with speed 50 comes back as ×20; the others are kept", () => {
    const r = run14({ seed: 5, until: 1952, islets: true }); const back = (v: unknown) => { (r.sim as any).speed = v; return sanitizeSim(JSON.parse(JSON.stringify(r.sim))).sim!.speed; };
    expect(back(50)).toBe(20); expect(back(20)).toBe(20); expect(back(5)).toBe(5); expect(back(1)).toBe(1); expect(back(0)).toBe(0); expect(back(7)).toBe(0);
  }, 300000);
});

describe("Stage 24: the map goes to the chosen line", () => {
  it("about 80% of the free width for the east-west extent, centred in the free part; a tall line fits its height; a tiny one stops at the nearest zoom", () => {
    const screen = { w: 360, h: 740 }, free = { x: 92, y: 160, w: 268, h: 400 };
    const v = fitView({ x0: 100, y0: 50, x1: 300, y1: 90 }, free, screen); expect((200 * v.zoom) / free.w).toBeCloseTo(0.8, 2);
    const cx = (100 + 300) / 2, cy = (50 + 90) / 2, sx = (cx - v.cx) * v.zoom + screen.w / 2, sy = -(cy - v.cy) * v.zoom + screen.h / 2; expect(sx).toBeCloseTo(free.x + free.w / 2, 3); expect(sy).toBeCloseTo(free.y + free.h / 2, 3);
    const tall = fitView({ x0: 0, y0: 0, x1: 20, y1: 900 }, free, screen); expect(900 * tall.zoom).toBeLessThanOrEqual(free.h + 1e-6);
    expect(fitView({ x0: 5, y0: 5, x1: 6, y1: 6 }, free, screen).zoom).toBe(12);
  });
});
