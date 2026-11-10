import { describe, expect, it } from "vitest";
import { KURIL_ISLANDS, KURIL_MEMBERSHIP, kurilPrefOf } from "../../src/sim/kuril1800";

describe("千島の所属(1800年版・固定)", () => {
  it("Stage 38: 千島列島の全島(歯舞・色丹・国後・択捉から占守島まで)は根室県", () => {
    for (const i of KURIL_ISLANDS) expect(KURIL_MEMBERSHIP[i.id], i.id).toBe("HK-NEM");
    expect(KURIL_ISLANDS.length).toBe(12);
  });
  it("全島がどちらかに属し、結果は入力だけで決まる(年や網に依存せず、何度呼んでも同じ)", () => {
    for (const i of KURIL_ISLANDS) { expect(KURIL_MEMBERSHIP[i.id]).toBe("HK-NEM"); expect(kurilPrefOf(i)).toBe(KURIL_MEMBERSHIP[i.id]); }
    expect(Object.isFrozen(KURIL_MEMBERSHIP)).toBe(true);
  });
  it("距離が同じ(1km以内)なら北海道", () => { expect(kurilPrefOf({ lat: 43.386, lon: 145.817 })).toBe("HK-NEM"); });
  it("Stage 38: the world's data agrees -- every Kuril islet of the data is 根室県, and no cell of a Kuril island is 樺太県 (only 南樺太 is)", async () => {
    const { realWorld } = await import("./simhelp"), { lonLatToReal } = await import("../../src/core/data"), data = (await import("../../src/data/islets.json")).default as { islets: { group: string; pref: string; lon: number; lat: number; name: string }[] };
    const kuril = data.islets.filter((i) => /千島|北方四島|歯舞/.test(i.group)); expect(kuril.length).toBeGreaterThanOrEqual(15); for (const i of kuril) expect(i.pref, i.name).toBe("HK-NEM");
    const w = realWorld(true, true, 3).w; let seen = 0;
    for (const i of kuril) { const k = w.cellOf(lonLatToReal(i.lon, i.lat)); if (k < 0 || w.t.land[k] !== 1) continue; seen++; expect(w.prefOf(k), i.name).toBe("HK-NEM"); }
    expect(seen).toBeGreaterThan(8);
  });
});
