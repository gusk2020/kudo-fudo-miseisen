/** Stage 31-35 audit: a reproducible x20-style benchmark. Fixed seed, fixed world, N repeated runs of the same 25 simulated years in one process; prints min / median / max.
 *  Run:  PERF35=1 PERF35_OUT=/some/file npx vitest run tests/unit/perf35.test.ts   (skipped in a normal run; PERF35_RUNS / PERF35_YEARS override 4 runs / 25 years). It measures node CPU time, not a phone. */
import { it } from "vitest";
import { writeFileSync } from "node:fs";
import { realState } from "../../src/core/state";
import { generateTerrain } from "../../src/core/terrain";
import { advance, createSim } from "../../src/sim/engine";
import { buildWorld, townsForSeats } from "../../src/sim/world";
import { loadDem } from "./helpers";

const RUNS = Number(process.env.PERF35_RUNS ?? 4), YEARS = Number(process.env.PERF35_YEARS ?? 25);
it.skipIf(!process.env.PERF35)("x20-style benchmark", () => {
  const s = realState(), t = generateTerrain(s, loadDem()), ids = townsForSeats(t, ["JP-13", "JP-27"]), out: string[] = [`seed 5, ${YEARS} simulated years from 1950, ${RUNS} runs per variant, node ${process.version}`];
  const stat = (a: number[]) => { const b = [...a].sort((x, y) => x - y); return `min ${b[0].toFixed(0)} / median ${b[Math.floor(b.length / 2)].toFixed(0)} / max ${b[b.length - 1].toFixed(0)} ms`; };
  const times: Record<string, number[]> = { "without reclamation (Stage 33 behaviour)": [], "with reclamation (Stage 34/35)": [] };
  for (let r = 0; r < RUNS; r++) for (const [name, g] of [["without reclamation (Stage 33 behaviour)", false], ["with reclamation (Stage 34/35)", { log: [], done: [] }]] as const) {
    const w = buildWorld(t, s.seed, ids, 2, [], g as never), sim = createSim(w, "m", t.hash, 5, { stage3: true, firstEra: 0, techK: 2, subCapital: "JP-27" }); sim.policy!.mode = "auto";
    const t0 = performance.now(); advance(sim, w, 12 * YEARS); times[name].push(performance.now() - t0);
  }
  for (const [k, v] of Object.entries(times)) out.push(`${k}: ${stat(v)}  (${(v.reduce((a, b) => a + b, 0) / v.length / YEARS).toFixed(0)} ms per simulated year on average)`);
  writeFileSync(process.env.PERF35_OUT ?? "perf35.out.txt", out.join("\n") + "\n");
}, 1800000);
