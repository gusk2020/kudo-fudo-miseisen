import { afterEach, describe, expect, it } from "vitest";
import { homeCity, performRoad0, previewNational, subCity } from "../../src/sim/ceremony";
import { routeOfficial } from "../../src/sim/engine";
import { checkIntegrity } from "../../src/sim/network";
import { sanitizeSim } from "../../src/core/save2";
import { FIXED_YEARS, SPECIALS13, SPECIALS60, SPECIAL_SYMS, isDoubleCenturyYear, isQuadYear, lastSpecial, canBuildNext, canExtend, extendSpecial, nextSpecial, readingOf, routeComplete, seatsPass, routeCells, setGlyphCheck, shownSymbol, specialRoutes, strokeCheck } from "../../src/sim/special41";
import type { Vec } from "../../src/core/types";
import { stage3Sim } from "./simhelp";

/** Stage 41 #8: special routes -- 1 0 A 元 始 ㄅ ᚠ Ⰰ ꀀ ᚛ 𓃀 ⌘ ꙮ, in the order they are built. */
const line = (a: Vec, b: Vec, n = 20): Vec[] => Array.from({ length: n + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n] as Vec);
const game = () => stage3Sim("heisei", 7, true, 0, 2, true, undefined, undefined, { start1800: true } as never);
function relocRoad(g: ReturnType<typeof game>, year: number) { const { sim, w } = g, a = homeCity(w, sim.capital)!, b = subCity(w, sim.subCapital)!; sim.month = (year - sim.startYear) * 12; const p = previewNational(w, line(a.pos, b.pos), sim.capital, sim.subCapital, { year }); return performRoad0(sim, w, p); }
afterEach(() => setGlyphCheck(null));
describe("Stage 41 #8: special routes", () => {
  it("the table is exactly the agreed order and readings", () => {
    expect(SPECIALS13.map((s) => `${s.sym}:${s.reading}`).join(" "), "the first list, kept for games made with it").toBe("1:イチ 0:ゼロ A:エー 元:ゲン 始:シ ㄅ:ボ ᚠ:フェ Ⰰ:アズ ꀀ:イ ᚛:ベイ 𓃀:ベー ⌘:コマ ꙮ:オク");
    // Issue #87: sixty symbols, 1800..7700 by hundreds, each one code point, all different
    expect(SPECIALS60.length).toBe(60); expect(SPECIALS60.map((d) => d.year)).toEqual(Array.from({ length: 60 }, (_, i) => 1800 + 100 * i)); expect(new Set(SPECIALS60.map((d) => d.sym)).size).toBe(60); for (const d of SPECIALS60) { expect([...d.sym].length, `${d.year} is one character`).toBe(1); expect(d.sym.codePointAt(0)).toBe(d.cp); expect(d.reading.length).toBeGreaterThan(0); }
    const at = (y: number) => SPECIALS60.find((d) => d.year === y)!; expect([at(1800).sym, at(1900).sym, at(2000).sym, at(2100).sym]).toEqual(["1", "0", "A", "阿"]);
    expect(FIXED_YEARS).toEqual({ 2200: "♨", 3300: "♥", 4400: "꧅", 5500: "⌬", 6600: "𓃀", 7700: "ꙮ" }); expect(at(3300).reading, "ハート, not ハト").toBe("ハート"); expect(at(7600).cp, "∞ U+221E, not ♾ U+267E").toBe(0x221e); expect(at(7600).sym).toBe("∞"); expect(at(7600).reading).toBe("ムゲン");
    expect([at(2200).reading, at(4400).reading, at(5500).reading, at(6600).reading, at(7700).reading]).toEqual(["ユ", "ジャワ", "ベン", "ベー", "オク"]); expect(SPECIAL_SYMS.length).toBeGreaterThanOrEqual(60);
    expect([2200, 3300, 7700, 1100].every(isDoubleCenturyYear)).toBe(true); expect([2100, 2210, 2222].some(isDoubleCenturyYear)).toBe(false); expect([2222, 3333, 7777].every(isQuadYear)).toBe(true); expect(isQuadYear(2200)).toBe(false);
  });
  it("1800 game: 国道1号 at the start, 国道0号 at 1900, A号 at 2000 -- by build order, as routes of their own (never a numbered route), and the game saves and loads", () => {
    const g = game(), { sim } = g; expect(sim.special41).toBe(true); expect(nextSpecial(sim)).toBe("0");
    const r0 = relocRoad(g, 1900)!; expect(r0).toBeTruthy(); expect(routeOfficial(sim.routes[r0.routeId])).toBe("国道0号"); expect(nextSpecial(sim)).toBe("A");
    const a = relocRoad(g, 2000)!; expect(a).toBeTruthy(); const ra = sim.routes[a.routeId]; expect(ra.special).toBe("A"); expect(routeOfficial(ra)).toBe("A号"); expect(ra.gen).toBe(2000); expect(ra.number).toBe(0);
    expect(Object.values(sim.routes).filter((r) => r.number === 0 && r.scope === "JP" && !r.special).length, "still one numbered 0号").toBe(1); expect(checkIntegrity(sim)).toEqual([]); expect(nextSpecial(sim), "2100: the next of the sixty").toBe("阿");
    const back = sanitizeSim(JSON.parse(JSON.stringify(sim))); expect(back.problems).toEqual([]); expect(back.sim).not.toBeNull(); expect(Object.keys(specialRoutes(back.sim!)).join()).toBe("0,1,A");
  }, 900000);
  it("a relocation that is skipped builds nothing: the same symbol waits, it is not taken by the calendar", () => {
    const g = game(); expect(nextSpecial(g.sim)).toBe("0"); /* 1900 skipped */ const r = relocRoad(g, 2000)!; expect(routeOfficial(g.sim.routes[r.routeId])).toBe("国道0号"); expect(g.sim.routes[r.routeId].special).toBeUndefined(); expect(nextSpecial(g.sim)).toBe("A");
  }, 900000);
  it("the next one needs the previous to be COMPLETE: an unfinished section of 国道0号 refuses A号 (and says why); a finished section that was later closed does not", () => {
    const g = game(), { sim } = g; const r0 = relocRoad(g, 1900)!; const route = sim.routes[r0.routeId]; expect(routeComplete(sim, route)).toBe(true); expect(canBuildNext(sim).ok).toBe(true);
    const e = sim.edges[route.edges.find((x) => !sim.edges[x.edgeId].facility)!.edgeId]; e.state = "closed"; e.open = false; expect(routeComplete(sim, route), "closed later: still a completed route").toBe(true); e.built = 0.5; expect(routeComplete(sim, route)).toBe(false);
    const gate = canBuildNext(sim); expect(gate.ok).toBe(false); expect(gate.sym).toBe("A"); expect(gate.reason).toContain("完成していません"); expect(relocRoad(g, 2000)).toBeNull(); expect(nextSpecial(sim)).toBe("A");
  }, 900000);
  it("one-stroke rule over the whole line: a path and a loop pass; a branch, a split line and a star do not; two loops meeting at one place do", () => {
    const E = (...p: [string, string][]) => p.map(([a, b]) => ({ a, b }));
    expect(strokeCheck(E(["1", "2"], ["2", "3"], ["3", "4"])).ok).toBe(true);
    expect(strokeCheck(E(["1", "2"], ["2", "3"], ["3", "1"])).ok, "a loop").toBe(true);
    expect(strokeCheck(E(["1", "2"], ["2", "3"], ["3", "4"], ["2", "5"])).ok, "a side branch from the middle").toBe(false);
    expect(strokeCheck(E(["1", "2"], ["3", "4"])).ok, "two separate pieces").toBe(false); expect(strokeCheck(E(["c", "1"], ["c", "2"], ["c", "3"])).ok, "a star").toBe(false);
    expect(strokeCheck(E(["a", "b"], ["b", "c"], ["c", "a"], ["a", "d"], ["d", "e"], ["e", "a"])).ok, "two loops meeting at a place").toBe(true);
    expect(strokeCheck([]).ok).toBe(false);
  });
  it("extension: new sections must join the route and keep it one stroke (a loop may be closed); an unrelated branch or a separate piece is refused", () => {
    const g = game(), { sim } = g; const r0 = relocRoad(g, 1900)!, a = relocRoad(g, 2000)!, ra = sim.routes[a.routeId]; void r0;
    const first = sim.edges[ra.edges[0].edgeId], last = sim.edges[ra.edges[ra.edges.length - 1].edgeId];
    const mk = (id: string, x: string, y: string) => { sim.edges[id] = { ...first, id, a: x, b: y, cells: [] } as typeof first; return id; };
    const ends = new Set<string>(); const deg = new Map<string, number>(); for (const ref of ra.edges) { const e = sim.edges[ref.edgeId]; for (const n of [e.a, e.b]) deg.set(n, (deg.get(n) ?? 0) + 1); } for (const [n, d] of deg) if (d % 2) ends.add(n); const [endA, endB] = [...ends]; expect(ends.size).toBe(2); void last;
    expect(canExtend(sim, "A", [mk("x1", endA, "NEW1")]).ok, "continuing from an end").toBe(true);
    expect(canExtend(sim, "A", [mk("x2", "AAA", "BBB")]).ok, "not joined to the route").toBe(false);
    const mid = [...deg].find(([n, d]) => d === 2 && !ends.has(n))![0]; expect(canExtend(sim, "A", [mk("x3", mid, "SPUR")]).ok, "a branch from the middle").toBe(false);
    expect(canExtend(sim, "A", [mk("x4", endA, endB)]).ok, "closing it into a loop").toBe(true);
    expect(canExtend(sim, "A", [mk("x5", endA, "P"), mk("x6", "P", "Q")]).ok, "a longer continuation").toBe(true);
    expect(canExtend(sim, "阿", ["x1"]).reason).toContain("まだありません");
    const n0 = ra.edges.length; expect(extendSpecial(sim, "A", ["x1"]).ok).toBe(true); expect(ra.edges.length).toBe(n0 + 1); expect(ra.number).toBe(0); expect(ra.special).toBe("A"); expect(extendSpecial(sim, "A", ["x3"]).ok).toBe(false); expect(ra.edges.length).toBe(n0 + 1);
  }, 900000);
  it("the line must pass the capital (or the palace near it) and the sub-capital", () => {
    const g = game(), { sim, w } = g; const r0 = relocRoad(g, 1900)!; const cells = routeCells(sim, sim.routes[r0.routeId]); const p = seatsPass(sim, w, cells); expect(p.ok).toBe(true); expect(p.capital && p.sub).toBe(true);
    const far = [...Array(w.N).keys()].filter((k) => w.t.land[k] === 1).filter((k) => { const q = w.cellPos(k), h = homeCity(w, sim.capital)!.pos, s = subCity(w, sim.subCapital)!.pos; return Math.hypot(q[0] - h[0], q[1] - h[1]) > 300 && Math.hypot(q[0] - s[0], q[1] - s[1]) > 300; }).slice(0, 5);
    const none = seatsPass(sim, w, far); expect(none.ok).toBe(false); expect(none.reason).toContain("を通っていません");
    const nearHome = [w.cellOf(homeCity(w, sim.capital)!.pos)]; expect(seatsPass(sim, w, nearHome).sub).toBe(false); expect(seatsPass(sim, w, nearHome).ok).toBe(false);
  }, 900000);
  it("display: a symbol the phone cannot draw is shown by its reading, never as an empty box; the key and the data do not change", () => {
    expect(shownSymbol("ᚠ")).toBe("ᚠ"); setGlyphCheck((s) => s === "A" || s === "元"); expect(shownSymbol("ᚠ")).toBe("フェ"); expect(shownSymbol("A")).toBe("A"); expect(shownSymbol("ꙮ")).toBe(readingOf("ꙮ")); expect(readingOf("𓃀")).toBe("ベー");
    const g = game(); relocRoad(g, 1900); const a = relocRoad(g, 2000)!; expect(routeOfficial(g.sim.routes[a.routeId])).toBe("A号"); const raw = JSON.stringify(g.sim.routes[a.routeId]); setGlyphCheck(() => false); expect(routeOfficial(g.sim.routes[a.routeId])).toBe("エー号"); expect(JSON.stringify(g.sim.routes[a.routeId])).toBe(raw);
  }, 900000);
  it("Issue #87 fixed years: 2200 builds ♨ whatever is still unused, the ordinary symbols are not lost and go on after it; a fixed symbol is never given out in another year; a skipped fixed year is not carried", () => {
    const g = game(), { sim } = g; relocRoad(g, 1900); /* 2000 and 2100 skipped: A and 阿 are still unused */
    sim.month = (2200 - sim.startYear) * 12; expect(nextSpecial(sim)).toBe("♨"); expect(nextSpecial(sim, 2150), "an ordinary year: the first unused ordinary symbol").toBe("A");
    const r = relocRoad(g, 2200)!; expect(sim.routes[r.routeId].special).toBe("♨"); expect(routeOfficial(sim.routes[r.routeId])).toBe("♨号"); expect(sim.routes[r.routeId].gen).toBe(2200);
    const a = relocRoad(g, 2300)!; expect(sim.routes[a.routeId].special, "the ordinary symbols were not lost").toBe("A"); const b = relocRoad(g, 2400)!; expect(sim.routes[b.routeId].special).toBe("阿"); const c = relocRoad(g, 2500)!; expect(sim.routes[c.routeId].special).toBe("∀");
    expect(nextSpecial(sim, 3200)).toBe("元"); expect(nextSpecial(sim, 3300)).toBe("♥"); expect(nextSpecial(sim, 3400), "3300 passed without building: ♥ is not carried").toBe("元");
    expect(lastSpecial(sim)!.special).toBe("∀"); expect(checkIntegrity(sim)).toEqual([]); const back = sanitizeSim(JSON.parse(JSON.stringify(sim))); expect(back.problems).toEqual([]); expect(Object.keys(specialRoutes(back.sim!)).sort().join()).toBe(["0", "1", "A", "∀", "♨", "阿"].sort().join());
  }, 900000);
  it("a game of the first list (special41 without special60, as the published build made them) keeps its thirteen symbols and their order", () => {
    const g = game(), { sim } = g; delete sim.special60; relocRoad(g, 1900); relocRoad(g, 2000); expect(nextSpecial(sim, 2100)).toBe("元"); sim.month = (2200 - sim.startYear) * 12; expect(nextSpecial(sim), "no fixed years in the first list").toBe("元");
    const r = relocRoad(g, 2200)!; expect(sim.routes[r.routeId].special).toBe("元"); expect(nextSpecial(sim, 2300)).toBe("始");
  }, 900000);
});
