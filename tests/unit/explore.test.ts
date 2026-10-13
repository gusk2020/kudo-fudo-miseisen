import { test } from "vitest";
import { defaultState } from "../../src/core/state";
import { validate, derive } from "../../src/core/validate";
import { generateTerrain } from "../../src/core/terrain";
import { loadDem } from "./helpers";
import { tOf } from "../../src/core/constraints";
import { centroid } from "../../src/core/geom";
test("explore", () => {
  const s = defaultState();
  const d = derive(s);
  process.stderr.write("\n"+JSON.stringify(["t hok", tOf(d.frame, centroid(d.parts.hokkaido[0])), "t kyu", tOf(d.frame, centroid(d.parts.kyushu[0])), "dir", d.frame.dir]));
  process.stderr.write("\n"+JSON.stringify([validate(s).map((i) => i.code + ":" + i.severity)]));
  const t0 = Date.now();
  const r = generateTerrain(s, loadDem());
  process.stderr.write("\n"+JSON.stringify([Date.now() - t0, "ms", r.stats, r.warnings, r.hash, r.rivers.slice(0, 3).map((x) => [x.id, x.lengthKm])]));
}, 60000);
