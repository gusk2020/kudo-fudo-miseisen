import { writeFileSync } from "node:fs";
import { describe, it } from "vitest";
import { advance, yearOf } from "../../src/sim/engine";
import { analyze } from "../../src/sim/demand";
import { competeWeight } from "../../src/sim/planning";
import { stage3Sim } from "../unit/simhelp";

/** Issue #66 priority 3 (study, not CI): why does a stance's railway stop growing 1900-1950? Per 5 years: rail/road km, live rail projects, and the pool the new-line planner draws on (city pairs 40-260 km apart, rail+road service <= 0.65, with their summed unmet demand; same formula as planRailGen, recomputed here, so it is an approximation of that pool).
 *  STUDY=1 SEED=7 ERA=2 OUT=dir npx vitest run tests/study/rail66.test.ts */
describe.skipIf(!process.env.STUDY)("rail66", () => { it("x", () => {
  const seed = +(process.env.SEED ?? 7), era = +(process.env.ERA ?? 0), { sim, w } = stage3Sim("heisei", seed, true, era, 2, true, undefined, undefined, { start1800: true } as never); sim.policy!.mode = "auto"; const out: string[] = [`seed ${seed} era#${era} stance ${sim.kaigen?.eras[0]?.stance}`];
  const km = (m: "rail" | "road") => Math.round(Object.values(sim.edges).filter((e) => (e.mode ?? "road") === m && e.facility !== "ferry" && e.built >= 1 && e.state === "open").reduce((a, e) => a + e.lengthKm, 0));
  let cnt: Record<string, number> = {}; (globalThis as any).__R66 = (k: string) => { cnt[k] = (cnt[k] ?? 0) + 1; };   // needs the temporary counters in planRailGen (not committed)
  for (let y = 1880; y <= 1960; y += 5) {
    cnt = {}; advance(sim, w, 12 * (y - yearOf(sim))); const gate = JSON.stringify(cnt); const an = analyze(sim, w), nc = w.cities.length, dl = sim.dials; let pairs = 0, unmet = 0, all = 0;
    for (let i = 0; i < nc; i++) for (let j = i + 1; j < nc; j++) { const a = w.cities[i], b = w.cities[j]; if (a.island !== b.island) continue; const d = Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1]); if (d < 40 || d > 260) continue; all++;
      const tt = an.TT[i * nc + j], tr = an.T[i * nc + j], railSvc = isFinite(tt) ? Math.min(1, d / (tt * 60)) : 0, roadSvc = isFinite(tr) ? Math.min(1, d / (tr * 40)) : 0, svc = Math.max(railSvc, roadSvc * competeWeight(dl, "road")); if (svc > 0.65) continue;
      pairs++; unmet += (Math.pow(sim.cities[a.id].pop * sim.cities[b.id].pop, 0.65) / Math.pow(d, 1.25)) * (1 - svc) * 1e-3; }
    const pr = Object.values(sim.projects).filter((p) => (p.kind === "new") && (p.edgeIds.some((id) => sim.edges[id]?.mode === "rail"))), st = (s: string) => pr.filter((p) => p.status === s).length;
    out.push(`${y} rail=${km("rail")}km road=${km("road")}km railBuild=${dl.railBuild.toFixed(2)} hwyBuild=${dl.hwyBuild.toFixed(2)} newRailProjects open=${st("open")} building=${st("building")} planned=${st("planned")} concept=${st("concept")} | pairs(all ${all}) unserved=${pairs} unmet=${unmet.toFixed(1)} | planRailGen exits over the last 5y: ${gate}`);
  }
  writeFileSync(`${process.env.OUT ?? "/tmp"}/rail66-seed${seed}-era${era}.txt`, out.join("\n") + "\n");
}, 6000000); });
