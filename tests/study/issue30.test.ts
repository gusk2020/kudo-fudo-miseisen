/**
 * Stage 12 (Issue #30): where do routes and cities go when a range and Fuji stand in the Kanto plain?
 *   STUDY=1 SCEN=kanto,none SEED=7 UNTIL=2110 OUT=/tmp/x npx vitest run tests/study/issue30.test.ts
 * Every edge is classified the first time it is seen (its cells against w.t.barrier), so seed network, new lines, bypasses, ports' access lines and
 * facilities are all counted by the same rule.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { describe, it } from "vitest";
import { stepMonth, yearOf, settleKaigen } from "../../src/sim/engine";
import { autoResolve } from "../../src/sim/policy";
import { modeOf } from "../../src/sim/types";
import { MTN_RIDGE_MIN, mountainBarrier } from "../../src/sim/world";
import { realWorld, ridgeWorld, stage3SimOn } from "../unit/simhelp";

import { KANTO_ALPS_SW, KANTO_RIDGE } from "./kanto";
const worldOf = (name: string) => name === "fuji" ? ridgeWorld({}, true, undefined, { lonLat: [139.0, 35.55], scale: 1.6 }) : name === "none" ? ridgeWorld({}, true) : name === "kanto" ? ridgeWorld({ ne: KANTO_RIDGE }, true, undefined, { lonLat: [139.0, 35.55], scale: 1.6 }) : name === "ridge" ? ridgeWorld({ ne: KANTO_RIDGE }, true) : name === "two" ? ridgeWorld({ ne: KANTO_RIDGE, sw: KANTO_ALPS_SW }, true, undefined, { lonLat: [139.0, 35.55], scale: 1.6 }) : realWorld(true);
export function run(name: string, seed: number, until: number, first = 0) {
  const base = worldOf(name), { sim, w } = stage3SimOn(base, first, seed); sim.policy!.mode = "priority";
  const seen = new Set<string>(), rows: any[] = [], t = w.t;
  const classify = (year: number) => {
    for (const e of Object.values(sim.edges)) if (!seen.has(e.id)) {
      seen.add(e.id); let inB = 0, hard = 0, mx = 0; for (const k of e.cells) { const b = t.barrier[k]; if (b > MTN_RIDGE_MIN) inB++; const mb = mountainBarrier(b, t.elev[k]); if (mb >= 5) hard++; if (mb > mx) mx = mb; }
      const pr = Object.values(sim.projects).find((q) => q.edgeIds.includes(e.id)), na = sim.nodes[e.a], nb = sim.nodes[e.b]; rows.push({ id: e.id, year, pk: pr ? pr.kind + (pr.reason.startsWith("【") ? ":local" : "") : "seed/other", rs: pr?.reason.slice(0, 30) ?? "", a: na?.name ?? na?.kind ?? "", b: nb?.name ?? nb?.kind ?? "", reg: e.region, bypass: e.bypassOf.length > 0, mode: modeOf(e), std: e.standard, fac: e.facility ?? "", maglev: !!e.maglev, km: e.lengthKm, n: e.cells.length, inB, hard, hardOpen: e.facility === "tunnel" ? 0 : hard, mx: Math.round(mx * 10) / 10 });
    }
  };
  classify(1950);
  const seedCells = { road: new Set<number>(), rail: new Set<number>() }; for (const e of Object.values(sim.edges)) if (e.built >= 1 && e.facility !== "ferry") for (const k of e.cells) seedCells[modeOf(e)].add(k); const stance = ["heisei", "shubun", "shoka", "kuuro", "kairo"][first]; const pops: any[] = [];
  const snap = () => { const o: Record<string, number> = {}; for (const c of w.cities) o[c.id] = Math.round(sim.cities[c.id].pop); pops.push({ year: yearOf(sim), o }); }; snap();
  while (yearOf(sim) < until) {
    stepMonth(sim, w);
    if (sim.kaigen?.pending) { const i = sim.kaigen.pending.cands.findIndex((c) => c.stance === stance); settleKaigen(sim, i >= 0 ? i : 0, true); }
    if (sim.policy?.pending) autoResolve(sim, w);
    if (sim.month % 12 === 0) { classify(yearOf(sim)); if (yearOf(sim) % 10 === 0) snap(); }
  }
  // physical truth, independent of how edges were split: the cells the open network covers at the end, new against the 1950 network
  const occ: Record<string, number> = {}; const add = (key: string) => { occ[key] = (occ[key] ?? 0) + 5; };
  const seen2 = { road: new Set<number>(), rail: new Set<number>() };
  for (const e of Object.values(sim.edges)) if (e.built >= 1 && e.state === "open" && e.facility !== "ferry") for (const k of e.cells) {
    const m = modeOf(e); if (seen2[m].has(k)) continue; seen2[m].add(k); const b = t.barrier[k], h = mountainBarrier(b, t.elev[k]), tag = seedCells[m].has(k) ? "old" : "new";
    add(`${m}.${tag}.all`); if (b > MTN_RIDGE_MIN) add(`${m}.${tag}.inB`); if (b > 0.5) add(`${m}.${tag}.core`); if (h >= 5) add(`${m}.${tag}.${e.facility === "tunnel" ? "hardTunnel" : "hardOpen"}`);
  }
  const cities = w.cities.map((c) => ({ id: c.id, name: c.name, pref: c.pref, b: Math.round(t.barrier[c.cell] * 100) / 100, elev: Math.round(t.elev[c.cell]), pop0: c.pop0 }));
  return { name, seed, occ, rows, pops, cities, ends: Object.values(sim.edges).filter((e) => e.built >= 1).map((e) => ({ id: e.id, state: e.state, inB: e.cells.filter((k) => t.barrier[k] > MTN_RIDGE_MIN).length, km: e.lengthKm, mode: modeOf(e), std: e.standard, fac: e.facility ?? "" })) };
}
describe.skipIf(!process.env.STUDY)("issue30", () => {
  for (const name of (process.env.SCEN ?? "kanto").split(",")) it(name, () => {
    const r = run(name, +(process.env.SEED ?? 7), +(process.env.UNTIL ?? 2110)); const out = process.env.OUT ?? "/tmp/claude-0/i30"; mkdirSync(out, { recursive: true }); writeFileSync(`${out}/${name}-${r.seed}.json`, JSON.stringify(r));
  }, 3_600_000);
});
