import { describe, expect, it } from "vitest";
import { advance, settleKaigen, stepMonth, yearOf } from "../../src/sim/engine";
import { autoResolve, resolveWindow } from "../../src/sim/policy";
import { prepareDecisionLoad, setDecisionSink, type DecisionPoint } from "../../src/sim/decision41";
import { sanitizeSim } from "../../src/core/save2";
import { waiting2200 } from "../../src/sim/event2200";
import { CP_DECISION_MAX, cpKey, planPrune, readIndex, writeCheckpoint, type CpEntry, type CpStore } from "../../src/sim/checkpoint";
import type { SimState } from "../../src/sim/types";
import { stage3Sim } from "./simhelp";

/** Stage 41: a save point just BEFORE a decision the game takes by itself. Loading it brings the decision back; the same choice reproduces the game that never stopped, another choice is another history, and nothing is applied twice. */
const sig = (s: SimState) => JSON.stringify([Object.keys(s.cities).sort().map((k) => [k, s.cities[k].pop]), Object.keys(s.routes).length, Object.keys(s.projects).length, Object.keys(s.edges).length, s.rngState, s.policy?.history.length, s.kaigen?.eras.map((e) => e.name), s.capital, s.subCapital]);
const game = () => stage3Sim("heisei", 7, true, 0, 2, true, undefined, undefined, { start1800: true } as never);
function capture(kind: DecisionPoint["kind"], untilYear: number) {
  const { sim, w } = game(), got: DecisionPoint[] = []; sim.policy!.mode = "auto"; setDecisionSink((d) => got.push(d));
  try { advance(sim, w, 12 * (untilYear - yearOf(sim))); } finally { setDecisionSink(null); }
  const d = got.find((x) => x.kind === kind); return { sim, w, d, all: got };
}
describe("Stage 41: 判断直前 save points", () => {
  it("nothing is captured unless the app registered a sink, and a captured copy is never the live game", () => {
    const { sim, w } = game(); sim.policy!.mode = "auto"; advance(sim, w, 12 * 15); const { d, all, sim: live } = capture("policy", 1815);
    expect(all.length).toBeGreaterThan(0); expect(d!.sim).not.toBe(live); expect(yearOf(live)).toBe(yearOf(sim)); expect(sig(sim), "the same game with and without a sink").toBe(sig(live));
  }, 900000);
  it("policy window: the copy waits at the open window; loaded, time stands still until the choice is made, then the automatic mode returns; the same choice = the game that never stopped; another choice = another history", () => {
    const { sim: live, w, d } = capture("policy", 1815); expect(d, "a policy window was captured").toBeTruthy(); const y0 = d!.year; expect(d!.sim.policy!.pending).toEqual({ year: y0, domain: null }); expect(d!.sim.policy!.mode).toBe("auto");
    const neverStopped = sig(live); const raw = JSON.parse(JSON.stringify(d!.sim)), back = sanitizeSim(raw).sim!; expect(back.policy!.pending, "the loaded game still waits at the window").not.toBeNull();
    expect(prepareDecisionLoad(back)).toBe(true); expect(back.policy!.mode).toBe("priority"); expect(back.resumeMode).toBe("auto");
    const m = back.month; for (let i = 0; i < 24; i++) stepMonth(back, w); expect(back.month, "time stands still while the decision is open").toBe(m);   // (the app's clock steps like this; advance() is the fast-forward of tests and tools, which resolves an open window by itself)
    // the same choice as the automatic one
    const chosen = autoResolve(back, w)!; expect(back.policy!.pending).toBeNull(); stepMonth(back, w); expect(back.resumeMode, "the automatic mode is back").toBeUndefined(); expect(back.policy!.mode).toBe("auto");
    advance(back, w, live.month - back.month); expect(sig(back), "the same choice reproduces the game that never stopped").toBe(neverStopped);
    // another choice
    const other = sanitizeSim(JSON.parse(JSON.stringify(d!.sim))).sim!; prepareDecisionLoad(other); const dom = (["politics", "economy", "opinion"] as const).find((x) => x !== chosen.domain)!; resolveWindow(other, w, dom, {}, true);
    advance(other, w, live.month - other.month); expect(other.policy!.history.at(-1)!.domain, "another domain was chosen").not.toBe(chosen.domain); const rec = live.policy!.history.find((h) => h.year === y0); expect(rec, "the game that never stopped recorded its choice").toBeTruthy(); expect(JSON.stringify(other.policy!.history.at(-1)), "another record in the history").not.toBe(JSON.stringify(rec));   // (an adoption that spends nothing leaves the world as it was; what differs is what was decided, kept in the record)
  }, 1800000);
  it("era change: the copy has the choice open; the first candidate (what the automatic mode takes) reproduces the game, another one gives another era", () => {
    const { sim: live, w, d } = capture("kaigen", 1845); expect(d, "an era change was captured").toBeTruthy(); const neverStopped = sig(live); expect(d!.sim.kaigen!.pending!.cands.length).toBeGreaterThan(1);
    const a = sanitizeSim(JSON.parse(JSON.stringify(d!.sim))).sim!; prepareDecisionLoad(a); expect(a.kaigen!.pending).not.toBeNull(); settleKaigen(a, 0, true); advance(a, w, live.month - a.month); expect(sig(a)).toBe(neverStopped);
    const b = sanitizeSim(JSON.parse(JSON.stringify(d!.sim))).sim!; prepareDecisionLoad(b); const first = b.kaigen!.pending!.cands[0].name, second = b.kaigen!.pending!.cands[1].name; settleKaigen(b, 1, false); expect(b.kaigen!.eras.at(-1)!.name).toBe(second); expect(second).not.toBe(first);
    advance(b, w, 12); expect(b.policy!.mode, "the automatic mode comes back after the choice").toBe("auto");
  }, 1800000);
  it("relocation (1900): the copy has the event open and waits for the seats; the loaded game does not apply it twice", () => {
    const { w, d } = capture("reloc", 1902); expect(d, "the 1900 relocation was captured").toBeTruthy(); expect(d!.sim.e2200?.state).toBe("pending"); expect(d!.sim.e2200?.sched).toBe(1900);
    const a = sanitizeSim(JSON.parse(JSON.stringify(d!.sim))).sim!; prepareDecisionLoad(a); expect(waiting2200(a)).toBe(true); const m = a.month; advance(a, w, 12); expect(a.month, "time stands still at the open event").toBe(m); expect((a.e2200hist ?? []).length, "not applied yet").toBe(0);
  }, 1800000);
  it("storage: a decision entry has a key of its own, is read back from the index, and only the newest CP_DECISION_MAX are kept without touching the 50-year saves", async () => {
    const mem = new Map<string, Uint8Array | string>(), store: CpStore = { put: async (k, v) => void mem.set(k, v), get: async (k) => mem.get(k), del: async (k) => void mem.delete(k), keys: async () => [...mem.keys()] };
    expect(cpKey({ kind: "decision", year: 1810, dk: "policy" })).not.toBe(cpKey({ kind: "decision", year: 1810, dk: "kaigen" })); expect(cpKey({ kind: "decision", year: 1810, dk: "policy" })).not.toBe(cpKey({ kind: "50y", year: 1810 }));
    for (const y of [1800, 1850]) { const r = await writeCheckpoint(store, "{}", { kind: "50y", year: y }, { capital: "a", sub: "b" }, 1000 + y); expect(r.ok).toBe(true); }
    for (let i = 0; i < 5; i++) { const r = await writeCheckpoint(store, "{}", { kind: "decision", year: 1810 + 10 * i, dk: "policy" }, { capital: "a", sub: "b" }, 5000 + i); expect(r.ok).toBe(true); }
    const idx = await readIndex(store); expect(idx.filter((e) => e.kind === "decision").length, "only the newest are kept").toBe(CP_DECISION_MAX); expect(idx.filter((e) => e.kind === "50y").length, "the 50-year saves are untouched").toBe(2);
    expect(idx.filter((e) => e.kind === "decision").map((e) => e.year).sort()).toEqual([1830, 1840, 1850]); const e = idx.find((x) => x.kind === "decision")!; expect(e.dk).toBe("policy"); void (null as unknown as CpEntry); void planPrune;
  });
});
