import { writeFileSync } from "node:fs";
import { describe, it } from "vitest";
import { run14 } from "./lib14";
describe.skipIf(!process.env.STUDY)("rs", () => { it("x", () => {
  const o: any = {};
  for (const e of [0, 1]) { const r = run14({ seed: 7, firstEra: e, until: 1962 }); const n = Object.keys(r.sim.regionShare).length; o[e] = Object.fromEntries(Object.entries(r.sim.regionShare).map(([k, v]) => [k, +(v * n).toFixed(2)])); }
  writeFileSync("/tmp/claude-0/rs15.json", JSON.stringify(o));
}, 900000); });
