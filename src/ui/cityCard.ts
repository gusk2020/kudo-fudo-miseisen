/**
 * Issue #67: what a tap on a city circle tells. Pure (the simulation in, lines of text out), so a test can ask it; nothing here draws anything.
 * Only data the game already has: the name, the prefecture, the people, the growth against the nation, where the city came from (a promoted old municipality), and which kinds of transport reach it.
 */
import { tierOf } from "../sim/tier23";
import { homeCity, subCity } from "../sim/ceremony";
import { modeOf } from "../sim/types";
import { prefName } from "../sim/engine";
import type { SimState } from "../sim/types";
import type { World } from "../sim/world";

export interface CityCard { title: string; lines: string[] }
const people = (n: number) => (n >= 1e7 ? `約${(n / 1e4).toFixed(0)}万人` : n >= 1e4 ? `約${(n / 1e4).toFixed(1)}万人` : `約${Math.round(n / 100) * 100}人`);
export function cityCard(sim: SimState, w: World, id: string, rel: number | null): CityCard | null {
  const c = w.cityById.get(id), st = sim.cities[id]; if (!c || !st) return null;
  const lines: string[] = [], seat = homeCity(w, sim.capital)?.id === id ? "首都" : subCity(w, sim.subCapital)?.id === id ? "副首都" : "", tier = tierOf(sim, id), def = sim.oldCities40?.find((d) => d.id === id);
  const tag = [seat, tier === 2 ? "政令指定都市" : tier === 1 ? "政令特区" : ""].filter(Boolean).join("・");
  if (c.pref) lines.push(`所属: ${prefName(c.pref)}`);
  lines.push(`人口: ${people(st.pop)}`);
  if (rel !== null) lines.push(`20年の人口: ${rel > 1.08 ? "全国平均より増えている" : rel < 0.93 ? "全国平均より減っている" : "全国平均並み"}`);
  if (def) lines.push(`成り立ち: 旧市町村から${def.year}年に都市へ昇格(ゲーム上の昇格。史実ではない)`);
  const node = Object.values(sim.nodes).find((n) => n.cell === c.cell), es = node ? Object.values(sim.edges).filter((e) => e.a === node.id || e.b === node.id) : [];
  const kinds = [es.some((e) => modeOf(e) === "road") ? "道路" : "", es.some((e) => modeOf(e) === "rail") ? "鉄道" : "", es.some((e) => e.facility === "ferry") ? "渡船" : "", sim.hubs?.ports[id] ? "港" : "", Object.values(sim.hubs?.airports ?? {}).some((a) => a.city === id) ? "空港" : ""].filter(Boolean);
  lines.push(`交通: ${kinds.length ? kinds.join("・") : "なし"}`);
  return { title: tag ? `${c.name}(${tag})` : c.name, lines };
}
