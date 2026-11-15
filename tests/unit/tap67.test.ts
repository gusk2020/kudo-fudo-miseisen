import { describe, expect, it } from "vitest";
import { attachGestures, TAP_MAX_MS, TAP_SLOP_PX, type EditHandler } from "../../src/ui/gestures";
import { cityCard } from "../../src/ui/cityCard";
import { stage3Sim } from "./simhelp";

/** Issue #67: a short, still, one-finger touch is a tap; everything else (a drag, a pinch, a long press, a touch an edit tool took) is not, and the old gestures are untouched. */
function rig(active = false, grab = false) {
  const L: Record<string, (e: any) => void> = {}, canvas = { addEventListener: (t: string, f: (e: any) => void) => (L[t] = f), getBoundingClientRect: () => ({ left: 0, top: 0 }), setPointerCapture: () => {} } as unknown as HTMLElement;
  const views: any[] = [], r = { view: { zoom: 1, cx: 0, cy: 0 }, size: { w: 400, h: 800 }, screenToWorld: (x: number, y: number) => [x, -y], setView: (v: any) => views.push(v) } as any, taps: number[][] = [];
  const h: EditHandler = { active: () => active, begin: () => grab, move() {}, end() {}, cancel() {}, tap: (_w, s) => taps.push(s) };
  attachGestures(canvas, r, h); const ev = (type: string, id: number, x: number, y: number, t: number) => L[type]({ pointerId: id, clientX: x, clientY: y, timeStamp: t, type, preventDefault() {} });
  return { ev, taps, views };
}
describe("Issue #67: tap detection", () => {
  it("a short still touch taps once, at where it began", () => { const g = rig(); g.ev("pointerdown", 1, 100, 200, 0); g.ev("pointerup", 1, 101, 201, 120); expect(g.taps).toEqual([[100, 200]]); });
  it("a touch that moves more than the slop, or lasts too long, is not a tap (and the drag still pans)", () => {
    const g = rig(); g.ev("pointerdown", 1, 100, 200, 0); g.ev("pointermove", 1, 100 + TAP_SLOP_PX + 2, 200, 50); g.ev("pointerup", 1, 120, 200, 100); expect(g.taps).toEqual([]); expect(g.views.length).toBeGreaterThan(0);
    const s = rig(); s.ev("pointerdown", 1, 5, 5, 0); s.ev("pointerup", 1, 5, 5, TAP_MAX_MS + 50); expect(s.taps).toEqual([]);
    const j = rig(); j.ev("pointerdown", 1, 100, 200, 0); j.ev("pointermove", 1, 103, 203, 40); j.ev("pointerup", 1, 103, 203, 80); expect(j.taps.length, "jitter inside the slop is still a tap").toBe(1);
  });
  it("two fingers (a pinch) never tap, even if one stays still; a cancelled touch never taps", () => {
    const g = rig(); g.ev("pointerdown", 1, 100, 200, 0); g.ev("pointerdown", 2, 200, 200, 10); g.ev("pointerup", 2, 200, 200, 60); g.ev("pointerup", 1, 100, 200, 90); expect(g.taps).toEqual([]);
    const c = rig(); c.ev("pointerdown", 1, 10, 10, 0); c.ev("pointercancel", 1, 10, 10, 30); expect(c.taps).toEqual([]);
  });
  it("a touch an edit tool took is not a tap; an active tool that grabbed nothing leaves the touch as a pan, which taps (the app then ignores it while editing)", () => {
    const e = rig(true, true); e.ev("pointerdown", 1, 50, 50, 0); e.ev("pointerup", 1, 50, 50, 50); expect(e.taps).toEqual([]);
    const n = rig(true, false); n.ev("pointerdown", 1, 50, 50, 0); n.ev("pointerup", 1, 50, 50, 50); expect(n.taps.length).toBe(1);
  });
});
describe("Issue #67: the card a tap opens", () => {
  const { sim, w } = stage3Sim("heisei", 7, true, 0, 2, true, undefined, undefined, { start1800: true } as never);
  it("names the city, its prefecture, its people and the kinds of transport that reach it; a promoted city also says where it came from; an unknown id gives nothing", () => {
    const tokyo = w.cities.find((c) => c.name === "東京")!, k = cityCard(sim, w, tokyo.id, 1.2)!; expect(k.title).toContain("東京"); expect(k.lines.some((l) => l.startsWith("所属: "))).toBe(true); expect(k.lines.some((l) => /^人口: 約/.test(l))).toBe(true); expect(k.lines.find((l) => l.startsWith("20年"))).toContain("増えている"); expect(k.lines.some((l) => l.startsWith("交通: "))).toBe(true); expect(k.lines.some((l) => l.startsWith("成り立ち"))).toBe(false);
    const other = w.cities.find((c) => c.id !== tokyo.id && c.kind !== "capital")!; sim.oldCities40 = [{ id: other.id, code: "99999", name: other.name, pref: other.pref ?? "JP-13", cell: other.cell, year: 1950, pop0: 60000 }]; expect(cityCard(sim, w, other.id, null)!.lines.some((l) => l.includes("1950年に都市へ昇格"))).toBe(true); delete sim.oldCities40;
    expect(cityCard(sim, w, "nope", null)).toBeNull();
  });
});
