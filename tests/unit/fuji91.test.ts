import { expect, it } from "vitest";
import { uninhabitable } from "../../src/sim/land";
import { writeFileSync } from "node:fs";
import { generateTerrain } from "../../src/core/terrain";
import { defaultState } from "../../src/core/state";
import { buildWorld } from "../../src/sim/world";
import { advance, yearOf } from "../../src/sim/engine";
import { stage3SimOn } from "./simhelp";
import { loadDem } from "./helpers";
/** Issue #91: Fuji moved onto Tokyo and enlarged (x5): the cities whose office points end up on the mountain cannot stay big (any role); on the real terrain nothing changes. Measured numbers: docs/TERRAIN91.md. */
it("Issue #91: cities put on a mountain by the player's terrain stay small; the real terrain is untouched", () => {
  const out: Record<string, unknown> = {}, tag = "";
  const mk = (mut: (s: ReturnType<typeof defaultState>) => void) => { const s = defaultState(); s.islands = true; mut(s); const t = generateTerrain(s, loadDem()); return { w: buildWorld(t, s.seed), hash: t.hash }; };
  const base = mk(() => {}), tk = base.w.cities.find((c) => c.name === "東京")!.pos;
  for (const [name, b] of [["normal", base], ["fuji-tokyo-x5", mk((s: any) => { s.features.fuji.pos = [tk[0], tk[1]]; s.features.fuji.scale = 5; s.features.fuji.auto = true; })]] as const) {
    const g = stage3SimOn(b as never, 0, 7, { start1800: true, subCapital: "JP-27" } as never) as any; g.sim.policy.mode = "auto"; advance(g.sim, g.w, 12 * (1927 - yearOf(g.sim)));
    const box = (c: { pos: number[] }) => Math.hypot(c.pos[0] - tk[0], c.pos[1] - tk[1]) < 70; let km = 0, kmHigh = 0; for (const e of Object.values(g.sim.edges) as any[]) { if (e.state !== "open" || e.facility === "ferry") continue; const inside = e.cells.filter((k: number) => { const p = g.w.cellPos(k); return Math.hypot(p[0] - tk[0], p[1] - tk[1]) < 70; }).length / e.cells.length; km += e.lengthKm * inside; kmHigh += e.lengthKm * e.cells.filter((k: number) => g.w.elevM(k) > 1500).length / e.cells.length; }
    out[name] = { pops: Object.fromEntries(["東京", "横浜市", "千葉市", "さいたま市", "大阪市"].map((n) => { const c = g.w.cities.find((x: any) => x.name === n); return [n, c ? Math.round((g.sim.cities[c.id]?.pop ?? 0) / 1000) : null]; })), kantoPopK: Math.round(g.w.cities.filter(box).reduce((a: number, c: any) => a + (g.sim.cities[c.id]?.pop ?? 0), 0) / 1000), roadKmWithin70km: Math.round(km), openKmAbove1500m: Math.round(kmHigh), capitalPref: g.sim.capital ?? "JP-13" };
  }
  if (process.env.KFM_OUT) writeFileSync(process.env.KFM_OUT, JSON.stringify(out, null, 1)); void tag;
  const n = out.normal as any, f = out["fuji-tokyo-x5"] as any; expect(base.w.cities.filter((c) => uninhabitable(base.w, c)).length, "no city of the real terrain is uninhabitable").toBe(0);
  expect(n.pops["東京"]).toBeGreaterThan(5000); for (const c of ["東京", "横浜市", "千葉市", "さいたま市"]) expect(f.pops[c], c).toBeLessThanOrEqual(6); expect(f.pops["大阪市"]).toBeGreaterThan(n.pops["大阪市"] * 0.5);
  expect(f.kantoPopK).toBeLessThan(n.kantoPopK / 50); expect(f.roadKmWithin70km).toBeLessThan(n.roadKmWithin70km / 5);
}, 3000000);
