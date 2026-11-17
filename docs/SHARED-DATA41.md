# Cross-game data: what can be shared between 酷道 / world-viewer (Antikitera) / Vind Ving — design and a first sample

Status: **design + minimal working sample in this repository only.** No other repository was changed. No shared engine. Sea-level change in 酷道 stays on hold (Issue #78); nothing here implements it.
`gusk2020/world-viewer` was read from a local checkout (its CLAUDE.md and `worlds/*/config.json`). **`gusk2020/bird-flight-simulator` (Vind Ving) was NOT read** (it is not attached to this session) — everything about it below is an assumption to verify.

## 1. What each side has today (facts)
| | 酷道・腐道・未成線 | world-viewer |
|---|---|---|
| frame | local equirectangular **km**, x east / y north from lon0 137°, lat0 37° (`JAPAN.proj`: 90.0598 km/°lon, 110.57 km/°lat); 5 km grid (344 × 586 cells with the islands) | whole globe, equirectangular lon/lat raster on a cube-sphere of radius 1 |
| height | `terrain.elev` Float32 metres per cell; land edited by the game's terrain rules; sea cells hold a negative depth (used for shading) | GEBCO_2026 metres, PNG `metres = R*256 + G − 12000` (`rg16-metres`), levels 512×256 … 4096×2048 |
| source | GEBCO_2026 **taken through world-viewer's 4096×2048 level** (docs/DATA.md) + Natural Earth | GEBCO_2026 (CEDA), built by GitHub Actions |
| sea level | fixed at 0 m | slider −6000 … +200 m; sea is a separate sphere scaled by the same exaggeration, so "which coast floods" is exact |
| time | month-by-month simulation, per-year state | none (static body + climate colouring) |
So the two already share the **same datum (GEBCO 0 m) and the same source raster**; only the frame differs (local km vs lon/lat).

## 2. Reusing world-viewer's seabed and sea-level work in 酷道 (how, not done)
- **Seabed transport (tunnels/bridges):** 酷道's 5 km sea cells already carry depths. For strait links the useful quantity is the depth profile along a crossing; at 5 km it is coarse. world-viewer's 4096×2048 level is ~10 km per pixel at the equator (~8 km at Japan's latitude) — *not finer* than 酷道's grid, so nothing is gained by importing it again. A finer source would be a new GEBCO cut for Japan (15″ ≈ 0.4 km) made by the same Actions pipeline (`build-terrain.yml`, `-r average`, `rg16-metres`): reuse the **pipeline and encoding**, not the existing files.
- **Sea-level change (on hold):** world-viewer's rule transfers directly: submerged ⇔ `elev < seaLevel`, with the land/sea line recomputed per cell. In 酷道 that touches land masks, ports, ferries and the terrain hash (the save-safety check), so it must be a versioned world flag like `isl36`. Colour of drained seabed: world-viewer's lesson — paint by depth, never blend toward the photo.
- **Rendering:** world-viewer's cube-sphere/three.js code is for a globe; 酷道 is a flat Pixi map. Nothing to share there.

## 3. The exchange format: `kfm.region.v1` (implemented: `src/sim/export41.ts`)
One JSON per region and year — small enough for a phone to fetch and parse at once. Fields:
- `format`, `source {game, year, seed, note}`, `licence[]` (GEBCO attribution, Natural Earth public domain, 国土数値情報).
- `frame {kind:"equirect-local-km", lon0, lat0, kmPerDegLon, kmPerDegLat, heightDatum}` → `lon = lon0 + x/kmPerDegLon`, `lat = lat0 + y/kmPerDegLat`. Units: km horizontally, **metres** vertically, 0 = present sea level. No vertical exaggeration is baked in (a consumer applies its own, as world-viewer does).
- `grid {x0, y0, cellKm, nx, ny, elevM, land}`: row 0 = south; `elevM` little-endian Int16 base64; `land` Uint8 base64 (0 sea / 1 land / 2 lake). Terrain edits made in the game are already in `elevM`.
- `places[] {id, name, kind, x, y, pop}` (population of that year), `lines[] {id, mode, kind, state, facility?, pts[x0,y0,x1,y1…]}` (roads and railways as drawn, incl. closed/lost/building so a flyer can see ruins).
- Reader: `readRegion(json)` validates and decodes and gives `lonLat(x,y)` / `heightAt(x,y)`; it is ~15 lines with no dependency and is meant to be copied into a consumer.
**Sample:** `docs/data/region-sample-kanto-1900.json` — 200 km square round Tokyo, year 1900 of an 1800-start game (seed 7), 41×41 cells, 75 KB. Test `tests/unit/export41.test.ts` (round trip, lon/lat of Tokyo, heights equal to the game's, sea depths present, bad files refused).

## 4. Reading it elsewhere (verified only as far as stated)
- **world-viewer:** verified *on paper against its code conventions only*: its mesh takes `radiusAt(lng, lat)` and its height sampler bilinear-samples an equirect raster. A region can be drawn by (a) converting `places`/`lines` to lon/lat with `lonLat` and lifting them like the graticule does (terrain-following lines already exist there), or (b) overriding heights inside the region's lon/lat box. (a) needs no terrain change and is the natural first experiment. Not run.
- **Vind Ving:** assumption — a flight game needs a height field in metres and landmarks in a local metric frame; `kfm.region.v1` is already that (multiply km by 1000). The 5 km cell is too coarse to fly close to: a consumer should interpolate (bilinear) and may add its own detail noise; real fine relief needs the finer GEBCO cut of §2. Not verified against the repository.
- **Performance on a phone:** 75 KB JSON for 200 km²; a 1000 km strip is ~1 MB with lines dominating — split by region or drop `lost`/`closed` lines if needed. Int16 base64 costs 2.7 bytes per cell.

## 5. Open questions for the owner (no action taken)
1. May a later session read `bird-flight-simulator` and add a reader there? (needs the repo attached and an explicit OK; none of that was done.)
2. Should regions be exported from the game's save menu (a button), or stay a developer tool? Today it is a function + test only; **nothing in the game's UI exposes it**.
3. Licence line to show in consumers: GEBCO requires attribution ("GEBCO Compilation Group (2026) GEBCO 2026 Grid"); confirm wording before any public build of another game uses the sample.

## 6. Vind Ving read (2026-11-18, read-only; nothing in either other repository was changed)
`gusk2020/bird-flight-simulator` @ c29213a (public; a shallow clone made outside this repo) was read for its data conventions only.
- **Frame and units**: a local metric world, x/z in metres, y up; flight physics (`src/flight.ts`) asks the world for `heightAt(x, z)` and a list of box `colliders`. `kfm.region.v1` is already metres-compatible (km × 1000, `elevM` as height) — the §4 assumption holds for the *frame*.
- **Where the gap is**: the world is not a height field but a **generated town** — `generateLayout(seed)` (`src/layout.ts`) returns a `Layout` of 56 m-pitch lots and 10 m roads (`PITCH`, `ROAD`, `LOT`), `houses`, `apts`, `trees`, `poles`, `wires`, `lows` (benches, walls), `lots` with a use (town/park/vacant/paddy), `groundAt`, and a `heightAt` that is flat (`LOT_TOP`). Landing, perching and the town life all hang off those lists. So handing it a raw 5 km height grid would give a flyer terrain to fly over but nothing to land on or perch on.
- **A realistic bridge (not built)**: an adapter `regionToLayout(region, seed)` in Vind Ving (not here) that keeps `generateLayout`'s output shape but takes (a) `heightAt` from `grid.elevM` (bilinear, as §4), (b) the town's density and lot uses from `places[].pop` and `lines[]` (roads → its road grid orientation and spacing; rail → pole lines), (c) paddy/park lots from land cover where the game has it. Population × 1000-year runs make the same region look different per year, which is the point of sharing it. The 5 km cell is far coarser than its 56 m lots, so the height must be interpolated and given detail noise — the heights are a *regional* trend, not a street profile.
- **What stays on each side**: this game exports (already: `kfm.region.v1` sample, test `export41.test.ts`); Vind Ving would own the reader + adapter + its tests. Licence line (GEBCO attribution) must travel with the file (`licence[]` already does).
- **Not done, needs the owner**: adding a reader/adapter to Vind Ving means a pull request in that repository (it asks for Draft PRs and owner approval before merging). None was opened. Open question 1 above is therefore only half answered: *reading* was done; *changing* it was not and will not be without an explicit OK.
