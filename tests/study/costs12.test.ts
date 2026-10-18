/** Stage 12: construction / upkeep cost table from the model constants. STUDY=1 npx vitest run tests/study/costs12.test.ts */
import { describe, it } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
import { OPEN_K, TUNNEL_LEN_KM, TUNNEL_POW, TUNNEL_UNIT, UPKEEP_OPEN, UPKEEP_TUNNEL, tunnelLimitKm } from "../../src/sim/land";
import { facilityCostMult } from "../../src/sim/tech";
describe.skipIf(!process.env.STUDY)("costs12", () => { it("table", () => {
  const n = 20, cell = 5, tech = { k: 2 };
  const mult = (mode: "road" | "rail", tunnelCells: number, openH: number) => 1 + (tunnelCells * TUNNEL_UNIT[mode] * Math.pow(1 + (tunnelCells * cell) / TUNNEL_LEN_KM, TUNNEL_POW) + (n - tunnelCells) * OPEN_K * openH) / n;
  const rows: string[] = ["100 km route, construction cost multiplier vs the same length on the plain (before the tunnel edge's own facility factor 3 x " + facilityCostMult(tech, 2000) + ")"];
  for (const [lab, tc, oh] of [["plain", 0, 0], ["foothill (open ground, hardness 2)", 0, 2], ["steep range foot (open, hardness 4)", 0, 4], ["one 15 km tunnel", 3, 0], ["one 30 km tunnel", 6, 0], ["one 60 km tunnel", 12, 0]] as [string, number, number][]) rows.push(`${lab.padEnd(40)} road ${mult("road", tc, oh).toFixed(2)}  rail ${mult("rail", tc, oh).toFixed(2)}`);
  rows.push("longest tunnel the technology can dig (km): " + [1950, 1960, 1975, 1990, 2010, 2050, 2100].map((y) => `${y}:${Math.round(tunnelLimitKm(tech, y))}`).join("  "));
  rows.push(`upkeep multiplier: open ground UPKEEP_OPEN x hardness = ${UPKEEP_OPEN}/unit, a tunnel cell = ${UPKEEP_TUNNEL}; 100 km with a 15 km tunnel: ${(1 + 3 * UPKEEP_TUNNEL / 20).toFixed(2)}, with a 30 km tunnel: ${(1 + 6 * UPKEEP_TUNNEL / 20).toFixed(2)}`);
  require("node:fs").writeFileSync(process.env.OUT ?? "/tmp/claude-0/costs12.txt", rows.join("\n"));
}); });
