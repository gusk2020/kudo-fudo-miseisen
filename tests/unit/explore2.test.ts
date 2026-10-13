import { test } from "vitest";
import { BODY_DEFS } from "../../src/core/data";
import { segCross } from "../../src/core/geom";
test("x", () => {
  const p = BODY_DEFS.honshu.parts[0], n = p.length; const hits: any[] = [];
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) { if (i === 0 && j === n - 1) continue; if (segCross(p[i], p[(i + 1) % n], p[j], p[(j + 1) % n])) hits.push([i, j, p[i], p[j]]); }
  process.stderr.write("\n"+JSON.stringify([n, hits.slice(0, 5)]));
});
