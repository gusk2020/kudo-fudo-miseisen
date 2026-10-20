/** STUDY=1 SEED: why the Kyushu-Shikoku (Oita-Ehime) crossing is not a candidate in each year, next to the Kyushu-Honshu one. */
import { writeFileSync } from "node:fs";
import { describe, it } from "vitest";
import { realToLonLat } from "../../src/core/data";
import { corridorsOf, evalCorridor, isCrossingProject, isStrategic, STRATEGIC_TAG } from "../../src/sim/crossing";
import { runWater } from "./water13lib";
describe.skipIf(!process.env.STUDY)("hoyoeval", () => { it("x", () => {
  const out: string[] = [];
  runWater(+(process.env.WK ?? 3), +(process.env.SEED ?? 7), +(process.env.UNTIL ?? 1978), "plain", (sim, w, y) => {
    const ap = (m: "road" | "rail") => (m === "road" ? sim.dials.hwyBuild : sim.dials.railBuild) * (1 + 0.5 * sim.dials.hsr) * (1 - 0.35 * Math.min(1, sim.dials.seaBias));
    for (const c of corridorsOf(sim, w, "road")) {
      const a = realToLonLat(w.cellPos(c.a.cell) as [number, number]), b = realToLonLat(w.cellPos(c.b.cell) as [number, number]);
      const kyu = (p: number[]) => p[0] < 132.0 && p[1] < 33.8 && p[0] > 130.9, shi = (p: number[]) => p[0] > 132.0 && p[1] < 34.3;
      const hoyo = (kyu(a) && shi(b)) || (kyu(b) && shi(a)); if (!hoyo) continue;
      const e = evalCorridor(sim, w, c, "road", y, ap("road"));
      const act = Object.values(sim.projects).filter((p) => isCrossingProject(p) && p.reason.includes(STRATEGIC_TAG) && ['concept','planned','building','suspended'].includes(p.status)).map((p) => p.mode + ':' + p.status).join(','); out.push(`strat=${isStrategic(w, c)} act[${act}] ${y} ${c.a.name}-${c.b.name} span ${c.span.toFixed(1)} km ${c.km} ok=${e.ok} why=${e.why} fac=${e.s?.fac} cost=${e.s?.cost?.toFixed(0)} need=${e.need?.toFixed(2)} fund=${e.fund?.toFixed(2)} score=${e.score?.toFixed(2)} bar=${e.bar?.toFixed(2)} rank=${e.rank?.toFixed(2)}`);
    }
  });
  writeFileSync(`/tmp/claude-0/hoyoeval-${process.env.TAG ?? "x"}.txt`, out.join("\n"));
}, 900000); });
