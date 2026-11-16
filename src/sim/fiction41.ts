/**
 * Stage 41 #6 / #7: fictional-technology marks and the sea/air-priority limit, both from the same short table of RECORDS that were checked against sources (docs/TECH-HISTORY41.md). Nothing here is guessed: a tunnel is marked 【架空】 only when it is longer than a
 * tunnel that is KNOWN to have existed at that time; a tunnel the table cannot judge (shorter than the verified records) is left unmarked, not called real.
 *   rail tunnel, world:  Seikan 53.85 km (1988) until the Gotthard Base 57.09 km (2016).   Japan: Seikan 53.85 km (1988).
 *   road tunnel, world:  Lærdal 24.51 km (2000).   Japan: 山手トンネル, 18.2 km by one source and 18.6 km by another -- the larger is used, so nothing is wrongly called fictional.
 * Anything longer than these, opened in ANY year, is longer than every tunnel that existed then (a record can only grow), so the mark is safe. Bridges: see BRIDGE_RECORD below (verified in the second round).
 */
import { modeOf, type SimEdge, type SimState } from "./types";

export const RECORD = { railWorldKm: [[1988, 53.85], [2016, 57.09]] as [number, number][], railJapanKm: 53.85, roadWorldKm: 24.51, roadJapanKm: 18.6 };
/** The longest tunnel (km) that existed in the world / in Japan at the end of the year -- as far as the verified table goes (a lower bound before the first entry: any value above it was still never dug). */
export const worldRailRecord = (year: number) => RECORD.railWorldKm.reduce((m, [y, km]) => (year >= y ? km : m), RECORD.railWorldKm[0][1]);
export type Fiction = "" | "日本初" | "世界初";
export function tunnelFiction(e: Pick<SimEdge, "facility" | "lengthKm" | "mode">, year: number): Fiction {
  if (e.facility !== "tunnel") return ""; const rail = modeOf(e) === "rail", km = e.lengthKm;
  const world = rail ? worldRailRecord(year) : RECORD.roadWorldKm, japan = rail ? RECORD.railJapanKm : RECORD.roadJapanKm;
  return km > world ? "世界初" : km > japan ? "日本初" : "";
}
/** Bridges (verified 2026-11-17): Japan's longest bridge is the 東京湾アクアブリッジ, 4,384 m by one count and 4,424-4,425 m by others (1997; the 明石海峡大橋 is 3,911 m, 1998) -- the larger is used. The world's longest continuous bridge over water is the Lake Pontchartrain Causeway,
 *  38.28-38.44 km by the way it is measured (1969) -- the larger is used. A viaduct over land (Danyang-Kunshan, 164.8 km) is another kind of thing and is not compared with a sea crossing. */
export const BRIDGE_RECORD = { japanKm: 4.425, worldWaterKm: 38.44 };
export function bridgeFiction(e: Pick<SimEdge, "facility" | "lengthKm">): Fiction {
  if (e.facility !== "bridge") return ""; return e.lengthKm > BRIDGE_RECORD.worldWaterKm ? "世界初" : e.lengthKm > BRIDGE_RECORD.japanKm ? "日本初" : "";
}
/** Either kind of facility. */
export const facilityFiction = (e: Pick<SimEdge, "facility" | "lengthKm" | "mode">, year: number): Fiction => (e.facility === "tunnel" ? tunnelFiction(e, year) : bridgeFiction(e));
export const fictionMark = (f: Fiction) => (f ? `【架空・${f}】` : "");
/** The longest tunnel any game may dig while sea or air is the priority: the longest that exists in 2026 (rail, world). */
export const SEA_AIR_TUNNEL_CAP_KM = 57.09;
/** Is the stance now in force sea or air priority? (the era list's last entry; a game without one, its single era) */
export function seaAirPriority(sim: Pick<SimState, "kaigen" | "era">): boolean {
  const k = sim.kaigen, last = k?.eras?.length ? k.eras[k.eras.length - 1].stance : sim.era; return last === "kairo" || last === "kuuro";
}
