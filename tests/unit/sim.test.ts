import { describe, expect, test } from "vitest";
import { CER_LABEL, TOKYO, performCeremony, previewCeremony, tokyoCity } from "../../src/sim/ceremony";
import { CATCHUP_CAP_MONTHS, advance, createSim, designate, noteSkipped, planCatchUp, routeLabel, routeOfficial, simHash, stepMonth, summary } from "../../src/sim/engine";
import { checkIntegrity, layPath } from "../../src/sim/network";
import { exportScenery } from "../../src/sim/scenery";
import { GRADE_LABEL, NICK_LABEL, eraLabel, ymLabel, type SimState } from "../../src/sim/types";
import { cellDistKm, pathfind } from "../../src/sim/world";
import { sanitizeSim } from "../../src/core/save2";
import { startedSim, testWorld } from "./simhelp";
import type { Vec } from "../../src/core/types";

const { w, hash } = testWorld();
const city = (n: string) => w.cities.find((c) => c.name === n)!;
const line = (a: Vec, b: Vec, n = 12): Vec[] => Array.from({ length: n + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n] as Vec);
function tokyoPair(): [Vec, Vec] {
  const t = tokyoCity(w)!; const cs: number[] = []; for (let k = 0; k < w.N; k++) if (w.t.land[k] === 1 && w.prefOf(k) === TOKYO) cs.push(k);
  let best: [number, number] = [cs[0], cs[1]], bd = 0; for (const a of cs) { const d = cellDistKm(w, a, t.cell); if (d > bd && d >= 10) { bd = d; best = [t.cell, a]; } }
  return [t.pos, w.cellPos(best[1])];
}
function ceremonySim(seed = 7): SimState {
  const sim = createSim(w, "m", hash, seed), t = tokyoCity(w)!;
  const k = previewCeremony(w, "kokudo1", line(t.pos, city("名古屋市").pos)), [a, b] = tokyoPair(), f = previewCeremony(w, "fudo1", line(a, b, 6));
  expect(k.ok, k.reasons.join()).toBe(true); expect(f.ok, f.reasons.join()).toBe(true);
  expect(performCeremony(sim, w, k, f)).toBe(true); return sim;
}

describe("era and labels", () => {
  test("fictional era after the 1945 renaming; official names are 国道/県道/府道, nicknames are separate", () => {
    expect(eraLabel(1945)).toBe("光文元年"); expect(eraLabel(1950)).toBe("光文6年"); expect(ymLabel(1950, 14)).toBe("光文7年(1951)3月");
    expect([GRADE_LABEL.national, GRADE_LABEL.ken, GRADE_LABEL.fu]).toEqual(["国道", "県道", "府道"]); expect([NICK_LABEL.national, NICK_LABEL.ken, NICK_LABEL.fu]).toEqual(["酷道", "険道", "腐道"]);
  });
});
describe("開通の儀", () => {
  test("a good pair of curves snaps to a path and starts the game, on top of the existing 1950 network", () => {
    const base = createSim(w, "m", hash, 7), before = Object.keys(base.edges).length, sim = ceremonySim(); expect(sim.ceremonyDone).toBe(true);
    const nat1 = Object.values(sim.routes).filter((r) => r.grade === "national" && r.scope === "JP" && r.number === 1), fu1 = Object.values(sim.routes).filter((r) => r.grade === "fu" && r.scope === TOKYO && r.number === 1);
    expect(nat1).toHaveLength(1); expect(fu1).toHaveLength(1); expect(routeOfficial(nat1[0])).toBe("国道1号"); expect(routeOfficial(fu1[0])).toContain("府道1号");
    expect(checkIntegrity(sim)).toEqual([]); expect(Object.keys(sim.edges).length).toBeGreaterThanOrEqual(before);
    const seen = new Set<string>(); for (const r of Object.values(sim.routes).filter((x) => x.active)) { const k = `${r.grade}:${r.scope}:${r.number}`; expect(seen.has(k), k).toBe(false); seen.add(k); }
    expect(sim.events.some((e) => e.kind === "ceremony" && e.text.includes("光文"))).toBe(true);
    expect(Object.values(sim.edges).every((e) => e.nick === false)).toBe(true);   // nobody is called 酷道 on day one
  });
  test("invalid lines are refused with a reason", () => {
    const t = tokyoCity(w)!, osaka = city("大阪市");
    expect(previewCeremony(w, "kokudo1", line(osaka.pos, t.pos)).reasons.join()).toContain("起点が東京府にありません");
    expect(previewCeremony(w, "kokudo1", line(t.pos, [t.pos[0] + 5, t.pos[1] + 5], 2)).reasons.join()).toContain("短すぎ");
    expect(previewCeremony(w, "kokudo1", line(t.pos, [t.pos[0] + 600, t.pos[1]])).reasons.join()).toContain("都市に届いていません");
    const hokkaido = w.cities.find((c) => c.island !== t.island && c.name === "札幌市")!;
    expect(previewCeremony(w, "kokudo1", line(t.pos, hokkaido.pos)).ok).toBe(false);
    expect(previewCeremony(w, "fudo1", line(t.pos, city("名古屋市").pos)).reasons.join()).toContain("東京府内にありません");
    expect(previewCeremony(w, "kokudo1", [t.pos]).ok).toBe(false);
  });
  test("a second ceremony is ignored", () => { const sim = ceremonySim(); const t = tokyoCity(w)!; const k = previewCeremony(w, "kokudo1", line(t.pos, city("名古屋市").pos)); expect(performCeremony(sim, w, k, k)).toBe(false); });
  test("labels use the official names", () => { expect(CER_LABEL.kokudo1).toContain("国道1号"); expect(CER_LABEL.fudo1).toContain("府道1号"); });
});
describe("road graph", () => {
  test("overlapping designation shares edges instead of duplicating them", () => {
    const { sim } = startedSim(3); const before = Object.keys(sim.edges).length, r1 = Object.values(sim.routes).find((r) => r.grade === "national" && r.number === 1)!;
    const cells = r1.edges.flatMap((x) => (x.dir === 1 ? sim.edges[x.edgeId].cells : [...sim.edges[x.edgeId].cells].reverse()));
    const again = layPath(sim, w, cells, { open: true, surface: "gravel", quality: 50, built: 1, month: 0 });
    expect(again.created).toEqual([]); expect(Object.keys(sim.edges).length).toBe(before);
    const r2 = designate(sim, again.chain, "ken", "JP-22", "overlap", "test")!;
    expect(r2.edges.map((e) => e.edgeId)).toEqual(r1.edges.map((e) => e.edgeId)); expect(checkIntegrity(sim)).toEqual([]);
    expect(Object.values(sim.routes).filter((r) => r.edges.some((x) => x.edgeId === r1.edges[0].edgeId)).length).toBeGreaterThanOrEqual(2);
  });
  test("a crossing road splits the existing edge and keeps routes connected", () => {
    const { sim } = startedSim(4); const e0 = Object.values(sim.edges).sort((a, b) => b.cells.length - a.cells.length)[0], mid = e0.cells[Math.floor(e0.cells.length / 2)];
    const nEdges = Object.keys(sim.edges).length, i = mid % w.nx, j = (mid / w.nx) | 0; let a = -1, b = -1;
    for (const [di, dj] of [[0, 3], [0, -3], [3, 0], [-3, 0]]) { const k = (j + dj) * w.nx + i + di; if (w.t.land[k] === 1 && w.t.island[k] === w.t.island[mid]) { if (a < 0) a = k; else if (b < 0 && k !== a) b = k; } }
    const p1 = pathfind(w, a, mid), p2 = pathfind(w, mid, b); if (!p1 || !p2) return;
    layPath(sim, w, [...p1, ...p2.slice(1)], { open: true, surface: "gravel", quality: 50, built: 1, month: 0 });
    expect(Object.keys(sim.edges).length).toBeGreaterThan(nEdges); expect(checkIntegrity(sim)).toEqual([]);
  });
  test("integrity checker catches a broken network", () => { const { sim } = startedSim(5); Object.values(sim.edges)[0].a = "n.999999"; expect(checkIntegrity(sim).length).toBeGreaterThan(0); });
});
describe("simulation over decades", () => {
  const run = (seed: number, years = 100) => { const { sim, w: ww } = startedSim(seed); advance(sim, ww, 12 * years); return sim; };
  test("every change has a recorded cause and the network stays consistent", () => {
    const sim = run(1); expect(sim.events.every((e) => e.cause.length > 0)).toBe(true); expect(checkIntegrity(sim)).toEqual([]);
    // the global log is capped, so decline is checked through the roads' own permanent histories
    const hist = (pre: string) => Object.values(sim.edges).some((e) => e.hist.some((h) => h.t.startsWith(pre)));
    for (const pre of ["休止", "閉鎖", "廃道化"]) expect(hist(pre), pre).toBe(true);
    expect(sim.links.length).toBeGreaterThan(0); expect(sim.events.some((e) => e.kind === "project")).toBe(true);
    expect(Object.values(sim.projects).some((p) => p.status === "unbuilt")).toBe(true);
  });
  test("route numbers stay unique per grade and scope; ids are stable; official names only", () => {
    const sim = run(2, 80), seen = new Set<string>(); for (const r of Object.values(sim.routes).filter((x) => x.active)) { const k = `${r.grade}:${r.scope}:${r.number}`; expect(seen.has(k), k).toBe(false); seen.add(k); expect(routeOfficial(r)).toMatch(/(国道|県道|府道)\d+号$/); }
    for (const r of Object.values(sim.routes)) expect(r.id).toMatch(/^r\.\d+$/);
  });
  test("deterministic: same seed and inputs give identical state; chunking does not matter; another seed differs", () => {
    const a = startedSim(11), b = startedSim(11), c = startedSim(11), d = startedSim(12);
    advance(a.sim, a.w, 360); advance(b.sim, b.w, 360); for (let i = 0; i < 12; i++) advance(c.sim, c.w, 30); advance(d.sim, d.w, 360);
    expect(simHash(a.sim)).toBe(simHash(b.sim)); expect(simHash(c.sim)).toBe(simHash(a.sim)); expect(simHash(d.sim)).not.toBe(simHash(a.sim));
  });
  test("save and restore mid-run continues identically", () => {
    const a = startedSim(13), b = startedSim(13); advance(a.sim, a.w, 300); advance(b.sim, b.w, 150);
    const re = sanitizeSim(JSON.parse(JSON.stringify(b.sim))); expect(re.problems).toEqual([]); advance(re.sim!, b.w, 150);
    expect(simHash(re.sim!)).toBe(simHash(a.sim));
  });
  test("construction can be interrupted and become 未成線 when money runs out", () => {
    const sim = run(3); const p = Object.values(sim.projects).find((q) => q.status === "unbuilt" || q.status === "suspended")!;
    expect(p).toBeTruthy(); expect(p.edgeIds.some((id) => sim.edges[id].built < 1)).toBe(true); expect(p.reason.length).toBeGreaterThan(0);
  });
});
describe("long absence and time control", () => {
  test("catch-up is capped and the skipped period is reported", () => {
    expect(planCatchUp(0, 5)).toEqual({ months: 0, skipped: 0 }); expect(planCatchUp(10_000, 0)).toEqual({ months: 0, skipped: 0 });
    expect(planCatchUp(60_000, 1)).toEqual({ months: 12, skipped: 0 }); expect(planCatchUp(60_000, 20)).toEqual({ months: 240, skipped: 0 });
    const big = planCatchUp(7 * 24 * 3600 * 1000, 20); expect(big.months).toBe(CATCHUP_CAP_MONTHS); expect(big.skipped).toBeGreaterThan(0);
    const { sim } = startedSim(1); noteSkipped(sim, 50 * 12 + 3); expect(sim.skippedMonths).toBe(603); expect(sim.events.at(-1)!.text).toContain("省略");
  });
  test("a capped catch-up finishes quickly", () => { const { sim, w: ww } = startedSim(1); const t0 = Date.now(); advance(sim, ww, CATCHUP_CAP_MONTHS); expect(Date.now() - t0).toBeLessThan(6000); expect(sim.month).toBe(CATCHUP_CAP_MONTHS); });
  test("single months advance one tick at a time", () => { const { sim, w: ww } = startedSim(1); stepMonth(sim, ww); expect(sim.month).toBe(1); });
});
describe("sanitising sim data", () => {
  test("garbage and inconsistent road data is rejected, never half-loaded", () => {
    for (const bad of [null, 3, "x", {}, { schemaVersion: 9 }]) expect(sanitizeSim(bad).sim).toBeNull();
    const { sim } = startedSim(1); expect(sanitizeSim(JSON.parse(JSON.stringify(sim))).sim).not.toBeNull();
    const jn = JSON.parse(JSON.stringify(sim)); Object.values<any>(jn.edges)[0].quality = null; expect(sanitizeSim(jn).sim).toBeNull();
    const j2 = JSON.parse(JSON.stringify(sim)); Object.values<any>(j2.edges)[0].cells = [1]; expect(sanitizeSim(j2).sim).toBeNull();
    const j3 = JSON.parse(JSON.stringify(sim)); Object.values<any>(j3.edges)[0].b = "n.404"; expect(sanitizeSim(j3).sim).toBeNull();
  });
});
describe("scenery json", () => {
  test("reports when/where/what with the 5 km caveat", () => {
    const { sim } = startedSim(1), e = Object.values(sim.edges)[0], mid = w.cellPos(e.cells[Math.floor(e.cells.length / 2)]);
    const j = exportScenery(sim, w, mid); expect(j.schema).toBe("kfm.scenery.v1"); expect(j.when.era).toBe("光文6年"); expect(j.road).not.toBeNull();
    expect(j.where.precisionKm).toBe(5); expect(j.notes).toContain("5km"); expect(exportScenery(sim, w, [-9999, -9999]).road).toBeNull();
    void routeLabel;
  });
});
