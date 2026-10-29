/** Stage 14: one game runner for the policy / seat / satellite studies. */
import { apply2200, close2200, type Choice2200 } from "../../src/sim/event2200";
import type { SeatMove } from "../../src/sim/seatmove20";
import { realToLonLat } from "../../src/core/data";
import { createSim, settleKaigen, stepMonth, yearOf } from "../../src/sim/engine";
import { autoResolve } from "../../src/sim/policy";
import { homeCity, performNational, previewNational, subCity } from "../../src/sim/ceremony";
import type { Vec } from "../../src/core/types";
import { realWorld, ridgeWorld } from "../unit/simhelp";
import { KANTO_RIDGE } from "./kanto";

export interface Run14 { /** Stage 28: the first relocation year (2100 for a new game; absent = the older 2200) */ relocFirst?: number; seed: number; firstEra?: number; capital?: string; sub?: string; until: number; ridge?: boolean; seats14?: boolean; pop15?: boolean; towns?: boolean; pot17?: boolean; islets?: boolean; moves?: SeatMove[]; capPos?: Vec; subPos?: Vec; lib?: boolean; e2200?: Choice2200; /** Stage 25: the choice at the n-th relocation event (null = keep) */ choose?: (n: number, sim: ReturnType<typeof createSim>) => Choice2200 | null; /** Stage 25: called right after the choice was applied */ applied?: (n: number, sim: ReturnType<typeof createSim>) => void; hook?: (sim: ReturnType<typeof createSim>, w: ReturnType<typeof realWorld>["w"], y: number) => void }
export function run14(o: Run14) {
  const { w, hash } = o.ridge ? ridgeWorld({ ne: KANTO_RIDGE }, true, undefined, { lonLat: [139.0, 35.55], scale: 1.6 }) : realWorld(true, o.towns === false ? false : { capital: o.capital, sub: o.sub }, o.islets ? 2 : false, o.moves ?? []);
  const sim = createSim(w, "m", hash, o.seed, { stage3: true, ...(o.relocFirst ? { relocFirst: o.relocFirst } : {}), firstEra: o.firstEra ?? 0, techK: 2, ...(o.capital ? { capital: o.capital } : {}), subCapital: o.sub ?? "JP-27", ...(o.seats14 === false ? { seats14: false } : {}), ...(o.pot17 === false ? { pot17: false } : {}), ...(o.pop15 === false ? { pop15: false } : {}), ...(o.moves ? { moves: o.moves } : {}), ...(o.capPos ? { capitalPos: o.capPos } : {}), ...(o.subPos ? { subPos: o.subPos } : {}) });
  const line = (a: Vec, b: Vec, n = 20): Vec[] => Array.from({ length: n + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n] as Vec);
  const p = previewNational(w, line(homeCity(w, sim.capital)!.pos, subCity(w, sim.subCapital)!.pos), sim.capital, sim.subCapital); if (!performNational(sim, w, p)) throw new Error("ceremony: " + p.reasons.join("|"));
  sim.policy!.mode = "priority"; const t0 = Date.now();
  while (yearOf(sim) < o.until) { stepMonth(sim, w); if (sim.kaigen?.pending) { const i = sim.kaigen.pending.cands.findIndex((c) => c.stance === "heisei"); settleKaigen(sim, i >= 0 ? i : 0, true); } if (sim.policy?.pending) autoResolve(sim, w); if (sim.e2200?.state === "pending") { const n = sim.e2200!.n ?? 0; apply2200(sim, o.choose ? o.choose(n, sim) : o.e2200 ?? null, !o.e2200 && !o.choose); o.applied?.(n, sim); }; if ((sim.e2200?.state as string) === "road0") close2200(sim);   /* (Stage 24: the game waits for 国道0号 too: the harness gives it up) */ if (o.hook && sim.month % 12 === 0) o.hook(sim, w, yearOf(sim)); }
  return { sim, w, wallS: (Date.now() - t0) / 1000 };
}
export const ll = (w: ReturnType<typeof realWorld>["w"], k: number) => realToLonLat(w.cellPos(k) as [number, number]).map((x) => +x.toFixed(2));
