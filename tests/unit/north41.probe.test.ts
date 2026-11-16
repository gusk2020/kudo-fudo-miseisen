import { describe, it } from "vitest";
import { writeFileSync } from "node:fs";
import { advance, yearOf } from "../../src/sim/engine";
import { stage3Sim } from "./simhelp";

/**
 * Stage 41 #10 measurement (NOT a regression test: it only runs when KFM_NORTH=<out.json> is set). 1800-start games, several seeds and capital placements; per prefecture group: population, open road/rail km, ports, airports at 1900/1950/2000.
 *   KFM_NORTH=docs/data/north41-baseline.json npx vitest run tests/unit/north41.probe.test.ts
 */
const out = process.env.KFM_NORTH;
const GROUPS: Record<string, string[]> = { 札幌県: ["HK-SAP"], 函館県: ["HK-HAK"], 根室県: ["HK-NEM"], 樺太県: ["KRF"] };
(out ? describe : describe.skip)("north probe", () => {
  it("baseline across seeds and capital placements", () => {
    const rows: unknown[] = []; const seeds = (process.env.KFM_SEEDS ?? "1,2,3").split(",").map(Number), caps = (process.env.KFM_CAPS ?? "JP-13,HK-SAP,KRF").split(",");
    for (const cap of caps) for (const seed of seeds) {
      const t0 = Date.now(); let g: ReturnType<typeof stage3Sim>;
      try { g = stage3Sim("heisei", seed, true, 0, 2, true, { capital: cap, sub: cap === "JP-27" ? "JP-13" : "JP-27" }, undefined, { start1800: true } as never); } catch (e) { rows.push({ cap, seed, error: String(e).slice(0, 200) }); continue; }
      g.sim.policy!.mode = "auto"; const { sim, w } = g;
      for (const y of [1900, 1950, 2000]) {
        advance(sim, w, 12 * (y - yearOf(sim)));
        const popBy: Record<string, number> = {}, townBy: Record<string, number> = {}; for (const id in sim.cities) { const c = w.cityById.get(id); if (!c) continue; const p = w.prefOf(c.cell) ?? c.pref ?? "?"; popBy[p] = (popBy[p] ?? 0) + sim.cities[id].pop; }
        for (const id in sim.settlements) { const s = sim.settlements[id]; if (s.gone) continue; const p = w.prefOf(s.cell) ?? "?"; townBy[p] = (townBy[p] ?? 0) + s.pop; }
        const km: Record<string, { road: number; rail: number }> = {}; for (const e of Object.values(sim.edges)) { if (e.state !== "open" || e.facility === "ferry") continue; const p = w.prefOf(e.cells[Math.floor(e.cells.length / 2)]) ?? "?"; (km[p] ??= { road: 0, rail: 0 })[e.mode === "rail" ? "rail" : "road"] += e.lengthKm; }
        const ports = (sim.hubs ? Object.values(sim.hubs.ports) : []).filter((p) => !p.until).map((p) => w.prefOf(w.cityById.get(p.city)?.cell ?? -1) ?? "?"), air = (sim.hubs ? Object.values(sim.hubs.airports) : []).filter((p) => !p.until).map((p) => w.prefOf(w.cityById.get(p.city)?.cell ?? -1) ?? "?");
        const others = Object.keys(popBy).filter((p) => !Object.values(GROUPS).flat().includes(p)).map((p) => popBy[p] + (townBy[p] ?? 0)).sort((a, b) => a - b), med = others.length ? others[others.length >> 1] : 0;
        const north: Record<string, unknown> = {}; for (const [n, ids] of Object.entries(GROUPS)) { const p = ids[0]; north[n] = { pop: Math.round((popBy[p] ?? 0) + (townBy[p] ?? 0)), roadKm: Math.round(km[p]?.road ?? 0), railKm: Math.round(km[p]?.rail ?? 0), ports: ports.filter((x) => x === p).length, airports: air.filter((x) => x === p).length }; }
        const all = Object.keys(popBy).map((p) => [p, Math.round(popBy[p] + (townBy[p] ?? 0))] as [string, number]).sort((a, b) => b[1] - a[1]);
        rows.push({ cap, seed, year: y, national: all.reduce((a, b) => a + b[1], 0), top5: all.slice(0, 5), otherPrefMedianPop: Math.round(med), north, secs: Math.round((Date.now() - t0) / 1000) });
      }
    }
    writeFileSync(out!, JSON.stringify(rows, null, 1));
  }, 3600000);
});
