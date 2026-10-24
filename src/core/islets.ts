/** Stage 20: the small islands the 5 km terrain grid cannot hold (and the far ones it does not reach): Izu, Ogasawara, Daito, Osumi, Tokara, Amami, Miyako, Yaeyama, Senkaku, Takeshima, the Northern Territories, the Sea of Japan and Seto islands.
 *  Approximate figures (centre, area, highest point, length/width/bearing), not outlines. The game draws each as an ellipse of that size; which prefecture it belongs to is the game's own provisional assignment. */
import raw from "../data/islets.json";
import { lonLatToReal } from "./data";
import type { Vec } from "./types";

export interface Islet { id: string; name: string; group: string; pref: string; lon: number; lat: number; area: number; elev: number; len: number; wid: number; bear: number; claim?: string; /** Stage 22: residents, approximate (0 = nobody the game counts) */ pop?: number; /** Stage 22: outline [lon, lat][] from 地球地図日本 (absent = only the size figures) */ shape?: [number, number][]; /** Stage 22: the outline's centre */ c?: [number, number]; shapeAreaKm2?: number; shapeNote?: string }
export const ISLETS: Islet[] = (raw as { islets: Islet[] }).islets;
export const ISLETS_NOTE: string = (raw as { note: string }).note;
export const isletPos = (s: Islet): Vec => lonLatToReal(s.lon, s.lat);
/** Stage 22: where the island really is (its outline's centre; the older figures otherwise) */
export const isletPos2 = (s: Islet): Vec => (s.c ? lonLatToReal(s.c[0], s.c[1]) : isletPos(s));
/** The islands of the Stage 20 data (a Stage 20 world is built from exactly these, with their ellipses); the later ones come with Stage 22 */
export const STAGE20_ISLETS = ISLETS.filter((s) => +s.id.slice(3) <= 103);
/** True when the real-world control of the island is disputed (the data carries a plain statement of it). */
export const isDisputed = (s: Islet) => !!s.claim && s.claim.includes("争い");
