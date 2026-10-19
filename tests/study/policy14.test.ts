/** STUDY=1 SEED=7 ERA=0|1|2|3 CAP=.. SUB=.. OUT=dir TAG=x: coast-policy A/B measures. */
import { mkdirSync, writeFileSync } from "node:fs";
import { describe, it } from "vitest";
import { coastSide } from "../../src/sim/recon";
import { modeOf } from "../../src/sim/types";
import { cityOrderBreaches } from "../../src/sim/seats14";
import { run14 } from "./lib14";
describe.skipIf(!process.env.STUDY)("policy14", () => { it("x", () => {
  const rows: any[] = [];
  const r = run14({ seed: +(process.env.SEED ?? 7), firstEra: +(process.env.ERA ?? 0), capital: process.env.CAP || undefined, sub: process.env.SUB || undefined, until: +(process.env.UNTIL ?? 2100), ridge: process.env.RIDGE === "1", hook: (sim, w, y) => {
    if (y % 10 && y !== 1955 && y !== 1953) return; if (rows.length && rows[rows.length - 1].y === y) return;
    const side = new Map(w.cities.map((c) => [c.id, coastSide(w, c.id)])), js = (id: string) => (side.get(id) ?? 0) < -0.25, pc = (id: string) => (side.get(id) ?? 0) > 0.25;
    let pj = 0, pp = 0, pt = 0, ij = 0, ip = 0, nj = 0, np = 0; for (const c of w.cities) { const p = sim.cities[c.id].pop, ind = sim.cities[c.id].industry; pt += p; if (js(c.id)) { pj += p; ij += ind * p; nj += p; } else if (pc(c.id)) { pp += p; ip += ind * p; np += p; } }
    const km = { jsRoad: 0, jsRail: 0, pcRoad: 0, pcRail: 0 }; const cityPos = w.cities.map((c) => ({ id: c.id, pos: c.pos }));
    for (const e of Object.values(sim.edges)) { if (e.built < 1 || e.state !== "open" || e.facility === "ferry") continue; const mid = w.cellPos(e.cells[Math.floor(e.cells.length / 2)]); let b = 1e9, bid = ""; for (const c of cityPos) { const d = Math.hypot(c.pos[0] - mid[0], c.pos[1] - mid[1]); if (d < b) { b = d; bid = c.id; } } const rail = modeOf(e) === "rail"; if (js(bid)) km[rail ? "jsRail" : "jsRoad"] += e.lengthKm; else if (pc(bid)) km[rail ? "pcRail" : "pcRoad"] += e.lengthKm; }
    const ports = { js: 0, pc: 0 }, big = { js: 0, pc: 0 }; if (sim.hubs) for (const p of Object.values(sim.hubs.ports)) { if (p.until !== undefined) continue; const a = js(p.city) ? "js" : pc(p.city) ? "pc" : null; if (a) { ports[a] += p.tier; if (p.tier >= 3) big[a]++; } }
    const names = ["新潟市", "金沢市", "富山市", "福井市", "秋田市", "鳥取市", "松江市", "酒田市", "山形市", "東京", "名古屋市", "横浜市", "広島市", "岡山市", "静岡市", "福岡市"]; const cp: Record<string, number> = {}; for (const n of names) { const c = w.cities.find((x) => x.name.startsWith(n.replace(/市$/, ""))); if (c) cp[n] = Math.round(sim.cities[c.id].pop / 1000); }
    const tk = [sim.edges, sim.projects]; void tk;
    rows.push({ y, pt, shareJs: pj / pt, sharePc: pp / pt, indJs: nj ? ij / nj : 0, indPc: np ? ip / np : 0, km, ports, big, cp, breaches: cityOrderBreaches(sim, w), rail: Object.values(sim.edges).filter((e) => modeOf(e) === "rail" && e.built >= 1 && e.state === "open").reduce((t, e) => t + e.lengthKm, 0), road: Object.values(sim.edges).filter((e) => modeOf(e) === "road" && e.built >= 1 && e.state === "open" && e.facility !== "ferry").reduce((t, e) => t + e.lengthKm, 0) });
  } });
  const dir = process.env.OUT ?? "/tmp/claude-0/P1"; mkdirSync(dir, { recursive: true }); writeFileSync(`${dir}/p-${process.env.TAG ?? "x"}-${process.env.SEED ?? 7}.json`, JSON.stringify({ rows, recon: r.sim.kaigen?.recon, wallS: r.wallS }, null, 1));
}, 3600000); });
