import { describe, expect, it } from "vitest";
import { run14 } from "../study/lib14";
import { advance, stepMonth, yearOf } from "../../src/sim/engine";
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
  it("Stage 23: in every mode (手動・半自動・完全自動, away too) time stops at 2200 until the player chooses; 現状維持 is its own choice", () => {
    for (const mode of ["auto", "idleAuto", "priority"] as const) {
      const { sim, w } = toEve(); sim.policy!.mode = mode; if (sim.policy) sim.policy.away = true; const cap = sim.capital, era = sim.kaigen!.eras.length;
      stepMonth(sim, w); expect(sim.e2200?.state, mode).toBe("pending"); const m = sim.month;
      for (let i = 0; i < 30; i++) stepMonth(sim, w); expect(sim.month, mode).toBe(m); expect(sim.e2200?.state, mode).toBe("pending");   // nothing resolves it by itself
      advance(sim, w, 24); expect(sim.month, mode).toBe(m); expect(sim.e2200?.state, mode).toBe("pending");   // nor a fast-forward
      expect(apply2200(sim, null)).toBe(false); expect(sim.e2200?.state).toBe("done"); expect(sim.e2200?.kept).toBe(true); expect(sim.e2200?.auto).toBeUndefined(); expect(sim.capital).toBe(cap); expect(sim.kaigen!.eras.length).toBe(era);
      stepMonth(sim, w); if (sim.policy?.pending) { autoResolve(sim, w); stepMonth(sim, w); } expect(sim.month, mode).toBe(m + 1);   // (a policy window of that year may come first)
    }
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

import { ISLETS, STAGE20_ISLETS } from "../../src/core/islets";
import { islandLinks, isIslandRoute, isOcean, oceanCandidates, seaKm, seaPolicy } from "../../src/sim/sea22";
import { seaPath } from "../../src/render/seaPath";
import { lonLatToReal } from "../../src/core/data";
describe("Stage 22: islands drawn and placed by their real outlines", () => {
  const W2 = realWorld(true, true, 2).w, W1 = realWorld(true, true, true).w;
  it("almost every island has an outline from 地球地図日本; 南鳥島 and 沖ノ鳥島 are there; a Stage 20 world is unchanged", () => {
    const shaped = ISLETS.filter((s) => s.shape && s.shape.length >= 3).length; expect(shaped / ISLETS.length).toBeGreaterThan(0.95);
    for (const n of ["南鳥島", "沖ノ鳥島"]) { const s = W2.islets!.find((x) => x.islet.name === n)!; expect(s, n).toBeTruthy(); expect(s.offGrid, n).toBe(true); expect(s.islet.shape!.length, n).toBeGreaterThanOrEqual(3); expect(s.islet.pref).toBe("JP-13"); }   // (drawn and listed; nobody lives there, so not on the grid)
    expect(W2.N).toBeLessThan(W1.N * 1.05);   // the two far atolls do not widen the grid
    expect(W2.islets!.filter((x) => !x.offGrid && !x.existing).every((x) => x.cells.length > 0 && W2.t.land[x.cell] === 1)).toBe(true);
    expect(W1.islets!.length).toBe(STAGE20_ISLETS.length); expect(W1.t.isletVersion).toBe(1); expect(W2.t.isletVersion).toBe(2);
  });
  it("the cells of an island lie inside (or at) its outline, and the outline is not a circle", () => {
    const s = W2.islets!.find((x) => x.islet.name === "奄美大島")!; expect(s.cells.length).toBeGreaterThan(10);
    const sh = s.islet.shape!.map(([lo, la]) => lonLatToReal(lo, la)); const xs = sh.map((p) => p[0]), ys = sh.map((p) => p[1]);
    for (const k of s.cells) { const p = W2.cellPos(k); expect(p[0]).toBeGreaterThan(Math.min(...xs) - 5); expect(p[0]).toBeLessThan(Math.max(...xs) + 5); expect(p[1]).toBeGreaterThan(Math.min(...ys) - 5); expect(p[1]).toBeLessThan(Math.max(...ys) + 5); }
    // an ellipse has all its points at one "radius" in its own frame; a real coast has many more vertices and an irregular radius
    const c = [xs.reduce((a, b) => a + b) / xs.length, ys.reduce((a, b) => a + b) / ys.length], rs = sh.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1])), m = rs.reduce((a, b) => a + b) / rs.length, sd = Math.sqrt(rs.reduce((a, b) => a + (b - m) ** 2, 0) / rs.length);
    expect(sh.length).toBeGreaterThan(20); expect(sd / m).toBeGreaterThan(0.15);
  });
});
describe("Stage 22: ocean and island routes", () => {
  const { w } = realWorld(true, true, 2);
  it("the distance is over the sea (Tokyo-Niigata goes round, not across Honshu); only domestic ports; routes follow the policy", () => {
    const c = (n: string) => w.cities.find((x) => x.name === n)!; expect(seaKm(w, c("東京").cell, c("新潟市").cell)).toBeGreaterThan(1000);
    expect(seaKm(w, c("東京").cell, c("大阪市").cell)).toBeLessThan(800);
    for (const x of oceanCandidates(w)) { expect(x.a.pref).toBeTruthy(); expect(x.b.pref).toBeTruthy(); }
    expect(seaPolicy("kairo").cap).toBeGreaterThan(seaPolicy("heisei").cap); expect(seaPolicy("kuuro").longPax).toBeLessThan(1);
    const l = islandLinks(w); expect(l.length).toBeGreaterThan(60); for (const x of l) expect(x.pop).toBeGreaterThan(0);
  });
  it("a sea-minded game opens more ocean routes than a rail-minded one; inhabited islands get their lifelines; no route is drawn across land", () => {
    const sea = run14({ seed: 5, until: 1975, islets: true, firstEra: 4 }), rail = run14({ seed: 5, until: 1975, islets: true, firstEra: 2 });
    const n = (r: typeof sea) => Object.values(r.sim.edges).filter(isOcean).length; expect(sea.sim.kaigen!.eras[0].stance).toBe("kairo"); expect(n(sea)).toBeGreaterThan(n(rail));
    const isl = Object.values(sea.sim.edges).filter(isIslandRoute); expect(isl.length).toBeGreaterThan(50); for (const e of isl) expect(e.state).toBe("open");
    for (const e of [...Object.values(sea.sim.edges).filter(isOcean), ...isl.slice(0, 20)]) { const pts = seaPath(sea.w, sea.sim.nodes[e.a].cell, sea.sim.nodes[e.b].cell); let onLand = 0; for (const p of pts.slice(2, -2)) { const k = sea.w.cellOf(p); if (k >= 0 && sea.w.t.land[k] === 1) onLand++; } expect(onLand, e.facilityName).toBeLessThanOrEqual(1); }
  }, 600000);
});

describe("Stage 22 audit: sea routes", () => {
  it("one search from a port gives the same km as asking for the pair, and a rested ocean route does not flip for ever", async () => {
    const w = realWorld(true, true, 2).w, cs = oceanCandidates(w), c = cs[0];
    expect(seaKm(w, c.a.cell, c.b.cell)).toBeCloseTo(c.km, 6);
    for (const l of islandLinks(w).slice(0, 30)) { expect(l.km).toBeGreaterThanOrEqual(0); expect(isFinite(l.km) || l.kind === "next").toBe(true); }   // (a lifeline's length is the way over the sea, never 0 for two cells apart)
    const { OCEAN_MAX_RESTS } = await import("../../src/sim/sea22"); const r = run14({ seed: 5, until: 2100, islets: true }), oc = Object.values(r.sim.edges).filter(isOcean);
    expect(oc.length).toBeGreaterThan(0); for (const e of oc) expect((e as unknown as { rests22?: number }).rests22 ?? 0).toBeLessThanOrEqual(OCEAN_MAX_RESTS);
  }, 300000);
});
