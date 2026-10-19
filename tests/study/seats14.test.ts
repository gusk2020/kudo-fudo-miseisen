/** STUDY=1 SEED=7 CAP=JP-13 SUB=JP-27 ERA=0 OUT=dir: city ranking and the seats' standing over the years. */
import { mkdirSync, writeFileSync } from "node:fs";
import { describe, it } from "vitest";
import { run14 } from "./lib14";
import { cityOrderBreaches } from "../../src/sim/seats14";
import { homeCity, subCity } from "../../src/sim/ceremony";
describe.skipIf(!process.env.STUDY)("seats14", () => { it("x", () => {
  const rows: any[] = []; const cap = process.env.CAP || undefined, sub = process.env.SUB || undefined;
  const r = run14({ seed: +(process.env.SEED ?? 7), firstEra: +(process.env.ERA ?? 0), capital: cap, sub, until: +(process.env.UNTIL ?? 2100), ridge: process.env.RIDGE === "1", hook: (sim, w, y) => {
    if (y % 10 && y !== 1955) return; if (rows.length && rows[rows.length - 1].y === y) return;
    const P = w.cities.map((c) => ({ n: c.name, id: c.id, p: sim.cities[c.id].pop, pref: c.pref })).sort((a, b) => b.p - a.p);
    const seatInfo = [homeCity(w, sim.capital), subCity(w, sim.subCapital)].map((c) => { if (!c) return null; const m = sim.metro?.list.find((x) => x.members.includes(c.id)); const mem = m ? m.members.filter((id) => id !== c.id).map((id) => ({ n: w.cityById.get(id)!.name, p: Math.round(sim.cities[id].pop / 1000), pref: w.prefOf(w.cityById.get(id)!.cell) })).sort((a, b) => b.p - a.p) : []; const home = w.prefOf(c.cell); return { seat: c.name, pop: Math.round(sim.cities[c.id].pop / 1000), metroPop: m ? Math.round(m.pop / 1000) : 0, share: m ? +(sim.cities[c.id].pop / m.pop).toFixed(2) : 1, sats: mem.slice(0, 8), satsBig: mem.filter((x) => x.p >= 300).length, prefsBig: [...new Set(mem.filter((x) => x.p >= 300 && x.pref !== home).map((x) => x.pref))].length }; });
    rows.push({ y, breaches: cityOrderBreaches(sim, w), seatInfo, total: P.reduce((s, x) => s + x.p, 0), top: P.slice(0, 12).map((x) => [x.n, Math.round(x.p / 1000)]), seats: [sim.capital, sim.subCapital], metro: (sim.metro?.list ?? []).sort((a, b) => b.pop - a.pop).slice(0, 8).map((m) => [w.cityById.get(m.core)!.name, Math.round(m.pop / 1000), Math.round(m.areaKm2), m.prefs.length, m.members.length]) });
  } });
  const dir = process.env.OUT ?? "/tmp/claude-0/S1"; mkdirSync(dir, { recursive: true }); writeFileSync(`${dir}/s-${process.env.TAG ?? "x"}-${process.env.SEED ?? 7}.json`, JSON.stringify({ rows, cap: r.sim.capital, sub: r.sim.subCapital, wallS: r.wallS }, null, 1));
}, 3600000); });
