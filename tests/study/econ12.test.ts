/** Stage 12: city economy study. STUDY=1 SCEN=base,... SEED=7 UNTIL=2100 OUT=dir npx vitest run tests/study/econ12.test.ts  -> per-5-year city populations and parts. */
import { mkdirSync, writeFileSync } from "node:fs";
import { describe, it } from "vitest";
import { settleKaigen, stepMonth, yearOf } from "../../src/sim/engine";
import { autoResolve } from "../../src/sim/policy";
import { realWorld, ridgeWorld, stage3Sim, stage3SimOn } from "../unit/simhelp";
import { KANTO_RIDGE } from "./issue30.test";
import { modeOf } from "../../src/sim/types";

export interface Sc { ridge?: boolean; fuji?: [number, number]; capital?: string; sub?: string; palace?: string; first?: number; dials?: Record<string, number> }
export const SC: Record<string, Sc> = {
  base: {}, ridge: { ridge: true }, fuji: { fuji: [138.2, 35.4] }, capSAP: { capital: "HK-SAP", sub: "JP-27" }, cap47: { capital: "JP-47", sub: "JP-27" }, palKyushu: { palace: "JP-40" }, palSap: { palace: "HK-SAP" }, road: { first: 1 }, rail: { first: 2 }, air: { first: 3 }, sea: { first: 4 },
};
export function runEcon(name: string, seed: number, until: number) {
  const sc = SC[name] ?? {}, first = sc.first ?? 0;
  const { sim, w } = sc.ridge || sc.fuji ? stage3SimOn(ridgeWorld(sc.ridge ? { ne: KANTO_RIDGE } : {}, true, undefined, sc.fuji ? { lonLat: sc.fuji, scale: 1.6 } : undefined), first, seed) : stage3Sim("heisei", seed, true, first, 2, true, sc.capital || sc.sub || sc.palace ? { capital: sc.capital, sub: sc.sub, palace: sc.palace } : undefined);
  if (process.env.NOECON) delete sim.econ;
  sim.policy!.mode = "priority"; const stance = ["heisei", "shubun", "shoka", "kuuro", "kairo"][first], rows: any[] = [], snap = () => rows.push({ y: yearOf(sim), pop: w.cities.map((c) => Math.round(sim.cities[c.id].pop)), ind: w.cities.map((c) => sim.cities[c.id].industry), p: w.cities.map((c) => sim.city12?.[c.id]?.p ?? []) });
  snap(); let t0 = Date.now();
  while (yearOf(sim) < until) {
    stepMonth(sim, w);
    if (sim.kaigen?.pending) { const i = sim.kaigen.pending.cands.findIndex((c) => c.stance === stance); settleKaigen(sim, i >= 0 ? i : 0, true); }
    if (sim.policy?.pending) autoResolve(sim, w);
    if (sim.month % 60 === 0 && rows[rows.length - 1].y !== yearOf(sim)) snap();
  }
  const live = Object.values(sim.edges).filter((e) => e.state === "open" && e.built >= 1 && e.facility !== "ferry");
  return { name, seed, cities: w.cities.map((c) => ({ id: c.id, name: c.name, pref: c.pref, pop0: c.pop0, coastal: c.coastal })), rows, roadKm: Math.round(live.filter((e) => modeOf(e) === "road").reduce((s, e) => s + e.lengthKm, 0)), railKm: Math.round(live.filter((e) => modeOf(e) === "rail").reduce((s, e) => s + e.lengthKm, 0)), wallS: (Date.now() - t0) / 1000 };
}
describe.skipIf(!process.env.STUDY)("econ12", () => {
  for (const name of (process.env.SCEN ?? "base").split(",")) it(name, () => {
    const r = runEcon(name, +(process.env.SEED ?? 7), +(process.env.UNTIL ?? 2100)); const out = process.env.OUT ?? "/tmp/claude-0/e12"; mkdirSync(out, { recursive: true }); writeFileSync(`${out}/${name}-${r.seed}.json`, JSON.stringify(r));
  }, 3_600_000);
});
