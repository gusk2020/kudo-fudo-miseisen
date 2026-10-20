/**
 * The 1950-style railway network, reconstructed (not copied) from where real railways run.
 *
 * Which city pairs are joined is decided by the reference corridors (reference.ts): a pair is linked when a path between them can follow
 * real railway most of the way. The route each link takes is the least-cost path, pulled toward the real line. Operators and standards
 * are model choices: large city pairs close together get a private commuter railway, a few rural short lines are private, the rest is
 * the national railway. None of that is a claim about who really owned which line.
 */
import { basePop, capitalPref } from "./roles";
import { terrainGate } from "./land";
import { dist } from "../core/geom";
import { layPath } from "./network";
import { designate, ev, prefName, rand } from "./engine";
import { refBias, refCoverage, referenceGrids } from "./reference";
import { pathfind, type World, type WCity } from "./world";
import type { Operator, SimRoute, SimState, Standard } from "./types";

interface Link { a: WCity; b: WCity; path: number[]; op: string; std: Standard }
const baseName = (c: WCity) => c.name.replace(/市$/, "");
export interface Step { idx: number; fwd: boolean }

/** Group links into through lines: at every city, pair up the links that continue most nearly straight on (turn under 60 degrees). */
export function chainLinks(links: { a: WCity; b: WCity }[]): Step[][] {
  const at = new Map<string, number[]>(), partner = new Map<string, number>(), key = (i: number, c: WCity) => `${i}@${c.id}`;
  links.forEach((l, i) => { for (const c of [l.a, l.b]) (at.get(c.id) ?? at.set(c.id, []).get(c.id)!).push(i); });
  const away = (i: number, c: WCity) => { const o = links[i].a.id === c.id ? links[i].b : links[i].a; return Math.atan2(o.pos[1] - c.pos[1], o.pos[0] - c.pos[0]); };
  for (const [cid, ls] of [...at.entries()].sort()) {
    const c = links[ls[0]].a.id === cid ? links[ls[0]].a : links[ls[0]].b, pairs: [number, number, number][] = [];
    for (let x = 0; x < ls.length; x++) for (let y = x + 1; y < ls.length; y++) { let d = Math.abs(away(ls[x], c) - away(ls[y], c)); if (d > Math.PI) d = 2 * Math.PI - d; if (d > (Math.PI * 2) / 3) pairs.push([d, ls[x], ls[y]]); }
    pairs.sort((p, q) => q[0] - p[0] || p[1] - q[1] || p[2] - q[2]); const used = new Set<number>();
    for (const [, x, y] of pairs) if (!used.has(x) && !used.has(y)) { used.add(x); used.add(y); partner.set(key(x, c), y); partner.set(key(y, c), x); }
  }
  const seen = new Set<number>(), chains: Step[][] = [];
  for (let i = 0; i < links.length; i++) {
    if (seen.has(i)) continue; seen.add(i); const chain: Step[] = [{ idx: i, fwd: true }];
    let cur = i, city = links[i].b;
    for (;;) { const j = partner.get(key(cur, city)); if (j === undefined || seen.has(j)) break; seen.add(j); const fwd = links[j].a.id === city.id; chain.push({ idx: j, fwd }); city = fwd ? links[j].b : links[j].a; cur = j; }
    cur = i; city = links[i].a;
    for (;;) { const j = partner.get(key(cur, city)); if (j === undefined || seen.has(j)) break; seen.add(j); const fwd = links[j].b.id === city.id; chain.unshift({ idx: j, fwd }); city = fwd ? links[j].a : links[j].b; cur = j; }
    chains.push(chain);
  }
  return chains;
}

function spanning(w: World): Set<string> {
  const keys = new Set<string>();
  for (const isl of [...new Set(w.cities.map((c) => c.island))].sort((x, y) => x - y)) {
    const cs = w.cities.filter((c) => c.island === isl); if (cs.length < 2) continue; const inT = new Set([cs[0].id]);
    while (inT.size < cs.length) {
      let best: [WCity, WCity] | null = null, bd = Infinity;
      for (const a of cs) if (inT.has(a.id)) for (const b of cs) if (!inT.has(b.id)) { const d = dist(a.pos, b.pos); if (d < bd) { bd = d; best = [a, b]; } }
      if (!best || bd > 300) break; keys.add(best[0].id < best[1].id ? best[0].id + best[1].id : best[1].id + best[0].id); inT.add(best[1].id);
    }
  }
  return keys;
}

/** Stage 15: the longest gap a quarter-of-the-compass neighbour may be joined across in the 1950 network (km). */
export const GAP_KM = 230;
export function* seedRailGen(sim: SimState, w: World): Generator<number> {
  const ref = referenceGrids(w), bias = refBias(ref.rail), mst = spanning(w);
  const cand: [WCity, WCity][] = [], keys = new Set<string>();
  const add = (a: WCity, b: WCity) => { const [x, y] = a.id < b.id ? [a, b] : [b, a], k = x.id + y.id; if (!keys.has(k)) { keys.add(k); cand.push([x, y]); } };
  for (const a of w.cities) for (const b of w.cities) if (a.id < b.id && a.island === b.island && mst.has(a.id + b.id)) add(a, b);
  for (const a of w.cities) for (const b of [...w.cities].filter((x) => x.id !== a.id && x.island === a.island).sort((p, q) => dist(a.pos, p.pos) - dist(a.pos, q.pos) || (p.id < q.id ? -1 : 1)).slice(0, 3)) if (dist(a.pos, b.pos) <= 130) add(a, b);
  // Stage 15: a gap between two cities of one coast is not a reason for there to be no railway: a city also joins the nearest city of each quarter of the compass within GAP_KM, however far the other
  // three are. (Before, only the three nearest within 130 km were tried, and a sparse coast -- Tottori-Matsue 153 km, Niigata-Toyama 212 km -- got no trunk at all in 1950: the San'in coast had 46 km of railway for the whole century.)
  if (sim.pop15) for (const a of w.cities) {
    const near: (WCity | null)[] = [null, null, null, null], nd = [Infinity, Infinity, Infinity, Infinity];
    for (const b of w.cities) { if (b.id === a.id || b.island !== a.island) continue; const d = dist(a.pos, b.pos); if (d > GAP_KM) continue; const q = Math.min(3, Math.floor(((Math.atan2(b.pos[1] - a.pos[1], b.pos[0] - a.pos[0]) + Math.PI) / (Math.PI / 2)))); if (d < nd[q]) { nd[q] = d; near[q] = b; } }
    for (const b of near) if (b) add(a, b);
  }
  yield 0.05;
  const links: Link[] = [], operators = new Map<string, Operator>(), railCells = new Set<number>();
  const opFor = (a: WCity, b: WCity, len: number, r: number): string => {
    const big = Math.min(basePop(sim, w, a), basePop(sim, w, b)) > 250000, anchor = basePop(sim, w, a) >= basePop(sim, w, b) ? a : b;
    if (big && len < 110 && r < 0.55) { const id = `p.${anchor.id}`; if (!operators.has(id)) operators.set(id, { id, name: `${baseName(anchor)}電鉄`, kind: "private", since: 1950, note: "大都市圏の私鉄(架空の事業者名)" }); return id; }
    if (len < 75 && Math.min(basePop(sim, w, a), basePop(sim, w, b)) < 200000 && r < 0.22) { const id = `p.${anchor.id}.r`; if (!operators.has(id)) operators.set(id, { id, name: `${prefName(anchor.pref ?? capitalPref(sim))}${baseName(anchor)}鉄道`, kind: "private", since: 1950, note: "地方の私鉄(架空の事業者名)" }); return id; }
    return "jnr";
  };
  let tried = 0;
  for (const [a, b] of cand) {
    const path = pathfind(w, a.cell, b.cell, { rail: true, bias, roadCells: railCells, margin: 18 }); tried++;
    if (tried % 6 === 0) yield 0.05 + 0.6 * (tried / cand.length);
    const r = rand(sim), r2 = rand(sim); if (!path || path.length < 3) continue;
    if (w.land12 && !terrainGate(w, sim, "rail", path, sim.startYear).ok) continue;
    const cov = refCoverage(ref.rail, path), structural = mst.has(a.id + b.id);
    if (cov < (structural ? 0.3 : 0.55)) continue;
    const len = path.length * w.cell, op = opFor(a, b, len, r);
    const elec = path.filter((k) => ref.railElectric[k]).length / path.length, multi = path.filter((k) => ref.railMulti[k]).length / path.length;
    const std: Standard = (elec > 0.5 || multi > 0.5) && basePop(sim, w, a) + basePop(sim, w, b) > 500000 && r2 < 0.8 ? "standard" : "rural";
    for (const k of path) railCells.add(k);
    links.push({ a, b, path, op, std });
  }
  for (const [id, o] of [...operators.entries()].sort()) sim.operators[id] = o;
  let nLines = 0, km = 0;
  for (const opId of ["jnr", ...[...operators.keys()].sort()]) {
    const mine = links.filter((l) => l.op === opId); if (!mine.length) continue;
    const chains = chainLinks(mine).map((c) => ({ c, len: c.reduce((s, x) => s + mine[x.idx].path.length, 0) })).sort((p, q) => q.len - p.len || p.c[0].idx - q.c[0].idx);
    const grade = opId === "jnr" ? "jnr" : "priv", scope = opId === "jnr" ? "JP" : opId;
    for (const { c } of chains) {
      // The route is registered with the first edge and extended as each link is laid, so a later link that splits an earlier one's edge rewrites the route too.
      let route: SimRoute | null = null, prev: string | null = null; const first = (c[0].fwd ? mine[c[0].idx].a : mine[c[0].idx].b).name, last = (c[c.length - 1].fwd ? mine[c[c.length - 1].idx].b : mine[c[c.length - 1].idx].a).name;
      for (const { idx, fwd } of c) {
        const l = mine[idx], cells = fwd ? l.path : [...l.path].reverse();
        const lay = layPath(sim, w, cells, { facilities: w.land12, open: true, surface: "paved", quality: opId === "jnr" ? 52 + rand(sim) * 28 : 58 + rand(sim) * 27, built: 1, month: 0, standard: l.std, mode: "rail", op: opId });
        for (const ref2 of lay.chain) {
          const e = sim.edges[ref2.edgeId], from = ref2.dir === 1 ? e.a : e.b, to = ref2.dir === 1 ? e.b : e.a;
          if (route && prev !== from) route = null;   // track shared with an earlier line can leave a gap: a gap starts a new line
          if (!route) { route = designate(sim, [ref2], grade, scope, `${first}〜${last}`, "1950年の既存鉄道網(再構成)", true); if (route) nLines++; } else route.edges.push(ref2);
          prev = to;
        }
      }
    }
    yield 0.9;
  }
  for (const e of Object.values(sim.edges)) if (e.mode === "rail") km += e.lengthKm;
  ev(sim, "seed", `1950年の鉄道網(再構成): 都市間${links.length}区間・${nLines}路線・事業者${1 + operators.size}(国鉄+私鉄${operators.size})・約${Math.round(km)}km`, "初期条件。実在の路線の位置を参考にした再構成で、史実の路線台帳ではない", {});
}
