/** Stable geographic IDs and the coordinate API handed to later stages (roads, rail). */
import { realToWorld, worldParts, worldToReal } from "./body";
import { BODY_DEFS, JAPAN, lonLatToReal, realToLonLat } from "./data";
import { dist, pointInPolygon } from "./geom";
import type { TerrainResult } from "./terrain";
import type { IslandId, ProjectState, Vec } from "./types";
import { ISLAND_IDS } from "./types";

export const islandGeoId = (id: IslandId) => `isl.${id}`;
export const prefGeoId = (id: string) => `pref.${id}`;
export const cityGeoId = (id: string) => `city.${id}`;

export class GeoMap {
  constructor(readonly state: ProjectState, readonly terrain: TerrainResult | null) {}
  /** real longitude/latitude -> game-world km (y up). Uses the island whose real outline is nearest. */
  toWorld(lon: number, lat: number): { world: Vec; island: IslandId } {
    const real = lonLatToReal(lon, lat);
    let best: IslandId = "honshu", bd = Infinity;
    for (const id of ISLAND_IDS) {
      const o = BODY_DEFS[id].origin;
      for (const part of BODY_DEFS[id].parts) {
        const loc: Vec = [real[0] - o[0], real[1] - o[1]];
        if (pointInPolygon(loc, part)) return { world: realToWorld(id, this.state.bodies[id], real), island: id };
        for (const q of part) { const d = dist(q, loc); if (d < bd) { bd = d; best = id; } }
      }
    }
    return { world: realToWorld(best, this.state.bodies[best], real), island: best };
  }
  /** game-world km -> real lon/lat, via the island that contains the point (or the nearest one). */
  toGeo(world: Vec): { lon: number; lat: number; island: IslandId } {
    let best: IslandId = "honshu", bd = Infinity;
    for (const id of ISLAND_IDS) for (const part of worldParts(id, this.state.bodies[id])) {
      if (pointInPolygon(world, part)) { best = id; bd = -1; break; }
      for (const q of part) { const d = dist(q, world); if (d < bd) { bd = d; best = id; } }
      if (bd < 0) break;
    }
    const [lon, lat] = realToLonLat(worldToReal(best, this.state.bodies[best], world));
    return { lon, lat, island: best };
  }
  /** Stable id of the terrain grid cell containing a world point. */
  cellId(world: Vec): string | null {
    const g = this.terrain?.grid; if (!g) return null;
    const i = Math.floor((world[0] - g.x0) / g.cell), j = Math.floor((world[1] - g.y0) / g.cell);
    return i < 0 || j < 0 || i >= g.nx || j >= g.ny ? null : `cell.${g.cell}.${i}.${j}`;
  }
  idList() {
    return {
      islands: ISLAND_IDS.map(islandGeoId), prefectures: JAPAN.prefectures.map((p) => prefGeoId(p.id)),
      cities: (this.terrain?.cities ?? []).map((c) => cityGeoId(c.id)), rivers: (this.terrain?.rivers ?? []).map((r) => r.id),
      lakes: ["lake.biwa"], mountains: ["mtn.fuji", "range.sw", "range.ne"],
    };
  }
  /** Compact summary stored with a finalised map. */
  summary() {
    const t = this.terrain;
    return { geoIds: this.idList(), terrainHash: t?.hash ?? null, grid: t?.grid ?? null, stats: t?.stats ?? null, warnings: t?.warnings ?? [] };
  }
}
