import type { Renderer } from "../render/renderer";
import type { Vec } from "../core/types";

/** Edit tools implement this; two-finger gestures always cancel an edit in progress and belong to the camera. */
export interface EditHandler {
  active(): boolean;                          // is an edit tool selected right now?
  begin(world: Vec, screen: Vec): boolean;    // false = nothing to grab, fall back to panning
  move(world: Vec, screen: Vec): void;
  end(): void;
  cancel(): void;
}
export function attachGestures(canvas: HTMLElement, r: Renderer, h: EditHandler) {
  const ptrs = new Map<number, Vec>(); let mode: "none" | "pan" | "edit" | "pinch" = "none";
  let pinch = { d: 0, mid: [0, 0] as Vec }; let last: Vec = [0, 0];
  const pos = (e: { clientX: number; clientY: number }): Vec => { const b = canvas.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; };
  const pinchState = () => { const [a, b] = [...ptrs.values()]; return { d: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] as Vec }; };
  canvas.addEventListener("pointerdown", (e) => {
    e.preventDefault(); canvas.setPointerCapture(e.pointerId);
    const p = pos(e); ptrs.set(e.pointerId, p);
    if (ptrs.size >= 2) { if (mode === "edit") h.cancel(); mode = "pinch"; pinch = pinchState(); return; }
    last = p;
    if (h.active() && h.begin(r.screenToWorld(p[0], p[1]), p)) mode = "edit"; else mode = "pan";
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!ptrs.has(e.pointerId)) return;
    e.preventDefault();
    const p = pos(e); ptrs.set(e.pointerId, p);
    if (mode === "pinch" && ptrs.size >= 2) {
      const n = pinchState(), before = r.screenToWorld(pinch.mid[0], pinch.mid[1]);
      r.setView({ zoom: r.view.zoom * (n.d / pinch.d) }, true);
      const { w, h: hh } = r.size, z = r.view.zoom; // keep the world point under the fingers fixed
      r.setView({ cx: before[0] - (n.mid[0] - w / 2) / z, cy: before[1] + (n.mid[1] - hh / 2) / z });
      pinch = n;
    } else if (mode === "edit") h.move(r.screenToWorld(p[0], p[1]), p);
    else if (mode === "pan") { r.setView({ cx: r.view.cx - (p[0] - last[0]) / r.view.zoom, cy: r.view.cy + (p[1] - last[1]) / r.view.zoom }); last = p; }
  });
  const up = (e: PointerEvent) => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.delete(e.pointerId);
    if (mode === "edit") { if (e.type === "pointercancel") h.cancel(); else h.end(); }
    if (ptrs.size === 0) mode = "none";
    else if (ptrs.size === 1) { mode = "pan"; last = [...ptrs.values()][0]; } // lifting one finger of a pinch never starts an edit
  };
  canvas.addEventListener("pointerup", up); canvas.addEventListener("pointercancel", up);
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault(); const p = pos(e), before = r.screenToWorld(p[0], p[1]);
    r.setView({ zoom: r.view.zoom * Math.exp(-e.deltaY * 0.0015) }, true);
    const { w, h: hh } = r.size, z = r.view.zoom;
    r.setView({ cx: before[0] - (p[0] - w / 2) / z, cy: before[1] + (p[1] - hh / 2) / z });
  }, { passive: false });
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
}
