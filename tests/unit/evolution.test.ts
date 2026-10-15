import { describe, expect, test } from "vitest";
import { sanitizeSim } from "../../src/core/save2";
import { ZERO_DEMAND, analyze, strandedWithout } from "../../src/sim/demand";
import { CLOSE_YEARS, DORMANT_YEARS, DROP_YEARS, EQUAL_SHARE, LOCAL_KEEP, advance, checkIntegrity, createSim, routeLabel, routeOfficial, simHash, summary } from "../../src/sim/engine";
import { finishMigration } from "../../src/sim/migrate";
import { setEdgeState } from "../../src/sim/network";
import { NICK_LABEL, type SimState } from "../../src/sim/types";
import type { World } from "../../src/sim/world";
import { startedSim, testWorld } from "./simhelp";

const memo = new Map<number, { sim: SimState; w: World; rows: Record<number, ReturnType<typeof measure>> }>();
function measure(sim: SimState, w: World) {
  const s = summary(sim), edges = Object.values(sim.edges), last = sim.stats[sim.stats.length - 1];
  return { ...s, prefsWithRoad: new Set(edges.filter((e) => e.state === "open" && e.built >= 1).map((e) => e.region)).size, regionsBuilding: last?.regionsBuilding ?? 0, building: s.building, pop: Object.values(sim.cities).reduce((a, c) => a + c.pop, 0), villagePop: Object.values(sim.settlements).reduce((a, v) => a + v.pop, 0), edgesTotal: edges.length, pending: Object.values(sim.projects).filter((p) => p.status === "building").length, bypass: sim.links.length, nick: edges.filter((e) => e.nick).length, w };
}
/** One shared 100-year run per seed (1950-2050), sampled every 5 years. */
function century(seed: number) {
  let m = memo.get(seed); if (m) return m;
  const { sim, w } = startedSim(seed), rows: Record<number, ReturnType<typeof measure>> = { 1950: measure(sim, w) }; let maxBuilding = 0;
  for (let y = 1950; y < 2050; y++) { advance(sim, w, 12); maxBuilding = Math.max(maxBuilding, Object.values(sim.projects).filter((p) => p.status === "building").length); if ((y + 1) % 5 === 0) rows[y + 1] = measure(sim, w); }
  (rows as any).maxBuilding = maxBuilding; m = { sim, w, rows }; memo.set(seed, m); return m;
}
const BIG = new Set(["東京", "大阪市", "名古屋市", "横浜市", "神戸市", "京都市", "福岡市", "札幌市"]);

describe("1950 starting network (地方にも既存道路)", () => {
  const { sim, w } = startedSim(1);
  test("every prefecture already has roads, settlements are tied to their cities, nothing is double counted", () => {
    const prefs = new Set(Object.values(sim.edges).filter((e) => e.state === "open").map((e) => e.region)); expect(prefs.size).toBeGreaterThanOrEqual(45);
    expect(Object.keys(sim.edges).length).toBeGreaterThan(200); expect(Object.keys(sim.settlements).length).toBeGreaterThan(100);
    const an = analyze(sim, w), reach = [...an.reach.values()].filter(Boolean).length; expect(reach / an.reach.size).toBeGreaterThan(0.9);
    const steps = new Set<string>(); for (const e of Object.values(sim.edges)) for (let i = 0; i + 1 < e.cells.length; i++) { const k = e.cells[i] < e.cells[i + 1] ? `${e.cells[i]}:${e.cells[i + 1]}` : `${e.cells[i + 1]}:${e.cells[i]}`; expect(steps.has(k), k).toBe(false); steps.add(k); }
    expect(checkIntegrity(sim)).toEqual([]);
  });
  test("they start as plain thin roads with official names; nobody is called 酷道 yet; the ceremony roads are 国道1号 and 府道1号", () => {
    expect(Object.values(sim.edges).every((e) => e.standard === "rural" && !e.nick)).toBe(true);
    const labels = Object.values(sim.routes).map(routeLabel); expect(labels.every((l) => /(国道|県道|府道)\d+号$/.test(l))).toBe(true); expect(labels.some((l) => /酷道|険道|腐道/.test(l))).toBe(false);
    expect(Object.values(sim.routes).filter((r) => r.grade === "national" && r.number === 1)).toHaveLength(1);
    expect(Object.values(sim.routes).some((r) => r.grade === "national") && Object.values(sim.routes).some((r) => r.grade === "ken") && Object.values(sim.routes).some((r) => r.grade === "fu")).toBe(true);
    expect(Object.values(sim.edges).some((e) => !Object.values(sim.routes).some((r) => r.edges.some((x) => x.edgeId === e.id)))).toBe(true);   // plain municipal roads exist too
  });
  test("regional budgets: shares sum to 1 and no prefecture is left without a floor", () => {
    advance(sim, w, 12); const v = Object.values(sim.regionShare); expect(v.length).toBe(w.t.prefOrder.length); expect(v.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6); expect(Math.min(...v)).toBeGreaterThanOrEqual(EQUAL_SHARE / v.length - 1e-9);
  });
});
describe("simultaneous regional development (同時多発)", () => {
  test("many prefectures build at once, not just Tokyo or the big cities", () => {
    const { sim, rows } = century(1); const early = [1955, 1960, 1965, 1970, 1975, 1980].map((y) => rows[y].regionsBuilding);
    expect(Math.max(...early)).toBeGreaterThanOrEqual(8); expect((rows as any).maxBuilding).toBeGreaterThanOrEqual(10);
    const projs = Object.values(sim.projects); expect(new Set(projs.map((p) => p.region)).size).toBeGreaterThanOrEqual(25);
    const big = projs.filter((p) => BIG.has(sim.nodes[p.from]?.name ?? "") || BIG.has(sim.nodes[p.to]?.name ?? "")).length / projs.length; expect(big).toBeLessThan(0.45);
    expect(projs.filter((p) => p.region === "JP-13").length / projs.length).toBeLessThan(0.2);
    for (const k of ["upgrade", "improve", "bypass"] as const) expect(projs.some((p) => p.kind === k), k).toBe(true);
  });
  test("density stays sane and the run is fast enough for a phone", () => {
    const { rows } = century(1); expect(rows[2000].km / rows[1950].km).toBeLessThan(1.6); expect(rows[2000].km / rows[1950].km).toBeGreaterThan(0.8);
    const t0 = Date.now(); const { sim, w } = startedSim(5); advance(sim, w, 12 * 20); expect(Date.now() - t0).toBeLessThan(15000);
  });
});
describe("new road vs old road (バイパス・旧道)", () => {
  test("a bypass pulls the through traffic off the old road, which keeps its local traffic", () => {
    const { sim } = century(1); expect(sim.links.length).toBeGreaterThan(3);
    const shifted = sim.links.filter((l) => { const o = sim.edges[l.oldEdges[0]], nsum = l.newEdges.reduce((s, id) => s + sim.edges[id].through, 0); return o.peakThrough >= 500 && o.through <= 0.6 * o.peakThrough && nsum > 0; });
    expect(shifted.length).toBeGreaterThanOrEqual(1);
    for (const l of sim.links) for (const id of l.newEdges) expect(sim.edges[id].bypassOf).toContain(l.oldEdges[0]);
    const olds = Object.values(sim.edges).filter((e) => e.bypassedBy.length), withLocal = olds.filter((e) => e.local > 0 && e.state === "open");
    expect(withLocal.length).toBeGreaterThanOrEqual(1);
  });
  test("an old road whose local role remains is kept (administration changes, it is not abolished); no downgrade before the through collapse has lasted", () => {
    for (const seed of [1, 2]) {
      const { sim } = century(seed), olds = Object.values(sim.edges).filter((e) => e.bypassedBy.length);
      const handed = olds.filter((e) => e.hist.some((h) => h.t.includes("所管変更")));
      for (const e of olds) { const link = sim.links.find((l) => l.oldEdges.includes(e.id)); if (!link) continue; for (const h of e.hist) if (h.t.includes("所管変更") || h.t.includes("指定を解除")) expect(h.m - link.month, `${e.id} ${h.t}`).toBeGreaterThanOrEqual(DROP_YEARS * 12 - 12); }
      if (seed === 1) { expect(handed.length).toBeGreaterThanOrEqual(1); for (const e of handed) { expect(e.hist.some((h) => h.t.includes("沿線需要"))).toBe(true); expect(e.state === "open" || e.state === "dormant" || e.state === "closed" || e.state === "lost").toBe(true); } }
      expect(LOCAL_KEEP).toBeGreaterThan(0);
    }
  });
});
describe("zero demand, closure, revival", () => {
  test("zero demand is an explicit threshold and a number of years; closure needs an alternative and never strands a settlement", () => {
    const { sim, w } = startedSim(21), an0 = analyze(sim, w);
    // a settlement whose only road is one edge: closing that edge would cut it off
    const deg = new Map<string, string[]>(); for (const e of Object.values(sim.edges)) for (const n of [e.a, e.b]) (deg.get(n) ?? deg.set(n, []).get(n)!).push(e.id);
    const sole = Object.values(sim.settlements).map((v) => ({ v, n: Object.values(sim.nodes).find((x) => x.cell === v.cell) })).filter((x) => x.n && deg.get(x.n.id)?.length === 1 && an0.reach.get(x.v.id)).map((x) => sim.edges[deg.get(x.n!.id)![0]]);
    expect(sole.length).toBeGreaterThan(5); expect(strandedWithout(sim, w, sole[0]).villages).toBeGreaterThanOrEqual(1);
    for (let y = 0; y < 15; y++) { for (const c of Object.values(sim.cities)) { c.pop = 10; c.industry = 0; } for (const v of Object.values(sim.settlements)) if (!v.gone) v.pop = 3000; advance(sim, w, 12); }   // big villages, but no through demand: they keep their own roads alive
    const edges = Object.values(sim.edges);
    for (const e of sole) expect(e.state, `${e.id} is the only access of a village`).not.toBe("closed");
    const closed = edges.filter((e) => e.state === "closed" && e.built >= 1), dormant = edges.filter((e) => e.state === "dormant");
    expect(dormant.length + closed.length).toBeGreaterThan(5);
    for (const e of closed) expect(e.hist.some((h) => h.t.includes("代替路あり") && h.t.includes("需要ゼロ"))).toBe(true);
    for (const e of dormant) expect(e.hist.some((h) => /需要が[5-9]年連続でほぼゼロ/.test(h.t))).toBe(true);
    expect(ZERO_DEMAND).toBe(4); expect(DORMANT_YEARS).toBe(5); expect(CLOSE_YEARS).toBe(12);
  });
  test("a closed road comes back when people return to it (再整備・復活)", () => {
    const { sim, w } = startedSim(22); advance(sim, w, 12);
    const e = Object.values(sim.edges).filter((x) => x.state === "open" && x.built >= 1 && x.cells.length >= 6 && !sim.settlements[x.id]).sort((a, b) => (a.id < b.id ? -1 : 1))[3];
    setEdgeState(sim, e, "closed", "テストで閉鎖"); const mid = e.cells[Math.floor(e.cells.length / 2)]; let cell = -1;
    for (const d of [1, -1, w.nx, -w.nx]) if (w.t.land[mid + d] === 1 && !Object.values(sim.settlements).some((q) => q.cell === mid + d)) { cell = mid + d; break; }
    const city = w.cities.find((c) => c.island === w.t.island[mid])!; sim.settlements["s.9999"] = { id: "s.9999", name: "テスト新町", cell, city: city.id, pop: 20000, pop0: 20000, isolatedYears: 0, gone: false };
    let planned = false, reopened = false;
    for (let y = 0; y < 25 && !reopened; y++) { advance(sim, w, 12); if (Object.values(sim.projects).some((p) => p.kind === "restore" && p.edgeIds.includes(e.id))) planned = true; if (sim.edges[e.id].state === "open") reopened = true; }
    expect(planned).toBe(true); expect(reopened).toBe(true); expect(sim.edges[e.id].hist.some((h) => h.t.includes("供用(再開)"))).toBe(true);
  });
});
describe("1950-2050: roads, population and decline that can be seen", () => {
  test("decade figures: development, then idle/closed/abandoned roads and shrinking population", () => {
    const { sim, rows } = century(1); const idle = (y: number) => rows[y].dormant + rows[y].closed + rows[y].lost;
    expect(idle(2050)).toBeGreaterThan(idle(2000)); expect(rows[2050].lost).toBeGreaterThanOrEqual(3); expect(rows[2050].poor).toBeGreaterThan(rows[2000].poor + 5);
    const peakPop = Math.max(...Object.values(rows).map((r) => (typeof r === "object" ? (r as any).pop : 0)));
    expect(rows[2050].pop).toBeLessThan(peakPop * 0.85); expect(rows[2050].villagePop).toBeLessThan(rows[1950].villagePop * 0.97 || 1e12);
    expect(rows[2050].bypass).toBeGreaterThan(rows[1980].bypass); expect(rows[2050].nick).toBeGreaterThanOrEqual(3); expect(rows[1950].nick).toBe(0);
    expect(sim.snaps.length).toBeGreaterThanOrEqual(9); expect(sim.snaps[0].year).toBe(1950);
    const a = sim.snaps.find((s) => s.year === 2000)!, b = sim.snaps[sim.snaps.length - 1]; let worse = 0; for (const [id, c] of Object.entries(b.edges)) { const o = a.edges[id]; if (o !== undefined && Math.floor(c / 16) > Math.floor(o / 16)) worse++; }
    expect(worse).toBeGreaterThanOrEqual(3);   // the map comparison has something to show
    process.stderr.write("\n" + [1950, 1970, 1990, 2010, 2030, 2050].map((y) => `${y}: 道路${rows[y].km}km 路線${rows[y].routes} 人口${Math.round(rows[y].pop / 1e6)}M 集落${Math.round(rows[y].villagePop / 1000)}k 休止${rows[y].dormant}/閉鎖${rows[y].closed}/廃道${rows[y].lost} バイパス${rows[y].bypass} 通称${rows[y].nick} 同時着工府県${rows[y].regionsBuilding}(着工中${(rows[y] as any).pending}件) 区間${(rows[y] as any).edgesTotal}`).join("\n") + "\n");
  });
  test("nicknames are earned: only rough, thin, designated roads; the official name never changes", () => {
    const { sim } = century(1); for (const e of Object.values(sim.edges).filter((x) => x.nick)) { expect(e.standard).toBe("rural"); expect(e.hist.some((h) => h.t.includes("通称"))).toBe(true); }
    const r = Object.values(sim.routes).find((x) => x.active && x.nick); if (r) { expect(routeLabel(r)).toContain(`通称:${NICK_LABEL[r.grade]}`); expect(routeOfficial(r)).not.toContain("通称"); }
  });
  test("deterministic across the whole century", () => { const a = century(1), b = startedSim(1); advance(b.sim, b.w, 1200); expect(simHash(a.sim)).toBe(simHash(b.sim)); });
});
describe("compatibility with Stage 2 (v1) road saves", () => {
  test("an old save without the new fields loads, is completed, and keeps simulating", () => {
    const { w } = testWorld(); const { sim } = startedSim(31); advance(sim, w, 36);
    const old = JSON.parse(JSON.stringify(sim)); old.schemaVersion = 1;
    for (const e of Object.values<any>(old.edges)) for (const k of ["standard", "state", "through", "local", "peakThrough", "zeroYears", "reviveYears", "congYears", "nick", "region", "hist", "bypassOf", "bypassedBy", "throughDropYears"]) delete e[k];
    for (const r of Object.values<any>(old.routes)) { delete r.nick; delete r.oldEdges; r.name = "酷道" + r.number + "号"; } for (const p of Object.values<any>(old.projects)) { delete p.region; delete p.replaces; }
    delete old.settlements; delete old.links; delete old.snaps; delete old.regionShare;
    const r = sanitizeSim(old); expect(r.problems).toEqual([]); const s = r.sim!; expect(s.schemaVersion).toBe(3); finishMigration(s, w);
    expect(Object.values(s.edges).every((e) => e.region.length > 0 && e.state)).toBe(true); expect(Object.values(s.routes).every((x) => /(国道|県道|府道)/.test(x.name))).toBe(true);
    advance(s, w, 12 * 10); expect(checkIntegrity(s)).toEqual([]); expect(s.month).toBe(36 + 120);
  });
});
