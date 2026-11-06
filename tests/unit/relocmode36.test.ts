import { describe, expect, it } from "vitest";
import { unattended } from "../../src/sim/event2200";
import { POLICY_MODE_LABEL } from "../../src/sim/policy";
import type { PolicyMode } from "../../src/sim/policy";

describe("遷都のみ手動モード", () => {
  const sim = (mode: PolicyMode) => ({ policy: { mode } }) as never;
  it("常に自動だけが遷都を通過させる。遷都のみ手動は遷都で時間が止まる(=無人ではない)", () => {
    expect(unattended(sim("auto"))).toBe(true); expect(unattended(sim("autoReloc"))).toBe(false); expect(unattended(sim("priority"))).toBe(false); expect(unattended(sim("idleAuto"))).toBe(false);
  });
  it("ボタンの表示名がある", () => { expect(POLICY_MODE_LABEL.autoReloc).toBe("遷都のみ手動"); });
});
