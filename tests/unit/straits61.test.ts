import { describe, expect, it } from "vitest";
import { chainContinuous, displayName, openStraits, shoreAnchorCandidates, STRAITS } from "../../src/sim/straits";
import { fixedLink } from "../../src/sim/ferry";
import { checkIntegrity } from "../../src/sim/network";
import { realWorld, stage3Sim, stage3SimOn } from "./simhelp";
import { pathfind } from "../../src/sim/world";
import type { SimEdge, SimState } from "../../src/sim/types";

/** Issue #61: a scripted crossing is a short facility between two shore anchors, with ordinary land lines from each city centre to its anchor. */
const fac = (sim: SimState, id: string) => Object.values(sim.edges).find((e) => e.facilityName?.startsWith(id + ":"));
const connected = (sim: SimState, e: SimEdge, ca: number, cb: number) => {
  const mode = e.mode === "rail" ? "rail" : "road", adj = new Map<string, string[]>(), nodeAt = new Map(Object.values(sim.nodes).map((n) => [n.cell, n.id]));
  for (const x of Object.values(sim.edges)) if (x.built >= 1 && x.state === "open" && (x.mode === "rail" ? "rail" : "road") === mode) { (adj.get(x.a) ?? adj.set(x.a, []).get(x.a)!).push(x.b); (adj.get(x.b) ?? adj.set(x.b, []).get(x.b)!).push(x.a); }
  const from = nodeAt.get(ca), to = nodeAt.get(cb); if (!from || !to) return false; const seen = new Set([from]), st = [from]; while (st.length) { const n = st.pop()!; if (n === to) return true; for (const m of adj.get(n) ?? []) if (!seen.has(m)) { seen.add(m); st.push(m); } } return false;
};
describe("Issue #61: the straits of the scripted crossings (関門・青函・瀬戸・明石・鳴門・西瀬戸)", () => {
  const { sim, w } = stage3Sim("heisei", 7, true, 0, 2, true); delete (sim as { crossings?: boolean }).crossings;
  openStraits(sim, w, 2100, true);
  const rows = STRAITS.map((s) => { const e = fac(sim, s.id), ca = w.cityById.get(s.a), cb = w.cityById.get(s.b); return { s, e, ca, cb, before: ca && cb ? Math.round(Math.hypot(ca.pos[0] - cb.pos[0], ca.pos[1] - cb.pos[1]) * 10) / 10 : 0 }; });
  process.stderr.write("S61 " + rows.map((r) => `${r.s.id}: before ${r.before}km after ${r.e ? r.e.lengthKm + "km" : "(not on this map)"}`).join(" | ") + "\n");
  it("every crossing the map can hold opened, and the 関門 pair and the 青函 are among them", () => { expect(rows.filter((r) => r.e).length).toBeGreaterThanOrEqual(6); for (const id of ["kanmon-rail", "kanmon-road", "seikan"]) expect(rows.find((r) => r.s.id === id)!.e, id).toBeTruthy(); });
  it("the facility is the water crossing only: two shore anchors one cell-scale apart, far shorter than the city-to-city line", () => {
    for (const r of rows.filter((x) => x.e)) { const e = r.e!; expect(e.cells.length, r.s.id).toBe(2); expect(e.lengthKm, r.s.id).toBeLessThan(r.before * 0.5); expect(e.lengthKm, r.s.id).toBeLessThanOrEqual(30); expect(w.t.land[e.cells[0]]).toBe(1); expect(w.t.land[e.cells[1]]).toBe(1); expect(w.lm[e.cells[0]]).not.toBe(w.lm[e.cells[1]]); }
    const k = rows.find((r) => r.s.id === "kanmon-rail")!; expect(k.before).toBeGreaterThan(80); expect(k.e!.lengthKm).toBeLessThanOrEqual(15);
  });
  it("each side is an ordinary land line from the city centre to the anchor, joined into one connected network and one route", () => {
    for (const r of rows.filter((x) => x.e)) {
      const e = r.e!; expect(connected(sim, e, r.ca!.cell, r.cb!.cell), r.s.id).toBe(true);
      const route = Object.values(sim.routes).find((q) => q.edges.some((x) => x.edgeId === e.id)); expect(route, r.s.id).toBeTruthy(); expect(route!.edges.length, r.s.id).toBeGreaterThanOrEqual(3);
      const land = route!.edges.filter((x) => x.edgeId !== e.id).map((x) => sim.edges[x.edgeId]); expect(land.every((x) => !x.facility)).toBe(true); expect(land.reduce((a, x) => a + x.lengthKm, 0)).toBeGreaterThan(e.lengthKm);
    }
  });
  it("the route, the facility and its upkeep are consistent: one route of the facility's mode and operator, a built, open, paved facility", () => {
    for (const r of rows.filter((x) => x.e)) { const e = r.e!, route = Object.values(sim.routes).find((q) => q.edges.some((x) => x.edgeId === e.id))!; for (const x of route.edges) { const ed = sim.edges[x.edgeId]; expect((ed.mode === "rail"), r.s.id).toBe(e.mode === "rail"); expect(ed.built).toBeGreaterThanOrEqual(1); expect(ed.state).toBe("open"); } expect(displayName(e)).toBe(r.s.name); }
  });
  it("a fixed link is found by its land masses (duplicate detection), nothing opens twice, the integrity check holds, and a save round-trip keeps it all", () => {
    for (const r of rows.filter((x) => x.e)) { const f = fixedLink(sim, w, w.lm[r.e!.cells[0]], w.lm[r.e!.cells[1]], r.e!.mode === "rail" ? "rail" : "road"); expect(f, r.s.id).toBeTruthy(); expect(f!.facility === "bridge" || f!.facility === "tunnel").toBe(true); }   /* (found by the two land masses; the 西瀬戸 shares its masses with the 瀬戸大橋, so the first of them answers) */
    expect(openStraits(sim, w, 2100, true)).toBe(0); expect(checkIntegrity(sim)).toEqual([]);
    const back = JSON.parse(JSON.stringify(sim)) as SimState; for (const r of rows.filter((x) => x.e)) expect(back.edges[r.e!.id].lengthKm).toBe(r.e!.lengthKm); expect(openStraits(back, w, 2100, true)).toBe(0);
  });
});

describe("Issue #61 fail-safe: a facility is never left with an anchor cut off from its city", () => {
  const fresh = () => { const g = stage3Sim("heisei", 7, true, 0, 2, true); delete (g.sim as { crossings?: boolean }).crossings; return g; };
  const routeOf = (sim: SimState, e: SimEdge) => Object.values(sim.routes).find((q) => q.edges.some((x) => x.edgeId === e.id))!;
  it("every crossing's route is one continuous chain (each edge shares a node with the next), not just 'connected through other edges'", () => {
    const { sim, w } = fresh(); openStraits(sim, w, 2100, true); let n = 0;
    for (const s of STRAITS) { const e = fac(sim, s.id); if (!e) continue; n++; const r = routeOf(sim, e); expect(chainContinuous(sim, r.edges), s.id).toBe(true); expect(r.edges.length, s.id).toBeGreaterThanOrEqual(3); } expect(n).toBeGreaterThanOrEqual(6);
  });
  it("if no land line can be drawn at all, the old city-to-city facility is used and the history says so (nothing is half built)", () => {
    const { sim, w } = fresh(); const before = Object.keys(sim.edges).length; openStraits(sim, w, 2100, true, () => null);
    for (const s of STRAITS) { const e = fac(sim, s.id), ca = w.cityById.get(s.a), cb = w.cityById.get(s.b); if (!e || !ca || !cb) continue; if (e.cells[0] === ca.cell || e.cells[0] === cb.cell) { expect(e.cells).toEqual([ca.cell, cb.cell]); expect(e.hist.some((h) => h.t.includes("代用")), s.id).toBe(true); expect(routeOf(sim, e).edges.length).toBe(1); } }
    expect(Object.keys(sim.edges).length).toBeGreaterThan(before);
  });
  it("if the first candidate's land line fails, the next candidate shore pair is used (a different place on the shore) and both lines exist", () => {
    const { sim, w } = fresh(); let calls = 0; const pf: typeof pathfind = (ww, a, b, o) => (calls++ < 2 ? null : pathfind(ww, a, b, o)); openStraits(sim, w, 2100, true, pf);
    const e = fac(sim, "kanmon-road")!, ca = w.cityById.get("C-JP-35")!;   /* (the rail one opened at the start, before the failing finder was in place) */ const first = shoreAnchorCandidates(w, ca.cell, w.cityById.get("C-1159141097")!.cell, 3);
    expect(first.length).toBeGreaterThanOrEqual(2); expect(e.cells[0] === first[0].a && e.cells[1] === first[0].b).toBe(false); expect(e.hist.some((h) => h.t.includes("代用"))).toBe(false); expect(chainContinuous(sim, routeOf(sim, e).edges)).toBe(true);
  });
  it("on the island-enlarged real map (島拡大) every crossing that opens has a continuous route and a short facility", () => {
    const base = realWorld(true, true, 3), g = stage3SimOn(base, 0, 7, {}) as unknown as { sim: SimState; w: import("../../src/sim/world").World }; delete (g.sim as { crossings?: boolean }).crossings; openStraits(g.sim, g.w, 2100, true);
    let n = 0; for (const s of STRAITS) { const e = fac(g.sim, s.id); if (!e) continue; n++; expect(e.lengthKm, s.id).toBeLessThanOrEqual(30); expect(chainContinuous(g.sim, routeOf(g.sim, e).edges), s.id).toBe(true); } expect(n).toBeGreaterThanOrEqual(4);
  });
});
