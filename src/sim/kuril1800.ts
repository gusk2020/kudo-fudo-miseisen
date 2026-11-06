/**
 * Stage 36 / M1: which prefecture each Kuril island belongs to in the 1800 start (北海道 or 樺太県).
 * Decided ONCE, from fixed coordinates and a fixed rule, and frozen for the whole game: nothing here reads the year, the roads or any simulation state, so membership can never change as the network grows.
 * Rule: each island goes to the nearer of two fixed harbour anchors by great-circle distance -- 根室(納沙布岬) for 北海道 and 大泊(コルサコフ) for 樺太県, the two ports the chain was reached from
 * (the sea routes of the time ran from them). A distance tie (within 1 km) goes to 北海道. The coordinates are approximate public geographic positions (a gameplay assumption, not a survey).
 * Fictional alternate history: not a claim about who governed these islands.
 */
export type KurilPref = "HK-NEM" | "KRF";   // (根室県 = the Hokkaido prefecture whose coast the chain is reached from; 樺太県)
export interface KurilIsland { id: string; name: string; lat: number; lon: number }
export const KURIL_ANCHORS = { "HK-NEM": { name: "根室(納沙布岬)", lat: 43.386, lon: 145.817 }, KRF: { name: "大泊(コルサコフ)", lat: 46.633, lon: 142.75 } } as const;
/** From the south (Habomai) to the north (Shumshu): the chain this world includes ("占守島まで"). */
export const KURIL_ISLANDS: readonly KurilIsland[] = [
  { id: "habomai", name: "歯舞群島", lat: 43.45, lon: 146.2 }, { id: "shikotan", name: "色丹島", lat: 43.8, lon: 146.75 }, { id: "kunashir", name: "国後島", lat: 44.1, lon: 146.1 },
  { id: "iturup", name: "択捉島", lat: 45.0, lon: 147.9 }, { id: "urup", name: "得撫島", lat: 45.9, lon: 150.0 }, { id: "simushir", name: "新知島", lat: 46.9, lon: 152.0 },
  { id: "ketoi", name: "計吐夷島", lat: 47.3, lon: 152.5 }, { id: "rasshua", name: "羅処和島", lat: 47.77, lon: 153.02 }, { id: "matua", name: "松輪島", lat: 48.1, lon: 153.2 },
  { id: "onekotan", name: "温禰古丹島", lat: 49.4, lon: 154.7 }, { id: "paramushir", name: "幌筵島", lat: 50.3, lon: 155.8 }, { id: "shumshu", name: "占守島", lat: 50.75, lon: 156.3 },
];
export const kmBetween = (a: { lat: number; lon: number }, b: { lat: number; lon: number }): number => {
  const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r, h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
};
export function kurilPrefOf(i: { lat: number; lon: number }): KurilPref {
  const h = kmBetween(i, KURIL_ANCHORS["HK-NEM"]), k = kmBetween(i, KURIL_ANCHORS.KRF); return k < h - 1 ? "KRF" : "HK-NEM";
}
export const KURIL_MEMBERSHIP: Readonly<Record<string, KurilPref>> = Object.freeze(Object.fromEntries(KURIL_ISLANDS.map((i) => [i.id, kurilPrefOf(i)])));
