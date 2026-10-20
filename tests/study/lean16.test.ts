import { writeFileSync } from "node:fs";
import { describe, it } from "vitest";
import { reconMeanCore, reconRegionLean } from "../../src/sim/recon";
import { run14 } from "./lib14";
describe.skipIf(!process.env.STUDY)("lean", () => { it("x", () => {
  const out: string[] = [];
  run14({ seed: 7, firstEra: +(process.env.ERA ?? 1), until: 1961, hook: (sim, w, y) => { if (y !== 1960) return; const mc = reconMeanCore(sim, w); out.push(`towns16=${!!sim.towns16} pop15=${sim.pop15}`); for (const r of w.t.prefOrder) out.push(`${r} ${reconRegionLean(sim, w, r, mc).toFixed(2)}`); } });
  out.push(JSON.stringify((globalThis as any).__pc));
  writeFileSync("/tmp/claude-0/lean16.txt", out.join("\n"));
}, 600000); });
