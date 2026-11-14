import { beforeAll, describe, expect, it } from "vitest";
import { advance, yearOf } from "../../src/sim/engine";
import { dropForeignOldCities, restoreOldCities, syncOldCities } from "../../src/sim/oldcity40";
import { promoteOldCities, promotionCandidates } from "../../src/sim/oldpromote40";
import { checkIntegrity } from "../../src/sim/network";
import type { SimState } from "../../src/sim/types";
import { stage3Sim } from "./simhelp";

/** Issue #67 (audit of PR #71, priority 3): a promoted city in the long run. Nothing is forced: the game promotes by its own rules; what is checked is that the city then takes part in the
 *  nation (people, roads, projects, the other modes where the normal rules give them) and that save -> load -> 50 years is the game that never stopped. */
const g = stage3Sim("heisei", 7, true, 0, 2, true, undefined, undefined, { start1800: true } as never), { sim, w } = g;
const sig = (s: SimState) => JSON.stringify([Object.keys(s.cities).sort().map((k) => [k, s.cities[k].pop]), Object.keys(s.routes).length, Object.keys(s.projects).length, Object.keys(s.edges).length, s.rngState, (s.oldCities40 ?? []).map((d) => d.id), s.next]);
const byPref = (s: SimState) => { const m = new Map<string, number>(); const add = (p: string | null | undefined, n: number) => m.set(p ?? "?", (m.get(p ?? "?") ?? 0) + n);
  for (const [id, c] of Object.entries(s.cities)) add(w.cityById.get(id)?.pref, c.pop); for (const v of Object.values(s.settlements)) add(w.prefOf(v.cell), v.pop); return m; };
let y0 = 0; const R: any = { Sprev: "", S: "", ctl: "", ids: [] as string[], pref: { b: new Map(), a: new Map(), n: 0 }, m: {} };
beforeAll(() => {
  sim.policy!.mode = "auto";
  for (let y = 1950; y <= 2030 && !y0; y++) { advance(sim, w, 12 * (y - yearOf(sim))); if ((y - sim.startYear) % 10 === 9 && promotionCandidates(sim, w, y + 1).length) y0 = y; }
  if (!y0) return; advance(sim, w, 12 * (y0 - yearOf(sim)) + 11); R.Sprev = JSON.stringify(sim);
  { const c = JSON.parse(R.Sprev) as SimState; syncOldCities(c, w); R.pref.b = byPref(c); R.pref.n = promoteOldCities(c, w, y0 + 1); R.pref.a = byPref(c); syncOldCities(sim, w); }   // the exact move, per prefecture
  advance(sim, w, 1); R.S = JSON.stringify(sim); R.ids = (sim.oldCities40 ?? []).map((d) => d.id); R.pop0 = Object.fromEntries(R.ids.map((i: string) => [i, sim.cities[i]?.pop]));
  advance(sim, w, 12 * 50); R.ctl = sig(sim); R.y = yearOf(sim);
}, 1800000);
describe("Issue #67: promoted cities over the long run", () => {
  it("at the promotion the people of every prefecture are the same (the nation's total is the same too)", () => {
    expect(R.pref.n).toBeGreaterThan(0); const keys = new Set([...R.pref.b.keys(), ...R.pref.a.keys()]); for (const k of keys) expect(R.pref.a.get(k) ?? 0, k).toBe(R.pref.b.get(k) ?? 0);
  });
  it("50 years later the promoted cities are part of the nation: they live (their own people), are on the road network, and the integrity holds", () => {
    expect(R.ids.length).toBeGreaterThan(0); const nodeOf = (cell: number) => Object.values(sim.nodes).find((n) => n.cell === cell); const rows: string[] = [];
    for (const d of sim.oldCities40!) {
      const c = sim.cities[d.id]; expect(c, d.id).toBeTruthy(); expect(c.pop, d.id).toBeGreaterThan(0); const nd = nodeOf(d.cell); expect(nd, d.id).toBeTruthy();
      const es = Object.values(sim.edges).filter((e) => e.a === nd!.id || e.b === nd!.id), modes = new Set(es.map((e) => (e.mode ?? "road") + (e.facility === "ferry" ? "-ferry" : ""))), pj = Object.values(sim.projects).filter((p) => p.from === nd!.id || p.to === nd!.id).length;
      const h = sim.hubs, port = !!h?.ports[d.id], air = Object.values(h?.airports ?? {}).some((a) => a.city === d.id), hr = (h?.routes ?? []).filter((r) => r.a === d.id || r.b === d.id).length;
      rows.push(`${d.name} pop ${R.pop0[d.id] ?? "-"}->${c.pop} edges ${es.length} modes ${[...modes].join("/")} projects ${pj} port ${port} air ${air} hubRoutes ${hr}`);
      expect(es.length, d.id).toBeGreaterThan(0);
    }
    process.stderr.write("LONG67 " + R.y + "\n" + rows.join("\n") + "\n"); expect(checkIntegrity(sim)).toEqual([]);
  });
  it("save at the promotion -> load into the same shared world -> 50 years: identical to the game that never stopped", () => {
    const loaded = JSON.parse(R.S) as SimState; loaded.policy!.mode = "auto"; dropForeignOldCities(w); const r = restoreOldCities(loaded, w); expect(r.problems).toEqual([]);
    advance(loaded, w, 12 * (R.y - yearOf(loaded))); expect(sig(loaded)).toBe(R.ctl);
  }, 1800000);
});
