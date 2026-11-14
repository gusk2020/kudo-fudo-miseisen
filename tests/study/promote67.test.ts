import { writeFileSync } from "node:fs";
import { describe, it } from "vitest";
import { advance, yearOf } from "../../src/sim/engine";
import { checkIntegrity } from "../../src/sim/network";
import { stage3Sim } from "../unit/simhelp";

/** Issue #67 priority 1 (study, not CI): which of the promoted cities end up with rail / port / airport / plans, per seed, 1800 -> UNTIL. Run: STUDY=1 SEED=7 UNTIL=2100 OUT=/path npx vitest run tests/study/promote67.test.ts */
describe.skipIf(!process.env.STUDY)("promote67", () => { it("x", () => {
  const seed = +(process.env.SEED ?? 7), until = +(process.env.UNTIL ?? 2100), { sim, w } = stage3Sim("heisei", seed, true, 0, 2, true, undefined, undefined, { start1800: true } as never); sim.policy!.mode = "auto"; const out: string[] = [], t0 = Date.now();
  const survey = (y: number) => {
    const nodeOf = (cell: number) => Object.values(sim.nodes).find((n) => n.cell === cell); let rail = 0, ferry = 0, port = 0, air = 0, proj = 0, roadOnly = 0, pop = 0; const defs = sim.oldCities40 ?? [];
    for (const d of defs) { const nd = nodeOf(d.cell); const es = nd ? Object.values(sim.edges).filter((e) => e.a === nd.id || e.b === nd.id) : []; const hasRail = es.some((e) => e.mode === "rail"), hasFerry = es.some((e) => e.facility === "ferry"), hp = !!sim.hubs?.ports[d.id], ha = Object.values(sim.hubs?.airports ?? {}).some((a) => a.city === d.id), pj = nd ? Object.values(sim.projects).some((p) => p.from === nd.id || p.to === nd.id) : false;
      if (hasRail) rail++; if (hasFerry) ferry++; if (hp) port++; if (ha) air++; if (pj) proj++; if (!hasRail && !hasFerry && !hp && !ha) roadOnly++; pop += sim.cities[d.id]?.pop ?? 0; }
    out.push(`${y} promoted=${defs.length} rail=${rail} ferry=${ferry} port=${port} air=${ha(defs)} proj=${proj} roadOnly=${roadOnly} popM=${(pop / 1e6).toFixed(1)} integrity=${checkIntegrity(sim).length} t=${((Date.now() - t0) / 1000).toFixed(0)}s`);
    function ha(d: unknown[]) { return air; }
  };
  for (let y = 1850; y <= until; y += 10) { advance(sim, w, 12 * (y - yearOf(sim))); if (y % 50 === 0) survey(y); }
  writeFileSync(`${process.env.OUT ?? "/tmp"}/promote67-seed${seed}.txt`, out.join("\n") + "\n");
}, 6000000); });
