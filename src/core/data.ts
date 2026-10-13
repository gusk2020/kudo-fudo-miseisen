import raw from "../data/japan.json";
import { centroid, densify } from "./geom";
import type { IslandId, Vec } from "./types";
import { ISLAND_IDS } from "./types";

export interface PrefDef { id: string; weight: number; name: string; island: IslandId | "okinawa"; capital: string; seed: Vec; seedApprox: boolean }
export interface CityDef { id: string; name: string; pos: Vec; kind: "capital" | "city"; pref: string | null; island: string }
export interface DemMeta { w: number; h: number; lon0: number; lat0: number; dLon: number; dLat: number; file: string }
export interface JapanData {
  islands: Record<string, { outline: Vec[]; n: number; areaKm2: number }>;
  biwa: { center: Vec; shape: Vec[]; areaKm2: number };
  fuji: { center: Vec; summitM: number; baseRadiusKm: number };
  prefectures: PrefDef[]; cities: CityDef[]; dem: DemMeta;
  proj: { lon0: number; lat0: number; kmPerDegLon: number; kmPerDegLat: number };
  sources: { name: string; license: string; url: string }[];
}
export const JAPAN = raw as unknown as JapanData;

export const MAX_SEG_KM = 3;
export interface BodyDef { id: IslandId; origin: Vec; parts: Vec[][]; mainArea: number }

function makeDef(id: IslandId, extra: string[]): BodyDef {
  const main = JAPAN.islands[id].outline;
  const origin = centroid(main);
  const local = (o: Vec[]) => densify(o.map((q) => [q[0] - origin[0], q[1] - origin[1]] as Vec), MAX_SEG_KM);
  return { id, origin, parts: [local(main), ...extra.map((e) => local(JAPAN.islands[e].outline))], mainArea: JAPAN.islands[id].areaKm2 };
}
/** Okinawa has no editing of its own: it rides along as a second part of Kyushu's body. */
export const BODY_DEFS: Record<IslandId, BodyDef> = {
  honshu: makeDef("honshu", []), hokkaido: makeDef("hokkaido", []),
  kyushu: makeDef("kyushu", ["okinawa"]), shikoku: makeDef("shikoku", []),
};
export const ISLAND_LABEL: Record<IslandId, string> = { honshu: "本州", hokkaido: "北海道", kyushu: "九州", shikoku: "四国" };
export function realToLonLat(p: Vec): Vec { return [p[0] / JAPAN.proj.kmPerDegLon + JAPAN.proj.lon0, p[1] / JAPAN.proj.kmPerDegLat + JAPAN.proj.lat0]; }
export function lonLatToReal(lon: number, lat: number): Vec { return [(lon - JAPAN.proj.lon0) * JAPAN.proj.kmPerDegLon, (lat - JAPAN.proj.lat0) * JAPAN.proj.kmPerDegLat]; }
export { ISLAND_IDS };
