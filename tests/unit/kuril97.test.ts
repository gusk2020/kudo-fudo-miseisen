import { expect, it } from "vitest";
import { generateTerrain } from "../../src/core/terrain";
import { defaultState } from "../../src/core/state";
import { buildWorld, townsForSeats } from "../../src/sim/world";
import { NORTH_TOWNS } from "../../src/core/data";
import { loadDem } from "./helpers";
/** Follow-up to Issue #95: the Kuril islets (国後・択捉・色丹) ARE on the world grid (real outlines, 根室県); three towns stand on them, placed on the coast of their own islet, only for a new game that asks for the northern towns. */
it("Kuril towns: on their own islet's coast, in 根室県; absent unless asked; the terrain is untouched", () => {
  const s = defaultState(); s.islands = true; const t = generateTerrain(s, loadDem()), hash = t.hash;
  const plain = townsForSeats(t, ["JP-13", "JP-27"]), north = townsForSeats(t, ["JP-13", "JP-27"], true);
  const ids = NORTH_TOWNS.filter((c) => c.islet).map((c) => c.id); expect(ids.length).toBe(3);
  for (const id of ids) { expect(plain.includes(id), id + " not in the default selection").toBe(false); expect(north.includes(id), id + " asked for").toBe(true); }
  const w = buildWorld(t, s.seed, north, 3), islands = new Set<number>();
  for (const id of ids) { const c = w.cityById.get(id)!; expect(c, id + " placed").toBeTruthy(); expect(w.t.land[c.cell], id + " on land").toBe(1); expect(c.pref, id + " in 根室県").toBe("HK-NEM"); expect(c.coastal, id).toBe(true); expect(c.island, id + " not the Hokkaido main island").not.toBe(w.cityById.get("T-002") ? w.cityById.get("T-002")!.island : -1); islands.add(c.island); }
  expect(islands.size, "three different islands").toBe(3);
  const w0 = buildWorld(t, s.seed, plain, 3); for (const id of ids) expect(w0.cityById.get(id), id + " absent without the flag").toBeUndefined();
  expect(generateTerrain(s, loadDem()).hash, "terrain hash unchanged").toBe(hash);
  const w2 = buildWorld(t, s.seed, north, false); for (const id of ids) expect(w2.cityById.get(id), id + " not placed where the islets are not on the grid").toBeUndefined();
}, 600000);
