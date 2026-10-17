import { describe, expect, it } from "vitest";
import { defaultState } from "../../src/core/state";
import { realToWorld } from "../../src/core/body";
import { lonLatToReal } from "../../src/core/data";
import { generateTerrain } from "../../src/core/terrain";
import type { Vec } from "../../src/core/types";
import { homeCity, performNational, previewNational, subCity } from "../../src/sim/ceremony";
import { createSim } from "../../src/sim/engine";
import { checkIntegrity } from "../../src/sim/network";
import { buildWorld, type World } from "../../src/sim/world";
import { loadDem } from "./helpers";
import { city, line, realWorld, ridgeWorld, stage3SimOn, viaShikoku } from "./simhelp";
import { MTN_RAIL_PASS_M, mountainBarrier, mountainCost, pathfind } from "../../src/sim/world";
import { analyze } from "../../src/sim/demand";
import { kindOf } from "../../src/render/roads";
import { landShare, seaPath } from "../../src/render/seaPath";
import { isLakeFerry } from "../../src/sim/ferry";
import { advance } from "../../src/sim/engine";

const worldOf = (mut: (s: ReturnType<typeof defaultState>) => void = () => {}) => { const s = defaultState(); s.islands = true; mut(s); const t = generateTerrain(s, loadDem()); return { w: buildWorld(t, s.seed), hash: t.hash, s }; };
describe("Stage 9: 国道1号 keeps the land masses the player drew", () => {
  const base = worldOf();
  it("a line drawn through Shikoku goes through Shikoku (two crossings, Shikoku cities on the road), and is laid that way", () => {
    const w = base.w, p = previewNational(w, viaShikoku(w), "JP-13", "JP-27"); expect(p.ok, p.reasons.join()).toBe(true);
    const shik = w.lm[city(w, "高松市").cell], onShik = p.segments.filter((s) => !s.ferry && !s.lake && s.cells.some((k) => w.lm[k] === shik));
    expect(onShik.length).toBeGreaterThan(0); expect(p.ferries.length).toBeGreaterThanOrEqual(2);
    for (const n of ["高松市", "松山市"]) { const c = city(w, n).pos; expect(Math.min(...p.path.map((q) => Math.hypot(q[0] - c[0], q[1] - c[1]))), n).toBeLessThan(12); }
    const sim = createSim(w, "m", base.hash, 7, { stage3: true, firstEra: 0, techK: 2, subCapital: "JP-27" }); expect(performNational(sim, w, p)).toBe(true); expect(checkIntegrity(sim)).toEqual([]);
    const r = Object.values(sim.routes).find((x) => x.grade === "national" && x.number === 1)!;
    expect(r.edges.some((x) => sim.edges[x.edgeId].cells.some((k) => w.lm[k] === shik))).toBe(true);
    for (let i = 1; i < r.edges.length; i++) { const a = sim.edges[r.edges[i - 1].edgeId], b = sim.edges[r.edges[i].edgeId], end = r.edges[i - 1].dir === 1 ? a.b : a.a, start = r.edges[i].dir === 1 ? b.a : b.b; expect(start, `break at ${i}`).toBe(end); }
  });
  it("a line along Honshu stays on Honshu (no crossing invented)", () => {
    const w = base.w, p = previewNational(w, line([homeCity(w)!.pos, city(w, "名古屋市").pos, subCity(w, "JP-27")!.pos]), "JP-13", "JP-27"); expect(p.ok, p.reasons.join()).toBe(true);
    expect(p.ferries.length).toBe(0);
  });
});

describe("Stage 9: a drawn mountain range is a real barrier", () => {
  const NE: [number, number][] = [[138.35, 34.95], [138.4, 35.4], [138.5, 35.9], [138.6, 36.4]], SW: [number, number][] = [[133.75, 34.45], [133.65, 34.8], [133.55, 35.15], [133.45, 35.45]];
  it("path-finding goes round or over the lowest pass, a railway never climbs over the high crest, and the cost of a line through it is several times higher", () => {
    const flat = realWorld(true).w, mtn = ridgeWorld({ ne: NE }).w, a = city(flat, "東京").cell, b = city(flat, "名古屋市").cell; flat.barrier = true; mtn.barrier = true;
    const crest: number[] = []; for (let k = 0; k < mtn.N; k++) if (mtn.t.ridge[k] > 0.85) crest.push(mtn.t.elev[k]); crest.sort((x, y) => x - y); const median = crest[Math.floor(crest.length / 2)];
    const p0 = pathfind(flat, a, b)!, p1 = pathfind(mtn, a, b)!, r1 = pathfind(mtn, a, b, { rail: true })!;
    expect(p1.length).toBeGreaterThan(p0.length);
    const highOn = (p: number[]) => Math.max(...p.filter((k) => mtn.t.ridge[k] > 0.5).map((k) => mtn.t.elev[k]), 0);
    expect(highOn(p1)).toBeLessThan(median);                     // over the lowest pass, never the crest
    expect(highOn(r1)).toBeLessThanOrEqual(MTN_RAIL_PASS_M);     // a railway does not climb over the range at all in 1950
    expect(mountainCost(mtn, p0)).toBeGreaterThan(1.5); expect(mountainCost(flat, p0)).toBe(1);
    expect(mountainBarrier(0.9, 2400)).toBeGreaterThan(3 * mountainBarrier(0.9, 1500)); expect(mountainBarrier(0.1, 3000)).toBe(0);
  });
  it("1950-1975: a range across the Tokaido makes Tokyo-Nagoya clearly slower by road and by rail (until tunnels come); one across the Sanyo lengthens the Okayama-Hiroshima way", () => {
    const run = (base: ReturnType<typeof realWorld>, y1: number) => { const { sim, w } = stage3SimOn(base); advance(sim, w, 12 * (y1 - 1950)); return { an: analyze(sim, w), w }; };
    const t = (r: ReturnType<typeof run>, x: string, y: string, rail = false) => { const nc = r.w.cities.length, i = r.w.cities.findIndex((c) => c.name === x), j = r.w.cities.findIndex((c) => c.name === y); return (rail ? r.an.TT : r.an.T)[i * nc + j]; };
    for (const y of [1960, 1975]) {
      const none = run(realWorld(true), y), ne = run(ridgeWorld({ ne: NE }), y);
      expect(t(ne, "東京", "名古屋市"), `road ${y}`).toBeGreaterThan(1.3 * t(none, "東京", "名古屋市"));
      expect(t(ne, "東京", "名古屋市", true), `rail ${y}`).toBeGreaterThan(1.3 * t(none, "東京", "名古屋市", true));
    }
    const flat = realWorld(true).w, mtn = ridgeWorld({ sw: SW }).w, a = city(flat, "岡山市").cell, b = city(flat, "広島市").cell; flat.barrier = true; mtn.barrier = true;
    expect(pathfind(mtn, a, b, { rail: true })!.length).toBeGreaterThan(pathfind(flat, a, b, { rail: true })!.length);
    expect(mountainCost(mtn, pathfind(flat, a, b)!)).toBeGreaterThan(1.5);
  }, 600000);
});

describe("Stage 9: the map shows kinds, and ferries are drawn over the water", () => {
  it("roads and railways are drawn by kind (道路/高速道路/鉄道/新幹線/リニア), never by administrative grade or operator", () => {
    expect(kindOf({ standard: "rural" } as never)).toBe("road"); expect(kindOf({ standard: "highgrade" } as never)).toBe("hwy");
    expect(kindOf({ standard: "standard", mode: "rail" } as never)).toBe("rail"); expect(kindOf({ standard: "highgrade", mode: "rail" } as never)).toBe("hsr"); expect(kindOf({ standard: "highgrade", mode: "rail", maglev: true } as never)).toBe("maglev");
  });
  it("every domestic ferry of the 1950 network is drawn over water: no drawn point (away from its two ports) falls on land", () => {
    const { sim, w } = stage3SimOn(realWorld(true)); const fs = Object.values(sim.edges).filter((e) => e.facility === "ferry"); expect(fs.length).toBeGreaterThan(5);
    for (const e of fs) { const pts = seaPath(w, sim.nodes[e.a].cell, sim.nodes[e.b].cell, isLakeFerry(e)); expect(landShare(w, pts), e.facilityName).toBeLessThanOrEqual(0.05); }
  });
});

describe("Stage 9: a range drawn in several strokes", () => {
  it("every stroke raises the terrain (and makes it a barrier); the strokes survive saving", async () => {
    const { parseState } = await import("../../src/core/save");
    const base = defaultState(); base.islands = true; const to = ([lon, lat]: [number, number]): Vec => realToWorld("honshu", base.bodies.honshu, lonLatToReal(lon, lat));
    const one = JSON.parse(JSON.stringify(base)); one.ridges.ne = [[138.35, 34.95], [138.4, 35.4]].map((p) => to(p as [number, number]));
    const two = JSON.parse(JSON.stringify(one)); two.ridgeExtra = { ne: [[[138.5, 35.9], [138.6, 36.4]].map((p) => to(p as [number, number]))], sw: [] };
    const cells = (s: typeof base) => { const t = generateTerrain(s, loadDem()); let n = 0; for (let k = 0; k < t.ridge.length; k++) if (t.ridge[k] > 0.5) n++; return n; };
    expect(cells(two)).toBeGreaterThan(cells(one) * 1.3);
    const back = parseState(JSON.parse(JSON.stringify(two))).state; expect(back.ridgeExtra?.ne.length).toBe(1); expect(back.ridgeExtra?.ne[0].length).toBe(2);
    expect(parseState(JSON.parse(JSON.stringify(one))).state.ridgeExtra).toBeUndefined();   // an older save has none, and gets none
  });
});
