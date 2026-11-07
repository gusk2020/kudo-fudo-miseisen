import { describe, expect, it } from "vitest";
import { KURIL_ISLANDS, KURIL_MEMBERSHIP, kurilPrefOf } from "../../src/sim/kuril1800";

describe("千島の所属(1800年版・固定)", () => {
  it("南部(歯舞・色丹・国後・択捉・得撫・新知・計吐夷・羅処和・松輪)は北海道、温禰古丹以北は樺太県", () => {
    for (const id of ["habomai", "shikotan", "kunashir", "iturup", "urup", "simushir", "ketoi", "rasshua", "matua"]) expect(KURIL_MEMBERSHIP[id], id).toBe("HK-NEM");
    for (const id of ["onekotan", "paramushir", "shumshu"]) expect(KURIL_MEMBERSHIP[id], id).toBe("KRF");
  });
  it("全島がどちらかに属し、結果は入力だけで決まる(年や網に依存せず、何度呼んでも同じ)", () => {
    for (const i of KURIL_ISLANDS) { expect(["HK-NEM", "KRF"]).toContain(KURIL_MEMBERSHIP[i.id]); expect(kurilPrefOf(i)).toBe(KURIL_MEMBERSHIP[i.id]); }
    expect(Object.isFrozen(KURIL_MEMBERSHIP)).toBe(true);
  });
  it("距離が同じ(1km以内)なら北海道", () => { expect(kurilPrefOf({ lat: 43.386, lon: 145.817 })).toBe("HK-NEM"); });
});
