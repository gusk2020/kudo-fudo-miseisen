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
  return pairs.map(([a, b]) => { const rd = linked(road, a.id, b.id), rl = linked(rail, a.id, b.id), se = via(a.id, b.id, ports, seaNet, "港", "国内航路"), ai = via(a.id, b.id, airs, airNet, "空港", "国内空路");
    return { from: a.name, to: b.name, road: rd, rail: rl, sea: se.ok, air: ai.ok, missing: { ...(rd ? {} : { road: "道路網がつながっていない" }), ...(rl ? {} : { rail: "鉄道網がつながっていない" }), ...(se.ok ? {} : { sea: se.why! }), ...(ai.ok ? {} : { air: ai.why! }) } }; });
}
