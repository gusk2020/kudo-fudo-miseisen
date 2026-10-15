import { describe, expect, it } from "vitest";
import { CONTEXT, CONTEXT_WEIGHT, checkContext, contextLean } from "../../src/sim/policyContext";
import { POLICIES } from "../../src/sim/policy";

describe("policy context table (foundation, switched off)", () => {
  it("is structurally sound, keeps history and invention apart, and only names existing policies", () => {
    expect(checkContext()).toEqual([]);
    const ids = new Set(POLICIES.map((p) => p.id)); for (const c of CONTEXT) for (const id of Object.keys(c.lean)) expect(ids.has(id), `${c.id} -> ${id}`).toBe(true);
    expect(checkContext([{ id: "x", from: 2030, to: 2040, domain: "economy", label: "x", real: true, source: "s", lean: {} }]).length).toBeGreaterThan(0);
    expect(checkContext([{ id: "y", from: 1980, to: 1990, domain: "economy", label: "y", real: true, lean: {} }]).length).toBeGreaterThan(0);
  });
  it("has no effect while the weight is 0", () => { expect(CONTEXT_WEIGHT).toBe(0); for (const p of POLICIES) expect(contextLean(1975, p.domain, p.id)).toBe(0); });
});
