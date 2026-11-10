import { describe, expect, it } from "vitest";
import { realWorld } from "./simhelp";

describe("Stage 36 M1: 南鳥島と沖ノ鳥島を格子に載せる(版3)", () => {
  const W2 = realWorld(true, true, 2).w, W3 = realWorld(true, true, 3).w;
  it("版2では格子外のまま、版3では2島とも格子上の陸として初期拡張される", () => {
    for (const n of ["南鳥島", "沖ノ鳥島"]) {
      expect(W2.islets!.find((x) => x.islet.name === n)!.offGrid, n).toBe(true);
      const s = W3.islets!.find((x) => x.islet.name === n)!; expect(s.offGrid, n).toBeUndefined(); expect(s.cells.length, n).toBeGreaterThan(0); expect(W3.t.land[s.cell], n).toBe(1);
    }
    expect(W3.t.isletVersion).toBe(3);
  });
  it("格子の大きさを記録する(性能の確認用)", () => { console.log("GRID v2", W2.nx, W2.ny, W2.N, "v3", W3.nx, W3.ny, W3.N, "ratio", (W3.N / W2.N).toFixed(2)); expect(W3.N).toBeGreaterThan(W2.N); });
});

describe("Stage 36 M1: 北部千島(版3)", () => {
  const W3 = realWorld(true, true, 3).w;
  it("8島すべてが格子上の陸として載り、所属県は固定の規則(kuril1800)どおり", async () => {
    const { KURIL_ISLANDS, KURIL_MEMBERSHIP } = await import("../../src/sim/kuril1800");
    const byName = new Map(KURIL_ISLANDS.map((i) => [i.name, i.id]));
    const north = W3.islets!.filter((x) => x.islet.group === "千島列島(北部)"); expect(north).toHaveLength(8);
    for (const s of north) { expect(s.cells.length + (s.existing ? 1 : 0), s.islet.name).toBeGreaterThan(0); expect(W3.t.land[s.cell], s.islet.name).toBe(1); expect(s.islet.pref, s.islet.name).toBe(KURIL_MEMBERSHIP[byName.get(s.islet.name)!]); expect(W3.prefOf(s.cell), s.islet.name).toBe(s.islet.pref); }
  });
  it("版2の世界には北部千島は載らない(旧版の世界はそのまま)", () => { expect(realWorld(true, true, 2).w.islets!.some((x) => x.islet.group === "千島列島(北部)")).toBe(false); });
});
