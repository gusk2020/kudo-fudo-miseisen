import { describe, expect, it } from "vitest";
import { EXTRA, EXTRA_IDS } from "../../src/core/data";
import { mapStateHash } from "../../src/core/save2";
import { parseState } from "../../src/core/save";
import { defaultState, realState } from "../../src/core/state";
import { advance } from "../../src/sim/engine";
import { isolatedIslands } from "../../src/sim/straits";
import { fixedLink } from "../../src/sim/ferry";
import { checkIntegrity } from "../../src/sim/network";
import { realWorld, stage3Sim } from "./simhelp";

describe("added islands: 淡路島・対馬・佐渡島・壱岐島・隠岐諸島", () => {
  const A = realWorld(false), B = realWorld(true), names = ["sado", "awaji", "tsushima", "iki", "oki"];
  it("data matches the real islands in area (Natural Earth, km2)", () => {
    const want: Record<string, [number, number]> = { awaji: [500, 650], tsushima: [650, 760], sado: [800, 960], iki: [120, 160], oki: [240, 340] };
    for (const id of EXTRA_IDS) { const a = EXTRA.islands[id].areaKm2; expect(a).toBeGreaterThanOrEqual(want[id][0]); expect(a).toBeLessThanOrEqual(want[id][1]); }
    expect(EXTRA.cities.map((c) => c.name).sort()).toEqual(["佐渡市", "壱岐市", "対馬市", "洲本市", "隠岐の島町"].sort());
  });
  it("the terrain gains each island as land with its own island number, prefecture and a town; the mainland is untouched", () => {
    expect(B.hash).not.toBe(A.hash);
    EXTRA_IDS.forEach((id, i) => {
      const idx = 5 + i; let cells = 0; for (let k = 0; k < B.w.N; k++) if (B.w.t.island[k] === idx && B.w.t.land[k] === 1) { cells++; expect(B.w.prefOf(k)).toBe(EXTRA.islands[id].pref); }
      expect(cells, id).toBeGreaterThanOrEqual({ sado: 25, awaji: 18, tsushima: 20, iki: 3, oki: 5 }[id]);
      const city = B.w.cities.find((c) => c.id === "X-" + id.toUpperCase())!; expect(city, id).toBeDefined(); expect(city.island).toBe(idx);
    });
    let diff = 0; for (let k = 0; k < A.w.N; k++) if (B.w.t.island[k] <= 4 && (A.w.t.land[k] !== B.w.t.land[k] || A.w.t.island[k] !== B.w.t.island[k])) diff++;
    expect(diff).toBe(0); expect(B.w.cities.length).toBe(A.w.cities.length + 5); expect(B.w.cities.slice(0, A.w.cities.length).map((c) => c.id)).toEqual(A.w.cities.map((c) => c.id));
    void names;
  });
  it("saves made before the islands existed keep their map hash and terrain; new games carry the flag", () => {
    const old = defaultState(), now = realState();
    expect(old.islands).toBeUndefined(); expect(now.islands).toBe(true);
    expect(mapStateHash(old)).toBe(mapStateHash({ ...old, capital: undefined })); expect(mapStateHash(realState())).not.toBe("709c0b87"); expect(mapStateHash({ ...realState(), islands: undefined })).toBe("709c0b87"); expect(mapStateHash(now)).not.toBe(mapStateHash({ ...now, islands: undefined }));
    expect(parseState({ ...old, real: true }).state.islands).toBeUndefined(); expect(parseState(JSON.parse(JSON.stringify(now))).state.islands).toBe(true);
  });
  it("a game on the island map runs: roads and villages on every island, integrity holds, remote islands start isolated, 淡路 gets its bridges", () => {
    const { sim, w } = stage3Sim("heisei", 7, true, 0, 2, true, undefined, 0);   // Stage 11 rules (waterK 0): with the Stage 13 water tunnels 淡路 is reached by tunnels long before the scripted bridges
    for (let i = 0; i < 5; i++) { const c = w.cities.find((x) => x.id === "X-" + EXTRA_IDS[i].toUpperCase())!; expect(Object.values(sim.settlements).some((v) => v.city === c.id), c.name).toBe(true); }
    expect(isolatedIslands(sim, w)).toEqual([]);   // Issue #15: every island is joined to the mainland by ferry from the first day (no bridge is forced into 1950)
    const lmOf = (id: string) => w.lm[w.cityById.get(id)!.cell], honshu = w.lm[w.cityById.get("C-JP-27")!.cell];
    expect(fixedLink(sim, w, lmOf("X-AWAJI"), honshu, "road")).toBeNull();   // ... but no fixed link yet
    sim.policy!.mode = "auto"; advance(sim, w, 12 * 70);
    expect(checkIntegrity(sim)).toEqual([]);
    expect(Object.values(sim.edges).some((e) => e.facilityName?.startsWith("akashi-awaji:") || e.facilityName?.startsWith("naruto-awaji:"))).toBe(true);
    expect(fixedLink(sim, w, lmOf("X-AWAJI"), honshu, "road") ?? fixedLink(sim, w, lmOf("X-AWAJI"), w.lm[w.cityById.get("C-JP-36")!.cell], "road")).not.toBeNull();   // 淡路 gets a bridge by 1998 at the latest
    expect(fixedLink(sim, w, lmOf("X-SADO"), honshu, "road")).toBeNull();   // 佐渡 stays reachable only by ferry (no fixed link is planned for it)
  }, 300000);
});
