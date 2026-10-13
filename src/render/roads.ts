/** Dynamic road layer: redrawn on its own (time ticks, zoom end) without touching the terrain layers. */
import { Container, Graphics, Text } from "pixi.js";
import { edgeShape } from "../sim/network";
import { GRADE_SHORT, type Grade, type SimState } from "../sim/types";
import { routeLabel } from "../sim/engine";
import type { World } from "../sim/world";
import type { Vec } from "../core/types";

export interface CerOverlay { pts: Vec[]; path?: Vec[]; ok: boolean }
export interface RoadArgs { sim: SimState | null; w: World | null; layers: { roads: boolean; plans: boolean; signs: boolean }; cer: CerOverlay[]; pin: Vec | null }
const GRADE_RANK: Record<Grade, number> = { national: 3, fu: 2, ken: 1 };
const qColour = (q: number) => (q >= 60 ? 0xffe14a : q >= 30 ? 0xff9a3c : 0xe8483c);
function dashed(g: Graphics, pts: Vec[], dash: number, gap: number) {
  let draw = true, left = dash;
  for (let i = 0; i + 1 < pts.length; i++) {
    let [x, y] = pts[i]; const [bx, by] = pts[i + 1]; let seg = Math.hypot(bx - x, by - y); const ux = (bx - x) / (seg || 1), uy = (by - y) / (seg || 1);
    while (seg > 1e-6) { const step = Math.min(left, seg); if (draw) { g.moveTo(x, -y); g.lineTo(x + ux * step, -(y + uy * step)); } x += ux * step; y += uy * step; seg -= step; left -= step; if (left <= 1e-9) { draw = !draw; left = draw ? dash : gap; } }
  }
}
export class RoadLayer {
  container = new Container(); private last: RoadArgs | null = null; private sig = "";
  /** Cheap change detector so a monthly tick that changed nothing visible costs nothing. */
  static signature(a: RoadArgs, zoom: number): string {
    let h = 0; const s = a.sim;
    if (s) { for (const e of Object.values(s.edges)) h = (h * 31 + (e.open ? 1 : 0) + (e.lost ? 2 : 0) + Math.floor(e.built * 10) * 4 + Math.floor(e.quality / 15) * 64 + e.cells.length) >>> 0; for (const r of Object.values(s.routes)) h = (h * 31 + r.number + (r.active ? 1 : 0) + r.edges.length * 7 + (r.grade === "national" ? 3 : r.grade === "fu" ? 5 : 11)) >>> 0; for (const p of Object.values(s.projects)) h = (h * 31 + p.status.length + p.edgeIds.length) >>> 0; }
    return `${h}|${Object.keys(s?.edges ?? {}).length}|${a.layers.roads}${a.layers.plans}${a.layers.signs}|${Math.round(zoom * 20)}|${a.cer.map((c) => c.pts.length + (c.path?.length ?? 0) + (c.ok ? "y" : "n")).join(",")}|${a.pin ? a.pin.join(",") : ""}`;
  }
  set(a: RoadArgs, zoom: number) { this.last = a; const sg = RoadLayer.signature(a, zoom); if (sg === this.sig) return false; this.sig = sg; this.draw(a, zoom); return true; }
  redraw(zoom: number) { if (this.last) { this.sig = ""; this.set(this.last, zoom); } }
  private draw(a: RoadArgs, zoom: number) {
    this.container.removeChildren().forEach((c) => c.destroy({ children: true }));
    const px = (n: number) => n / zoom, { sim, w } = a;
    if (sim && w) {
      const best = new Map<string, Grade>(), routeOf = new Map<string, typeof sim.routes[string][]>();
      for (const r of Object.values(sim.routes)) if (r.active) for (const x of r.edges) { const b = best.get(x.edgeId); if (!b || GRADE_RANK[r.grade] > GRADE_RANK[b]) best.set(x.edgeId, r.grade); (routeOf.get(x.edgeId) ?? routeOf.set(x.edgeId, []).get(x.edgeId)!).push(r); }
      const planned = new Map<string, string>(); for (const p of Object.values(sim.projects)) if (p.status !== "open" && p.status !== "abolished") for (const id of p.edgeIds) planned.set(id, p.status);
      const casing = new Graphics(), line = new Graphics(), plan = new Graphics(), ghost = new Graphics(), shapes = new Map<string, Vec[]>();
      const edges = Object.values(sim.edges);
      for (const e of edges) {
        const pts = edgeShape(w, sim, e); shapes.set(e.id, pts); const g = best.get(e.id), wd = g === "national" ? 3.4 : g ? 2.4 : 1.8;
        if (e.open && !e.lost && e.built >= 1) {
          if (!a.layers.roads) continue;
          casing.moveTo(pts[0][0], -pts[0][1]); for (const q of pts.slice(1)) casing.lineTo(q[0], -q[1]); casing.stroke({ width: px(wd + 2), color: 0x1a1a1a, alpha: 0.85, cap: "round", join: "round" });
          line.moveTo(pts[0][0], -pts[0][1]); for (const q of pts.slice(1)) line.lineTo(q[0], -q[1]); line.stroke({ width: px(wd), color: qColour(e.quality), cap: "round", join: "round" });
        } else if (e.lost) { if (a.layers.roads) { dashed(ghost, pts, px(3), px(5)); ghost.stroke({ width: px(1.2), color: 0x3b3b3b, alpha: 0.9 }); } }
        else if (e.built >= 1) { if (a.layers.roads) { dashed(ghost, pts, px(6), px(4)); ghost.stroke({ width: px(1.6), color: 0x9aa4ad, alpha: 0.95 }); } }
        else if (a.layers.plans) {
          const st = planned.get(e.id) ?? "planned", col = st === "building" ? 0x3aa0ff : st === "suspended" ? 0xff8f1f : st === "unbuilt" ? 0xb04bff : 0x39d6c8;
          dashed(plan, pts, st === "planned" ? px(2) : px(7), px(4)); plan.stroke({ width: px(2.2), color: col, alpha: 0.95 });
          if (st === "building" && e.built > 0) { const n = Math.max(1, Math.floor(pts.length * e.built)); plan.moveTo(pts[0][0], -pts[0][1]); for (const q of pts.slice(0, n + 1)) plan.lineTo(q[0], -q[1]); plan.stroke({ width: px(3), color: 0x3aa0ff }); }
        }
      }
      this.container.addChild(ghost, plan, casing, line);
      const nodes = new Graphics();
      if (a.layers.roads) for (const n of Object.values(sim.nodes)) if (n.kind === "pass") nodes.poly([n.pos[0], -n.pos[1] - px(6), n.pos[0] - px(5), -n.pos[1] + px(3), n.pos[0] + px(5), -n.pos[1] + px(3)]).fill({ color: 0xffffff }).stroke({ width: px(1), color: 0x222222 });
      this.container.addChild(nodes);
      if (a.layers.signs && zoom >= 0.28) {
        let count = 0;
        for (const r of Object.values(sim.routes).sort((p, q) => GRADE_RANK[q.grade] - GRADE_RANK[p.grade] || p.number - q.number)) {
          if (!r.active || count >= 60 || (zoom < 0.5 && r.grade !== "national")) continue;
          const es = r.edges.map((x) => sim.edges[x.edgeId]).filter((e) => e && e.open && !e.lost).sort((p, q) => q.lengthKm - p.lengthKm || (p.id < q.id ? -1 : 1)); if (!es.length) continue;
          const pts = shapes.get(es[0].id)!, mid = pts[Math.floor(pts.length / 2)], c = new Container(); c.position.set(mid[0], -mid[1]); c.scale.set(1 / zoom);
          const sg = new Graphics(), col = r.grade === "national" ? 0x1d5fb4 : r.grade === "fu" ? 0x7b3fa0 : 0x1f7a4d;
          if (r.grade === "national") sg.circle(0, 0, 11).fill({ color: col }).stroke({ width: 2, color: 0xffffff });
          else if (r.grade === "ken") sg.roundRect(-12, -9, 24, 18, 4).fill({ color: 0xffffff }).stroke({ width: 2.5, color: col });
          else sg.poly([0, -12, 12, -2, 7, 11, -7, 11, -12, -2]).fill({ color: 0xffffff }).stroke({ width: 2.5, color: col });
          const t = new Text({ text: `${GRADE_SHORT[r.grade]}${r.number}`, style: { fontSize: r.grade === "national" ? 10 : 9, fontWeight: "700", fill: r.grade === "national" ? 0xffffff : col } }); t.anchor.set(0.5); c.addChild(sg, t); c.label = routeLabel(r); this.container.addChild(c); count++;
        }
      }
    }
    const ov = new Graphics();
    for (const c of a.cer) {
      if (c.path && c.path.length > 1) { ov.moveTo(c.path[0][0], -c.path[0][1]); for (const q of c.path.slice(1)) ov.lineTo(q[0], -q[1]); ov.stroke({ width: px(5), color: c.ok ? 0x45e06f : 0xff5252, alpha: 0.8, cap: "round", join: "round" }); }
      if (c.pts.length > 1) { ov.moveTo(c.pts[0][0], -c.pts[0][1]); for (const q of c.pts.slice(1)) ov.lineTo(q[0], -q[1]); ov.stroke({ width: px(2), color: 0xffffff, alpha: 0.95 }); }
    }
    if (a.pin) { ov.circle(a.pin[0], -a.pin[1], px(7)).fill({ color: 0xff3b6b }).stroke({ width: px(2), color: 0xffffff }); }
    this.container.addChild(ov);
  }
  clear() { this.last = null; this.sig = ""; this.container.removeChildren().forEach((c) => c.destroy({ children: true })); }
}
