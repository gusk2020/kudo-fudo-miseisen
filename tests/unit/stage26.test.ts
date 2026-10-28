import { describe, expect, it } from "vitest";
import { CP_MAX_COUNT, CP_PREFIX, checkpointDue, cpKey, decodeSave, encodeSave, listCheckpoints, markCheckpoint, planPrune, readCheckpoint, writeCheckpoint, type CpDue, type CpEntry, type CpStore } from "../../src/sim/checkpoint";
import { splitGmj } from "../../src/render/gmBorders";
import { streamKeep } from "../../src/render/streams";
import { AIR_STYLE, KIND_COLOUR, STATE_DASH, edgeStyle, type Kind, type LineState, type Tier } from "../../src/render/style24";
import { legendItems } from "../../src/render/legendSamples";
import { readFileSync } from "node:fs";

class MemStore implements CpStore {
  m = new Map<string, Uint8Array | string>(); failPut: ((key: string) => boolean) | null = null; failGet = false; puts: string[] = [];
  async put(key: string, data: Uint8Array | string) { if (this.failPut?.(key)) throw new Error("QuotaExceededError"); this.puts.push(key); this.m.set(key, data); }
  async get(key: string) { if (this.failGet) throw new Error("read failed"); return this.m.get(key); }
  async del(key: string) { this.m.delete(key); }
  async keys() { return [...this.m.keys()]; }
}
const ent = (year: number, kind: "50y" | "reloc", bytes = 1000, savedAt = year): CpEntry => ({ key: `${CP_PREFIX}${year}:${kind}`, year, kind, bytes, gz: false, savedAt, capital: "東京府", sub: "大阪府" });
const stub = (year: number, extra: Record<string, unknown> = {}) => ({ ceremonyDone: true, month: (year - 1950) * 12, startYear: 1950, stage3: true, kaigen: { eras: [] }, ...extra }) as never;

describe("Stage 26: when a checkpoint is due", () => {
  it("every 50 years from 2000, once each; a jump past the mark still gets it once; nothing before the ceremony or off a year boundary", () => {
    const sim: any = stub(1999); expect(checkpointDue(sim)).toBeNull();
    sim.month = (2000 - 1950) * 12; const d = checkpointDue(sim)!; expect(d).toEqual({ kind: "50y", year: 2000 }); markCheckpoint(sim, d); expect(checkpointDue(sim)).toBeNull();
    sim.month = (2049 - 1950) * 12; expect(checkpointDue(sim)).toBeNull(); sim.month = (2050 - 1950) * 12 + 3; expect(checkpointDue(sim)).toBeNull();   // not a year boundary
    sim.month = (2050 - 1950) * 12; expect(checkpointDue(sim)?.year).toBe(2050); markCheckpoint(sim, checkpointDue(sim)!);
    sim.month = (2160 - 1950) * 12; expect(checkpointDue(sim)).toEqual({ kind: "50y", year: 2160 }); sim.ceremonyDone = false; expect(checkpointDue(sim)).toBeNull();
  });
  it("just before each relocation event (2200, 2350, 2500, 2650): one checkpoint even where it is also a 50-year mark; none again after loading it", () => {
    const sim: any = stub(2199, { cp: { y50: 2150, reloc: 0 } }); expect(checkpointDue(sim)).toBeNull();
    sim.month = (2200 - 1950) * 12; const d = checkpointDue(sim)!; expect(d).toEqual({ kind: "reloc", year: 2200, n: 1 }); markCheckpoint(sim, d); expect(sim.cp).toEqual({ y50: 2200, reloc: 1 }); expect(checkpointDue(sim)).toBeNull();
    const loaded = JSON.parse(JSON.stringify(sim)); expect(checkpointDue(loaded)).toBeNull();   // a game restored from it goes straight into the event
    for (const [y, n] of [[2350, 2], [2500, 3], [2650, 4]] as const) {
      sim.e2200hist = Array.from({ length: n - 2 }, () => ({ state: "done" })); sim.e2200 = { state: "done" }; sim.month = (y - 1950) * 12; const dd = checkpointDue(sim)!;
      expect(dd).toEqual({ kind: "reloc", year: y, n }); markCheckpoint(sim, dd); expect(checkpointDue(sim)).toBeNull();
    }
    const old: any = stub(2350, { e2200: { state: "done" } }); expect(checkpointDue(old)).toEqual({ kind: "reloc", year: 2350, n: 2 });   // a save from before the repeat existed
    const pend: any = stub(2200, { e2200: { state: "pending" }, cp: { y50: 2200, reloc: 1 } }); expect(checkpointDue(pend)).toBeNull();   // an event already open takes none
  });
});

describe("Stage 26: storing checkpoints", () => {
  it("planPrune: oldest 50-year ones first, then the oldest pre-relocation ones; the newest is never removed; count and bytes both limit", () => {
    const es = [ent(2000, "50y"), ent(2050, "50y"), ent(2100, "50y"), ent(2150, "50y"), ent(2200, "reloc"), ent(2250, "50y"), ent(2300, "50y"), ent(2350, "reloc"), ent(2400, "50y")];
    expect(planPrune(es, 8)).toEqual([`${CP_PREFIX}2000:50y`]); expect(planPrune(es, 6)).toEqual([2000, 2050, 2100].map((y) => `${CP_PREFIX}${y}:50y`));
    expect(planPrune([ent(2000, "50y"), ent(2200, "reloc"), ent(2250, "50y", 1000, 99999)], 1)).toEqual([`${CP_PREFIX}2000:50y`, `${CP_PREFIX}2200:reloc`]);
    expect(planPrune(es, 99, 5000).length).toBe(4); expect(planPrune([], 3)).toEqual([]); expect(planPrune([ent(2000, "50y")], 0)).toEqual([]);
  });
  it("gzip round-trips; writing keeps at most 8, only under s3:cp:, and leaves every other key (the numbered slots, the autosave) alone", async () => {
    const enc = await encodeSave('{"a":"日本語"}'.repeat(2000)); expect(await decodeSave(enc.data, enc.gz)).toBe('{"a":"日本語"}'.repeat(2000)); if (enc.gz) expect((enc.data as Uint8Array).byteLength).toBeLessThan(2000);
    const st = new MemStore(); st.m.set("s3:slot1", "SLOT"); st.m.set("s3:slot2", "SLOT2"); st.m.set("s3:autosave", "AUTO"); st.m.set("s3:autosave:prev", "PREV");
    for (let i = 0; i < 12; i++) { const y = 2000 + 50 * i, r = await writeCheckpoint(st, JSON.stringify({ y }), { kind: i % 4 === 3 ? "reloc" : "50y", year: y, n: 1 } as CpDue, { capital: "東京府", sub: "大阪府" }, 1000 + i); expect(r.ok).toBe(true); }
    const list = await listCheckpoints(st); expect(list.length).toBeLessThanOrEqual(CP_MAX_COUNT); expect(list[0].year).toBe(2550); expect(list.some((e) => e.year === 2550)).toBe(true);
    for (const k of st.puts) expect(k.startsWith(CP_PREFIX)).toBe(true); expect(st.m.get("s3:slot1")).toBe("SLOT"); expect(st.m.get("s3:slot2")).toBe("SLOT2"); expect(st.m.get("s3:autosave")).toBe("AUTO"); expect(st.m.get("s3:autosave:prev")).toBe("PREV");
    const blobs = [...st.m.keys()].filter((k) => k.startsWith(CP_PREFIX) && k !== "s3:cp:index"); expect(blobs.length).toBe(list.length);   // pruned blobs are gone
    expect(JSON.parse((await readCheckpoint(st, list[0]))!)).toEqual({ y: 2550 });
  });
  it("a failed write (full storage, unreadable index) is reported, never throws, and leaves every earlier checkpoint listed and readable", async () => {
    const st = new MemStore(); for (const y of [2000, 2050]) await writeCheckpoint(st, JSON.stringify({ y }), { kind: "50y", year: y }, { capital: "a", sub: "b" });
    const before = JSON.stringify([...st.m.entries()].map(([k, v]) => [k, typeof v === "string" ? v : v.byteLength]));
    st.failPut = (k) => k === cpKey({ kind: "50y", year: 2100 }); const r1 = await writeCheckpoint(st, JSON.stringify({ y: 2100 }), { kind: "50y", year: 2100 }, { capital: "a", sub: "b" }); expect(r1.ok).toBe(false); if (!r1.ok) expect(r1.error).toContain("Quota");
    st.failPut = (k) => k === "s3:cp:index"; const r2 = await writeCheckpoint(st, JSON.stringify({ y: 2150 }), { kind: "50y", year: 2150 }, { capital: "a", sub: "b" }); expect(r2.ok).toBe(false);
    st.failPut = null; st.m.delete(cpKey({ kind: "50y", year: 2150 })); expect(JSON.stringify([...st.m.entries()].map(([k, v]) => [k, typeof v === "string" ? v : v.byteLength]))).toBe(before);
    expect((await listCheckpoints(st)).map((e) => e.year)).toEqual([2050, 2000]); expect(JSON.parse((await readCheckpoint(st, (await listCheckpoints(st))[1]))!)).toEqual({ y: 2000 });
    st.failGet = true; const r3 = await writeCheckpoint(st, "{}", { kind: "50y", year: 2200 }, { capital: "a", sub: "b" }); expect(r3.ok).toBe(false); st.failGet = false; expect((await listCheckpoints(st)).length).toBe(2);   // an unreadable index is never rewritten from a guess
  });
});

describe("Stage 26: the map's lines", () => {
  it("coast and prefecture borders are told apart by sharing: a segment two polygons carry is a border (drawn once), one polygon's is coast", () => {
    const a = [0, 0, 10000, 0, 10000, 10000, 0, 10000, 0, 0], b = [10000, 0, 20000, 0, 20000, 10000, 10000, 10000, 10000, 0], s = splitGmj([a, b]);
    expect(s.border.length / 4).toBe(1); expect(s.coast.length / 4).toBe(6);
    const real = splitGmj(JSON.parse(readFileSync("src/data/coast-gmj.json", "utf8")).polys); expect(real.border.length / 4).toBeGreaterThan(500); expect(real.coast.length / 4).toBeGreaterThan(5000);
  });
  it("a stream fragment that connects to nothing is not drawn; a long stream is", () => {
    const seg = (x1: number, y1: number, x2: number, y2: number) => [x1, y1, x2, y2, 1]; const long = Array.from({ length: 10 }, (_, i) => seg(i * 5, 0, i * 5 + 5, 0)).flat(), stub = seg(100, 100, 105, 100), s = [...long, ...stub];
    const keep = streamKeep(s, 30); expect(keep.slice(0, 10).every(Boolean)).toBe(true); expect(keep[10]).toBe(false);
  });
  it("air lines have a style of their own (black long-short dashes on white), told from road, sea and closed lines; 新幹線・リニア are one legend entry but two kinds", () => {
    const air = AIR_STYLE.body, others = (["road", "hwy", "rail", "hsr", "maglev", "sea"] as Kind[]).map((k) => edgeStyle(k, "sub", "open", 90).body); for (const o of others) expect(JSON.stringify([air.colour, air.dash])).not.toBe(JSON.stringify([o.colour, o.dash]));
    for (const st of ["closed", "lost", "planned", "unbuilt", "dormant"] as LineState[]) expect(air.dash).not.toEqual(STATE_DASH[st]);
    expect(KIND_COLOUR.hsr).not.toBe(KIND_COLOUR.maglev); const items = legendItems(); expect(items.filter((i) => /新幹線|リニア/.test(i.caption)).length).toBe(1); expect(items.some((i) => i.ref.what === "air")).toBe(true);
    for (const t of ["main", "sub", "local"] as Tier[]) for (const k of ["road", "rail"] as Kind[]) for (const q of [0, 30, 60, 99]) expect(edgeStyle(k, t, "open", q).body.colour).toBe(KIND_COLOUR[k]);
  });
});

import { gridBordersWithin } from "../../src/render/gmBorders";
import { run14 } from "../study/lib14";
import { advance, stepMonth, yearOf } from "../../src/sim/engine";
import { finishMigration } from "../../src/sim/migrate";
import { makeSave, parseSave, sanitizeSim } from "../../src/core/save2";
import { realState } from "../../src/core/state";
import { E2200_YEAR, open2200 } from "../../src/sim/event2200";

describe("Stage 26: borders inside Hokkaido's three regions only", () => {
  it("gridBordersWithin keeps only segments between two cells of the chosen group", () => {
    const grid = { x0: 0, y0: 0, cell: 5, nx: 4, ny: 1 }, land = [1, 1, 1, 1], pref = [1, 2, 3, 3];   // 1,2 = group, 3 = another prefecture
    expect(gridBordersWithin(grid, land, pref, (n) => n <= 2)).toEqual([5, 0, 5, 5]);   // only the 1|2 border, not 2|3
    expect(gridBordersWithin(grid, land, pref, () => true).length / 4).toBe(2); expect(gridBordersWithin(grid, land, pref, () => false)).toEqual([]);
  });
});

describe("Stage 26: a checkpoint is a complete save; the game goes on from it exactly as it would have", () => {
  it("round trip through the checkpoint encoding and parseSave: the restored game and the original, stepped the same months, are identical; the 3 slots' format is untouched", async () => {
    const r = run14({ seed: 5, until: 1999, islets: true }), { sim, w } = r; advance(sim, w, 11 - (sim.month % 12) + 12 * 0);   // (to a year boundary)
    while (sim.month % 12 !== 0) stepMonth(sim, w);
    const save = makeSave(realState(1), sim), json = JSON.stringify(save), enc = await encodeSave(json), back = await decodeSave(enc.data, enc.gz); expect(back).toBe(json);
    const parsed = parseSave(back); expect(parsed.sim).not.toBeNull(); const rest = parsed.sim!; finishMigration(rest, w);
    expect(JSON.stringify(rest)).toBe(JSON.stringify(sim));   // nothing is lost or added by saving and loading
    advance(sim, w, 30); advance(rest, w, 30); expect(rest.month).toBe(sim.month); expect(rest.rngState).toBe(sim.rngState); expect(JSON.stringify(rest)).toBe(JSON.stringify(sim));
    expect((sim as unknown as { snaps?: unknown }).snaps).toBeUndefined();
  }, 600000);
  it("a checkpoint taken just before 2200 restores into the same event, once: no double firing, era history intact", async () => {
    const r = run14({ seed: 5, until: 1952, islets: true }), { sim, w } = r; sim.month = (E2200_YEAR - sim.startYear) * 12; sim.policy!.mode = "auto"; sim.kaigen!.next = 2230; sim.kaigen!.pending = null;
    const d = checkpointDue(sim)!; expect(d).toEqual({ kind: "reloc", year: 2200, n: 1 }); markCheckpoint(sim, d); const json = JSON.stringify(makeSave(realState(1), sim)), eras0 = JSON.stringify(sim.kaigen!.eras);
    const rest = parseSave(json).sim!; finishMigration(rest, w); expect(checkpointDue(rest)).toBeNull();
    for (const g of [sim, rest]) { stepMonth(g, w); expect(g.e2200?.state).toBe("pending"); expect(g.e2200?.n).toBe(0); stepMonth(g, w); expect(g.e2200hist ?? []).toEqual([]); }
    expect(JSON.stringify(rest.e2200)).toBe(JSON.stringify(sim.e2200)); expect(JSON.stringify(rest.kaigen!.eras)).toBe(eras0); expect(JSON.stringify(rest.kaigen!.reloc)).toBe(JSON.stringify(sim.kaigen!.reloc));
    void open2200; void yearOf;
  }, 600000);
  it("an older save (with year-by-year snapshots, no checkpoint record) loads: the snapshots are dropped, the era and relocation history stay", () => {
    const r = run14({ seed: 5, until: 1952, islets: true }), s = JSON.parse(JSON.stringify(r.sim)); s.snaps = [{ year: 1950, edges: { a: 1 } }]; s.e2200hist = []; delete s.cp;
    const back = sanitizeSim(s).sim!; expect(back).not.toBeNull(); expect((back as unknown as { snaps?: unknown }).snaps).toBeUndefined(); expect(back.kaigen!.eras.length).toBe(r.sim.kaigen!.eras.length); expect(back.cp).toBeUndefined();
    s.cp = { y50: "x", reloc: 1 }; expect(sanitizeSim(s).sim!.cp).toBeUndefined();   // a damaged record is dropped, not trusted
  }, 300000);
});
