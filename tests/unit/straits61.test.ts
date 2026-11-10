import { describe, expect, it } from "vitest";
import { displayName, openStraits, STRAITS } from "../../src/sim/straits";
import { fixedLink } from "../../src/sim/ferry";
import { checkIntegrity } from "../../src/sim/network";
import { stage3Sim } from "./simhelp";
import type { SimEdge, SimState } from "../../src/sim/types";

/** Issue #61: a scripted crossing is a short facility between two shore anchors, with ordinary land lines from each city centre to its anchor. */
const fac = (sim: SimState, id: string) => Object.values(sim.edges).find((e) => e.facilityName?.startsWith(id + ":"));
const connected = (sim: SimState, e: SimEdge, ca: number, cb: number) => {
  const mode = e.mode === "rail" ? "rail" : "road", adj = new Map<string, string[]>(), nodeAt = new Map(Object.values(sim.nodes).map((n) => [n.cell, n.id]));
  for (const x of Object.values(sim.edges)) if (x.built >= 1 && x.state === "open" && (x.mode === "rail" ? "rail" : "road") === mode) { (adj.get(x.a) ?? adj.set(x.a, []).get(x.a)!).push(x.b); (adj.get(x.b) ?? adj.set(x.b, []).get(x.b)!).push(x.a); }
  const from = nodeAt.get(ca), to = nodeAt.get(cb); if (!from || !to) return false; const seen = new Set([from]), st = [from]; while (st.length) { const n = st.pop()!; if (n === to) return true; for (const m of adj.get(n) ?? []) if (!seen.has(m)) { seen.add(m); st.push(m); } } return false;
};
describe("Issue #61: the straits of the scripted crossings (関門・青函・瀬戸・明石・鳴門・西瀬戸)", () => {
  const { sim, w } = stage3Sim("heisei", 7, true, 0, 2, true); delete (sim as { crossings?: boolean }).crossings; sim.edges = Object.fromEntries(Object.entries(sim.edges).filter(([, e]) => !e.facilityName?.includes(":")));
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
