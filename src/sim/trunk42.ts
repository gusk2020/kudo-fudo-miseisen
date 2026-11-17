/**
 * Issue #88 (last request): whatever the policy, the capital and each sub-capital should come to be joined in ALL FOUR modes -- road, rail, sea, air -- as far as the technology of the year allows. This file is the MEASURE of that (pure, no change to the game):
 * for every capital / sub-capital pair, is there a way by each mode?
 *   road  the two 県庁所在地 are in one connected piece of the open road network (ferry sections count: they are how a road crosses a strait);
 *   rail  the same over the open railway network;
 *   sea   each seat reaches a port in service by land (its own city's port, or a port city in the same connected piece of the road or rail network), and those ports are joined by domestic sea routes in service (through other ports if need be);
 *   air   the same with airports and domestic air routes.
 * `missing` says, per mode, the first thing that is not there -- what a builder would have to add. docs/TRUNK42.md has the measurements and the design of the builder that is to use this.
 */
import { homeCity, subCity } from "./ceremony";
import { modeOf, type SimState } from "./types";
import type { World } from "./world";

export type TrunkMode = "road" | "rail" | "sea" | "air";
export interface TrunkPair { from: string; to: string; road: boolean; rail: boolean; sea: boolean; air: boolean; missing: Partial<Record<TrunkMode, string>> }
class UF { p = new Map<string, string>(); find(x: string): string { let r = this.p.get(x) ?? x; if (r !== x) { r = this.find(r); this.p.set(x, r); } return r; } join(a: string, b: string) { const x = this.find(a), y = this.find(b); if (x !== y) this.p.set(x, y); } }
export function trunkStatus(sim: SimState, w: World): TrunkPair[] {
  const cap = homeCity(w, sim.capital), subs = [subCity(w, sim.subCapital), sim.subCapital2 ? subCity(w, sim.subCapital2) : null].filter((c): c is NonNullable<typeof c> => !!c); if (!cap) return [];
  const road = new UF(), rail = new UF(), land = new UF();
  for (const e of Object.values(sim.edges)) { if (e.state !== "open" || e.built < 1) continue; (modeOf(e) === "rail" ? rail : road).join(e.a, e.b); land.join(e.a, e.b); }
  const nodesOf = new Map<string, string[]>(); for (const n of Object.values(sim.nodes)) if (n.cityId) (nodesOf.get(n.cityId) ?? nodesOf.set(n.cityId, []).get(n.cityId)!).push(n.id);
  const linked = (u: UF, a: string, b: string) => { const na = nodesOf.get(a) ?? [], nb = new Set((nodesOf.get(b) ?? []).map((n) => u.find(n))); return a === b || na.some((n) => nb.has(u.find(n))); };
  const hubs = sim.hubs, ports = hubs ? Object.keys(hubs.ports).filter((c) => !hubs.ports[c].until && !hubs.ports[c].build) : [], airs = hubs ? Object.keys(hubs.airports).filter((c) => !hubs.airports[c].until) : [];
  const net = (mode: "sea" | "air") => { const u = new UF(); for (const r of hubs?.routes ?? []) if (r.mode === mode && !r.intl && r.state === "open") u.join(r.a, r.b); return u; }, seaNet = net("sea"), airNet = net("air");
  const reach = (city: string, list: string[]) => list.filter((h) => h === city || linked(land, city, h));
  const via = (a: string, b: string, list: string[], u: UF, what: string, route: string): { ok: boolean; why?: string } => {
    const ha = reach(a, list), hb = reach(b, list); if (!ha.length) return { ok: false, why: `${w.cityById.get(a)?.name ?? a}から陸路で行ける${what}がない` }; if (!hb.length) return { ok: false, why: `${w.cityById.get(b)?.name ?? b}から陸路で行ける${what}がない` };
    const rb = new Set(hb.map((h) => u.find(h))); return ha.some((h) => rb.has(u.find(h))) ? { ok: true } : { ok: false, why: `${what}どうしを結ぶ${route}がない` };
  };
  const pairs: [typeof cap, typeof cap][] = [...subs.map((s) => [cap, s] as [typeof cap, typeof cap]), ...(subs.length === 2 ? [[subs[0], subs[1]] as [typeof cap, typeof cap]] : [])];
  const railShip = (a: string, b: string) => { const pa = ports.filter((h) => h === a || linked(rail, a, h)), pb = new Set(ports.filter((h) => h === b || linked(rail, b, h)).map((h) => seaNet.find(h))); return pa.some((h) => pb.has(seaNet.find(h))); };   // rail to a port, ship, rail from a port: the train-and-ferry way across a strait
  return pairs.map(([a, b]) => { const rd = linked(road, a.id, b.id), rl = linked(rail, a.id, b.id) || (a.island !== b.island && railShip(a.id, b.id)), se = via(a.id, b.id, ports, seaNet, "港", "国内航路"), ai = via(a.id, b.id, airs, airNet, "空港", "国内空路");
    return { from: a.name, to: b.name, road: rd, rail: rl, sea: se.ok, air: ai.ok, missing: { ...(rd ? {} : { road: "道路網がつながっていない" }), ...(rl ? {} : { rail: "鉄道網がつながっていない" }), ...(se.ok ? {} : { sea: se.why! }), ...(ai.ok ? {} : { air: ai.why! }) } }; });
}

/**
 * The rail duty (games made with `sim.trunk42`): while the capital and a sub-capital are not joined by railway, the planner is offered ONE extra candidate a year -- the next leg towards the
 * sub-capital: from a city on the capital's side of the rail network (the capital itself when it has none) to the city that brings the line nearest to the sub-capital, within 160 km and on the same island.
 * It goes through the planner's ordinary checks (path, technology, cost, purse): nothing is built for free, nothing before its technology, no strait is forced (a pair on two islands is left to the
 * strait planner and the ferries). Policy does not switch it off; it only decides how fast the rest of the network grows.
 */
export const TRUNK_TAG = "【首都幹線】", TRUNK_SCORE = 60, TRUNK_LEG_KM = 160, TRUNK_PURSE_SHARE = 0.1;
export function trunkRailLeg(sim: SimState, w: World): { a: number; b: number; reason: string } | null {
  if (!sim.trunk42) return null; const cap = homeCity(w, sim.capital); if (!cap) return null;
  if (Object.values(sim.projects).some((p) => p.reason.startsWith(TRUNK_TAG) && (p.status === "concept" || p.status === "planned" || p.status === "building" || p.status === "suspended"))) return null;   // one leg at a time
  const all = [subCity(w, sim.subCapital), sim.subCapital2 ? subCity(w, sim.subCapital2) : null].filter((c): c is NonNullable<typeof c> => !!c), subs = all.filter((c) => c.island === cap.island);
  const u = new UF(); for (const e of Object.values(sim.edges)) if (modeOf(e) === "rail" && e.state === "open" && e.built >= 1) u.join(e.a, e.b);
  const compOf = new Map<string, string>(); for (const n of Object.values(sim.nodes)) if (n.cityId && !compOf.has(n.cityId)) compOf.set(n.cityId, u.find(n.id));
  const idx = new Map(w.cities.map((c, i) => [c.id, i])), d = (p: { pos: number[] }, q: { pos: number[] }) => Math.hypot(p.pos[0] - q.pos[0], p.pos[1] - q.pos[1]);
  // a seat on another island: the targets become the ports joined by a sea route -- the capital's line runs to its port, the sub-capital's line to the port on its own island (no strait is bridged here)
  const hubs = sim.hubs, ports = hubs ? Object.keys(hubs.ports).filter((c) => !hubs.ports[c].until && !hubs.ports[c].build) : [], sea = new UF(); for (const r of hubs?.routes ?? []) if (r.mode === "sea" && !r.intl && r.state === "open") sea.join(r.a, r.b);
  const targets: { from: NonNullable<ReturnType<typeof homeCity>>; to: NonNullable<ReturnType<typeof homeCity>>; why: string }[] = subs.map((s2) => ({ from: cap, to: s2, why: `首都(${cap.name})と副首都(${s2.name})を鉄道で結ぶ` }));
  for (const sub of all.filter((c) => c.island !== cap.island)) {
    if (trunkStatus(sim, w).find((p) => p.to === sub.name)?.rail) continue; let best: { pa: string; pb: string; v: number } | null = null;
    for (const pa of ports) for (const pb of ports) { const A = w.cityById.get(pa), B = w.cityById.get(pb); if (!A || !B || A.island !== cap.island || B.island !== sub.island || sea.find(pa) !== sea.find(pb)) continue; const v = d(cap, A) + d(sub, B); if (!best || v < best.v) best = { pa, pb, v }; }
    if (!best) continue; const A = w.cityById.get(best.pa)!, B = w.cityById.get(best.pb)!;
    targets.push({ from: cap, to: A, why: `首都(${cap.name})から副首都(${sub.name})への航路の港(${A.name})まで鉄道を通す` }, { from: sub, to: B, why: `副首都(${sub.name})から首都への航路の港(${B.name})まで鉄道を通す` });
  }
  for (const t of targets) {
    const capS = t.from, sub = t.to;
    const cc = compOf.get(capS.id), sc = compOf.get(sub.id); if (capS.id === sub.id || (cc !== undefined && cc === sc)) continue;   // already joined
    const side = w.cities.filter((c) => c.island === capS.island && (c.id === capS.id || (cc !== undefined && compOf.get(c.id) === cc)) && (sim.cities[c.id]?.pop ?? 0) > 0);
    let best: { a: number; b: number; v: number } | null = null;
    for (const a of side) for (const b of w.cities) {
      if (b.island !== capS.island || (sim.cities[b.id]?.pop ?? 0) <= 0 || (cc !== undefined && compOf.get(b.id) === cc) || b.id === a.id) continue; const ab = d(a, b); if ((ab < 20 && b.id !== sub.id) || ab > TRUNK_LEG_KM || d(b, sub) >= d(a, sub)) continue;
      const v = ab + d(b, sub); if (!best || v < best.v) best = { a: idx.get(a.id)!, b: idx.get(b.id)!, v };
    }
    if (best) return { a: best.a, b: best.b, reason: `${TRUNK_TAG}${t.why}(${w.cities[best.a].name}〜${w.cities[best.b].name})` };
  }
  return null;
}
