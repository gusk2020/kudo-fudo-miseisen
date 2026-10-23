import { describe, expect, it } from "vitest";
import { ISLETS, isDisputed } from "../../src/core/islets";
import { realWorld } from "./simhelp";

describe("Stage 20 C: islets on the world", () => {
  const base = realWorld(true, true).w, W = realWorld(true, true, true).w;
  it("the terrain hash and the plain world are untouched", () => {
    expect(realWorld(true, true, true).hash).toBe(realWorld(true, true).hash);
    expect(base.islets).toBeUndefined(); expect(base.t.grid.nx).toBeLessThan(W.t.grid.nx);
  });
  it("old cells keep their position after the grid is widened", () => {
    let n = 0; for (let k = 0; k < base.N; k += 7) { const p = base.cellPos(k), q = W.cellOf(p); expect(q).toBeGreaterThanOrEqual(0); if (base.t.land[k] !== 0) { expect(W.t.land[q]).toBe(base.t.land[k]); expect(W.t.island[q]).toBe(base.t.island[k]); } n++; }
    expect(n).toBeGreaterThan(1000);
  });
  it("every islet is on the grid, once, with land under it", () => {
    expect(W.islets!.length).toBe(ISLETS.length);
    const seen = new Set<number>();
    for (const s of W.islets!) { expect(s.cell).toBeGreaterThanOrEqual(0); expect(W.t.land[s.cell]).toBe(1); if (!s.existing) { for (const k of s.cells) { expect(seen.has(k)).toBe(false); seen.add(k); expect(W.t.island[k]).toBe(s.island); } } }
  });
  it("the named groups are all there, and the disputed ones carry a statement", () => {
    const names = new Set(ISLETS.map((s) => s.name));
    for (const n of ["硫黄島", "父島", "母島", "八丈島", "魚釣島", "竹島", "択捉島", "国後島", "色丹島", "歯舞群島".length ? "水晶島" : ""]) expect(names.has(n), n).toBe(true);
    for (const g of ["尖閣諸島", "竹島", "北方四島", "歯舞群島"]) { const l = ISLETS.filter((s) => s.group === g); expect(l.length, g).toBeGreaterThan(0); for (const s of l) expect(isDisputed(s), s.name).toBe(true); }
  });
  it("each islet is its own land mass (a road cannot reach it)", () => {
    for (const s of W.islets!) if (!s.existing) { const m = W.lm[s.cells[0]]; expect(m).toBeGreaterThan(0); for (const k of s.cells) expect(W.lm[k]).toBe(m); }
  });
});
