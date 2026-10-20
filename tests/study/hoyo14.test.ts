import { describe, it } from "vitest";
import { writeFileSync } from "node:fs";
import { lonLatToReal, realToLonLat } from "../../src/core/data";
import { modeOf } from "../../src/sim/types";
import { runWater } from "./water13lib";
describe.skipIf(!process.env.STUDY)("hoyo", () => { it("x", () => {
  const out: string[] = []; const r = runWater(3, +(process.env.SEED ?? 7), +(process.env.UNTIL ?? 1990)); const sim = r._sim, w = r._w;
  const ll = (k: number) => realToLonLat(w.cellPos(k) as [number, number]).map((x) => +x.toFixed(2)).join(",");
  // map cells of the real Saganoseki / Sadamisaki / Oita / Matsuyama
  const cellAt = (lon: number, lat: number) => w.cellOf(lonLatToReal(lon, lat) as any);
  for (const [n, lon, lat] of [["佐賀関", 131.88, 33.25], ["佐田岬", 132.0, 33.34], ["大分", 131.61, 33.24], ["松山", 132.77, 33.84]] as [string, number, number][]) { const k = cellAt(lon, lat); out.push(`${n} cell ${k} lm ${k >= 0 ? w.lm[k] : "-"} land ${k >= 0 ? w.t.land[k] : "-"} ll ${k >= 0 ? ll(k) : "-"}`); }
  out.push("cities: " + w.cities.filter((c) => /大分|松山|別府|宇和島|今治|新居浜|西条/.test(c.name)).map((c) => `${c.name}:${ll(c.cell)} lm${w.lm[c.cell]}`).join(" "));
  const near = (k: number, lon: number, lat: number, d = 0.9) => { const [a, b] = realToLonLat(w.cellPos(k) as [number, number]); return Math.abs(a - lon) < d && Math.abs(b - lat) < d; };
  for (const e of Object.values(sim.edges)) { if (!(e.facility === "ferry" || e.facility === "tunnel" || e.facility === "bridge")) continue; const a = e.cells[0], b = e.cells[e.cells.length - 1]; if (!(near(a, 132.1, 33.4) || near(b, 132.1, 33.4) || near(a, 131.8, 33.3) || near(b, 131.8, 33.3))) continue;
    const deg = (id: string) => Object.values(sim.edges).filter((x) => (x.a === id || x.b === id) && x.id !== e.id && x.built >= 1 && x.state === "open").length;
    out.push(`${e.id} ${e.facility} ${e.facilityName} ${modeOf(e)} ${e.lengthKm}km ${e.state} built${e.built} ends ${ll(a)} -> ${ll(b)} lm ${w.lm[a]}/${w.lm[b]} deg ${deg(e.a)}/${deg(e.b)} traffic ${Math.round(e.through + e.local)}`); }
  for (const p of r.projects) if (/大分|松山|愛媛/.test(p.name ?? "")) out.push(`proj ${p.name} ${p.mode} ${p.km}km ${p.hist.map((h: any) => h[0] + h[1].slice(0, 2)).join(" ")} ${p.state} ends ${JSON.stringify(p.ends)}`);
  const reach = (start: string, skip: string) => { const seen = new Set([start]), q = [start]; while (q.length) { const n = q.pop()!; for (const e of Object.values(sim.edges)) { if (e.id === skip || e.built < 1 || e.state !== "open" || e.facility === "ferry") continue; const o = e.a === n ? e.b : e.b === n ? e.a : null; if (o && !seen.has(o)) { seen.add(o); q.push(o); } } } return seen; };
  for (const e of Object.values(sim.edges)) if (e.facility === "tunnel" && /大分〜愛媛/.test(e.facilityName ?? "") && e.built >= 1) { for (const [side, nid] of [["A", e.a], ["B", e.b]] as [string, string][]) { const r2 = reach(nid, e.id); const cities = w.cities.filter((c) => { const nd = Object.values(sim.nodes).find((n) => n.cell === c.cell); return nd && r2.has(nd.id); }).map((c) => c.name); out.push(`tunnel ${e.id} side ${side} reaches ${r2.size} nodes, cities: ${cities.slice(0, 8).join(",")}${cities.length > 8 ? "..." + cities.length : ""}`); } }
  writeFileSync("/tmp/claude-0/hoyo.txt", out.join("\n"));
}, 900000); });
