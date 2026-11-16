import { describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { advance } from "../../src/sim/engine";
import { homeCity } from "../../src/sim/ceremony";
import { exportRegion, readRegion, REGION_FORMAT } from "../../src/sim/export41";
import { stage3Sim } from "./simhelp";

/** Cross-game exchange (docs/SHARED-DATA41.md): a region of the game as kfm.region.v1, and the reference reader. KFM_REGION_OUT=<file> also writes the sample (docs/data/region-sample-kanto-1900.json was made so). */
describe("kfm.region.v1", () => {
  it("a 200 km square round Tokyo in 1900: small, self-describing, readable back; the game is not touched", () => {
    const { sim, w } = stage3Sim("heisei", 7, true, 0, 2, true, undefined, undefined, { start1800: true } as never); sim.policy!.mode = "auto"; advance(sim, w, 12 * 100);
    const t = homeCity(w, sim.capital)!, snap = JSON.stringify(sim), f = exportRegion(sim, w, { x0: t.pos[0] - 100, y0: t.pos[1] - 100, x1: t.pos[0] + 100, y1: t.pos[1] + 100 }, 1900); expect(JSON.stringify(sim)).toBe(snap);
    const text = JSON.stringify(f); if (process.env.KFM_REGION_OUT) writeFileSync(process.env.KFM_REGION_OUT, text);
    expect(f.format).toBe(REGION_FORMAT); expect(text.length, "small enough for a phone to fetch and parse at once").toBeLessThan(400000); expect([40, 41]).toContain(f.grid.nx); expect([40, 41]).toContain(f.grid.ny); expect(f.places.some((p) => p.id === t.id)).toBe(true); expect(f.lines.length).toBeGreaterThan(5);
    const d = readRegion(JSON.parse(text)); expect(d.elevM.length).toBe(f.grid.nx * f.grid.ny); const [lon, lat] = d.lonLat(t.pos[0], t.pos[1]); expect(lon).toBeGreaterThan(139); expect(lon).toBeLessThan(140.5); expect(lat).toBeGreaterThan(35); expect(lat).toBeLessThan(36.2);
    const k = w.cellOf(t.pos); expect(d.heightAt(t.pos[0], t.pos[1])).toBe(Math.round(w.t.elev[k])); expect(Number.isNaN(d.heightAt(t.pos[0] + 500, t.pos[1]))).toBe(true);
    const seaCells = [...d.land].filter((v) => v === 0).length; expect(seaCells, "Tokyo Bay and the Pacific are in the square").toBeGreaterThan(50); expect([...d.elevM].some((v, i) => d.land[i] === 0 && v < 0), "sea cells carry a depth").toBe(true);
    for (const l of f.lines) { expect(["road", "rail"]).toContain(l.mode); expect(l.pts.length % 2).toBe(0); }
    expect(() => readRegion({ format: "x" })).toThrow(); expect(() => readRegion({ ...f, grid: { ...f.grid, nx: f.grid.nx + 1 } })).toThrow("grid size");
  }, 900000);
});
