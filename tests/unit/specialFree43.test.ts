import { describe, expect, it } from "vitest";
import { homeCity, previewNational, subCity } from "../../src/sim/ceremony";
import { checkIntegrity } from "../../src/sim/network";
import { routeStroke, seatsPass, routeCells } from "../../src/sim/special41";
import { checkFree, freePassKm, performFree, splitFree } from "../../src/sim/specialDraw41";
import type { Vec } from "../../src/core/types";
import { stage3Sim } from "./simhelp";

/** Stage 43 (D): a special route that PASSES the capital and a sub-capital, wherever it begins and ends; loops; refusals. */
const line = (a: Vec, b: Vec, n = 20): Vec[] => Array.from({ length: n + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n] as Vec);
const join = (...ps: Vec[][]) => ps.reduce((acc, p) => (acc.length ? [...acc, ...p.slice(1)] : [...p]), [] as Vec[]);
const game = () => stage3Sim("heisei", 7, true, 0, 2, true, undefined, undefined, { start1800: true } as never);
const city = (g: ReturnType<typeof game>, n: string) => g.w.cities.find((c) => c.name === n)!;
describe("Stage 43 (D): free special routes", () => {
  it("splitFree: a line through both seats is split at them; missing either seat, or merely skirting it, is refused with the reason", () => {
    const g = game(), { sim, w } = g, a = homeCity(w, sim.capital)!.pos, b = subCity(w, sim.subCapital)!.pos, s = freePassKm(45);
    const pre = city(g, "宇都宮市").pos, post = city(g, "神戸市").pos, drawn = join(line(pre, a, 6), line(a, b, 12), line(b, post, 6));
    const f = splitFree(drawn, a, [b], s); expect(f.reason).toBe(""); expect(f.exts.length).toBe(2); expect(Math.hypot(f.mid[0][0] - a[0], f.mid[0][1] - a[1])).toBeLessThan(1);
    const back = splitFree([...drawn].reverse(), a, [b], s); expect(back.reason, "drawn the other way: the middle still runs capital -> sub-capital").toBe(""); expect(Math.hypot(back.mid[0][0] - a[0], back.mid[0][1] - a[1])).toBeLessThan(1);
    expect(splitFree(line(pre, post, 20).map((p) => [p[0], p[1] + 200] as Vec), a, [b], s).reason).toContain("通っていません");
    const skirt = join(line(pre, [a[0], a[1] + s * 2], 6), line([a[0], a[1] + s * 2], b, 12)); expect(splitFree(skirt, a, [b], s).reason, "40 km away is not passing").toContain("首都");
  }, 900000);
  it("a line from beyond the capital through both seats to beyond the sub-capital becomes ONE route that passes both (checked on a copy, then built)", () => {
    const g = game(), { sim, w } = g; sim.month = 1200; const a = homeCity(w, sim.capital)!, b = subCity(w, sim.subCapital)!;
    const drawn = join(line(city(g, "宇都宮市").pos, a.pos, 8), line(a.pos, b.pos, 14), line(b.pos, city(g, "神戸市").pos, 6)), f = splitFree(drawn, a.pos, [b.pos], 20);
    const nat = previewNational(w, f.mid, sim.capital, sim.subCapital, { year: 1900 }); expect(nat.ok, nat.reasons.join()).toBe(true);
    const snap = JSON.stringify(sim), chk = checkFree(sim, w, nat, f.exts, 45); expect(JSON.stringify(sim), "the check does not touch the game").toBe(snap); expect(chk.ok, chk.reason).toBe(true);
    const res = performFree(sim, w, nat, f.exts, 45); expect(res.ok, res.reason).toBe(true); const r = sim.routes[res.info!.routeId];
    expect(routeStroke(sim, r).ok, "one stroke").toBe(true); expect(seatsPass(sim, w, routeCells(sim, r)).ok).toBe(true); expect(checkIntegrity(sim)).toEqual([]);
    // the finished route really reaches the two outer ends (宇都宮, 神戸), not only the seats
    const cells = routeCells(sim, r), reach = (n: string) => { const c = city(g, n).pos; return Math.min(...[...cells].map((k) => { const p = w.cellPos(k); return Math.hypot(p[0] - c[0], p[1] - c[1]); })); };
    console.log("S43D reach km: 宇都宮", reach("宇都宮市").toFixed(1), "神戸", reach("神戸市").toFixed(1)); expect(reach("宇都宮市"), "the route reaches beyond the capital").toBeLessThan(15); expect(reach("神戸市"), "the route reaches beyond the sub-capital").toBeLessThan(15);
  }, 900000);
  it("a closed loop that begins and ends away from the seats is built closed (no ends); one that would run over itself is refused with the one-stroke reason", () => {
    const g = game(), { sim, w } = g; sim.month = 1200; const a = homeCity(w, sim.capital)!, b = subCity(w, sim.subCapital)!, P = (n: string) => city(g, n).pos;
    const ring = [P("鳥取市"), P("福井市"), P("富山市"), P("前橋市"), P("横浜市")], segs: Vec[][] = [line(P("横浜市"), a.pos, 6), line(a.pos, b.pos, 14)]; let cur = b.pos; for (const p of ring) { segs.push(line(cur, p, 10)); cur = p; }
    const f = splitFree(join(...segs), a.pos, [b.pos], 20); expect(f.reason).toBe(""); const nat = previewNational(w, f.mid, sim.capital, sim.subCapital, { year: 1900 }); expect(nat.ok, nat.reasons.join()).toBe(true);
    const res = performFree(sim, w, nat, f.exts, 45); expect(res.ok, res.reason).toBe(true); expect(res.loop, "closed").toBe(true);
    const r = sim.routes[res.info!.routeId], st = routeStroke(sim, r); expect(st.ok).toBe(true); expect(st.odd).toBe(0); expect(checkIntegrity(sim)).toEqual([]);
    const g2 = game(); g2.sim.month = 1200; const a2 = homeCity(g2.w, g2.sim.capital)!, b2 = subCity(g2.w, g2.sim.subCapital)!, f2 = splitFree(join(line(city(g2, "甲府市").pos, a2.pos, 6), line(a2.pos, b2.pos, 14), line(b2.pos, city(g2, "長野市").pos, 10), line(city(g2, "長野市").pos, city(g2, "甲府市").pos, 6)), a2.pos, [b2.pos], 20);
    const n2 = Object.keys(g2.sim.edges).length, nat2 = previewNational(g2.w, f2.mid, g2.sim.capital, g2.sim.subCapital, { year: 1900 }), r2 = performFree(g2.sim, g2.w, nat2, f2.exts, 45);
    if (!r2.ok) { expect(r2.reason).toContain("一筆書き"); expect(Object.keys(g2.sim.edges).length, "nothing built when refused").toBe(n2); }
  }, 900000);
  it("with two sub-capitals, passing either one is enough", () => {
    const g = game(), { sim, w } = g, a = homeCity(w, sim.capital)!.pos, b = subCity(w, sim.subCapital)!.pos, far: Vec = [b[0] + 400, b[1] + 400];
    expect(splitFree(join(line(city(g, "宇都宮市").pos, a, 6), line(a, b, 12)), a, [far, b], 20).sub).toBe(1);
  }, 900000);
});
