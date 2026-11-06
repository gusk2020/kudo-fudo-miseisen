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
