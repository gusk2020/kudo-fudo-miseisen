/** STUDY=1 ERA SEED: which new road/rail projects exist, by region group, and what the policy said about them. */
import { writeFileSync } from "node:fs";
import { describe, it } from "vitest";
import { modeOf } from "../../src/sim/types";
import { run14 } from "./lib14";
import { REGIONS } from "./reg15.test";
describe.skipIf(!process.env.STUDY)("proj15", () => { it("x", () => {
  const r = run14({ seed: +(process.env.SEED ?? 7), firstEra: +(process.env.ERA ?? 0), until: +(process.env.UNTIL ?? 2030) }), sim = r.sim, w = r.w;
  const grp = (pref: string | null) => { const n = (pref ?? "").slice(-2); for (const [k, v] of Object.entries(REGIONS)) if (v.includes(n)) return k; return "other"; };
  const out: Record<string, any> = {};
  for (const p of Object.values(sim.projects)) {
    const e = sim.edges[p.edgeIds[0]]; const cell = e?.cells[Math.floor(e.cells.length / 2)]; const g = grp(cell !== undefined ? w.prefOf(cell) : null);
    const m = modeOf(p), key = `${g}/${m}/${p.kind}`; const o = (out[key] ??= { n: 0, open: 0, tagged: 0 }); o.n++; if (p.status === "open") o.open++; if (/復興方針/.test(p.reason)) o.tagged++;
  }
  writeFileSync(`/tmp/claude-0/proj15-${process.env.TAG ?? "x"}.json`, JSON.stringify(out, null, 1));
}, 900000); });
