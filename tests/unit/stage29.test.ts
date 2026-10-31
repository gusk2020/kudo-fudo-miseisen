import { describe, expect, it } from "vitest";
import { smoothLine, streamChains, streamKeep } from "../../src/render/streams";
import { CP_INDEX, writeCheckpoint, type CpStore } from "../../src/sim/checkpoint";
import { adoptRelocSchedule, relocDiag } from "../../src/sim/event2200";
import { ROAD_LAND } from "../../src/render/style24";
import { LAKE_LIST, RAW_HOLE_COUNT, isBrackish } from "../../src/render/lakes";
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

import { existsSync, readFileSync } from "node:fs";
const lakesPath = new URL("../../src/data/lakes.json", import.meta.url);
describe.skipIf(!existsSync(lakesPath))("Stage 29: 湖と湖中島のデータ(OpenStreetMap)", () => {
  const d = JSON.parse(existsSync(lakesPath) ? readFileSync(lakesPath, "utf8") : "{\"lakes\":[]}") as { lakes: { name: string; kind: string; km2: number; outer: number[][]; holes: number[][][]; islands?: { name: string }[] }[] };
  const inside = (p: number[], ring: number[][]) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c; } return c; };
  it("琵琶湖・霞ヶ浦・サロマ湖・宍道湖・浜名湖など主要な湖があり、汽水湖は区別されている", () => {
    for (const n of ["琵琶湖", "霞ヶ浦", "サロマ湖", "宍道湖", "浜名湖", "猪苗代湖", "洞爺湖"]) expect(d.lakes.some((l) => l.name.includes(n)), n).toBe(true);
    for (const n of ["サロマ湖", "宍道湖", "浜名湖", "霞ヶ浦"]) expect(isBrackish(d.lakes.find((l) => l.name.includes(n))!), n).toBe(true);
    expect(isBrackish(d.lakes.find((l) => l.name === "琵琶湖")!)).toBe(false); expect(isBrackish(d.lakes.find((l) => l.name === "猪苗代湖")!)).toBe(false);
    expect(d.lakes.find((l) => l.name === "琵琶湖")!.kind).toBe("lake"); expect(d.lakes.length).toBeGreaterThan(20);
  });
  it("湖中島はその湖の内側にだけ置かれ(陸水が食い違わない)、ほとんどのデータが残る。琵琶湖には沖島などが入っている", () => {
    for (const l of LAKE_LIST) for (const h of l.holes) { const c = [h.reduce((t, p) => t + p[0], 0) / h.length, h.reduce((t, p) => t + p[1], 0) / h.length]; expect(inside(c, l.outer), `${l.name}の島の中心が湖の外`).toBe(true); }
    expect(LAKE_LIST.reduce((t, l) => t + l.holes.length, 0)).toBeGreaterThan(RAW_HOLE_COUNT * 0.8);   // (a few rings that are not inside their lake are dropped, not most of them)
    const biwa = d.lakes.find((l) => l.name === "琵琶湖")!; expect(biwa.holes.length).toBeGreaterThanOrEqual(3);
    const km2 = (r: number[][]) => { let a = 0; for (let i = 0; i < r.length; i++) { const [x1, y1] = r[i], [x2, y2] = r[(i + 1) % r.length]; a += (x1 / 1e4) * 91 * (y2 / 1e4) * 111 - (x2 / 1e4) * 91 * (y1 / 1e4) * 111; } return Math.abs(a) / 2; };
    expect(biwa.holes.some((h) => km2(h) > 1)).toBe(true);   // 沖島 (about 1.5 km2) is among them
    const lon = biwa.outer.map((p) => p[0] / 1e4), lat = biwa.outer.map((p) => p[1] / 1e4); expect(Math.min(...lon)).toBeGreaterThan(135.8); expect(Math.max(...lon)).toBeLessThan(136.3); expect(Math.min(...lat)).toBeGreaterThan(34.9); expect(Math.max(...lat)).toBeLessThan(35.7);
  });
});

import { spreadSea } from "../../src/render/renderer";
describe("Stage 29: 海の層は陸のセルにも最も近い海の色を使う(四角い色の段差を作らない)", () => {
  it("深い海に接する陸のセルは深い色、浅い海に接する陸のセルは浅い色。一色の定数ではない", () => {
    const nx = 12, ny = 2, land = new Float32Array(nx * ny).fill(1), elev = new Float32Array(nx * ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < 2; i++) { land[j * nx + i] = 0; }   // water on the left two columns
    elev[0] = -900; elev[1] = -900; elev[nx] = -5; elev[nx + 1] = -5;   // row 0 deep, row 1 shallow
    const rgb = spreadSea(land, elev, nx, ny), at = (i: number, j: number) => [rgb[3 * (j * nx + i)], rgb[3 * (j * nx + i) + 1], rgb[3 * (j * nx + i) + 2]];
    expect(at(2, 0)).toEqual(at(1, 0)); expect(at(2, 1)).toEqual(at(1, 1)); expect(at(2, 0)).not.toEqual(at(2, 1));   // the land beside deep water is deep-coloured, beside shallow water shallow
    expect(at(11, 0)).toEqual([40, 110, 160]);   // far from any water: the shallow default
  });
});
