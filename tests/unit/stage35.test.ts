import { describe, expect, it } from "vitest";
import { realState } from "../../src/core/state";
import { generateTerrain } from "../../src/core/terrain";
import { apply2200, close2200, due2200, nextYear2200, skip2200, unattended, waiting2200 } from "../../src/sim/event2200";
import { createSim, stepMonth, yearOf } from "../../src/sim/engine";
import { buildWorld, townsForSeats, type World } from "../../src/sim/world";
import type { SimState } from "../../src/sim/types";
import { loadDem } from "./helpers";

const s = realState(), t = generateTerrain(s, loadDem()), ids = townsForSeats(t, ["JP-13", "JP-27"]);
function game(first = 2200) {
  const w: World = buildWorld(t, s.seed, ids, 2, [], { log: [], done: [] }), sim = createSim(w, "m", t.hash, 5, { stage3: true, firstEra: 0, techK: 2, subCapital: "JP-27", relocFirst: first });
  return { w, sim };
}
/** Puts the clock at a month just before a year boundary without running 250 years: the sim stays as the 1950 game it is. */
const eveOf = (sim: SimState, year: number) => { sim.month = (year - sim.startYear) * 12 - 1; };
const cross = (sim: SimState, w: World, months = 2) => { for (let i = 0; i < months; i++) stepMonth(sim, w); };
const setMode = (sim: SimState, m: "priority" | "idleAuto" | "auto", away = false) => { sim.policy!.mode = m; sim.policy!.away = away; };

describe("Stage 35: the fixed schedule", () => {
  it("a game with the 2200 start is due in 2200, 2350, 2500, ... (150 years), and not before", () => {
    const { sim } = game(2200); expect(nextYear2200(sim)).toBe(2200);
    sim.e2200 = { year: 2200, state: "done", n: 0, sched: 2200 }; expect(nextYear2200(sim)).toBe(2350);
    sim.e2200hist = [sim.e2200]; sim.e2200 = { year: 2350, state: "done", n: 1, sched: 2350 }; expect(nextYear2200(sim)).toBe(2500);
  });
  it("manual: the event opens at the first month of the boundary year and time stops (no step moves the clock) until it is closed", () => {
    const { w, sim } = game(2200); setMode(sim, "priority"); sim.month = (2199 - sim.startYear) * 12 + 11; expect(due2200(sim)).toBe(false);
    cross(sim, w, 3); expect(sim.e2200?.state).toBe("pending"); expect(sim.e2200?.sched).toBe(2200); expect(waiting2200(sim)).toBe(true);
    const m = sim.month; cross(sim, w, 5); expect(sim.month).toBe(m);   // stopped
    expect(sim.relocSkipped).toBeUndefined();
  });
});

describe("Stage 35: fully unattended mode skips the relocation whole", () => {
  it("2200 is skipped: no event, no era change, no seat change, the clock keeps running; the next due year is 2350", () => {
    const { w, sim } = game(2200); setMode(sim, "auto"); sim.kaigen!.next = 3000; expect(unattended(sim)).toBe(true);   // (the ordinary era-change timer is its own thing: parked, so only the relocation is measured)
    const era0 = JSON.stringify(sim.kaigen!.eras), cap = [sim.capital, sim.subCapital, sim.palace]; sim.month = (2199 - sim.startYear) * 12 + 11; const m0 = sim.month;
    cross(sim, w, 3); expect(sim.e2200).toBeUndefined(); expect(sim.relocSkipped).toEqual([2200]); expect(sim.month).toBe(m0 + 3);
    expect(JSON.stringify(sim.kaigen!.eras)).toBe(era0); expect([sim.capital, sim.subCapital, sim.palace]).toEqual(cap); expect(nextYear2200(sim)).toBe(2350);
    expect(sim.events.some((e) => e.text.includes("完全自動運転のため遷都"))).toBe(true);
  });
  it("2350 and 2500 are skipped the same way, each once", () => {
    const { w, sim } = game(2200); setMode(sim, "auto");
    for (const y of [2200, 2350, 2500]) { eveOf(sim, y); cross(sim, w, 2); }
    expect(sim.relocSkipped).toEqual([2200, 2350, 2500]); expect(sim.e2200).toBeUndefined(); expect(nextYear2200(sim)).toBe(2650); expect(yearOf(sim)).toBe(2500);
  });
  it("a year jump that passes several boundaries skips each in order and never makes them up", () => {
    const { sim } = game(2200); setMode(sim, "auto"); sim.month = (2520 - sim.startYear) * 12; expect(skip2200(sim)).toBe(3); expect(sim.relocSkipped).toEqual([2200, 2350, 2500]); expect(skip2200(sim)).toBe(0);
  });
  it("back to manual after a skip: nothing is made up; the next relocation is the next fixed boundary; loading the save does not fire it", () => {
    const { w, sim } = game(2200); setMode(sim, "auto"); eveOf(sim, 2200); cross(sim, w, 2); expect(sim.relocSkipped).toEqual([2200]);
    setMode(sim, "priority"); expect(due2200(sim)).toBe(false); cross(sim, w, 24); expect(sim.e2200).toBeUndefined();   // 2200 and 2201 pass in manual with nothing opening
    const reloaded = JSON.parse(JSON.stringify(sim)) as SimState; expect(due2200(reloaded)).toBe(false); expect(nextYear2200(reloaded)).toBe(2350);
    eveOf(sim, 2350); cross(sim, w, 3); expect(sim.e2200?.state).toBe("pending"); expect(sim.e2200?.sched).toBe(2350); expect(sim.e2200?.n).toBe(0);   // the first event actually opened is n = 0
  });
  it("semi-automatic (放置中のみ自動), also while away, is not fully unattended: the event still opens and waits", () => {
    const { w, sim } = game(2200); setMode(sim, "idleAuto", true); expect(unattended(sim)).toBe(false); eveOf(sim, 2200); cross(sim, w, 3); expect(sim.e2200?.state).toBe("pending"); expect(sim.relocSkipped).toBeUndefined();
  });
  it("switching to fully automatic while the event is open does not discard it: the game keeps waiting for the choices", () => {
    const { w, sim } = game(2200); setMode(sim, "priority"); eveOf(sim, 2200); cross(sim, w, 3); expect(sim.e2200?.state).toBe("pending");
    setMode(sim, "auto"); const m = sim.month; cross(sim, w, 4); expect(sim.month).toBe(m); expect(sim.e2200?.state).toBe("pending"); expect(sim.relocSkipped).toBeUndefined();
    apply2200(sim, null); expect(sim.e2200?.state).toBe("done"); cross(sim, w, 3); expect(sim.month).toBeGreaterThan(m);
  });
  it("no double firing: after an event is closed the same boundary never opens again, in either mode", () => {
    const { w, sim } = game(2200); setMode(sim, "priority"); eveOf(sim, 2200); cross(sim, w, 3); apply2200(sim, null); close2200(sim); cross(sim, w, 30);
    expect(sim.e2200?.state).toBe("done"); expect(sim.e2200hist ?? []).toHaveLength(0); expect(nextYear2200(sim)).toBe(2350); setMode(sim, "auto"); cross(sim, w, 30); expect(sim.relocSkipped).toBeUndefined();
  });
});

import { adoptWorld } from "../../src/sim/event2200";

describe("Stage 35: a manual relocation carries Stage 34 over", () => {
  it("island enlargement applies at the new seat, the old site stops and keeps its land, the new sites start from zero, the log only grows", () => {
    const { w, sim } = game(1956); setMode(sim, "priority");
    // a one-cell island to move the capital to
    const sizes = new Map<number, number>(); for (let k = 0; k < w.N; k++) if (w.lm[k]) sizes.set(w.lm[k], (sizes.get(w.lm[k]) ?? 0) + 1);
    const one = [...sizes].filter(([, n]) => n === 1).map(([id]) => w.lm.indexOf(id)).find((k) => w.prefOf(k) && w.prefOf(k) !== "JP-13" && w.prefOf(k) !== "JP-27")!; expect(one).toBeGreaterThan(0);
    cross(sim, w, 12 * 6); expect(sim.rec34!.sites.every((x) => x.active)).toBe(true); const before = sim.rec34!.log.length, oldFilled = sim.rec34!.sites.map((x) => x.filled); expect(before).toBeGreaterThan(0);
    cross(sim, w, 24); expect(sim.e2200?.state).toBe("pending");
    const pref = w.prefOf(one)!, pos = w.cellPos(one), y = sim.e2200!.year;
    expect(apply2200(sim, { era: 0, stance: "heisei", coast: "neutral", focus: "concentrate", capital: pref, capitalPos: [pos[0], pos[1]], sub: "JP-13" })).toBe(true);
    const w2 = buildWorld(t, s.seed, ids, 2, sim.moves20 as never, { log: [...sim.rec34!.log], done: [...sim.rec34!.done] }); w2.barrier = true;
    expect(w2.g34grown!.some((g) => g.from === 25 && g.to === 50)).toBe(true);   // the island under the new capital became 50 km2
    sim.rec34!.log.push(...w2.g34new!.log); sim.rec34!.done.push(...w2.g34new!.done); adoptWorld(sim, w2);
    for (const e of sim.rec34!.log.slice(0, before)) expect(w2.t.land[e.k]).toBe(1);   // all earlier reclaimed land is still there
    expect(w2.lmCount).toBe(w.lmCount);
    close2200(sim); cross(sim, w2, 12 * 8);
    const sites = sim.rec34!.sites, olds = sites.filter((x) => !x.active), news = sites.filter((x) => x.active && x.start >= y);
    expect(olds.length).toBeGreaterThan(0); expect(olds.map((x) => x.filled).reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(oldFilled.reduce((a, b) => a + b, 0) - 0); for (const o of olds) expect(o.last).toBeLessThanOrEqual(y + 1);   // an old site stops accruing at the move
    expect(news.length).toBeGreaterThan(0); for (const n of news) expect(n.start).toBe(y + 0 === n.start ? n.start : y);
    expect(sim.rec34!.log.length).toBeGreaterThanOrEqual(before + 1);
  }, 240000);
});
