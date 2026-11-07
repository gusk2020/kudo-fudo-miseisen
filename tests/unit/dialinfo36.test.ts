import { describe, expect, it } from "vitest";
import { DIAL_INFO, DIAL_KEYS, DIAL_LABEL, DIAL_RANGE } from "../../src/sim/eras";
describe("Stage 36: every policy dial is described", () => {
  it("name, range, target, effect and explanation exist for every dial, and nothing extra", () => {
    expect(Object.keys(DIAL_INFO).sort()).toEqual([...DIAL_KEYS].sort());
    for (const k of DIAL_KEYS) { expect(DIAL_LABEL[k]).toBeTruthy(); expect(DIAL_RANGE[k][0]).toBeLessThan(DIAL_RANGE[k][1]); for (const f of ["target", "effect", "explain"] as const) expect(DIAL_INFO[k][f].length).toBeGreaterThanOrEqual(2); }
  });
});
