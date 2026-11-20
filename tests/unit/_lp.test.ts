import { it } from "vitest";
import { homeCity, previewNational, subCity } from "../../src/sim/ceremony";
import { performFree, splitFree } from "../../src/sim/specialDraw41";
import type { Vec } from "../../src/core/types";
import { stage3Sim } from "./simhelp";
const line = (a: Vec, b: Vec, n = 20): Vec[] => Array.from({ length: n + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n] as Vec);
const join = (...ps: Vec[][]) => ps.reduce((acc, p) => (acc.length ? [...acc, ...p.slice(1)] : [...p]), [] as Vec[]);
it("lp", () => {
  for (const via of [["甲府市", "長野市"], ["千葉市", "金沢市", "新潟市"], ["横浜市", "鳥取市", "福井市", "富山市", "前橋市"], ["静岡市", "鳥取市", "金沢市", "長野市"]]) {
    const g = stage3Sim("heisei", 7, true, 0, 2, true, undefined, undefined, { start1800: true } as never), { sim, w } = g; sim.month = 1200; const a = homeCity(w, sim.capital)!, b = subCity(w, sim.subCapital)!, C = (n: string) => w.cities.find((c) => c.name === n)?.pos;
    const pts = via.map(C); if (pts.some((p) => !p)) { console.log("LP missing", via.join()); continue; }
    const start = pts[0]!, rest = pts.slice(1) as Vec[]; const segs: Vec[][] = [line(start, a.pos, 6), line(a.pos, b.pos, 14)]; let cur = b.pos; for (const p of [...rest, start]) { segs.push(line(cur, p, 10)); cur = p; }
    const f = splitFree(join(...segs), a.pos, [b.pos], 20); const nat = previewNational(w, f.mid, sim.capital, sim.subCapital, { year: 1900 }); const r = performFree(sim, w, nat, f.exts, 45);
    console.log("LP", via.join(">"), r.ok, r.loop, r.reason);
  }
}, 900000);
