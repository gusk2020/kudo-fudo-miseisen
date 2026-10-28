import { describe, expect, test } from "vitest";
import { createSim, createSimGen, simHash, stepMonthGen } from "../../src/sim/engine";
import { SimRunner } from "../../src/sim/runner";
import { startedSim, testWorld } from "./simhelp";

describe("time-sliced simulation (Issue #7)", () => {
  test("pumping in tiny slices gives exactly the same state as running straight through", () => {
    const a = startedSim(41), b = startedSim(41); const r = new SimRunner(b.sim, b.w);
    for (let i = 0; i < 120; i++) { const g = stepMonthGen(a.sim, a.w); while (!g.next().done); }
    r.request(24); let guard = 0; while (b.sim.month < 120 && guard++ < 1e6) { if (r.pending < 5) r.request(24 - r.pending); r.pump(0.05); }
    r.settle(); expect(b.sim.month).toBeGreaterThanOrEqual(120);
    const c = startedSim(41); const g = new SimRunner(c.sim, c.w); g.request(24); while (c.sim.month < b.sim.month) { g.pump(100); if (g.pending < 1) g.request(1); } g.settle();
    expect(simHash(c.sim)).toBe(simHash(b.sim));
  });
  test("a year is split into many atoms, and a month never leaves the state half-saved", () => {
    const { sim, w } = startedSim(42); const g = stepMonthGen(sim, w); let atoms = 0; while (!g.next().done) atoms++;
    expect(atoms).toBeGreaterThanOrEqual(8);   // January carries the yearly work in several slices
    const r = new SimRunner(sim, w); r.request(3); r.pump(0.001); r.settle(); expect(r.idle).toBe(true);
  });
  test("the backlog is capped: a slow device falls behind instead of queuing work without limit", () => {
    const { sim, w } = startedSim(43); const r = new SimRunner(sim, w); r.request(1000); expect(r.pending).toBe(24); expect(r.dropped).toBeGreaterThan(900);
  });
  test("creating the 1950 network is sliced and reports progress; the sliced result equals the direct one", () => {
    const { w, hash } = testWorld(); const g = createSimGen(w, "m", hash, 44); let slices = 0, last = 0, sim; for (;;) { const r = g.next(); if (r.done) { sim = r.value; break; } slices++; expect(r.value).toBeGreaterThanOrEqual(0); last = r.value; }
    expect(slices).toBeGreaterThan(100); expect(last).toBeLessThanOrEqual(1); expect(simHash(sim)).toBe(simHash(createSim(w, "m", hash, 44)));
  });
  test("bounded growth: events, histories and stats stay capped over 150 years", () => {
    const { sim, w } = startedSim(45); const r = new SimRunner(sim, w); r.request(24); while (sim.month < 12 * 150) { if (r.pending < 12) r.request(12); r.pump(50); }
    expect(sim.events.length).toBeLessThanOrEqual(600); expect(sim.stats.length).toBeLessThanOrEqual(160); expect((sim as unknown as { snaps?: unknown }).snaps).toBeUndefined();   // Stage 26: no year-by-year snapshots
    for (const e of Object.values(sim.edges)) expect(e.hist.length).toBeLessThanOrEqual(41);
    expect(JSON.stringify(sim).length).toBeLessThan(2_500_000);
  });
});
