import { describe, expect, it } from "vitest";
import { JAPAN } from "../../src/core/data";
import { mapStateHash } from "../../src/core/save2";
import { parseState } from "../../src/core/save";
import { PALACE_LINKS, PREF_IDS, palaceWorld, prefOfSeat, seatsOf, seatsValid } from "../../src/core/seat";
import { defaultState, realState } from "../../src/core/state";
import { homeCity, performNational, previewNational, seatCity, subCity } from "../../src/sim/ceremony";
import { massRoute } from "../../src/sim/ferry";
import { checkIntegrity } from "../../src/sim/network";
import { modeOf } from "../../src/sim/types";
import type { Vec } from "../../src/core/types";
import { realWorld, stage3Sim } from "./simhelp";

const line = (a: Vec, b: Vec, n = 20): Vec[] => Array.from({ length: n + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n] as Vec);
/** Strokes along the great line between the two cities, broken into one stroke per land mass crossed: how a player would draw it. */
const drawn = (w: ReturnType<typeof realWorld>["w"], from: string, to: string): Vec[] => { const a = seatCity(w, from)!, b = seatCity(w, to)!; return line(a.pos, b.pos, 40); };

describe("capital, sub-capital and palace: three independent seats among the 49 prefectures", () => {
  it("all 49 prefectures can be chosen -- the three Hokkaido prefectures and Okinawa included -- and each has a 県庁所在地", () => {
    const { w } = realWorld(true); expect(PREF_IDS.length).toBe(49); expect(PREF_IDS).toContain("JP-47"); expect(PREF_IDS.filter((p) => p.startsWith("HK-")).length).toBe(3);
    for (const p of PREF_IDS) { expect(seatCity(w, p), p).not.toBeNull(); expect(homeCity(w, p)!.pref).toBe(p); expect(subCity(w, p)!.pref).toBe(p); }
    expect(JAPAN.prefectures.length).toBe(49);
  });
  it("defaults are Tokyo / Osaka / Tokyo; the three are read independently; a legacy city id still means its prefecture", () => {
    expect(seatsOf(defaultState())).toEqual({ capital: "JP-13", sub: "JP-27", palace: "JP-13" });
    expect(seatsOf({ capital: "JP-27" } as never)).toEqual({ capital: "JP-27", sub: "JP-13", palace: "JP-13" });   // Osaka as capital pushes the default sub-capital to Tokyo
    const s = { capital: "JP-47", subCapital: "HK-SAP", palace: "JP-26" }; expect(seatsOf(s as never)).toEqual({ capital: "JP-47", sub: "HK-SAP", palace: "JP-26" });
    expect(prefOfSeat("C-JP-27")).toBe("JP-27"); expect(prefOfSeat("C-HK-NEM")).toBe("HK-NEM"); expect(prefOfSeat("JP-99")).toBeNull(); expect(prefOfSeat(5)).toBeNull();
    expect(seatsValid({ capital: "JP-13", sub: "JP-13", palace: "JP-13" })).toBe(false); expect(seatsValid({ capital: "JP-13", sub: "JP-27", palace: "JP-13" })).toBe(true);
    expect(PALACE_LINKS).toEqual([]);   // the palace is not linked to anything yet (extension point only)
  });
  it("the palace may share a prefecture with the capital and with the sub-capital", () => {
    expect(seatsOf({ capital: "JP-13", subCapital: "JP-27", palace: "JP-27" } as never).palace).toBe("JP-27"); expect(seatsOf({ capital: "JP-13", subCapital: "JP-27", palace: "JP-13" } as never).palace).toBe("JP-13");
  });
  it("seats survive a save and a reload, the palace point too; old saves without them keep their map hash", () => {
    const s = realState(); s.capital = "JP-47"; s.subCapital = "HK-SAP"; s.palace = "JP-26"; s.palacePos = [10, 20];
    const back = parseState(JSON.parse(JSON.stringify(s))).state; expect(back.capital).toBe("JP-47"); expect(back.subCapital).toBe("HK-SAP"); expect(back.palace).toBe("JP-26"); expect(back.palacePos).toEqual([10, 20]);
    expect(palaceWorld(back)).toEqual([10, 20]); expect(palaceWorld({ ...back, palacePos: undefined })).not.toEqual([10, 20]);
    expect(parseState({ ...JSON.parse(JSON.stringify(s)), capital: "nonsense", subCapital: 5, palace: "x" }).state.capital).toBeUndefined();
    expect(mapStateHash({ ...realState(), islands: undefined })).toBe("709c0b87"); expect(mapStateHash(s)).not.toBe(mapStateHash(realState()));
    expect(parseState({ ...JSON.parse(JSON.stringify(realState())), capital: "C-JP-27" }).state.capital).toBe("C-JP-27");   // a Stage 4 save keeps its value and still reads as Osaka
  });
});

describe("国道1号 from the capital to the sub-capital, ferries across the straits", () => {
  const W = realWorld(true), { w } = W;
  it("the same prefecture twice is refused", () => { const p = previewNational(w, drawn(w, "JP-13", "JP-14"), "JP-13", "JP-13"); expect(p.ok).toBe(false); expect(p.reasons.join()).toContain("別の府県"); });
  it("on one land mass there is no ferry and the whole way is road", () => {
    const p = previewNational(w, drawn(w, "JP-13", "JP-27"), "JP-13", "JP-27"); expect(p.ok, p.reasons.join()).toBe(true); expect(p.ferries.length).toBe(0); expect(p.segments.every((s) => !s.ferry)).toBe(true);
  });
  for (const [from, to, label, minFerries] of [["JP-47", "JP-13", "Okinawa -> Tokyo", 1], ["JP-13", "JP-47", "Tokyo -> Okinawa", 1], ["JP-47", "HK-SAP", "Okinawa -> Sapporo (Kyushu, Honshu, Hokkaido)", 3], ["JP-36", "JP-13", "Shikoku -> Tokyo", 1], ["HK-NEM", "JP-40", "Nemuro -> Fukuoka", 2]] as const)
    it(`${label}: the route exists, crosses every strait by ferry, and never draws a road over water`, () => {
      const p = previewNational(w, drawn(w, from, to), from, to); expect(p.ok, p.reasons.join()).toBe(true); expect(p.ferries.length).toBeGreaterThanOrEqual(minFerries);
      let prevEnd = -1;
      for (const s of p.segments) {
        if (s.ferry) { expect(s.cells.length).toBe(2); expect(w.lm[s.cells[0]]).not.toBe(w.lm[s.cells[1]]); }
        else { const lm = w.lm[s.cells[0]]; for (let i = 0; i < s.cells.length; i++) { expect(w.t.land[s.cells[i]]).toBe(1); expect(w.lm[s.cells[i]]).toBe(lm); if (i) { const di = Math.abs((s.cells[i] % w.nx) - (s.cells[i - 1] % w.nx)), dj = Math.abs(((s.cells[i] / w.nx) | 0) - ((s.cells[i - 1] / w.nx) | 0)); expect(Math.max(di, dj)).toBe(1); } } }
        if (prevEnd >= 0) expect(s.cells[0]).toBe(prevEnd); prevEnd = s.cells[s.cells.length - 1];
      }
      expect(p.segments[0].cells[0]).toBe(seatCity(w, from)!.cell); expect(prevEnd).toBe(seatCity(w, to)!.cell);
    });
  it("performing it lays one continuous route whose ferry links are ferry edges, not roads; the network stays sound", () => {
    const { sim, w: ww } = stage3Sim("heisei", 7, false, 0, 2, true, { capital: "JP-47", sub: "HK-SAP" });
    const home = homeCity(ww, sim.capital)!, dest = subCity(ww, sim.subCapital)!, p = previewNational(ww, line(home.pos, dest.pos, 60), sim.capital, sim.subCapital); expect(p.ok, p.reasons.join()).toBe(true);
    expect(performNational(sim, ww, p)).toBe(true);
    const r = Object.values(sim.routes).find((x) => x.grade === "national" && x.number === 1)!; expect(r).toBeDefined();
    const es = r.edges.map((x) => sim.edges[x.edgeId]); const ferries = es.filter((e) => e.facility === "ferry"); expect(ferries.length).toBe(p.ferries.length);
    for (const f of ferries) { expect(modeOf(f)).toBe("road"); expect(f.cells.length).toBe(2); expect(ww.lm[f.cells[0]]).not.toBe(ww.lm[f.cells[1]]); }
    for (const e of es.filter((x) => x.facility !== "ferry")) { const lm = ww.lm[e.cells[0]]; expect(e.cells.every((c) => ww.lm[c] === lm && ww.t.land[c] === 1)).toBe(true); }
    // continuity: each edge shares a node with the next along the route
    let at = ""; r.edges.forEach((ref, i) => { const e = sim.edges[ref.edgeId], from = ref.dir === 1 ? e.a : e.b, to = ref.dir === 1 ? e.b : e.a; if (i) expect(from).toBe(at); at = to; });
    expect(checkIntegrity(sim)).toEqual([]); expect(sim.capital).toBe("JP-47"); expect(sim.subCapital).toBe("HK-SAP");
    expect(sim.events.filter((e) => e.kind === "ceremony").every((e) => !e.text.includes("府道1号"))).toBe(true);   // no 府道1号 is drawn any more
  }, 120000);
  it("the land masses are chained by ferries from the very start of a new game", () => {
    const { sim, w: ww } = stage3Sim("heisei", 7, false, 0, 2, true);
    const ferries = Object.values(sim.edges).filter((e) => e.facility === "ferry"); expect(ferries.length).toBeGreaterThanOrEqual(9);
    const route = massRoute(ww, ww.lm[seatCity(ww, "JP-47")!.cell], ww.lm[seatCity(ww, "HK-SAP")!.cell]); expect(route!.length).toBeGreaterThanOrEqual(4);
    for (const f of ferries) expect(f.state).toBe("open");
  }, 120000);
});

describe("Issue #20: prefectures are listed north to south", () => {
  it("all 49, Hokkaido's three first and Okinawa last, by the latitude of each 県庁所在地 (not by code)", async () => {
    const { PREF_IDS_NS } = await import("../../src/core/seat");
    expect(PREF_IDS_NS).toHaveLength(49); expect(new Set(PREF_IDS_NS)).toEqual(new Set(PREF_IDS));
    expect(PREF_IDS_NS.slice(0, 3).every((x) => x.startsWith("HK-"))).toBe(true); expect(PREF_IDS_NS[48]).toBe("JP-47");
    const lat = (id: string) => JAPAN.cities.find((c) => c.pref === id && c.kind === "capital")!.pos[1];
    for (let i = 1; i < 49; i++) expect(lat(PREF_IDS_NS[i]), PREF_IDS_NS[i]).toBeLessThanOrEqual(lat(PREF_IDS_NS[i - 1]));
    expect(PREF_IDS_NS).not.toEqual([...PREF_IDS].sort());
  });
});
