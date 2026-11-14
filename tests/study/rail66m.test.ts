import { appendFileSync } from "node:fs";
import { describe, it } from "vitest";
import { advance, yearOf } from "../../src/sim/engine";
import { analyze } from "../../src/sim/demand";
import { competeWeight } from "../../src/sim/planning";
import { stage3Sim } from "../unit/simhelp";

/** Issue #66 work B (study, not CI): one cell of the matrix seed x stance x variant. Appends a JSON line to $OUT/matrix.jsonl.
 *  STUDY=1 SEED=7 ERA=2 VAR=AB OUT=dir npx vitest run tests/study/rail66m.test.ts */
describe.skipIf(!process.env.STUDY)("rail66m", () => { it("x", () => {
  const seed = +(process.env.SEED ?? 7), era = +(process.env.ERA ?? 0), V = process.env.VAR ?? ""; (globalThis as any).__R66V = V;   // (only the temporary experiment code in planning.ts read this; the shipped code ignores it)
  const { sim, w } = stage3Sim("heisei", seed, true, era, 2, true, undefined, undefined, { start1800: true } as never); sim.policy!.mode = "auto";
  let cnt: Record<string, number> = {}; (globalThis as any).__R66 = (k: string) => { cnt[k] = (cnt[k] ?? 0) + 1; };
  const km = (m: "rail" | "road") => Math.round(Object.values(sim.edges).filter((e) => (e.mode ?? "road") === m && e.facility !== "ferry" && e.built >= 1 && e.state === "open").reduce((a, e) => a + e.lengthKm, 0));
  const row: Record<string, unknown> = { seed, era, V }; let cpu = 0;
  for (const y of [1900, 1925, 1950]) {
    const t0 = performance.now(); advance(sim, w, 12 * (y - yearOf(sim))); cpu += performance.now() - t0;
    const an = analyze(sim, w), nc = w.cities.length, dl = sim.dials; let unmet = 0;
    for (let i = 0; i < nc; i++) for (let j = i + 1; j < nc; j++) { const a = w.cities[i], b = w.cities[j]; if (a.island !== b.island) continue; const d = Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1]); if (d < 40 || d > 260) continue;
      const tt = an.TT[i * nc + j], tr = an.T[i * nc + j], railSvc = isFinite(tt) ? Math.min(1, d / (tt * 60)) : 0, roadSvc = isFinite(tr) ? Math.min(1, d / (tr * 40)) : 0, svc = Math.max(railSvc, roadSvc * competeWeight(dl, "road")); if (svc > 0.65) continue;
      unmet += (Math.pow(sim.cities[a.id].pop * sim.cities[b.id].pop, 0.65) / Math.pow(d, 1.25)) * (1 - svc) * 1e-3; }
    row[y] = { newRailProjects: Object.values(sim.projects).filter((p) => p.kind === "new" && p.edgeIds.some((id) => sim.edges[id]?.mode === "rail")).length, rail: km("rail"), road: km("road"), unmetK: Math.round(unmet / 1000), cum: { ...cnt } };
  }
  row.cpuS = Math.round(cpu / 100) / 10; appendFileSync(`${process.env.OUT ?? "/tmp"}/matrix.jsonl`, JSON.stringify(row) + "\n");
}, 6000000); });
