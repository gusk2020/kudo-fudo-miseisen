import { describe, expect, it } from "vitest";
import { CP_PREFIX, assignBranch, cpKey, ensureIdentity, identityOf, inHistory, newWorldId, planPrune, writeCheckpoint, listCheckpoints, type CpEntry, type CpStore } from "../../src/sim/checkpoint";
import { exportGame, makeSave, mapStateHash, parseSave } from "../../src/core/save2";
import { defaultState } from "../../src/core/state";
import { startedSim } from "./simhelp";

class Mem implements CpStore { m = new Map<string, Uint8Array | string>();
  async put(k: string, d: Uint8Array | string) { this.m.set(k, d); } async get(k: string) { return this.m.get(k); } async del(k: string) { this.m.delete(k); } async keys() { return [...this.m.keys()]; } }
const sim = (year: number, x: Record<string, unknown> = {}): any => ({ month: (year - 1950) * 12, startYear: 1950, ...x });
const ent = (wid: string | undefined, tl: string | undefined, year: number, savedAt = year, bytes = 1000): CpEntry => ({ wid, tl, key: `${CP_PREFIX}${wid ?? ""}:${tl ?? ""}:${year}:50y`, year, kind: "50y", bytes, gz: false, savedAt, capital: "東京府", sub: "大阪府" });

describe("Stage 30A: world / timeline identity", () => {
  it("a new game gets a world and a timeline; ids are unique; an existing identity is kept", () => {
    const a = sim(1950), b = sim(1950); expect(ensureIdentity(a)).toBe(true); ensureIdentity(b); expect(a.wid).not.toBe(b.wid); expect(newWorldId()).not.toBe(newWorldId());
    const w = a.wid, t = a.tl; expect(ensureIdentity(a)).toBe(false); expect(a.wid).toBe(w); expect(a.tl).toBe(t);
  });
  it("same year in two worlds / timelines are stored apart (no overwrite) and listed per world", async () => {
    const st = new Mem(), A = { wid: "wa", tl: "ta" }, B = { wid: "wb", tl: "tb" };
    for (const id of [A, B]) expect((await writeCheckpoint(st, "{}", { kind: "50y", year: 2050 }, { capital: "c", sub: "s", id })).ok).toBe(true);
    const l = await listCheckpoints(st); expect(l.length).toBe(2); expect(cpKey({ kind: "50y", year: 2050 }, A)).not.toBe(cpKey({ kind: "50y", year: 2050 }, B));
    expect(l.filter((e) => inHistory(e, A)).map((e) => e.wid)).toEqual(["wa"]);
  });
  it("loading an earlier save of a timeline that has a later checkpoint branches; the old future is hidden, the shared past is shown; nothing is deleted", () => {
    const idx = [ent("wa", "t1", 2000), ent("wa", "t1", 2050), ent("wa", "t1", 2100)], s = sim(2050, { wid: "wa", tl: "t1" });
    expect(assignBranch(s, idx)).toBe(true); expect(s.tl).not.toBe("t1"); expect(s.anc).toEqual([{ tl: "t1", y: 2050 }]);
    const id = identityOf(s)!; expect(idx.filter((e) => inHistory(e, id)).map((e) => e.year)).toEqual([2000, 2050]);
    idx.push(ent("wa", s.tl, 2100)); expect(idx.filter((e) => inHistory(e, id)).map((e) => e.year)).toEqual([2000, 2050, 2100]);
    const latest = sim(2100, { wid: "wa", tl: "t1" }); expect(assignBranch(latest, idx)).toBe(false);   // the newest point of a line continues it
    const n = sim(2050, { wid: "wa", tl: "t1" }); expect(assignBranch(n, [])).toBe(false);
  });
  it("legacy saves (no id) become a world of their own and legacy entries are never part of a world's history", () => {
    const s = sim(2000); expect(assignBranch(s, [ent(undefined, undefined, 2050)])).toBe(false); expect(s.wid).toBeTruthy();
    expect(inHistory(ent(undefined, undefined, 2000), identityOf(s)!)).toBe(false);
  });
  it("capacity is per world (8 / 48MB), branches count, abandoned branches go first, other worlds are capped at 4, the newest is kept", () => {
    const cur = { wid: "wa", tl: "t2", anc: [{ tl: "t1", y: 2050 }] };
    const es = [...[2000, 2050, 2100, 2150].map((y) => ent("wa", "t1", y)), ...[2100, 2150, 2200, 2250, 2300].map((y) => ent("wa", "t2", y, 5000 + y))];
    const out = planPrune(es, 8, 1 << 30, cur); expect(out).toEqual([`${CP_PREFIX}wa:t1:2100:50y`]);
    const worlds = ["w1", "w2", "w3", "w4", "w5", "w6"].map((w, i) => ent(w, "t", 2000, 100 * (i + 1))); const drop = planPrune([...worlds, ent("wa", "t2", 2000, 1)], 8, 1 << 30, { wid: "wa", tl: "t2" });
    expect(drop.length).toBe(3); expect(drop.some((k) => k.includes("wa:"))).toBe(false); expect(drop[0]).toContain("w1");
    expect(planPrune([ent("x", "t", 2000), ent("x", "t", 2050)], 1, 1 << 30, { wid: "x", tl: "t" })).toEqual([`${CP_PREFIX}x:t:2000:50y`]);
  });
  it("a save round trip keeps a whole identity (and its branch list) and drops a broken one", () => {
    const { sim: a } = startedSim(1), m = defaultState(); m.finalized = true; m.step = 5; a.mapHash = mapStateHash(m); a.wid = "wabc"; a.tl = "tdef"; a.anc = [{ tl: "t0x", y: 2050 }];
    const p = parseSave(exportGame(makeSave(m, a))); expect([p.sim!.wid, p.sim!.tl, p.sim!.anc]).toEqual(["wabc", "tdef", [{ tl: "t0x", y: 2050 }]]);
    a.tl = "BAD ID!"; const q = parseSave(exportGame(makeSave(m, a))); expect(q.sim).not.toBeNull(); expect(q.sim!.wid).toBeUndefined(); expect(q.sim!.tl).toBeUndefined();
  });
});

import { realToWorld } from "../../src/core/body";
import { JAPAN } from "../../src/core/data";
import { RANGES, cleanRangeEdits, clampRange } from "../../src/core/ranges";
import { parseState } from "../../src/core/save";
import { realState } from "../../src/core/state";
import { generateTerrain } from "../../src/core/terrain";
import { loadDem } from "./helpers";

describe("Stage 30A: mountain ranges", () => {
  const dem = loadDem(), gen = (edits?: Record<string, number>) => { const s = realState(); if (edits) s.rangeEdits = edits; return { s, t: generateTerrain(s, dem) }; };
  const base = gen();
  const crest = (r: (typeof RANGES)[number], t: ReturnType<typeof gen>["t"], s: ReturnType<typeof gen>["s"]) => { const pts = r.line.map(([lo, la]) => realToWorld(r.island, s.bodies[r.island], [(lo - JAPAN.proj.lon0) * JAPAN.proj.kmPerDegLon, (la - JAPAN.proj.lat0) * JAPAN.proj.kmPerDegLat])), { x0, y0, cell, nx, ny } = t.grid; let mx = 0;
    for (const p of pts) { const i = Math.floor((p[0] - x0) / cell), j = Math.floor((p[1] - y0) / cell); for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) { const a = i + di, b = j + dj; if (a >= 0 && b >= 0 && a < nx && b < ny && t.land[b * nx + a] === 1) mx = Math.max(mx, t.elev[b * nx + a]); } } return mx; };
  it("no edit leaves the terrain (hash) exactly as it was; the ranges are real land with real height", () => {
    expect(gen({}).t.hash).toBe(base.t.hash); expect(cleanRangeEdits({ kiso: 1 })).toBeUndefined();
    for (const r of RANGES) expect(crest(r, base.t, base.s), r.name).toBeGreaterThan(400);
    expect(RANGES.map((r) => r.id).length).toBe(new Set(RANGES.map((r) => r.id)).size); expect(RANGES.length).toBeGreaterThanOrEqual(10);
  });
  it("amplify raises the crest, attenuate lowers it to plain; never under 2 m or the plain floor, never over the cap; the sea and the coast are untouched; one range's edit leaves the others alone", () => {
    for (const id of ["akaishi", "ou", "kyushu", "hidaka"]) {
      const r = RANGES.find((x) => x.id === id)!, up = gen({ [id]: 2 }), dn = gen({ [id]: 0 });
      expect(crest(r, up.t, up.s), id).toBeGreaterThan(crest(r, base.t, base.s) * 1.2); expect(crest(r, dn.t, dn.s), id).toBeLessThan(crest(r, base.t, base.s) * 0.45);
      let max = 0, minLand = 1e9, seaDiff = 0, landDiff = 0; for (let k = 0; k < base.t.land.length; k++) { if (up.t.land[k] !== base.t.land[k] || dn.t.land[k] !== base.t.land[k]) landDiff++; if (base.t.land[k] === 0 && (up.t.elev[k] !== base.t.elev[k] || dn.t.elev[k] !== base.t.elev[k])) seaDiff++; if (base.t.land[k] === 1) { max = Math.max(max, up.t.elev[k]); minLand = Math.min(minLand, dn.t.elev[k]); } }
      expect(seaDiff).toBe(0); expect(landDiff).toBe(0); expect(minLand).toBeGreaterThanOrEqual(2); expect(max).toBeLessThanOrEqual(Math.max(4900, base.t.stats.maxElevM) + 1);
    }
    const a = gen({ akaishi: 2 }), kiso = RANGES.find((x) => x.id === "kiso")!, tk = RANGES.find((x) => x.id === "kyushu")!; expect(crest(tk, a.t, a.s)).toBe(crest(tk, base.t, base.s)); void kiso;
  });
  it("continuity: no cell next to another differs from the base by a steeper jump than the edit's own relief change allows (no cliff at the edge)", () => {
    const up = gen({ chugoku: 2 }), { nx, ny } = up.t.grid; let worst = 0, natural = 0;
    for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) { const k = j * nx + i; if (up.t.land[k] !== 1 || up.t.land[k + 1] !== 1) continue; const d0 = Math.abs(base.t.elev[k + 1] - base.t.elev[k]), d1 = Math.abs(up.t.elev[k + 1] - up.t.elev[k]); worst = Math.max(worst, d1); natural = Math.max(natural, d0); }
    expect(worst).toBeLessThan(natural * 1.5);   // the steepest step after doubling the range stays within 1.5x of the steepest the DEM itself has anywhere
  });
  it("the stored edits round trip, unknown ranges and neutral values are dropped, the factor is clamped; a save without the field is the standard state", () => {
    expect(clampRange(3)).toBe(2); expect(clampRange(-1)).toBe(0); expect(cleanRangeEdits({ kiso: 0.5, nope: 2, hida: 1, kyushu: 9 })).toEqual({ kiso: 0.5, kyushu: 2 });
    const s = realState(); s.rangeEdits = { kiso: 0.5 }; const p = parseState(JSON.parse(JSON.stringify(s)))!; expect((p as any).state?.rangeEdits ?? (p as any).rangeEdits).toEqual({ kiso: 0.5 });
    const old = JSON.parse(JSON.stringify(realState())); expect(((parseState(old) as any).state ?? parseState(old) as any).rangeEdits).toBeUndefined();
  });
  it("the map hash moves with an edit (so a started game cannot be mixed with other terrain) and not without one", () => {
    const a = realState(), b = realState(); b.rangeEdits = { ou: 1.5 }; expect(mapStateHash(a)).not.toBe(mapStateHash(b)); b.rangeEdits = {}; expect(mapStateHash(a)).toBe(mapStateHash(b));
  });
});
