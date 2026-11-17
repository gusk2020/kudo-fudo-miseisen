import { it } from "vitest";
import { advance, yearOf } from "../../src/sim/engine";
import { stage3Sim } from "./simhelp";
it("dbg2", () => {
  const g = stage3Sim("heisei", 7, true, 0, 2, true, { capital: "JP-13", sub: "JP-27" }, undefined, { start1800: true, era86: { name: "天興", stance: "shubun", coast: "pacific", focus: "concentrate" } } as never); g.sim.policy!.mode = "auto";
  advance(g.sim, g.w, 12 * (1929 - yearOf(g.sim))); const log = console.log; console.log = (...a: unknown[]) => process.stderr.write("DBG " + a.map(String).join(" ") + "\n"); (globalThis as any).__DBG = true; advance(g.sim, g.w, 24); (globalThis as any).__DBG = false; console.log = log;
}, 3000000);
