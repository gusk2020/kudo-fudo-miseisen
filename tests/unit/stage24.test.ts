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
const memo = new Map<string, ReturnType<typeof run14>>();
/** One 2230 run per (seed, destination or "keep"): the two tests below share them (a run is about 90 s). */
const runOf = (seed: number, dest: "keep" | typeof MOVE | typeof MOVE2) => { const k = seed + ":" + (dest === "keep" ? "keep" : dest.capital); let r = memo.get(k); if (!r) { r = run14({ seed, until: 2230, islets: true, ...(dest === "keep" ? {} : { e2200: dest as never }) }); memo.set(k, r); } return r; };
const MOVE = { era: 1, stance: "heisei" as const, coast: "neutral" as const, focus: "concentrate" as const, capital: "JP-40", sub: "JP-04", palace: "JP-40" };
const MOVE2 = { era: 1, stance: "heisei" as const, coast: "neutral" as const, focus: "concentrate" as const, capital: "JP-23", sub: "JP-27", palace: "JP-23" };

describe("Stage 24: the 2200 event", () => {
  it("time waits for 国道0号 (drawn, or given up) after the choice; giving it up is recorded; a fast-forward stops there too", () => {
    const r = run14({ seed: 5, until: 1952, islets: true }), { sim, w } = r; sim.relocFirst = 2200; sim.month = (2200 - sim.startYear) * 12; sim.policy!.mode = "idleAuto"; sim.kaigen!.next = 2230; sim.kaigen!.pending = null;
    stepMonth(sim, w); expect(sim.e2200?.state).toBe("pending"); apply2200(sim, MOVE); expect(sim.e2200?.state).toBe("road0"); expect(waiting2200(sim)).toBe(true);
    const m = sim.month; for (let i = 0; i < 6; i++) stepMonth(sim, w); advance(sim, w, 30); expect(sim.month).toBe(m);
    close2200(sim); expect(sim.e2200?.state).toBe("done"); expect(sim.e2200?.skipped).toBe(true); expect(waiting2200(sim)).toBe(false); stepMonth(sim, w); if (sim.policy?.pending) { sim.policy.pending = null; } expect(sim.month).toBeGreaterThanOrEqual(m);
  }, 300000);
  it("the seats the player chose are the ones the game and its save show", () => {
    const r = run14({ seed: 5, until: 2202, islets: true, e2200: MOVE as never }); const s = realState(1);   // (the map state still says 東京 / 大阪)
    expect(r.sim.capital).toBe("JP-40"); expect(r.sim.subCapital).toBe("JP-04"); const m = slotMetaOf(makeSave(s, r.sim)); expect(m.capital).toBe(prefName("JP-40")); expect(m.sub).toBe(prefName("JP-04"));
  }, 300000);
  it("the development order is drawn again from the new seats by the starting rule, and it works: the new capital grows, the old one eases, nobody is created", () => {
    const keep = runOf(5, "keep"), move = runOf(5, MOVE);
    const o = move.sim.pot17!.order; expect(new Set(o).size).toBe(PREF_IDS.length); expect(o.length).toBe(PREF_IDS.length); expect([...o].sort()).toEqual([...PREF_IDS].sort()); expect(o.slice(0, 3)).toEqual(["JP-40", "JP-04", "JP-40"].filter((x, i, a) => a.indexOf(x) === i).concat(o.slice(2, 3)).slice(0, 3));
    const w = potentialWeights(o), mean = Object.values(w).reduce((a, b) => a + b, 0) / PREF_IDS.length; expect(mean).toBeCloseTo(1, 6); expect(w["JP-40"]).toBeGreaterThan(w["JP-47"]);
    expect(move.sim.pot17!.hist.some((h) => h.y >= 2200 && h.order[0] === "JP-40")).toBe(true);
    expect(share(move, "JP-13")).toBeLessThan(share(keep, "JP-13"));   // the move acts on the people (the size of the effect is checked over several seeds and destinations in the next test)
    const a = tot(keep.sim), b = tot(move.sim); expect(Math.abs(a - b) / a).toBeLessThan(0.01);   // moved, not made: the nation is the same size
    for (const c of move.w.cities) expect(move.sim.cities[c.id].pop).toBeGreaterThanOrEqual(2000 - 1);
  }, 900000);
  /**
   * Issue #65 (owner's decision 2026-11-12, option 1). This replaces the old single-seed bound "the new capital (福岡) holds more than ten times its no-move share" (seed 5 measured 9.93x after the 関門 crossing was repaired,
   * 11.55x before). That ratio divides by the no-move share of a small prefecture (0.3-1.1%), which the model splits into two discrete branches from tiny traffic differences (docs/ISSUE65.md), and it cannot hold for a destination that is already big (愛知: 1.6x).
   * What a move of the capital MUST do is checked instead, over three seeds and two destinations, as sizes with a stated margin. Observed (2230, seeds 5/11/23 -> 福岡, seed 11 -> 愛知): the new capital becomes the largest prefecture (rank 1 in all four);
   * its share 0.108-0.130; its gain over no-move 0.048-0.113; 東京 loses 0.216-0.287 of the nation; the people moved (half the sum of |change|) 0.296-0.406; totals equal. The bounds below keep 15-30% of margin under the smallest observation.
   * Counter-examples that must fail: no move at all (gain 0, nothing moved), a move that only adds people (total changes), a move that leaves 東京 the largest.
   */
  const cases: [number, typeof MOVE | typeof MOVE2][] = [[5, MOVE], [11, MOVE], [23, MOVE], [11, MOVE2]];
  const rank1 = (r: ReturnType<typeof run14>, pref: string) => { const m = new Map<string, number>(); for (const c of r.w.cities) m.set(c.pref ?? "?", (m.get(c.pref ?? "?") ?? 0) + r.sim.cities[c.id].pop); return [...m.values()].filter((v) => v > (m.get(pref) ?? 0)).length + 1; };
  for (const [seed, dest] of cases) it(`a move of the capital to ${dest.capital} (seed ${seed}) moves a large share of the nation's people to it, out of 東京, and creates nobody`, () => {
    const keep = runOf(seed, "keep"), move = runOf(seed, dest), nc = dest.capital, k = share(keep, nc), m = share(move, nc), gain = m - k, loss = share(keep, "JP-13") - share(move, "JP-13");
    const prefs = [...new Set(keep.w.cities.map((c) => c.pref ?? "?"))], moved = prefs.reduce((a, p) => a + Math.abs(share(move, p) - share(keep, p)), 0) / 2;
    const diag = `seed ${seed} -> ${nc}: share ${k.toFixed(4)} -> ${m.toFixed(4)} (x${(m / k).toFixed(1)}, rank ${rank1(move, nc)}), gain ${gain.toFixed(4)}, 東京 loss ${loss.toFixed(4)}, moved ${moved.toFixed(4)}`;
    expect(rank1(move, nc), diag).toBe(1);                       // the new capital is the largest prefecture
    expect(m, diag).toBeGreaterThanOrEqual(0.09);                // its share (observed 0.108-0.130)
    expect(gain, diag).toBeGreaterThanOrEqual(0.04);             // a real gain over no move (observed 0.048-0.113), not one more person
    expect(loss, diag).toBeGreaterThanOrEqual(0.15);             // the old capital gives up a large share of the nation (observed 0.216-0.287)
    expect(loss, diag).toBeGreaterThanOrEqual(gain);             // and at least what the new one gains: the people come from the old capital's region first
    expect(rank1(move, "JP-13"), diag).toBeGreaterThan(1);       // 東京 is no longer the largest
    expect(moved, diag).toBeGreaterThanOrEqual(0.2);             // the amount of people that moved is large (observed 0.296-0.406)
    expect(Math.abs(tot(keep.sim) - tot(move.sim)) / tot(keep.sim), diag).toBeLessThan(0.01);   // moved, not made
    for (const c of move.w.cities) expect(move.sim.cities[c.id].pop, diag).toBeGreaterThanOrEqual(2000 - 1);
  }, 900000);
  it("the invariants really fail for a move that does nothing, and for the move read backwards (so they measure a move, not just any run)", () => {
    const keep = runOf(5, "keep"), move = runOf(5, MOVE), eff = (a: ReturnType<typeof run14>, b: ReturnType<typeof run14>, nc: string) => ({ gain: share(b, nc) - share(a, nc), loss: share(a, "JP-13") - share(b, "JP-13"), rank: rank1(b, nc), tokyoRank: rank1(b, "JP-13") });
    const none = eff(keep, keep, "JP-40"), back = eff(move, keep, "JP-40"), real = eff(keep, move, "JP-40");
    expect(none.gain).toBe(0); expect(none.loss).toBe(0); expect(none.rank).toBeGreaterThan(1); expect(none.tokyoRank).toBe(1);   // no move: nothing gained, nothing lost, 東京 still largest
    expect(back.gain).toBeLessThan(0); expect(back.rank).toBeGreaterThan(1);                                                      // the move undone: the share falls
    expect(real.gain).toBeGreaterThanOrEqual(0.04); expect(real.rank).toBe(1);                                                    // the real move passes the same measures
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
