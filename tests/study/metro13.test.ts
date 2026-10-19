/** Stage 13: metro study. STUDY=1 SEED=7 WK=3 OUT=dir npx vitest run tests/study/metro13.test.ts */
import { mkdirSync, writeFileSync } from "node:fs";
import { describe, it } from "vitest";
import { terrainFactor } from "../../src/sim/metro";
import { runWater } from "./water13lib";

describe.skipIf(!process.env.STUDY)("metro13", () => { it("m", () => {
  const rows: any[] = [], hook = (sim: any, w: any, y: number) => {
    if (y % 10 !== 0 && y !== 2100 && y !== 1955) return; const M = sim.metro; if (!M) return;
    const seen = new Map<string, number>(); let cnt = 0, pop = 0; for (const m of M.list) for (const id of m.members) { seen.set(id, (seen.get(id) ?? 0) + 1); cnt++; }
    for (const c of w.cities) pop += sim.cities[c.id].pop;
    const cellOwner = new Map<number, number>(); let dupCells = 0; for (const m of M.list) for (const k of m.cells) { if (cellOwner.has(k)) dupCells++; cellOwner.set(k, 1); }
    const prefPop: Record<string, number> = {}; for (const c of w.cities) { const p = w.prefOf(c.cell) ?? "?"; prefPop[p] = (prefPop[p] ?? 0) + sim.cities[c.id].pop; }
    rows.push({ y, nMetro: M.list.length, cityCount: w.cities.length, membersTotal: cnt, multi: [...seen.values()].filter((v) => v > 1).length, popSum: M.list.reduce((s: number, m: any) => s + m.pop, 0), cityPop: pop, dupCells, prefPop,
      top: [...M.list].sort((a: any, b: any) => b.pop - a.pop).slice(0, 10).map((m: any) => { let fs = 0, plain = 0, high = 0; for (const k of m.cells) { const f = terrainFactor(w, k); fs += f; if (f > 1) plain++; if (f < 1) high++; } return { core: w.cityById.get(m.core).name, pop: Math.round(m.pop), area: Math.round(m.areaKm2), budget: Math.round(m.budgetKm2), r: Math.round(m.radiusKm), sat: m.members.length - 1, prefs: m.prefs.length, out: +m.outsidePct.toFixed(2), plain: +(plain / m.cells.length).toFixed(2), high: +(high / m.cells.length).toFixed(2), fmean: +(fs / m.cells.length).toFixed(2), dens: Math.round(m.pop / m.areaKm2) }; }) });
  };
  const r = runWater(+(process.env.WK ?? 3), +(process.env.SEED ?? 7), +(process.env.UNTIL ?? 2100), "plain", hook); const out = process.env.OUT ?? "/tmp/claude-0/m13"; mkdirSync(out, { recursive: true });
  writeFileSync(`${out}/m-${r.wk}-${r.seed}.json`, JSON.stringify({ rows, wallS: r.wallS }, null, 1));
}, 3_600_000); });
