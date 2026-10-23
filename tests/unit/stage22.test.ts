import { describe, expect, it } from "vitest";
import { run14 } from "../study/lib14";
import { stepMonth, yearOf } from "../../src/sim/engine";
import { autoResolve } from "../../src/sim/policy";
import { apply2200, adoptWorld, due2200 } from "../../src/sim/event2200";
import { CAND_2200 } from "../../src/sim/kaigen";
import { homeCity, performNational, previewNational, subCity } from "../../src/sim/ceremony";
import { buildIndex } from "../../src/sim/network";
import { makeSave, parseSave, mapStateHash } from "../../src/core/save2";
import { defaultState } from "../../src/core/state";
import { realWorld } from "./simhelp";
import type { Vec } from "../../src/core/types";

const toEve = () => { const r = run14({ seed: 5, until: 1952, islets: true }); const sim = r.sim; sim.month = (2200 - sim.startYear) * 12; sim.policy!.mode = "priority"; sim.kaigen!.next = 2230; sim.kaigen!.pending = null; return { ...r, sim }; };
const line = (a: Vec, b: Vec, n = 20): Vec[] => Array.from({ length: n + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n] as Vec);

describe("Stage 22: the 2200 event", () => {
  it("opens once at 2200, waits for the player, applies era / policy / seats, and never fires twice", () => {
    const { sim, w } = toEve(); expect(due2200(sim)).toBe(true);
    stepMonth(sim, w); expect(yearOf(sim)).toBe(2200); expect(sim.e2200?.state).toBe("pending");
    const m = sim.month; stepMonth(sim, w); expect(sim.month).toBe(m);   // time waits
    const before = sim.kaigen!.eras.length;
    expect(apply2200(sim, { era: 1, stance: "kairo", coast: "neutral", focus: "disperse", capital: "JP-04", sub: "JP-40", palace: "JP-26" })).toBe(true);
    const k = sim.kaigen!; expect(k.eras.length).toBe(before + 1); expect(k.eras[k.eras.length - 1]).toMatchObject({ name: CAND_2200[1].name, start: 2200, stance: "kairo" });
    expect(k.recon).toEqual({ coast: "neutral", focus: "disperse", since: 2200 }); expect(sim.capital).toBe("JP-04"); expect(sim.subCapital).toBe("JP-40"); expect(sim.e2200?.state).toBe("road0");
    for (let i = 0; i < 14; i++) { stepMonth(sim, w); if (sim.policy?.pending) autoResolve(sim, w); } expect(yearOf(sim)).toBe(2201); expect(due2200(sim)).toBe(false);
    expect(sim.kaigen!.eras.filter((e) => e.name === CAND_2200[1].name)).toHaveLength(1);
    expect(sim.pot17!.hist.some((x) => x.y === 2201 || x.y === 2200)).toBe(true);   // the development order is redrawn from the new seats
  }, 300000);
  it("left alone (auto) it keeps everything as it was and goes on", () => {
    const { sim, w } = toEve(); sim.policy!.mode = "auto"; const cap = sim.capital, era = sim.kaigen!.eras.length;
    stepMonth(sim, w); expect(sim.e2200?.state).toBe("done"); expect(sim.e2200?.kept).toBe(true); expect(sim.capital).toBe(cap); expect(sim.kaigen!.eras.length).toBe(era);
    const m = sim.month; stepMonth(sim, w); expect(sim.month).toBe(m + 1);
  }, 300000);
  it("a point on the map becomes the new 県庁所在地, gets its people from the old one, and the save keeps it all", () => {
    const { sim, w } = toEve(); stepMonth(sim, w); const tot = (ww: typeof w) => ww.cities.reduce((a, c) => a + (sim.cities[c.id]?.pop ?? 0), 0), t0 = tot(w);
    const nagoya = w.cities.find((c) => c.name === "名古屋市")!, at: Vec = [nagoya.pos[0] + 30, nagoya.pos[1] + 20];
    expect(apply2200(sim, { era: 0, stance: "shoka", coast: "japansea", focus: "concentrate", capital: "JP-23", capitalPos: at })).toBe(true);
    expect(sim.moves20?.some((m) => m.since === 2200 && m.pref === "JP-23")).toBe(true);
    const w2 = realWorld(true, { capital: "JP-13", sub: "JP-27" }, true, sim.moves20 as never).w; adoptWorld(sim, w2);
    const nc = w2.cities.find((c) => c.id === "M22-JP-23")!; expect(nc.kind).toBe("capital"); expect(w2.cityById.get("C-JP-23")!.former).toBe(true);
    expect(Math.abs(tot(w2) - t0)).toBeLessThan(2); expect(sim.cities[nc.id].pop).toBeGreaterThan(0);
    const s = defaultState(); s.finalized = true; sim.mapHash = mapStateHash(s); const back = parseSave(JSON.parse(JSON.stringify(makeSave(s, sim))));
    expect(back.sim?.e2200).toEqual(sim.e2200); expect(back.sim?.kaigen?.recon).toEqual(sim.kaigen!.recon); expect(back.sim?.moves20).toEqual(sim.moves20);
  }, 300000);
  it("国道0号 runs along the existing and abandoned roads, shares their edges with 国道1号, and builds only the gaps", () => {
    const { sim, w } = toEve(); stepMonth(sim, w); apply2200(sim, { era: 2, stance: "heisei", coast: "pacific", focus: "concentrate", capital: "JP-27", sub: "JP-13" });
    const idx = buildIndex(sim, "road"), a = homeCity(w, sim.capital)!, b = subCity(w, sim.subCapital)!;
    const r1 = Object.values(sim.routes).find((r) => r.grade === "national" && r.number === 1)!, e1 = r1.edges.map((x) => sim.edges[x.edgeId]).filter((e) => e.facility !== "ferry");
    const closed = e1[Math.floor(e1.length / 2)]; closed.state = "closed"; closed.open = false;   // an abandoned stretch on the way
    const p = previewNational(w, line(a.pos, b.pos), sim.capital, sim.subCapital, { roadCells: idx.roadCells, roadside: true }); expect(p.ok, p.reasons.join()).toBe(true);
    const n0 = Object.keys(sim.edges).length, res = performNational(sim, w, p, { road0: true }); expect(res).toBe(true);
    const r0 = Object.values(sim.routes).find((r) => r.grade === "national" && r.number === 0)!; expect(r0).toBeTruthy();
    const shared = r0.edges.filter((x) => r1.edges.some((y) => y.edgeId === x.edgeId)).length; expect(shared).toBeGreaterThan(0);
    expect(sim.edges[closed.id].state).toBe("open");
    const newEdges = Object.keys(sim.edges).length - n0; expect(newEdges).toBeLessThan(r0.edges.length);   // most of it is reuse
    expect(Object.values(sim.routes).find((r) => r.grade === "national" && r.number === 1)?.active).toBe(true);   // 国道1号 is not overwritten
  }, 300000);
});
