import { describe, expect, it } from "vitest";
import { homeCity, performRoad0, previewNational, subCity } from "../../src/sim/ceremony";
import { checkIntegrity } from "../../src/sim/network";
import { sanitizeSim } from "../../src/core/save2";
import { routeStroke, specialRoutes, nextSpecial, routeCells } from "../../src/sim/special41";
import { checkExtension, checkLoop, performExtension, performLoop, previewExtension, splitLoop } from "../../src/sim/specialDraw41";
import type { Vec } from "../../src/core/types";
import { stage3Sim } from "./simhelp";

/** Stage 41 #8 (drawing): extension, loop and detour of a special route, on the real map. */
const line = (a: Vec, b: Vec, n = 20): Vec[] => Array.from({ length: n + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n] as Vec);
const game = () => stage3Sim("heisei", 7, true, 0, 2, true, undefined, undefined, { start1800: true } as never);
const city = (g: ReturnType<typeof game>, n: string) => g.w.cities.find((c) => c.name === n)!;
function with0(g: ReturnType<typeof game>) { const { sim, w } = g, a = homeCity(w, sim.capital)!, b = subCity(w, sim.subCapital)!; sim.month = 1200; const p = previewNational(w, line(a.pos, b.pos), sim.capital, sim.subCapital, { year: 1900 }); return performRoad0(sim, w, p)!; }
describe("Stage 41 #8: drawing an extension / a loop", () => {
  it("an extension drawn from the sub-capital end onward is added to the same route (symbol kept, one stroke, saved and loaded); the game is untouched by the check", () => {
    const g = game(), { sim, w } = g; with0(g); const r0 = specialRoutes(sim)["0"], n0 = r0.edges.length, sub = subCity(w, sim.subCapital)!, to = city(g, "神戸市") ?? city(g, "姫路市");
    const p = previewExtension(sim, w, "0", line(sub.pos, to.pos, 8)); expect(p.ok, p.reasons.join()).toBe(true); expect(p.closes).toBe(false);
    const snap = JSON.stringify(sim); const chk = checkExtension(sim, w, p); expect(chk.ok, chk.reason).toBe(true); expect(JSON.stringify(sim), "the check does not touch the game").toBe(snap);
    const res = performExtension(sim, w, p); expect(res.ok, res.reason).toBe(true); expect(r0.edges.length).toBeGreaterThan(n0); expect(r0.number).toBe(0); expect(routeStroke(sim, r0).ok).toBe(true); expect(checkIntegrity(sim)).toEqual([]); expect(nextSpecial(sim), "an extension uses no new symbol").toBe("A");
    const back = sanitizeSim(JSON.parse(JSON.stringify(sim))); expect(back.problems).toEqual([]); expect(back.sim!.routes[r0.id].edges.length).toBe(r0.edges.length);
  }, 900000);
  it("a branch drawn from the middle of the route is refused with the reason, and nothing is built", () => {
    const g = game(), { sim, w } = g; with0(g); const r0 = specialRoutes(sim)["0"], cells = routeCells(sim, r0), mid = w.cellPos(cells[Math.floor(cells.length / 2)]), off: Vec = [mid[0] + 10, mid[1] + 90];
    const p = previewExtension(sim, w, "0", line(mid, off, 8), { snapKm: 20 }); if (!p.ok) { expect(p.reasons[0]).toBeTruthy(); return; }
    const nE = Object.keys(sim.edges).length, res = performExtension(sim, w, p); expect(res.ok).toBe(false); expect(res.reason).toContain("一筆書き"); expect(Object.keys(sim.edges).length, "nothing was laid").toBe(nE);
  }, 900000);
  it("a line drawn far from the route, a sea crossing, and a route that does not exist are refused with reasons", () => {
    const g = game(), { sim, w } = g; with0(g); const sap = city(g, "札幌市"), hak = city(g, "函館市");
    expect(previewExtension(sim, w, "0", line(sap.pos, hak.pos, 6)).reasons[0]).toContain("近くから描き始めて"); expect(previewExtension(sim, w, "元", line(sap.pos, hak.pos, 6)).reasons[0]).toContain("まだありません");
    const sub = subCity(w, sim.subCapital)!, tok = city(g, "徳島市"); const p = previewExtension(sim, w, "0", line(sub.pos, tok.pos, 8)); expect(p.ok).toBe(false);
  }, 900000);
  it("a loop: a new route drawn capital -> sub-capital -> back by another way becomes one closed route (no odd place), by the next symbol", () => {
    const g = game(), { sim, w } = g; sim.month = 1200; const a = homeCity(w, sim.capital)!, b = subCity(w, sim.subCapital)!, via = city(g, "長野市") ?? city(g, "金沢市");
    const drawn = [...line(a.pos, b.pos, 12), ...line(b.pos, via.pos, 8).slice(1), ...line(via.pos, a.pos, 8).slice(1)], sp = splitLoop(drawn, a.pos, b.pos)!; expect(sp, "recognised as a loop").toBeTruthy();
    expect(splitLoop(line(a.pos, b.pos, 12), a.pos, b.pos), "a plain line is not a loop").toBeNull();
    const nat = previewNational(w, sp.out, sim.capital, sim.subCapital, { year: 1900 }); expect(nat.ok, nat.reasons.join()).toBe(true);
    const snap = JSON.stringify(sim), chk = checkLoop(sim, w, nat, sp.back); expect(JSON.stringify(sim)).toBe(snap); expect(chk.ok, chk.reason).toBe(true);
    const res = performLoop(sim, w, nat, sp.back); expect(res.ok, res.reason).toBe(true); const r = sim.routes[res.info!.routeId]; expect(r.number).toBe(0); const st = routeStroke(sim, r); expect(st.ok).toBe(true); expect(st.odd, "closed: no ends").toBe(0); expect(checkIntegrity(sim)).toEqual([]);
  }, 900000);
});
