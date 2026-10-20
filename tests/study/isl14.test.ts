import { describe, it } from "vitest";
import { writeFileSync } from "node:fs";
import { lonLatToReal, realToLonLat } from "../../src/core/data";
import { waterLinks } from "../../src/sim/waterlink";
import { realWorld } from "../unit/simhelp";
describe.skipIf(!process.env.STUDY)("isl", () => { it("x", () => {
  const { w } = realWorld(true); const out: string[] = []; const ll = (k: number) => realToLonLat(w.cellPos(k) as [number, number]).map((x) => +x.toFixed(2)).join(",");
  const cnt = new Map<string, number>(); for (let k = 0; k < w.N; k++) if (w.t.land[k] === 1) { const key = `lm${w.lm[k]}/isl${w.t.island[k]}`; cnt.set(key, (cnt.get(key) ?? 0) + 1); }
  out.push([...cnt].filter(([, n]) => n > 15).map(([k, n]) => `${k}:${n}`).join(" "));
  for (const [n, lon, lat] of [["Sadamisaki-neck", 132.1, 33.4], ["Oita", 131.6, 33.2], ["Matsuyama", 132.8, 33.85], ["Uwajima", 132.55, 33.2], ["Saganoseki", 131.85, 33.25]] as [string, number, number][]) { const k = w.cellOf(lonLatToReal(lon, lat) as any); let best = -1, bd = 1e9; for (let q = 0; q < w.N; q++) if (w.t.land[q] === 1) { const a = w.cellPos(q), b = w.cellPos(k); const d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (d < bd) { bd = d; best = q; } } out.push(`${n}: nearest land ${ll(best)} lm${w.lm[best]} isl${w.t.island[best]} d${bd.toFixed(0)}km`); }
  // narrowest land gap between island ids
  const byIsl = new Map<number, number[]>(); for (let k = 0; k < w.N; k++) if (w.t.land[k] === 1) { const i = w.t.island[k]; if (!byIsl.has(i)) byIsl.set(i, []); byIsl.get(i)!.push(k); }
  const big = [...byIsl].filter(([, c]) => c.length > 300).map(([i]) => i); out.push("big islands " + big.join(","));
  for (let x = 0; x < big.length; x++) for (let y = x + 1; y < big.length; y++) { let bd = 1e9, ba = -1, bb = -1; const A = byIsl.get(big[x])!, B = byIsl.get(big[y])!; for (const a of A) { const pa = w.cellPos(a); for (const b of B) { const pb = w.cellPos(b); const d = Math.abs(pa[0] - pb[0]) + Math.abs(pa[1] - pb[1]); if (d > bd * 1.5) continue; const dd = Math.hypot(pa[0] - pb[0], pa[1] - pb[1]); if (dd < bd) { bd = dd; ba = a; bb = b; } } } out.push(`isl${big[x]}-isl${big[y]}: ${bd.toFixed(1)}km ${ll(ba)} -> ${ll(bb)}`); }
  const L = waterLinks(w).filter((l) => w.t.island[l.a] !== w.t.island[l.b]); out.push("waterLinks across islands: " + L.map((l) => `${ll(l.a)}->${ll(l.b)} ${l.km}km isl${w.t.island[l.a]}/${w.t.island[l.b]} sav${Math.round(l.saving)}`).join(" | "));
  writeFileSync("/tmp/claude-0/isl.txt", out.join("\n"));
}, 900000); });
