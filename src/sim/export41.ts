/**
 * Cross-game exchange (design: docs/SHARED-DATA41.md): a REGION of this game's world as one small, self-describing JSON -- ground, places, roads and railways as they stand in one year -- for another program (a flight game, a globe viewer) to read without
 * knowing anything about this game. Format `kfm.region.v1`. Pure: reads the game, changes nothing; `readRegion` is the reference reader (validates and decodes), used by the test and meant to be copied by a consumer.
 *   frame   local equirectangular km: x east, y north, from (lon0, lat0); lon = lon0 + x / kmPerDegLon, lat = lat0 + y / kmPerDegLat. Heights are metres above THIS game's present sea level (0 = shore; sea cells carry a negative depth).
 *   grid    row 0 is the SOUTH row; cell centres at x0 + (i + 0.5) * cellKm. elevM = little-endian Int16 (base64), land = Uint8 (0 sea, 1 land, 2 lake).
 *   places  cities and towns with their population in `year`.   lines  roads and railways as polylines (km), with what they are and their state.
 */
import { JAPAN } from "../core/data";
import type { Vec } from "../core/types";
import { edgeShape } from "./network";
import { modeOf, type SimState } from "./types";
import type { World } from "./world";

export const REGION_FORMAT = "kfm.region.v1";
export interface RegionPlace { id: string; name: string; kind: string; x: number; y: number; pop: number }
export interface RegionLine { id: string; mode: "road" | "rail"; kind: "road" | "hwy" | "rail" | "hsr" | "maglev"; state: "open" | "dormant" | "closed" | "lost" | "building"; facility?: "bridge" | "tunnel" | "ferry"; pts: number[] }
export interface RegionFile {
  format: typeof REGION_FORMAT; source: { game: string; year: number; seed: number; note: string }; licence: string[];
  frame: { kind: "equirect-local-km"; lon0: number; lat0: number; kmPerDegLon: number; kmPerDegLat: number; heightDatum: string };
  bbox: { x0: number; y0: number; x1: number; y1: number };
  grid: { x0: number; y0: number; cellKm: number; nx: number; ny: number; elevM: string; land: string };
  places: RegionPlace[]; lines: RegionLine[];
}
const b64 = (u: Uint8Array) => { let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s: string) => { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
const r2 = (v: number) => Math.round(v * 100) / 100;
/** `bbox` in this game's world km (x0 < x1, y0 < y1); it is widened to whole cells. */
export function exportRegion(sim: SimState, w: World, bbox: { x0: number; y0: number; x1: number; y1: number }, year: number): RegionFile {
  const g = w.t.grid, i0 = Math.max(0, Math.floor((bbox.x0 - g.x0) / g.cell)), i1 = Math.min(g.nx, Math.ceil((bbox.x1 - g.x0) / g.cell)), j0 = Math.max(0, Math.floor((bbox.y0 - g.y0) / g.cell)), j1 = Math.min(g.ny, Math.ceil((bbox.y1 - g.y0) / g.cell)), nx = Math.max(0, i1 - i0), ny = Math.max(0, j1 - j0);
  const elev = new Uint8Array(nx * ny * 2), dv = new DataView(elev.buffer), land = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const k = (j + j0) * g.nx + (i + i0), o = j * nx + i; dv.setInt16(o * 2, Math.max(-32768, Math.min(32767, Math.round(w.t.elev[k]))), true); land[o] = w.t.land[k]; }
  const X0 = g.x0 + i0 * g.cell, Y0 = g.y0 + j0 * g.cell, X1 = X0 + nx * g.cell, Y1 = Y0 + ny * g.cell, inside = (p: Vec) => p[0] >= X0 && p[0] <= X1 && p[1] >= Y0 && p[1] <= Y1;
  const places: RegionPlace[] = []; for (const c of w.cities) { const st = sim.cities[c.id]; if (!st || !inside(c.pos)) continue; places.push({ id: c.id, name: c.name, kind: c.kind ?? "city", x: r2(c.pos[0]), y: r2(c.pos[1]), pop: Math.round(st.pop) }); }
  const lines: RegionLine[] = [];
  for (const e of Object.values(sim.edges)) {
    const pts = edgeShape(w, sim, e); if (!pts.some(inside)) continue; const rail = modeOf(e) === "rail";
    lines.push({ id: e.id, mode: rail ? "rail" : "road", kind: rail ? (e.maglev ? "maglev" : e.standard === "highgrade" ? "hsr" : "rail") : e.standard === "highgrade" ? "hwy" : "road", state: e.built < 1 ? "building" : e.state, ...(e.facility ? { facility: e.facility as "bridge" | "tunnel" | "ferry" } : {}), pts: pts.flatMap((p) => [r2(p[0]), r2(p[1])]) });
  }
  return { format: REGION_FORMAT, source: { game: "kudo-fudo-miseisen", year, seed: sim.seed, note: "A fictional history played on real terrain: the places and lines are this game's, not the real ones of that year." },
    licence: ["Terrain: GEBCO Compilation Group (GEBCO_2026 Grid), resampled to this game's 5 km grid and edited by its terrain rules", "Outlines, prefectures, cities: Natural Earth (public domain)", "Town names: 国土数値情報 N03 (see docs/DATA.md)"],
    frame: { kind: "equirect-local-km", lon0: JAPAN.proj.lon0, lat0: JAPAN.proj.lat0, kmPerDegLon: JAPAN.proj.kmPerDegLon, kmPerDegLat: JAPAN.proj.kmPerDegLat, heightDatum: "metres above the game's present sea level (GEBCO 0 m)" },
    bbox: { x0: X0, y0: Y0, x1: X1, y1: Y1 }, grid: { x0: X0, y0: Y0, cellKm: g.cell, nx, ny, elevM: b64(elev), land: b64(land) }, places, lines };
}
export interface RegionDecoded { file: RegionFile; elevM: Int16Array; land: Uint8Array; lonLat(x: number, y: number): [number, number]; heightAt(x: number, y: number): number }
/** The reference reader: checks the format and the sizes, decodes the grid, and gives lon/lat and height lookups. Throws a plain Error with the reason on anything wrong. */
export function readRegion(raw: unknown): RegionDecoded {
  const f = raw as RegionFile; if (!f || f.format !== REGION_FORMAT) throw new Error("not a kfm.region.v1 file");
  const g = f.grid; if (!g || !(g.nx > 0) || !(g.ny > 0) || !(g.cellKm > 0)) throw new Error("bad grid");
  const eb = unb64(g.elevM), land = unb64(g.land); if (eb.length !== g.nx * g.ny * 2 || land.length !== g.nx * g.ny) throw new Error("grid size does not match nx * ny");
  const dv = new DataView(eb.buffer), elevM = new Int16Array(g.nx * g.ny); for (let i = 0; i < elevM.length; i++) elevM[i] = dv.getInt16(i * 2, true);
  if (f.frame?.kind !== "equirect-local-km") throw new Error("unknown frame");
  for (const l of f.lines ?? []) if (!Array.isArray(l.pts) || l.pts.length < 4 || l.pts.length % 2) throw new Error(`bad line ${l.id}`);
  return { file: f, elevM, land, lonLat: (x, y) => [f.frame.lon0 + x / f.frame.kmPerDegLon, f.frame.lat0 + y / f.frame.kmPerDegLat],
    heightAt: (x, y) => { const i = Math.floor((x - g.x0) / g.cellKm), j = Math.floor((y - g.y0) / g.cellKm); return i < 0 || j < 0 || i >= g.nx || j >= g.ny ? NaN : elevM[j * g.nx + i]; } };
}
