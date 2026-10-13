import { describe, expect, test } from "vitest";
import { CER_LABEL, TOKYO, performCeremony, previewCeremony, tokyoCity } from "../../src/sim/ceremony";
import { CATCHUP_CAP_MONTHS, advance, createSim, designate, noteSkipped, planCatchUp, simHash, stepMonth, summary } from "../../src/sim/engine";
import { checkIntegrity, layPath } from "../../src/sim/network";
import { exportScenery } from "../../src/sim/scenery";
import { GRADE_LABEL, eraLabel, ymLabel, type SimState } from "../../src/sim/types";
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
  test("fictional era after the 1945 renaming; display names", () => {
    expect(eraLabel(1945)).toBe("光文元年"); expect(eraLabel(1950)).toBe("光文6年"); expect(ymLabel(1950, 14)).toBe("光文7年(1951)3月");
    expect([GRADE_LABEL.national, GRADE_LABEL.ken, GRADE_LABEL.fu]).toEqual(["酷道", "険道", "腐道"]);
  });
});
describe("開通の儀", () => {
  test("a good pair of curves snaps to a path and starts the game", () => {
    const sim = ceremonySim(); expect(sim.ceremonyDone).toBe(true);
    const rs = Object.values(sim.routes); expect(rs.map((r) => `${r.grade}:${r.scope}:${r.number}`).sort()).toEqual([`fu:${TOKYO}:1`, "national:JP:1"]);
    expect(checkIntegrity(sim)).toEqual([]); expect(summary(sim).routes).toBe(2);
    expect(Object.values(sim.edges).every((e) => e.open && e.built === 1)).toBe(true);
    expect(sim.events.some((e) => e.kind === "ceremony" && e.text.includes("光文"))).toBe(true);
  });
  test("invalid lines are refused with a reason", () => {
    const t = tokyoCity(w)!, osaka = city("大阪市");
    expect(previewCeremony(w, "kokudo1", line(osaka.pos, t.pos)).reasons.join()).toContain("起点が東京府にありません");
    expect(previewCeremony(w, "kokudo1", line(t.pos, [t.pos[0] + 5, t.pos[1] + 5], 2)).reasons.join()).toContain("短すぎ");
    expect(previewCeremony(w, "kokudo1", line(t.pos, [t.pos[0] + 600, t.pos[1]])).reasons.join()).toContain("都市に届いていません");
    const hokkaido = w.cities.find((c) => c.island !== t.island && c.name === "札幌市")!;
    const far = previewCeremony(w, "kokudo1", line(t.pos, hokkaido.pos)); expect(far.ok).toBe(false);
    expect(previewCeremony(w, "fudo1", line(t.pos, city("名古屋市").pos)).reasons.join()).toContain("東京府内にありません");
    expect(previewCeremony(w, "kokudo1", [t.pos]).ok).toBe(false);
  });
  test("a second ceremony is ignored", () => { const sim = ceremonySim(); const t = tokyoCity(w)!; const k = previewCeremony(w, "kokudo1", line(t.pos, city("名古屋市").pos)); expect(performCeremony(sim, w, k, k)).toBe(false); });
  test("labels exist for both roads", () => { expect(CER_LABEL.kokudo1).toContain("酷道1号"); expect(CER_LABEL.fudo1).toContain("腐道1号"); });
});
describe("road graph", () => {
  test("overlapping designation shares edges instead of duplicating them", () => {
    const { sim } = startedSim(3); const before = Object.keys(sim.edges).length, r1 = Object.values(sim.routes)[0];
    const cells = r1.edges.flatMap((x) => (x.dir === 1 ? sim.edges[x.edgeId].cells : [...sim.edges[x.edgeId].cells].reverse()));
    const again = layPath(sim, w, cells, { open: true, surface: "gravel", quality: 50, built: 1, month: 0 });
    expect(again.created).toEqual([]); expect(Object.keys(sim.edges).length).toBe(before);
    const r2 = designate(sim, again.chain, "ken", "JP-22", "overlap", "test")!;
    expect(r2.edges.map((e) => e.edgeId)).toEqual(r1.edges.map((e) => e.edgeId)); expect(checkIntegrity(sim)).toEqual([]);
    expect(Object.values(sim.routes).filter((r) => r.edges.some((x) => x.edgeId === r1.edges[0].edgeId)).length).toBe(2);
  });
  test("a crossing road splits the existing edge and keeps routes connected", () => {
    const { sim } = startedSim(4); const e0 = Object.values(sim.edges).sort((a, b) => b.cells.length - a.cells.length)[0], mid = e0.cells[Math.floor(e0.cells.length / 2)];
    const len = Object.values(sim.edges).reduce((s, e) => s + e.lengthKm, 0), nEdges = Object.keys(sim.edges).length;
    // approach the middle cell from two off-road neighbours
    const i = mid % w.nx, j = (mid / w.nx) | 0; let a = -1, b = -1;
    for (const [di, dj] of [[0, 3], [0, -3], [3, 0], [-3, 0]]) { const k = (j + dj) * w.nx + i + di; if (w.t.land[k] === 1 && w.t.island[k] === w.t.island[mid]) { if (a < 0) a = k; else if (b < 0 && Math.hypot(di, dj) > 0 && k !== a) b = k; } }
    const p1 = pathfind(w, a, mid), p2 = pathfind(w, mid, b); if (!p1 || !p2) return;
    const path = [...p1, ...p2.slice(1)]; layPath(sim, w, path, { open: true, surface: "gravel", quality: 50, built: 1, month: 0 });
    expect(Object.keys(sim.edges).length).toBeGreaterThan(nEdges + 1); expect(checkIntegrity(sim)).toEqual([]);
    expect(Object.values(sim.edges).some((e) => sim.nodes[e.a].kind === "junction" || sim.nodes[e.b].kind === "junction")).toBe(true);
    void len;
  });
  test("integrity checker catches a broken network", () => {
    const { sim } = startedSim(5); const e = Object.values(sim.edges)[0]; e.a = "n.999999"; expect(checkIntegrity(sim).length).toBeGreaterThan(0);
  });
});
describe("simulation over decades", () => {
  const run = (seed: number) => { const { sim, w: ww } = startedSim(seed); advance(sim, ww, 12 * 160); return sim; };
  test("roads develop then decline; every change has a recorded cause", () => {
    const sim = run(1), s = sim.stats, peak = Math.max(...s.map((x) => x.km));
    expect(peak).toBeGreaterThan(1500); expect(s[s.length - 1].km).toBeLessThan(peak); expect(Object.values(sim.edges).some((e) => e.lost)).toBe(true);
    expect(sim.events.every((e) => e.cause.length > 0)).toBe(true); expect(checkIntegrity(sim)).toEqual([]);
    const kinds = new Set(sim.events.map((e) => e.kind)); for (const k of ["project", "open", "lost", "close", "promote"]) expect(kinds.has(k), k).toBe(true);
    expect(sim.events.some((e) => e.text.includes("工事中断"))).toBe(true); expect(sim.events.some((e) => e.text.includes("未成線化"))).toBe(true);
    expect(Object.values(sim.projects).some((p) => p.status === "unbuilt" || p.status === "abolished")).toBe(true);
  });
  test("route numbers stay unique per grade and scope; ids are stable across promotion", () => {
    const sim = run(2), seen = new Set<string>(); for (const r of Object.values(sim.routes).filter((x) => x.active)) { const k = `${r.grade}:${r.scope}:${r.number}`; expect(seen.has(k), k).toBe(false); seen.add(k); }
    const promoted = Object.values(sim.routes).find((r) => r.history.some((h) => h.text === "昇格"));
    expect(promoted).toBeTruthy(); expect(promoted!.id).toMatch(/^r\.\d+$/); expect(promoted!.history.length).toBeGreaterThanOrEqual(2); expect(promoted!.grade).toBe("national");
    const nums = Object.values(sim.routes).filter((r) => r.grade === "national").map((r) => r.number); expect(new Set(nums).size).toBe(nums.length);
  });
  test("a low-traffic national route is demoted (or retired) while keeping its stable id", () => {
    const { sim, w: ww } = startedSim(6); const hk = ww.cities.filter((c) => c.island === ww.cities.find((q) => q.name === "福岡市")!.island);
    const a = hk.find((c) => c.name === "熊本市")!, b = hk.find((c) => c.name === "鹿児島市")!, p = pathfind(ww, a.cell, b.cell)!;
    const l = layPath(sim, ww, p, { open: true, surface: "gravel", quality: 80, built: 1, month: 0 }), r = designate(sim, l.chain, "national", "JP", "t", "t")!; r.lowYears = 5;
    const old = `${r.grade}${r.number}`; advance(sim, ww, 12);
    expect(!r.active || `${r.grade}${r.number}` !== old).toBe(true); expect(sim.routes[r.id]).toBe(r); expect(checkIntegrity(sim)).toEqual([]);
  });
  test("deterministic: same seed and inputs give identical state; chunking does not matter; another seed differs", () => {
    const a = startedSim(11), b = startedSim(11), c = startedSim(11), d = startedSim(12);
    advance(a.sim, a.w, 600); advance(b.sim, b.w, 600); for (let i = 0; i < 20; i++) advance(c.sim, c.w, 30); advance(d.sim, d.w, 600);
    expect(simHash(a.sim)).toBe(simHash(b.sim)); expect(simHash(c.sim)).toBe(simHash(a.sim)); expect(simHash(d.sim)).not.toBe(simHash(a.sim));
  });
  test("save and restore mid-run continues identically", () => {
    const a = startedSim(13), b = startedSim(13); advance(a.sim, a.w, 400); advance(b.sim, b.w, 200);
    const re = sanitizeSim(JSON.parse(JSON.stringify(b.sim))); expect(re.problems).toEqual([]); advance(re.sim!, b.w, 200);
    expect(simHash(re.sim!)).toBe(simHash(a.sim));
  });
  test("construction can be interrupted and become 未成線 when money runs out", () => {
    const sim = run(3); const p = Object.values(sim.projects).find((q) => q.status === "unbuilt" || q.status === "abolished" || q.status === "suspended")!;
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
  test("a capped catch-up finishes quickly", () => {
    const { sim, w: ww } = startedSim(1); const t0 = Date.now(); advance(sim, ww, CATCHUP_CAP_MONTHS); expect(Date.now() - t0).toBeLessThan(3000); expect(sim.month).toBe(CATCHUP_CAP_MONTHS);
  });
  test("single months advance one tick at a time", () => { const { sim, w: ww } = startedSim(1); stepMonth(sim, ww); expect(sim.month).toBe(1); });
});
describe("sanitising sim data", () => {
  test("garbage and inconsistent road data is rejected, never half-loaded", () => {
    for (const bad of [null, 3, "x", {}, { schemaVersion: 9 }]) expect(sanitizeSim(bad).sim).toBeNull();
    const { sim } = startedSim(1); const j = JSON.parse(JSON.stringify(sim));
    expect(sanitizeSim(j).sim).not.toBeNull();
    const jn = JSON.parse(JSON.stringify(sim)); Object.values<any>(jn.edges)[0].quality = null; expect(sanitizeSim(jn).sim).toBeNull();   // NaN becomes null in JSON
    const j2 = JSON.parse(JSON.stringify(sim)); Object.values<any>(j2.edges)[0].cells = [1]; expect(sanitizeSim(j2).sim).toBeNull();
    const j3 = JSON.parse(JSON.stringify(sim)); Object.values<any>(j3.edges)[0].b = "n.404"; expect(sanitizeSim(j3).sim).toBeNull();
  });
});
describe("scenery json", () => {
  test("reports when/where/what with the 5 km caveat", () => {
    const { sim } = startedSim(1), e = Object.values(sim.edges)[0], mid = w.cellPos(e.cells[Math.floor(e.cells.length / 2)]);
    const j = exportScenery(sim, w, mid); expect(j.schema).toBe("kfm.scenery.v1"); expect(j.when.era).toBe("光文6年"); expect(j.road?.edgeId).toBe(e.id);
    expect(j.road?.routes.length).toBeGreaterThan(0); expect(j.where.precisionKm).toBe(5); expect(j.notes).toContain("5km");
    expect(exportScenery(sim, w, [-9999, -9999]).road).toBeNull();
  });
});
