import { describe, expect, it } from "vitest";
import { analyze, localRailFactor } from "../../src/sim/demand";
import { DIAL_KEYS, DIAL_RANGE, POLICY_CAP, composeDials } from "../../src/sim/eras";
import { advance, settleKaigen, stepMonth, yearOf } from "../../src/sim/engine";
import { FROZEN_TAG, reviewWorks } from "../../src/sim/freeze";
import { CAND_1945, eraWeights, newKaigen, openKaigen, chooseEra } from "../../src/sim/kaigen";
import { autoResolve } from "../../src/sim/policy";
import { DEFICIT_DENS, DEFICIT_YEARS_PRIV, reviewRailLines } from "../../src/sim/railecon";
import { modeOf, type SimState } from "../../src/sim/types";
import type { World } from "../../src/sim/world";
import { stage3Sim } from "./simhelp";

describe("Stage 7: village trips are split between train and car", () => {
  it("the railway's share of village trips falls as the car is preferred, never to zero, and stays bounded", () => {
    const f = (car: number, rail: number) => localRailFactor({ carBias: car, railBias: rail });
    expect(f(-0.4, 0.45)).toBeGreaterThan(1); expect(f(1.6, 0.05)).toBeLessThan(0.4); expect(f(2, -0.4)).toBeGreaterThanOrEqual(0.15);
    for (let c = -1; c < 2; c += 0.25) expect(f(c + 0.25, 0.2)).toBeLessThanOrEqual(f(c, 0.2));
    expect(f(-1, 1.5)).toBeLessThanOrEqual(1.4);
  });
});

describe("Stage 7: loss-making lines are given up by their operator", () => {
  const thin = (sim: SimState, w: World, op: string) => {
    const r = Object.values(sim.routes).filter((x) => x.active && modeOf(x) === "rail" && x.edges.every((e) => sim.edges[e.edgeId]?.standard !== "highgrade")).sort((a, b) => (a.id < b.id ? -1 : 1))[0];
    if (!sim.operators[op]) sim.operators[op] = { id: op, name: "テスト鉄道", kind: op === "jnr" ? "jnr" : "private", since: 1950, note: "" };
    r.op = op; for (const x of r.edges) { const e = sim.edges[x.edgeId]; e.op = op; } void w; return r;
  };
  const starve = (sim: SimState, r: ReturnType<typeof thin>) => { for (const x of r.edges) { const e = sim.edges[x.edgeId]; e.through = 50; e.local = 50; e.freight = 0; } };
  it("a private line under the density closes after its loss years, with the reason; a busy one does not", () => {
    const { sim, w } = stage3Sim("heisei", 7, false, 0, 2, true); analyze(sim, w); sim.dials.railBias = 0; sim.dials.jnrSubsidy = 0.2;
    const r = thin(sim, w, "p.test");
    for (let i = 0; i < DEFICIT_YEARS_PRIV - 1; i++) { starve(sim, r); reviewRailLines(sim, w, 1960 + i); expect(r.active).toBe(true); }
    starve(sim, r); expect(reviewRailLines(sim, w, 1970)).toBeGreaterThan(0);
    expect(r.edges.every((x) => sim.edges[x.edgeId].state === "closed")).toBe(true); expect(r.active).toBe(false);
    expect(sim.edges[r.edges[0].edgeId].hist.some((h) => h.t.includes("輸送密度"))).toBe(true);
    expect(DEFICIT_DENS).toBeGreaterThan(1000);
  });
  it("the national railway keeps the same line while the state still subsidises it; a rail-minded world shields a private one", () => {
    const { sim, w } = stage3Sim("heisei", 7, false, 0, 2, true); analyze(sim, w); sim.dials.jnrSubsidy = 0.75;
    const r = thin(sim, w, "jnr"); for (let i = 0; i < 15; i++) { starve(sim, r); reviewRailLines(sim, w, 1960 + i); } expect(r.active).toBe(true);
    const b = stage3Sim("heisei", 7, false, 0, 2, true); analyze(b.sim, b.w); b.sim.dials.railBias = 0.6;
    const q = thin(b.sim, b.w, "p.test"); for (const x of q.edges) { const e = b.sim.edges[x.edgeId]; e.through = 900; e.local = 600; }   // 1500: under the line, but above half of it
    for (let i = 0; i < 10; i++) reviewRailLines(b.sim, b.w, 1960 + i); expect(q.active).toBe(true);
  });
});

describe("Stage 7: era direction accumulates; policy steers within it", () => {
  it("each era weighs by its years, the current one double; a 44-year first era still carries about a fifth in 2100", () => {
    const k = newKaigen(CAND_1945[1], 1, 7); openKaigen(k, 1989); chooseEra(k, 0, 7); openKaigen(k, 2019); chooseEra(k, 0, 7);
    const w95 = eraWeights(k.eras, 1995), w2100 = eraWeights(k.eras, 2100);
    expect(w95[0]).toBeGreaterThan(0.75); expect(w95[1]).toBeGreaterThan(0.1);
    expect(w2100[0]).toBeGreaterThan(0.15); expect(w2100[0]).toBeLessThan(0.3); expect(w2100[2]).toBeGreaterThan(w2100[0]);
    expect(eraWeights(k.eras, 1989)).toEqual([1, 0, 0]);
  });
  it("however many policies are in force, a dial moves at most POLICY_CAP of its range; events are not capped", () => {
    const base = composeDials({ era: "heisei", mods: [], kaigen: undefined } as never, 1970);
    const mods = Array.from({ length: 6 }, (_, i) => ({ id: "m" + i, kind: "policy" as const, label: "", from: 1960, until: 1980, d: { hwyBuild: 0.2, carBias: 0.3 } }));
    const d = composeDials({ era: "heisei", mods, kaigen: undefined } as never, 1970);
    expect(d.hwyBuild - base.hwyBuild).toBeCloseTo(POLICY_CAP * (DIAL_RANGE.hwyBuild[1] - DIAL_RANGE.hwyBuild[0]), 9);
    const e = composeDials({ era: "heisei", mods: [{ id: "e", kind: "event", label: "", from: 1960, until: 1980, d: { hwyBuild: 0.5 } }], kaigen: undefined } as never, 1970);
    expect(e.hwyBuild - base.hwyBuild).toBeCloseTo(Math.min(0.5, DIAL_RANGE.hwyBuild[1] - base.hwyBuild), 9); void DIAL_KEYS;
  });
});

describe("Stage 7: works are frozen by a change of course and resumed when it comes back", () => {
  it("a sharp fall in the appetite suspends the least urgent unfinished new works, tagged; a recovery resumes them", () => {
    const { sim, w } = stage3Sim("heisei", 7, false, 0, 2, true); let guard = 0;
    while (!Object.values(sim.projects).some((p) => modeOf(p) === "road" && (p.kind === "new" || p.kind === "bypass") && (p.status === "planned" || p.status === "building") && p.spentBu < 0.7 * p.costBu) && guard++ < 40) advance(sim, w, 12);
    const before = Object.values(sim.projects).filter((p) => p.status === "suspended").length;
    sim.mods.push({ id: "cut", kind: "event", label: "テスト", from: yearOf(sim), until: yearOf(sim) + 1, d: { hwyBuild: -0.5 } }); sim.dials = composeDials(sim, yearOf(sim));
    const r = reviewWorks(sim); expect(r.frozen).toBeGreaterThan(0);
    const frozen = Object.values(sim.projects).filter((p) => p.status === "suspended" && p.reason.includes(FROZEN_TAG)); expect(frozen.length).toBeGreaterThan(0); expect(frozen.length).toBeGreaterThan(before - 1);
    sim.mods = sim.mods.filter((m) => m.id !== "cut"); sim.mods.push({ id: "up", kind: "event", label: "", from: yearOf(sim), until: yearOf(sim) + 5, d: { hwyBuild: 0.6 } }); sim.dials = composeDials(sim, yearOf(sim));
    expect(reviewWorks(sim).resumed).toBeGreaterThan(0); expect(frozen.some((p) => p.status === "planned")).toBe(true); void w;
  });
});

describe("Stage 7: the world lines differ in the network itself, not only in the shares (quantified, 1950-2030)", () => {
  const memo = new Map<string, { sim: SimState; w: World }>();
  const run = (first: number, later: "same" | "first", y1 = 2030) => {
    const key = `${first}:${later}:${y1}`; if (memo.has(key)) return memo.get(key)!;
    const { sim, w } = stage3Sim("heisei", 7, true, first, 2, true, undefined, undefined, { pop15: false }); sim.policy!.mode = "priority"; const stance = ["heisei", "shubun", "shoka"][first];
    while (yearOf(sim) < y1) { stepMonth(sim, w); if (sim.kaigen?.pending) { const i = later === "first" ? 0 : sim.kaigen.pending.cands.findIndex((c) => c.stance === stance); settleKaigen(sim, Math.max(0, i), true); } if (sim.policy?.pending) autoResolve(sim, w); }
    memo.set(key, { sim, w }); return { sim, w };
  };
  const railKm = (s: SimState) => Object.values(s.edges).filter((e) => modeOf(e) === "rail" && e.state === "open" && e.built >= 1 && e.facility !== "ferry").reduce((t, e) => t + e.lengthKm, 0);
  const closedRail = (s: SimState) => Object.values(s.edges).filter((e) => modeOf(e) === "rail" && e.built >= 1 && (e.state === "closed" || e.state === "lost")).reduce((t, e) => t + e.lengthKm, 0);
  const paxRail = (s: SimState, w: World) => { analyze(s, w); let r = 0, d = 0; for (const e of Object.values(s.edges)) { if (e.state !== "open" || e.built < 1 || e.facility === "ferry") continue; if (modeOf(e) === "rail") r += (e.through / 2 + e.local) * e.lengthKm; else d += (e.through + e.local) * e.lengthKm; } return r / (r + d); };
  it("a road-minded world keeps far less railway than a rail-minded one and closes more of it", () => {
    const S = run(1, "same"), R = run(2, "same");
    expect(railKm(S.sim)).toBeLessThan(railKm(R.sim) * 0.7); expect(closedRail(S.sim)).toBeGreaterThan(closedRail(R.sim) * 1.3);
    expect(Object.values(S.sim.routes).some((r) => r.history.some((h) => h.text === "赤字のため廃止"))).toBe(true);
  }, 300000);
  it("the first era's direction still shows in 2030 after two real-name era changes (平成, 令和) were taken", () => {
    const S = run(1, "first"), R = run(2, "first");
    expect(paxRail(S.sim, S.w) + 0.15).toBeLessThan(paxRail(R.sim, R.w)); expect(railKm(S.sim)).toBeLessThan(railKm(R.sim));
  }, 300000);
});

describe("Stage 7: saves", () => {
  it("a game with the new fields survives a JSON round trip and keeps running identically; a save without them (older) still loads", async () => {
    const { sanitizeSim } = await import("../../src/core/save2"); const { simHash } = await import("../../src/sim/engine");
    const { sim, w } = stage3Sim("heisei", 7, true, 1, 2, true); advance(sim, w, 12 * 25);
    expect(sim.regionSlack && Object.keys(sim.regionSlack).length).toBeGreaterThan(0);
    const copy = sanitizeSim(JSON.parse(JSON.stringify(sim))).sim!; expect(copy).toBeTruthy(); expect(simHash(copy)).toBe(simHash(sim));
    advance(sim, w, 24); advance(copy, w, 24); expect(simHash(copy)).toBe(simHash(sim));
    const old = JSON.parse(JSON.stringify(sim)); delete old.regionSlack; for (const r of Object.values(old.routes) as any[]) delete r.deficitYears;
    const o = sanitizeSim(old).sim!; expect(o).toBeTruthy(); advance(o, w, 24); expect(o.regionSlack).toBeTruthy();
    const bad = JSON.parse(JSON.stringify(sim)); bad.regionSlack = "x"; expect(sanitizeSim(bad).sim!.regionSlack).toBeUndefined();
  }, 300000);
});
