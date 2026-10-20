/** STUDY=1 SEED ERA CAP SUB UNTIL TAG: the network and the cities at a year as JSON (lon/lat) for rendering side-by-side maps. */
import { mkdirSync, writeFileSync } from "node:fs";
import { describe, it } from "vitest";
import { realToLonLat } from "../../src/core/data";
import { modeOf } from "../../src/sim/types";
import { run14 } from "./lib14";
describe.skipIf(!process.env.STUDY)("mapdump", () => { it("x", () => {
  const until = +(process.env.UNTIL ?? 2020), seed = +(process.env.SEED ?? 7), dump: any = {};
  const snap = (sim: any, w: any, y: number) => {
    const ll = (k: number) => realToLonLat(w.cellPos(k) as [number, number]).map((x) => +x.toFixed(2));
    const edges: any[] = [];
    for (const e of Object.values(sim.edges) as any[]) { if (e.built < 1 || e.state !== "open") continue; const step = Math.max(1, Math.floor(e.cells.length / 12)); const pts: number[][] = []; for (let i = 0; i < e.cells.length; i += step) pts.push(ll(e.cells[i])); pts.push(ll(e.cells[e.cells.length - 1])); edges.push({ L: e.lengthKm, pr: w.prefOf(e.cells[Math.floor(e.cells.length / 2)]), m: modeOf(e), s: e.standard, f: e.facility ?? "", p: pts }); }
    const cities = w.cities.map((c: any) => ({ n: c.name, k: c.kind, p: Math.round(sim.cities[c.id].pop / 1000), ll: ll(c.cell), pref: c.pref }));
    dump[y] = { edges, cities, metro: (sim.metro?.list ?? []).map((m: any) => ({ core: w.cityById.get(m.core)?.name, pop: Math.round(m.pop / 1000), members: m.members.length })) };
  };
  run14({ seed, firstEra: +(process.env.ERA ?? 0), capital: process.env.CAP || undefined, sub: process.env.SUB || undefined, until, hook: (sim: any, w: any, y: number) => { if (y === 1951 || y === 1970 || y === 1990 || y === 2020 || y === 2050) { if (!dump[y]) snap(sim, w, y); } } } as any);
  const dir = process.env.OUT ?? "/tmp/claude-0/MD"; mkdirSync(dir, { recursive: true }); writeFileSync(`${dir}/m-${process.env.TAG ?? "x"}-${seed}.json`, JSON.stringify(dump));
}, 3600000); });
