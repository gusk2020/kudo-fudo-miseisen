import { describe, expect, it } from "vitest";
import { EARLY_GAP_KM, EARLY_OFFSHORE_KM, earlyLinkBlock, offshoreKm, shorePairs } from "../../src/sim/islandlink37";
import { realWorld } from "./simhelp";

/** Issue #88: in 1900-1999 the far island groups are not chained by long fixed links; from 2000 the ordinary rules decide. No place is named in the rule: the test names places only to check the outcome. */
describe("Issue #88: remote islands before 2000", () => {
  it("mainlands are at 0 km; Okinawa's and Ogasawara's land masses are far offshore, a near-shore island (淡路) is not", () => {
    const { w } = realWorld(true, true, 3), off = offshoreKm(w), massOf = (name: string) => w.lm[w.cities.find((c) => c.name === name)!.cell];
    for (const n of ["東京", "札幌市", "福岡市", "高松市"]) expect(off[massOf(n)], n).toBe(0);
    expect(off[massOf("那覇市")]).toBeGreaterThan(300); expect(off[massOf("洲本市")], "淡路島").toBeLessThan(EARLY_OFFSHORE_KM);
    const far = [...off].filter((d, m) => m > 0 && Number.isFinite(d) && d > 600).length; console.log(`I88 land masses: ${w.lmCount}, more than 600 km offshore: ${far}`); expect(far).toBeGreaterThan(0);
  }, 600000);
  it("a pair is blocked before 2000 when its gap is long or either shore is far offshore, and never from 2000", async () => {
    const { w } = realWorld(true, true, 3), off = offshoreKm(w), prs = shorePairs(w); expect(prs.length).toBeGreaterThan(10);
    let longNear = 0, shortFar = 0, shortNear = 0;
    for (const pr of prs) {
      const remote = Math.max(off[pr.a], off[pr.b]) > EARLY_OFFSHORE_KM, long = pr.gap > EARLY_GAP_KM, b = earlyLinkBlock(w, pr, 1960);
      expect(earlyLinkBlock(w, pr, 2000)).toBeNull(); expect(earlyLinkBlock(w, pr, 1999)).toBe(b);
      if (long) { expect(b).toBe("early-long"); if (!remote) longNear++; } else if (remote) { expect(b).toBe("early-remote"); shortFar++; } else { expect(b).toBeNull(); shortNear++; }
    }
    if (process.env.KFM_OUT) (await import("node:fs")).writeFileSync(process.env.KFM_OUT, JSON.stringify({ pairs: prs.length, allowed: shortNear, long: prs.filter((p) => p.gap > EARLY_GAP_KM).length, longNear, shortFar, gaps: prs.map((p) => Math.round(p.gap)).sort((a, b) => a - b) }));
    console.log(`I88 shore pairs ${prs.length}: allowed in the 1900s ${shortNear}; blocked long ${prs.filter((p) => p.gap > EARLY_GAP_KM).length} (of them near the mainland ${longNear}); blocked short-but-remote ${shortFar}`);
    expect(shortNear, "near-shore short links are still possible in the 1900s").toBeGreaterThan(0); expect(shortFar, "short hops between far islands exist and are held back").toBeGreaterThan(0);
  }, 600000);
});
