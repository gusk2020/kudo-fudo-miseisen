import { expect, it } from "vitest";
import { generateTerrain } from "../../src/core/terrain";
import { defaultState } from "../../src/core/state";
import { buildWorld, townsForSeats } from "../../src/sim/world";
import { NORTH_TOWNS } from "../../src/core/data";
import { loadDem } from "./helpers";
/** Stage 42 (Issue #88, north): the towns of 樺太 are a separate list, only in the towns a NEW game asks for (north flag); the default selection is unchanged, so older saves and pinned tests are untouched. */
it("Karafuto towns: on land, on the coast, in 樺太県; absent unless asked for", () => {
  const s = defaultState(); s.islands = true; const t = generateTerrain(s, loadDem());
  const plain = townsForSeats(t, ["JP-13", "JP-27"]), withNorth = townsForSeats(t, ["JP-13", "JP-27"], true);
  expect(plain.some((id) => id.startsWith("TN-")), "default selection has none").toBe(false);
  expect(withNorth.filter((id) => !id.startsWith("TN-")).join(), "the other towns are the same").toBe(plain.join());
  const got = withNorth.filter((id) => id.startsWith("TN-")); expect(got.length, "all five placed").toBe(NORTH_TOWNS.length);
  const w = buildWorld(t, s.seed, withNorth, 3);
  for (const id of got) { const c = w.cityById.get(id)!; expect(c, id).toBeTruthy(); expect(w.t.land[c.cell], id + " on land").toBe(1); expect(c.pref, id).toBe("KRF"); expect(c.coastal, id + " on the coast").toBe(true); }
  const w0 = buildWorld(t, s.seed, plain, 3); expect(w0.cities.some((c) => c.id.startsWith("TN-"))).toBe(false);
}, 600000);
