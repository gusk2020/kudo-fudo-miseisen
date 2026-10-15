import { describe, expect, it } from "vitest";
import { metrics, runPolicy } from "./sens.test";

/**
 * 1950-2100 quantitative comparison (Issue #13): the world line (era choices) and the ten-yearly policy are varied SEPARATELY and their effects compared.
 * The full tables are produced by `SENS=1 npx vitest run tests/unit/sens.test.ts`; this is the cheap guard that keeps the conclusions true.
 */
const KEYS = ["roadKm", "railKm", "localRoadKm", "localRailKm", "lostKm", "railShareP", "newRoadKm", "newRailKm"] as const;
const spread = (v: number[]) => { const m = v.reduce((a, b) => a + b, 0) / v.length; return m ? (Math.max(...v) - Math.min(...v)) / m : 0; };
const mean = (runs: Record<number, ReturnType<typeof metrics>>[]) => { const rows: number[] = []; for (const y of [2000, 2050, 2100]) for (const k of KEYS) rows.push(spread(runs.map((r) => r[y][k]))); return rows.reduce((a, b) => a + b, 0) / rows.length; };
const allPick = (i: number) => { const o: Record<number, number> = { 1989: i, 2019: i }; for (let y = 2040; y <= 2100; y++) o[y] = i; return o; };

describe("world line vs policy, 1950-2100", () => {
  it("the era path (first era + later choices) moves the network clearly more than the policy domain does, and local transport does not just vanish", () => {
    const eras = [0, 1, 2].map((i) => runPolicy("heisei", 7, "auto", 2100, undefined, i, allPick(i)));
    const pols = (["none", "politics", "economy"] as const).map((p) => runPolicy("heisei", 7, p, 2100, undefined, 0, {}));
    const e = mean(eras), p = mean(pols);
    require("node:fs").writeFileSync("/tmp/quant.json", JSON.stringify({ eraSpread: e, policySpread: p, eras, pols }));
    expect(e).toBeGreaterThan(p * 1.5);
    // road-minded and rail-minded paths separate the mode share, in the expected direction
    expect(eras[1][2000].railShareP).toBeLessThan(eras[0][2000].railShareP); expect(eras[2][2000].railShareP).toBeGreaterThan(eras[0][2000].railShareP);
    expect(eras[2][2050].railKm).toBeGreaterThan(eras[1][2050].railKm); expect(eras[1][2050].hwyKm).toBeGreaterThan(eras[2][2050].hwyKm);
    // local transport: villages are not left behind on every path, and the network is not a one-way story of closures
    for (const r of eras) { expect(r[2050].villIso / Math.max(1, r[2050].villTot)).toBeLessThan(0.12); expect(r[2100].newRoadKm + r[2100].newRailKm).toBeGreaterThan(1500); }
  }, 600000);
});
