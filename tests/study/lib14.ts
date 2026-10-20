/** Stage 14: one game runner for the policy / seat / satellite studies. */
import { realToLonLat } from "../../src/core/data";
import { createSim, settleKaigen, stepMonth, yearOf } from "../../src/sim/engine";
import { autoResolve } from "../../src/sim/policy";
import { homeCity, performNational, previewNational, subCity } from "../../src/sim/ceremony";
import type { Vec } from "../../src/core/types";
import { realWorld, ridgeWorld } from "../unit/simhelp";
import { KANTO_RIDGE } from "./kanto";

export interface Run14 { seed: number; firstEra?: number; capital?: string; sub?: string; until: number; ridge?: boolean; seats14?: boolean; pop15?: boolean; towns?: boolean; hook?: (sim: ReturnType<typeof createSim>, w: ReturnType<typeof realWorld>["w"], y: number) => void }
export function run14(o: Run14) {
  const { w, hash } = o.ridge ? ridgeWorld({ ne: KANTO_RIDGE }, true, undefined, { lonLat: [139.0, 35.55], scale: 1.6 }) : realWorld(true, o.towns === false ? false : { capital: o.capital, sub: o.sub });
  const sim = createSim(w, "m", hash, o.seed, { stage3: true, firstEra: o.firstEra ?? 0, techK: 2, ...(o.capital ? { capital: o.capital } : {}), subCapital: o.sub ?? "JP-27", ...(o.seats14 === false ? { seats14: false } : {}), ...(o.pop15 === false ? { pop15: false } : {}) });
  const line = (a: Vec, b: Vec, n = 20): Vec[] => Array.from({ length: n + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n] as Vec);
  const p = previewNational(w, line(homeCity(w, sim.capital)!.pos, subCity(w, sim.subCapital)!.pos), sim.capital, sim.subCapital); if (!performNational(sim, w, p)) throw new Error("ceremony");
  sim.policy!.mode = "priority"; const t0 = Date.now();
  while (yearOf(sim) < o.until) { stepMonth(sim, w); if (sim.kaigen?.pending) { const i = sim.kaigen.pending.cands.findIndex((c) => c.stance === "heisei"); settleKaigen(sim, i >= 0 ? i : 0, true); } if (sim.policy?.pending) autoResolve(sim, w); if (o.hook && sim.month % 12 === 0) o.hook(sim, w, yearOf(sim)); }
  return { sim, w, wallS: (Date.now() - t0) / 1000 };
}
export const ll = (w: ReturnType<typeof realWorld>["w"], k: number) => realToLonLat(w.cellPos(k) as [number, number]).map((x) => +x.toFixed(2));
