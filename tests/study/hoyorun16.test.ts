/** STUDY=1 SEED UNTIL: the Kyushu-Shikoku links of a towns-world game: every ferry/tunnel/bridge edge whose ends are on the two islands, with its endpoints and year. */
import { writeFileSync } from "node:fs";
import { describe, it } from "vitest";
import { realToLonLat } from "../../src/core/data";
import { run14 } from "./lib14";
describe.skipIf(!process.env.STUDY)("hoyorun", () => { it("x", () => {
  const out: string[] = [], seed = +(process.env.SEED ?? 7);
  const { sim, w, wallS } = run14({ seed, until: +(process.env.UNTIL ?? 2000), capital: process.env.CAP, sub: process.env.SUB });
  const ll = (k: number) => realToLonLat(w.cellPos(k) as [number, number]).map((x) => +x.toFixed(3)).join(",");
  const kyu = (k: number) => w.t.island[k] === 3, shi = (k: number) => w.t.island[k] === 4;
  for (const e of Object.values(sim.edges)) {
    const c0 = e.cells[0], c1 = e.cells[e.cells.length - 1]; if (!((kyu(c0) && shi(c1)) || (shi(c0) && kyu(c1)))) continue;
    out.push(`${e.id} ${e.mode ?? "road"} ${e.facility} state=${e.state} ${e.facilityName ?? ""} ${e.lengthKm}km ${ll(c0)} -> ${ll(c1)} builtMonth=${e.builtMonth}`);
  }
  for (const v of sim.events) if (/海峡連絡|海峡トンネル|海峡架橋/.test(v.text) ) out.push(JSON.stringify(v).slice(0, 300));
  const adj = new Map<string, string[]>(); for (const e of Object.values(sim.edges)) { if (e.state !== "open" || (e.mode ?? "road") !== "road" || e.facility === "ferry" || /豊予/.test(e.facilityName ?? "")) continue; (adj.get(e.a) ?? adj.set(e.a, []).get(e.a)!).push(e.b); (adj.get(e.b) ?? adj.set(e.b, []).get(e.b)!).push(e.a); }
  const reach = (from: string) => { const seen = new Set([from]), q = [from]; while (q.length) { const n = q.pop()!; for (const m of adj.get(n) ?? []) if (!seen.has(m)) { seen.add(m); q.push(m); } } return seen; };
  const tun = Object.values(sim.edges).find((e) => e.facility === "tunnel" && /豊予/.test(e.facilityName ?? ""));
  if (tun) { out.push(`tunnel ends degree a=${adj.get(tun.a)?.length ?? 0} b=${adj.get(tun.b)?.length ?? 0}`); const R = reach(tun.a), R2 = reach(tun.b); for (const nm of ["大分市", "松山市", "高松市", "福岡市", "大阪市"]) { const c = w.cities.find((x) => x.name === nm); const nd = c ? Object.values(sim.nodes).find((x) => x.cell === c.cell)?.id : null; out.push(`reach ${nm}: kyushuSide=${nd ? R.has(nd) : "nonode"} shikokuSide=${nd ? R2.has(nd) : "nonode"}`); } }
  out.push(`wall ${wallS}s towns=${sim.towns16?.length}`);
  writeFileSync(`/tmp/claude-0/hoyorun-${process.env.TAG ?? seed}.txt`, out.join("\n"));
}, 3000000); });
