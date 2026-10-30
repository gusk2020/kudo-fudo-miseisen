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
