/**
 * Stage 14 (Issue #35): which cities get a circle on the map. Pure (no drawing), so a test can ask it. The metropolitan area (metro.ts) is a faint scale indicator on the bottom layer; THESE are the
 * circles of the cities themselves, drawn on top of the roads:
 *   always      the two seats of government (a gold ring), the cores of the ten biggest metropolises, and the towns of the seats' metropolises that are big enough to read (150,000 or more; 40,000 for the real provincial towns of Stage 16):
 *               the commuter belt round a capital is made of towns, not of one disc;
 *   then        the biggest cities by size (10 in the light view, 18 zoomed out, 36 zoomed in), and the clear movers (the four that gained most and the four that lost most on the nation).
 * Colour is the city's own growth against the nation over twenty years (green / red / grey); the radius grows with the square root of its people. No triangles.
 */
import { homeCity, subCity } from "../sim/ceremony";
import type { SimState } from "../sim/types";
import type { World } from "../sim/world";

/** Stage 16: a provincial town of a seat's metropolis gets its circle from this size (the commuter belt is made of small towns: 150,000 would hide all of them). */
export const SATELLITE_MIN = 40000;
export interface CityCircle { id: string; x: number; y: number; p: number; rel: number; seat: boolean }
export function pickCityCircles(sim: SimState, w: World, zoom: number, year: number | null, lite: boolean): CityCircle[] {
  const c12 = sim.city12; if (!c12) return [];
  const rows: { id: string; x: number; y: number; p: number; rel: number }[] = []; let s0 = 0, s1 = 0; const raw: { id: string; x: number; y: number; p1: number; p0: number }[] = [];
  for (const c of w.cities) {
    const h = c12[c.id]?.h; if (!h || h.length < 2) continue; let k = h.length - 1; if (year !== null) k = Math.max(1, Math.min(h.length - 1, Math.floor((year - sim.startYear) / 5)));
    const p1 = year === null ? sim.cities[c.id]?.pop ?? h[k] : h[k], p0 = h[Math.max(0, k - 4)]; raw.push({ id: c.id, x: c.pos[0], y: c.pos[1], p1, p0 }); s0 += p0; s1 += p1;
  }
  const nat = s0 > 0 ? s1 / s0 : 1; for (const r of raw) rows.push({ id: r.id, x: r.x, y: r.y, p: r.p1, rel: r.p0 > 0 ? r.p1 / r.p0 / nat : 1 });
  const byId = new Map(rows.map((r) => [r.id, r])), keep = new Set<(typeof rows)[0]>(), seat = new Set<string>();
  for (const c of [homeCity(w, sim.capital), subCity(w, sim.subCapital)]) if (c) { seat.add(c.id); const r = byId.get(c.id); if (r) keep.add(r); }
  const M = sim.metro;
  if (M && year === null) {
    const top = [...M.list].sort((a, b) => b.pop - a.pop);
    for (const m of top.slice(0, 10)) { const r = byId.get(m.core); if (r) keep.add(r); }
    for (const m of top) if (m.members.some((id) => seat.has(id))) for (const id of m.members) { const r = byId.get(id); if (r && r.p >= (w.cityById.get(id)?.kind === "town" ? SATELLITE_MIN : 150000)) keep.add(r); }
  }
  const bySize = [...rows].sort((p, q) => q.p - p.p); for (const r of bySize.slice(0, lite ? 10 : zoom < 0.5 ? 18 : 36)) keep.add(r);
  for (const r of [...rows].sort((p, q) => q.rel - p.rel).slice(0, 4)) if (r.rel > 1.1 && r.p > 5e4) keep.add(r);
  for (const r of [...rows].sort((p, q) => p.rel - q.rel).slice(0, 4)) if (r.rel < 0.9 && r.p > 5e4) keep.add(r);
  return [...keep].sort((p, q) => q.p - p.p).map((r) => ({ ...r, seat: seat.has(r.id) }));
}
