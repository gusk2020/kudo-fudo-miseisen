import { describe, it } from "vitest";
import { writeFileSync } from "node:fs";
import { advance, stepMonth } from "../../src/sim/engine";
import { modeOf, type SimState } from "../../src/sim/types";
import { resolveWindow, type Domain } from "../../src/sim/policy";
import { analyze } from "../../src/sim/demand";
import { stage3Sim } from "./simhelp";

/** Quantitative comparison harness (Issue #13). Runs only with SENS=1; prints/records the network at 25-year marks. */
export function metrics(sim: SimState, w?: any) {
  const E = Object.values(sim.edges).filter((e) => e.built >= 1);
  const open = E.filter((e) => e.state === "open"), sum = (a: typeof E, f: (e: (typeof E)[0]) => number) => Math.round(a.reduce((s, e) => s + f(e), 0));
  const road = open.filter((e) => modeOf(e) === "road"), rail = open.filter((e) => modeOf(e) === "rail");
  const rteGrade = new Map<string, string>(); for (const r of Object.values(sim.routes)) if (r.active) for (const x of r.edges) rteGrade.set(x.edgeId, r.grade);
  const local = (e: (typeof E)[0]) => e.standard === "rural" || rteGrade.get(e.id) === "ken" || rteGrade.get(e.id) === "priv";
  const pk = (a: typeof E) => a.reduce((s, e) => s + (e.through + e.local) * e.lengthKm, 0), fk = (a: typeof E) => a.reduce((s, e) => s + e.freight * e.lengthKm, 0);
  const pr = pk(road), pl = pk(rail), fr = fk(road), fl = fk(rail);
  let villIso = 0, villTot = 0, townRail = 0, towns = 0, townRoadMin = 0;
  if (w) {
    const an = analyze(sim, w), railNodes = new Set<string>(); for (const e of rail) { railNodes.add(e.a); railNodes.add(e.b); }
    for (const v of Object.values(sim.settlements)) if (!v.gone) { villTot++; if (an.reach.get(v.id) === false) villIso++; }
    const byCell = new Map<number, string>(); for (const n of Object.values(sim.nodes)) byCell.set(n.cell, n.id);
    w.cities.forEach((c: any, i: number) => { if (sim.cities[c.id].pop >= 150000) return; towns++; const nid = byCell.get(c.cell); if (nid && railNodes.has(nid)) townRail++; let best = Infinity; for (let j = 0; j < w.cities.length; j++) if (j !== i && sim.cities[w.cities[j].id].pop >= 500000) best = Math.min(best, an.T[i * w.cities.length + j]); if (isFinite(best)) townRoadMin += best; });
  }
  return {
    villIso, villTot, townRail, towns, townHoursToMetro: towns ? +(townRoadMin / towns).toFixed(2) : 0,
    roadKm: sum(road, (e) => e.lengthKm), railKm: sum(rail, (e) => e.lengthKm), hwyKm: sum(road.filter((e) => e.standard === "highgrade"), (e) => e.lengthKm),
    localRoadKm: sum(road.filter(local), (e) => e.lengthKm), localRailKm: sum(rail.filter(local), (e) => e.lengthKm),
    lostKm: sum(E.filter((e) => e.state === "lost" || e.state === "closed"), (e) => e.lengthKm), dormantKm: sum(E.filter((e) => e.state === "dormant"), (e) => e.lengthKm),
    railShareP: +(pl / Math.max(1, pr + pl)).toFixed(3), railShareF: +(fl / Math.max(1, fr + fl)).toFixed(3),
    newRoadKm: sum(E.filter((e) => modeOf(e) === "road" && (e.builtMonth ?? 0) > 0), (e) => e.lengthKm), newRailKm: sum(E.filter((e) => modeOf(e) === "rail" && (e.builtMonth ?? 0) > 0), (e) => e.lengthKm),
  };
}
export function trajectory(era: "heisei" | "shubun" | "shoka", seed: number, hook?: (sim: SimState, w: any) => void) {
  const { sim, w } = stage3Sim(era, seed); sim.speed = 0; const out: Record<number, ReturnType<typeof metrics>> = {};
  hook?.(sim, w);
  for (let y = 1950; y <= 2100; y += 25) { if (y > 1950) advance(sim, w, 25 * 12); out[y] = metrics(sim, w); }
  return out;
}
type PolV = "auto" | "none" | Domain;
/** Like advance(), but every ten-yearly window is answered the same fixed way (so policy variants can be compared with the era held still). */
export function runPolicy(era: "heisei" | "shubun" | "shoka", seed: number, pol: PolV, to = 2100, setup?: (sim: SimState, w: any) => void) {
  const { sim, w } = stage3Sim(era, seed); sim.speed = 0; setup?.(sim, w); const out: Record<number, ReturnType<typeof metrics>> = {};
  for (let y = 1950; y <= to; y += 25) {
    if (y > 1950) for (let i = 0; i < 25 * 12; i++) { stepMonth(sim, w); if (sim.policy?.pending) { if (pol === "none") sim.policy.pending = null; else if (pol === "auto") (require_autoResolve(sim, w)); else resolveWindow(sim, w, pol, {}); stepMonth(sim, w); } }
    out[y] = metrics(sim, w);
  }
  return out;
}
import { autoResolve as require_autoResolve } from "../../src/sim/policy";
const spread = (vals: number[]) => { const m = vals.reduce((a, b) => a + b, 0) / vals.length; return m ? (Math.max(...vals) - Math.min(...vals)) / m : 0; };
export function sensitivity(eraRuns: Record<string, any>, polRuns: Record<string, any>) {
  const keys = ["roadKm", "railKm", "localRoadKm", "localRailKm", "lostKm", "railShareP", "newRoadKm", "newRailKm"], rows: any[] = [];
  for (const y of [2000, 2050, 2100]) for (const k of keys) rows.push({ year: y, metric: k, era: +spread(Object.values(eraRuns).map((r: any) => r[y][k])).toFixed(3), policy: +spread(Object.values(polRuns).map((r: any) => r[y][k])).toFixed(3) });
  const avg = (f: (r: any) => number) => +(rows.reduce((s, r) => s + f(r), 0) / rows.length).toFixed(3);
  return { rows, meanEra: avg((r) => r.era), meanPolicy: avg((r) => r.policy) };
}
describe.skipIf(!process.env.SENS)("sensitivity-compare", () => {
  it("era vs policy", () => {
    const eraRuns: any = {}, polRuns: any = {};
    for (const era of ["heisei", "shubun", "shoka"] as const) eraRuns[era] = runPolicy(era, 7, "auto");
    for (const pol of ["none", "politics", "economy", "opinion"] as PolV[]) polRuns[pol] = runPolicy("heisei", 7, pol);
    const s = sensitivity(eraRuns, polRuns); console.log("MEAN era", s.meanEra, "policy", s.meanPolicy); for (const r of s.rows) console.log(JSON.stringify(r));
    writeFileSync(process.env.SENS_OUT2 ?? "/tmp/sens-compare.json", JSON.stringify({ s, eraRuns, polRuns }, null, 1));
  }, 3_000_000);
});
describe.skipIf(!process.env.SENS)("sensitivity", () => {
  it("baseline eras", () => {
    const res: any = {};
    for (const era of ["heisei", "shubun", "shoka"] as const) { res[era] = trajectory(era, 7); console.log(era, JSON.stringify(res[era])); }
    writeFileSync(process.env.SENS_OUT ?? "/tmp/sens-baseline.json", JSON.stringify(res, null, 1));
  }, 1_800_000);
});
