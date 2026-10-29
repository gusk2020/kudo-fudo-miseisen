import { describe, expect, it } from "vitest";
import { smoothLine, streamChains, streamKeep } from "../../src/render/streams";
import { CP_INDEX, writeCheckpoint, type CpStore } from "../../src/sim/checkpoint";
import { adoptRelocSchedule, relocDiag } from "../../src/sim/event2200";
import { ROAD_LAND } from "../../src/render/style24";
import { WATER, seaRgb } from "../../src/render/water";

const memStore = (lossy = false): CpStore & { m: Map<string, Uint8Array | string> } => { const m = new Map<string, Uint8Array | string>(); return { m, put: async (k, d) => { if (lossy && k.startsWith("s3:cp:") && k !== CP_INDEX) return; m.set(k, d); }, get: async (k) => m.get(k), del: async (k) => void m.delete(k), keys: async () => [...m.keys()] }; };

describe("Stage 29: 保存は読み戻して確認できてから成功にする", () => {
  it("書き込みが失われる記憶域は失敗として返し、既存のセーブポイント一覧を壊さない", async () => {
    const ok = memStore(); const r1 = await writeCheckpoint(ok, JSON.stringify({ a: 1 }), { kind: "50y", year: 2000 }, { capital: "東京", sub: "大阪" }, 1);
    expect(r1.ok).toBe(true);
    const lossy = memStore(true); lossy.m.set(CP_INDEX, ok.m.get(CP_INDEX)!); const before = lossy.m.get(CP_INDEX);
    const r2 = await writeCheckpoint(lossy, JSON.stringify({ b: 2 }), { kind: "50y", year: 2050 }, { capital: "東京", sub: "大阪" }, 2);
    expect(r2.ok).toBe(false); expect(lossy.m.get(CP_INDEX)).toEqual(before);   // the list as it was
  });
});
describe("Stage 29: 遷都予定の診断と旧セーブの移行", () => {
  const sim = (o: object) => ({ stage3: true, kaigen: {}, startYear: 1950, month: 0, ...o }) as any;
  it("2100年未満で遷都の履歴がない旧ゲームだけが 2100 起点に移る", () => {
    const a = sim({ month: (2060 - 1950) * 12 }); expect(adoptRelocSchedule(a)).toBe(true); expect([a.relocFirst, a.relocOrigin]).toEqual([2100, "migrated"]); expect(relocDiag(a)).toContain("次は2100年");
    const past = sim({ month: (2150 - 1950) * 12 }); expect(adoptRelocSchedule(past)).toBe(false); expect(past.relocFirst).toBeUndefined(); expect(relocDiag(past)).toContain("次は2200年");
    const had = sim({ month: (2060 - 1950) * 12, e2200: { year: 2200, state: "done", n: 0 } }); expect(adoptRelocSchedule(had)).toBe(false);
    const hist = sim({ month: (2060 - 1950) * 12, e2200hist: [{ year: 2200 }] }); expect(adoptRelocSchedule(hist)).toBe(false);
    const fresh = sim({ month: (2060 - 1950) * 12, relocFirst: 2100, relocOrigin: "new" }); expect(adoptRelocSchedule(fresh)).toBe(false); expect(relocDiag(fresh)).toContain("新しいゲーム");
  });
});
describe("Stage 29: 河川は端から端までつなぎ、なめらかにする(位置は動かさない)", () => {
  const seg = (x1: number, y1: number, x2: number, y2: number) => [x1, y1, x2, y2, 1];
  it("つながった断片は1本の線になり、孤立した短い断片は描かれない", () => {
    const s = [...seg(0, 0, 5, 0), ...seg(5, 0, 10, 5), ...seg(10, 5, 15, 5), ...seg(100, 100, 105, 100)], keep = streamKeep(s, 12);
    const chains = streamChains(s, keep); expect(chains.length).toBe(1); expect(chains[0].pts).toEqual([0, 0, 5, 0, 10, 5, 15, 5]);   // (the 5 km fragment far away connects to nothing)
  });
  it("なめらか化は両端の位置を変えず、点を増やす", () => {
    const p = [0, 0, 5, 0, 10, 5, 15, 5], q = smoothLine(p, 2); expect(q.slice(0, 2)).toEqual([0, 0]); expect(q.slice(-2)).toEqual([15, 5]); expect(q.length).toBeGreaterThan(p.length);
  });
});
describe("Stage 29: 水と土地の色の共通定義", () => {
  it("道路地図の土地色は 0xf3efe4。水の色は濃すぎず、海・湖・汽水湖・川が違う色", () => {
    expect(ROAD_LAND).toBe(0xf3efe4); const vals = [WATER.lake, WATER.brackish, WATER.river]; expect(new Set(vals).size).toBe(3);
    const lum = (c: number) => 0.2126 * ((c >> 16) & 255) + 0.7152 * ((c >> 8) & 255) + 0.0722 * (c & 255); for (const c of vals) expect(lum(c)).toBeGreaterThan(110);   // light water
    const deep = seaRgb(5000), shallow = seaRgb(0); expect(deep[2]).toBeLessThan(shallow[2]);
  });
});
