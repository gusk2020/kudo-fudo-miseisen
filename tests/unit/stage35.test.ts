import { describe, expect, it } from "vitest";
import { realState } from "../../src/core/state";
import { generateTerrain } from "../../src/core/terrain";
import { apply2200, close2200, due2200, nextYear2200, skip2200, unattended, waiting2200 } from "../../src/sim/event2200";
import { createSim, stepMonth, yearOf } from "../../src/sim/engine";
import { buildWorld, townsForSeats, type World } from "../../src/sim/world";
import type { SimState } from "../../src/sim/types";
import { loadDem } from "./helpers";

const s = realState(), t = generateTerrain(s, loadDem()), ids = townsForSeats(t, ["JP-13", "JP-27"]);
function game(first: number | null = 2200) {
  const w: World = buildWorld(t, s.seed, ids, 2, [], { log: [], done: [] }), sim = createSim(w, "m", t.hash, 5, { stage3: true, firstEra: 0, techK: 2, subCapital: "JP-27", ...(first ? { relocFirst: first } : {}) });
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

import { relocFirstOf, relocYear } from "../../src/sim/kaigen";
import { adoptRelocSchedule, originOf } from "../../src/sim/event2200";
import { sanitizeSim } from "../../src/core/save2";

describe("Stage 35: the origin is each game's own start year (start + 150 x n), never a fixed 2100 / 2200", () => {
  it("the boundaries of several start years", () => {
    for (const [start, want] of [[1950, [2100, 2250, 2400]], [2000, [2150, 2300, 2450]], [2050, [2200, 2350, 2500]]] as const) {
      expect([1, 2, 3].map((n) => start + 150 * n)).toEqual(want); expect([0, 1, 2].map((n) => relocYear(n, relocFirstOf(start)))).toEqual(want);
      const sim = { startYear: start, e2200: undefined, e2200hist: undefined, relocSkipped: undefined } as any; expect(nextYear2200(sim)).toBe(want[0]);   // no recorded origin: the start year says it
      sim.e2200 = { year: want[0], n: 0, sched: want[0], state: "done" }; expect(nextYear2200(sim)).toBe(want[1]); sim.e2200hist = [sim.e2200]; sim.e2200 = { year: want[1], n: 1, sched: want[1], state: "done" }; expect(nextYear2200(sim)).toBe(want[2]);
    }
  });
  it("a new game records its first boundary as its own start year + 150 (1950 -> 2100) and keeps it through a save, a load and a relocation", () => {
    const { w, sim } = game(null); expect(sim.startYear).toBe(1950); expect(sim.relocFirst).toBe(2100); expect(sim.relocOrigin).toBe("new"); expect(originOf(sim)).toBe(2100);
    const back = sanitizeSim(JSON.parse(JSON.stringify(sim))).sim!; expect([back.startYear, back.relocFirst]).toEqual([1950, 2100]);
    setMode(sim, "priority"); eveOf(sim, 2100); cross(sim, w, 3); expect(sim.e2200?.sched).toBe(2100); apply2200(sim, null); close2200(sim);
    expect([sim.startYear, sim.relocFirst, nextYear2200(sim)]).toEqual([1950, 2100, 2250]);   // the relocation moved nothing but the next slot
    const again = sanitizeSim(JSON.parse(JSON.stringify(sim))).sim!; expect([again.startYear, again.relocFirst, nextYear2200(again), due2200(again)]).toEqual([1950, 2100, 2250, false]);
  });
  it("the same rule for other start years: a game that starts in 2000 or 2050 is due 150 years later, whatever the calendar says", () => {
    for (const [start, first] of [[2000, 2150], [2050, 2200]] as const) {
      const { sim } = game(first); sim.startYear = start; expect(nextYear2200(sim)).toBe(first);
      sim.month = (first - 1 - start) * 12; expect(due2200(sim)).toBe(false); sim.month = (first - start) * 12; expect(due2200(sim)).toBe(true); expect(yearOf(sim)).toBe(first);
    }
  });
  it("fully unattended skips keep the origin; manual again waits for the next boundary counted from the start year (start 2000 -> 2150 skipped, 2300 next)", () => {
    const { w, sim } = game(2150); sim.startYear = 2000; setMode(sim, "auto"); sim.kaigen!.next = 9000;
    sim.month = (2149 - 2000) * 12 + 11; cross(sim, w, 3); expect(sim.relocSkipped).toEqual([2150]); expect(sim.relocFirst).toBe(2150); expect(nextYear2200(sim)).toBe(2300);
    setMode(sim, "priority"); cross(sim, w, 12); expect(sim.e2200).toBeUndefined();   // no catch-up of 2150
    const back = JSON.parse(JSON.stringify(sim)) as SimState; expect([back.startYear, back.relocFirst, back.relocSkipped, nextYear2200(back), due2200(back)]).toEqual([2000, 2150, [2150], 2300, false]);
    sim.month = (2299 - 2000) * 12 + 11; cross(sim, w, 3); expect(sim.e2200?.state).toBe("pending"); expect(sim.e2200?.sched).toBe(2300);
  });
  it("no double firing on the boundary: loading, switching mode and stepping the same month again open or skip it exactly once", () => {
    const { w, sim } = game(2100); setMode(sim, "priority"); eveOf(sim, 2100); cross(sim, w, 1); expect(sim.e2200).toBeUndefined();
    const copy = JSON.parse(JSON.stringify(sim)) as SimState; setMode(copy, "auto"); copy.kaigen!.next = 9000; cross(copy, w, 2); expect(copy.relocSkipped).toEqual([2100]); expect(copy.e2200).toBeUndefined();
    cross(copy, w, 2); expect(copy.relocSkipped).toEqual([2100]);   // once
    cross(sim, w, 2); expect(sim.e2200?.state).toBe("pending"); const hist = sim.e2200hist?.length ?? 0; const reload = JSON.parse(JSON.stringify(sim)) as SimState; expect(reload.e2200?.state).toBe("pending"); cross(reload, w, 5);
    expect([reload.e2200?.state, reload.e2200hist?.length ?? 0, reload.relocSkipped]).toEqual(["pending", hist, undefined]);
  });
  it("an older save without a recorded origin takes it from its own history on load: events -> its first boundary; none -> start + 150 with passed boundaries recorded as skipped", () => {
    const mk = (o: object) => ({ stage3: true, kaigen: {}, startYear: 2000, month: 0, ...o }) as any;
    const noEvents = mk({ month: (2320 - 2000) * 12 }); expect(adoptRelocSchedule(noEvents)).toBe(true); expect([noEvents.relocFirst, noEvents.relocSkipped, nextYear2200(noEvents)]).toEqual([2150, [2150, 2300], 2450]);
    const withEvents = mk({ month: (2400 - 2000) * 12, e2200: { year: 2300, n: 1, sched: 2300, state: "done" }, e2200hist: [{ year: 2150, n: 0, sched: 2150 }] }); expect(adoptRelocSchedule(withEvents)).toBe(true); expect([withEvents.relocFirst, nextYear2200(withEvents)]).toEqual([2150, 2450]);
    expect(due2200(noEvents)).toBe(false);
  });
});

describe("Stage 35 audit: a real seat move that lands on the same grid cell restarts that seat's reclamation (concern 1)", () => {
  /** a run of the first years with the real world; then a relocation that names the same prefecture and a point inside the same 5 km cell */
  const run = (choose: (sim: SimState, w: World) => Parameters<typeof apply2200>[1]) => {
    const { w, sim } = game(1956); setMode(sim, "priority"); cross(sim, w, 12 * 8); expect(sim.rec34!.sites.every((x) => x.active)).toBe(true);
    const cap0 = sim.rec34!.sites.find((x) => x.role === "capital")!, before = { start: cap0.start, filled: cap0.filled };
    cross(sim, w, 36); expect(sim.e2200?.state).toBe("pending"); const y = sim.e2200!.year;
    apply2200(sim, choose(sim, w)); close2200(sim); cross(sim, w, 24);   // two years on: the site list reflects the move
    return { sim, w, y, before };
  };
  const same = (sim: SimState, w: World) => { const c = w.cities.find((x) => x.pref === (sim.capital ?? "JP-13") && x.kind === "capital")!; return { era: 0, stance: "heisei" as const, coast: "neutral" as const, focus: "concentrate" as const, capital: c.pref!, capitalPos: [c.pos[0] + 0.4, c.pos[1] + 0.4] as [number, number] }; };
  it("choosing the capital's own city again with a point on the map is a move: the old site stops, a new one starts from zero", () => {
    const { sim, y } = run(same); const caps = sim.rec34!.sites.filter((x) => x.role === "capital");
    expect(caps.filter((x) => !x.active)).toHaveLength(1); const now = caps.find((x) => x.active)!; expect(now.start).toBeGreaterThanOrEqual(y); expect(now.filled).toBeLessThanOrEqual(1);
  });
  it("現状維持 (nothing chosen) keeps the running schedule: no new site", () => {
    const { sim, before } = run(() => null); const caps = sim.rec34!.sites.filter((x) => x.role === "capital"); expect(caps).toHaveLength(1); expect(caps[0].start).toBe(before.start); expect(caps[0].filled).toBeGreaterThanOrEqual(before.filled);
  });
  it("a relocation that does not move the capital (only the era) keeps the capital's schedule", () => {
    const { sim, before } = run((s, w) => ({ ...same(s, w), capitalPos: undefined }) as never); const caps = sim.rec34!.sites.filter((x) => x.role === "capital"); expect(caps).toHaveLength(1); expect(caps[0].start).toBe(before.start);
  });
});
