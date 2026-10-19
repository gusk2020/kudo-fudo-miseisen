/** STUDY=1 SCALE=3 ROT=0.8 SEED=7 WK=3 OUT=dir: every fixed link built over Lake Biwa. */
import { mkdirSync, writeFileSync } from "node:fs";
import { describe, it } from "vitest";
import { isLakeFerry } from "../../src/sim/ferry";
import { runWater } from "./water13lib";
describe.skipIf(!process.env.STUDY)("lake13", () => { it("x", () => {
  const wk = +(process.env.WK ?? 3), seed = +(process.env.SEED ?? 7), key = `${process.env.SCALE}-${process.env.ROT}`;
  const out: any[] = [];
  const r = runWater(wk, seed, 2100, `biwa:${process.env.SCALE}:${process.env.ROT}`, (sim, w, y) => {
    if (y !== 2100) return; const seen = new Set<string>();
    for (const p of Object.values(sim.projects)) { const e = sim.edges[p.edgeIds[0]]; if (!e || !(e.facilityName ?? "").includes("湖")) continue; seen.add(p.id); out.push({ name: e.facilityName, km: e.lengthKm, status: p.status, cost: Math.round(p.costBu), traffic: Math.round(e.through + e.local) }); }
    for (const e of Object.values(sim.edges)) if ((e.facility === "bridge" || e.facility === "tunnel") && (e.facilityName ?? "").includes("湖") && e.built >= 1 && !out.some((o) => o.name === e.facilityName && o.km === e.lengthKm)) out.push({ name: e.facilityName, km: e.lengthKm, status: "built", cost: 0, traffic: Math.round(e.through + e.local) });
    out.push({ lakeFerries: Object.values(sim.edges).filter(isLakeFerry).map((e) => `${e.lengthKm}km ${e.state}`) });
  });
  const dir = process.env.OUT ?? "/tmp/claude-0/L1"; mkdirSync(dir, { recursive: true }); writeFileSync(`${dir}/l-${wk}-${seed}-${key}.json`, JSON.stringify({ out, projects: r.projects.filter((p) => (p.name ?? "").includes("湖")) }, null, 1));
}, 3600000); });
