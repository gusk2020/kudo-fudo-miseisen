import { describe, it } from "vitest";
import { writeFileSync } from "node:fs";
import { advance, yearOf } from "../../src/sim/engine";
import { modeOf } from "../../src/sim/types";
import { stance18 } from "../../src/sim/policy18";
import { realWorld, stage3SimOn } from "./simhelp";
import { s43Metrics } from "./s43metrics";
/**
 * Stage 43 measurement (runs only with KFM_S43=<out.json>): the owner's playtest scenario (1800 start, 空路重視・地方分散・中立, automatic) and the other policies, on the world a new game in the app gets
 * (islets on). KFM_S43_OFF=1 removes the Stage 43 flag (= the rules before this change, same code). KFM_STANCES, KFM_SEEDS, KFM_YEARS (e.g. 1900,2000,2500), KFM_FOCUS.
 */
const out = process.env.KFM_S43;
(out ? describe : describe.skip)("Stage 43 probe", () => {
  it("transport network by policy", () => {
    const rows: unknown[] = []; const years = (process.env.KFM_YEARS ?? "1900,2000,2200,2500").split(",").map(Number);
    for (const stance of (process.env.KFM_STANCES ?? "kuuro").split(",")) for (const seed of (process.env.KFM_SEEDS ?? "7").split(",").map(Number)) {
      const t0 = Date.now(); const base = realWorld(true, { capital: "JP-13", sub: "JP-27" }, 3);
      const g = stage3SimOn(base as never, 0, seed, { start1800: true, subCapital: "JP-27", era86: { name: "天興", stance, coast: "neutral", focus: process.env.KFM_FOCUS ?? "disperse" } } as never); g.sim.policy!.mode = "auto";
      if (process.env.KFM_S43_OFF === "1") delete (g.sim as { s43?: true }).s43;
      for (const y of years) { advance(g.sim, g.w, 12 * (y - yearOf(g.sim))); rows.push({ stance, seed, year: yearOf(g.sim), s43: !!g.sim.s43, stance18: stance18(g.sim), secs: Math.round((Date.now() - t0) / 1000), ...s43Metrics(g.sim, g.w) }); writeFileSync(out!, JSON.stringify(rows, null, 1)); }
    }
    void modeOf;
  }, 7200000);
});
