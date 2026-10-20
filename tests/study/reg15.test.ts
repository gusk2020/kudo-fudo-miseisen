/** STUDY=1 SEED=7 ERA=0..3 CAP=.. SUB=.. S14=0|1 OUT=dir TAG=x: regional shares (population, metro area, roads, rail, industry, ports) every ten years. */
import { mkdirSync, writeFileSync } from "node:fs";
import { describe, it } from "vitest";
import { modeOf } from "../../src/sim/types";
import { cityOrderBreaches } from "../../src/sim/seats14";
import { run14 } from "./lib14";

export const REGIONS: Record<string, string[]> = {
  kanto: ["08", "09", "10", "11", "12", "13", "14"], tokaido: ["21", "22", "23", "24", "25", "26", "27", "28"], sanyo: ["33", "34", "35"],
  hokuriku: ["15", "16", "17", "18"], sanin: ["31", "32"], tohokuJs: ["05", "06"], tohokuPac: ["02", "03", "04", "07"], kyushu: ["40", "41", "42", "43", "44", "45", "46"],
};
const regOf = (pref: string | null | undefined) => { if (!pref) return null; const n = pref.slice(-2); for (const [k, v] of Object.entries(REGIONS)) if (v.includes(n)) return k; return "other"; };
describe.skipIf(!process.env.STUDY)("reg15", () => { it("x", () => {
  const rows: any[] = [];
  const r = run14({ seed: +(process.env.SEED ?? 7), firstEra: +(process.env.ERA ?? 0), capital: process.env.CAP || undefined, sub: process.env.SUB || undefined, until: +(process.env.UNTIL ?? 2100), seats14: process.env.S14 === "0" ? false : undefined, pop15: process.env.P15 === "0" ? false : undefined, hook: (sim, w, y) => {
    if ((y % 10 && y !== 1955) || (rows.length && rows[rows.length - 1].y === y)) return;
    const inv: Record<string, number> = {}, hw: Record<string, number> = {}; const UN: Record<string, number> = { rural: 1, standard: 1.8, highgrade: 4 };
    const pop: Record<string, number> = {}, ind: Record<string, number> = {}, big: Record<string, number> = {}, road: Record<string, number> = {}, rail: Record<string, number> = {}, port: Record<string, number> = {}; let tot = 0;
    for (const c of w.cities) { const p = sim.cities[c.id].pop, k = regOf(c.pref) ?? "other"; tot += p; pop[k] = (pop[k] ?? 0) + p; ind[k] = (ind[k] ?? 0) + p * sim.cities[c.id].industry; if (p >= 300000) big[k] = (big[k] ?? 0) + 1; }
    for (const e of Object.values(sim.edges)) { if (e.built < 1 || e.state !== "open" || e.facility === "ferry") continue; const k = regOf(w.prefOf(e.cells[Math.floor(e.cells.length / 2)])) ?? "other"; const t = modeOf(e) === "rail" ? rail : road; t[k] = (t[k] ?? 0) + e.lengthKm; const kk = k + (modeOf(e) === 'rail' ? '/rail' : '/road'); inv[kk] = (inv[kk] ?? 0) + e.lengthKm * (UN[e.standard] ?? 1); if (e.standard === 'highgrade') hw[kk] = (hw[kk] ?? 0) + e.lengthKm; }
    if (sim.hubs) for (const p of Object.values(sim.hubs.ports)) { if (p.until !== undefined) continue; const c = w.cityById.get(p.city); const k = regOf(c?.pref) ?? "other"; port[k] = (port[k] ?? 0) + p.tier; }
    const top = w.cities.map((c) => [c.name, Math.round(sim.cities[c.id].pop / 1000)] as [string, number]).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const sh = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, +(v / tot * 100).toFixed(2)]));
    const metro = (sim.metro?.list ?? []).sort((a, b) => b.pop - a.pop).slice(0, 5).map((m) => [w.cityById.get(m.core)!.name, Math.round(m.pop / 1000), Math.round(m.areaKm2), m.prefs.length, m.members.length]);
    rows.push({ y, inv: Object.fromEntries(Object.entries(inv).map(([k, v]) => [k, Math.round(v)])), hw: Object.fromEntries(Object.entries(hw).map(([k, v]) => [k, Math.round(v)])), tot: Math.round(tot / 1000), popShare: sh(pop), indAvg: Object.fromEntries(Object.entries(ind).map(([k, v]) => [k, +(v / pop[k]).toFixed(2)])), big, road: Object.fromEntries(Object.entries(road).map(([k, v]) => [k, Math.round(v)])), rail: Object.fromEntries(Object.entries(rail).map(([k, v]) => [k, Math.round(v)])), port, top, metro, br: cityOrderBreaches(sim, w) });
  } });
  const dir = process.env.OUT ?? "/tmp/claude-0/R1"; mkdirSync(dir, { recursive: true }); writeFileSync(`${dir}/r-${process.env.TAG ?? "x"}-${process.env.SEED ?? 7}.json`, JSON.stringify({ rows, wallS: r.wallS }, null, 1));
}, 3600000); });
