/** Dynamic road layer: redrawn on its own (time ticks, zoom end) without touching the terrain layers. */
import { Container, Graphics, Text } from "pixi.js";
import { edgeShape } from "../sim/network";
import { GRADE_SHORT, NICK_SHORT, type Grade, type SimEdge, type SimState, type Snapshot } from "../sim/types";
import { routeLabel } from "../sim/engine";
import type { World } from "../sim/world";
import type { Vec } from "../core/types";

export interface CerOverlay { pts: Vec[]; path?: Vec[]; ok: boolean }
export interface RoadArgs { sim: SimState | null; w: World | null; layers: { roads: boolean; plans: boolean; signs: boolean }; cer: CerOverlay[]; pin: Vec | null; compare?: Snapshot | null; sel?: string | null }
const GRADE_RANK: Record<Grade, number> = { national: 3, fu: 2, ken: 1 };
/** Fill colour = physical condition. (Legend text repeats every class: colour is never the only cue.) */
export const COND = [{ min: 70, col: 0x5bd66b, label: "良" }, { min: 40, col: 0xffe14a, label: "可" }, { min: 15, col: 0xff9a3c, label: "悪" }, { min: 0, col: 0xe8483c, label: "荒廃" }];
export const condColour = (q: number) => COND.find((c) => q >= c.min)!.col;
export const CASING: Record<Grade | "none", number> = { national: 0x8e1b1b, ken: 0x1b6b3a, fu: 0x5a2a8a, none: 0x3a3a3a };
export const WIDTH = { rural: 1.6, standard: 2.8, highgrade: 4.6 } as const;
export function snapCode(e: SimEdge): number { return (e.built < 1 ? 4 : { open: 0, dormant: 1, closed: 2, lost: 3 }[e.state]) * 16 + Math.min(15, Math.floor(e.quality / 6.5)); }

function pattern(g: Graphics, pts: Vec[], dash: number[]) {
  let i = 0, left = dash[0], draw = true;
  for (let s = 0; s + 1 < pts.length; s++) {
    let [x, y] = pts[s]; const [bx, by] = pts[s + 1]; let seg = Math.hypot(bx - x, by - y); const ux = (bx - x) / (seg || 1), uy = (by - y) / (seg || 1);
    while (seg > 1e-6) { const step = Math.min(left, seg); if (draw) { g.moveTo(x, -y); g.lineTo(x + ux * step, -(y + uy * step)); } x += ux * step; y += uy * step; seg -= step; left -= step; if (left <= 1e-9) { i = (i + 1) % dash.length; draw = i % 2 === 0; left = dash[i]; } }
  }
}
export class RoadLayer {
  container = new Container(); private last: RoadArgs | null = null; private sig = "";
  // Everything below is created once and reused: creating and destroying Graphics/Text on every redraw leaked ~130 KB each time (Issue #7).
  private g = Object.fromEntries(["halo", "ghost", "plan", "cas", "old", "fillDash", "fill", "mid", "nodes", "sel", "ov"].map((k) => [k, new Graphics()])) as Record<string, Graphics>;
  private signLayer = new Container(); private signs: { c: Container; bg: Graphics; t: Text; nk: Text }[] = [];
  constructor() { for (const k of ["halo", "ghost", "plan", "cas", "old", "fillDash", "fill", "mid", "nodes", "sel"]) this.container.addChild(this.g[k]); this.container.addChild(this.signLayer, this.g.ov); }
  private sign(i: number) {
    let s = this.signs[i];
    if (!s) { const c = new Container(), bg = new Graphics(), t = new Text({ text: "", style: { fontSize: 10, fontWeight: "700", fill: 0xffffff } }), nk = new Text({ text: "", style: { fontSize: 9, fontWeight: "700", fill: 0xffffff, stroke: { color: 0x000000, width: 3 } } }); t.anchor.set(0.5); nk.anchor.set(0.5); nk.position.set(0, 16); c.addChild(bg, t, nk); this.signLayer.addChild(c); s = this.signs[i] = { c, bg, t, nk }; }
    return s;
  }
  /** Cheap change detector so a monthly tick that changed nothing visible costs nothing. */
  static signature(a: RoadArgs, zoom: number): string {
    let h = 0; const s = a.sim;
    if (s) { for (const e of Object.values(s.edges)) h = (h * 31 + (e.open ? 1 : 0) + (e.lost ? 2 : 0) + e.state.length * 5 + Math.floor(e.built * 10) * 4 + Math.floor(e.quality / 15) * 64 + e.cells.length + (e.nick ? 7 : 0) + e.standard.length * 13 + e.bypassedBy.length * 17) >>> 0; for (const r of Object.values(s.routes)) h = (h * 31 + r.number + (r.active ? 1 : 0) + r.edges.length * 7 + r.oldEdges.length * 3 + (r.grade === "national" ? 3 : r.grade === "fu" ? 5 : 11) + (r.nick ? 19 : 0)) >>> 0; for (const p of Object.values(s.projects)) h = (h * 31 + p.status.length + p.edgeIds.length) >>> 0; }
    return `${h}|${Object.keys(s?.edges ?? {}).length}|${a.layers.roads}${a.layers.plans}${a.layers.signs}|${Math.round(zoom * 20)}|${a.cer.map((c) => c.pts.length + (c.path?.length ?? 0) + (c.ok ? "y" : "n")).join(",")}|${a.pin ? a.pin.join(",") : ""}|${a.compare?.year ?? ""}|${a.sel ?? ""}`;
  }
  set(a: RoadArgs, zoom: number) { this.last = a; const sg = RoadLayer.signature(a, zoom); if (sg === this.sig) return false; this.sig = sg; this.draw(a, zoom); return true; }
  redraw(zoom: number) { if (this.last) { this.sig = ""; this.set(this.last, zoom); } }
  private draw(a: RoadArgs, zoom: number) {
    for (const k of Object.keys(this.g)) this.g[k].clear();
    let count = 0;
    const px = (n: number) => n / zoom, { sim, w } = a;
    if (sim && w) {
      const best = new Map<string, Grade>(), nickGrade = new Map<string, Grade>();
      for (const r of Object.values(sim.routes)) if (r.active) for (const id of [...r.edges.map((x) => x.edgeId), ...r.oldEdges]) { const b = best.get(id); if (!b || GRADE_RANK[r.grade] > GRADE_RANK[b]) best.set(id, r.grade); }
      const planned = new Map<string, string>(); for (const p of Object.values(sim.projects)) if (p.status !== "open" && p.status !== "abolished") for (const id of p.edgeIds) planned.set(id, p.status);
      const { ghost, plan, halo, cas, fill, mid, fillDash, old } = this.g, shapes = new Map<string, Vec[]>();
      const hasRoadLayer = a.layers.roads;
      for (const e of Object.values(sim.edges)) {
        const pts = edgeShape(w, sim, e); shapes.set(e.id, pts); const g = best.get(e.id), wd = (g ? WIDTH[e.standard] : WIDTH[e.standard] * 0.8), col = condColour(e.quality), isOld = e.bypassedBy.length > 0;
        if (g && e.nick) nickGrade.set(e.id, g);
        if (a.compare) { // halo = what changed since the chosen year
          const base = a.compare.edges[e.id], now = snapCode(e); let c = 0;
          if (base === undefined) c = 0x39a0ff; else if (Math.floor(now / 16) > Math.floor(base / 16)) c = 0x111111; else if (Math.floor(now / 16) < Math.floor(base / 16)) c = 0x39e08a; else if (Math.floor(base % 16) - Math.floor(now % 16) >= 3) c = 0xff3b3b; else if (Math.floor(now % 16) - Math.floor(base % 16) >= 3) c = 0x39e08a;
          if (c) { halo.moveTo(pts[0][0], -pts[0][1]); for (const q of pts.slice(1)) halo.lineTo(q[0], -q[1]); halo.stroke({ width: px(wd + 7), color: c, alpha: 0.6, cap: "round", join: "round" }); }
        }
        if (e.built >= 1 && (e.state === "open")) {
          if (!hasRoadLayer) continue;
          cas.moveTo(pts[0][0], -pts[0][1]); for (const q of pts.slice(1)) cas.lineTo(q[0], -q[1]); cas.stroke({ width: px(wd + 2.4), color: CASING[g ?? "none"], alpha: 0.95, cap: "round", join: "round" });
          if (isOld) { pattern(old, pts, [px(9), px(3), px(2), px(3)]); old.stroke({ width: px(wd), color: col, cap: "butt" }); }
          else { fill.moveTo(pts[0][0], -pts[0][1]); for (const q of pts.slice(1)) fill.lineTo(q[0], -q[1]); fill.stroke({ width: px(wd), color: col, cap: "round", join: "round" }); }
          if (e.bypassOf.length) { mid.moveTo(pts[0][0], -pts[0][1]); for (const q of pts.slice(1)) mid.lineTo(q[0], -q[1]); mid.stroke({ width: px(1), color: 0xffffff, alpha: 0.9 }); }
        } else if (e.built >= 1 && e.state === "dormant") { if (hasRoadLayer) { pattern(fillDash, pts, [px(10), px(6)]); fillDash.stroke({ width: px(wd * 0.9), color: col, alpha: 0.85 }); } }
        else if (e.state === "lost" && e.built >= 1) { if (hasRoadLayer) { pattern(ghost, pts, [px(2), px(5)]); ghost.stroke({ width: px(1.2), color: 0x2b2b2b, alpha: 0.95 }); } }
        else if (e.built >= 1) { if (hasRoadLayer) { pattern(ghost, pts, [px(5), px(4)]); ghost.stroke({ width: px(1.6), color: 0x9aa4ad, alpha: 0.95 }); } }
        else if (a.layers.plans) {
          const st = planned.get(e.id) ?? "planned", c2 = st === "building" ? 0x3aa0ff : st === "suspended" ? 0xff8f1f : st === "unbuilt" ? 0xb04bff : 0x39d6c8;
          pattern(plan, pts, st === "planned" ? [px(2), px(4)] : [px(7), px(4)]); plan.stroke({ width: px(2.2), color: c2, alpha: 0.95 });
          if (st === "building" && e.built > 0) { const n = Math.max(1, Math.floor(pts.length * e.built)); plan.moveTo(pts[0][0], -pts[0][1]); for (const q of pts.slice(0, n + 1)) plan.lineTo(q[0], -q[1]); plan.stroke({ width: px(3), color: 0x3aa0ff }); }
        }
      }
      if (a.sel && shapes.has(a.sel)) { const pts = shapes.get(a.sel)!, s2 = this.g.sel; s2.moveTo(pts[0][0], -pts[0][1]); for (const q of pts.slice(1)) s2.lineTo(q[0], -q[1]); s2.stroke({ width: px(9), color: 0xffffff, alpha: 0.55, cap: "round", join: "round" }); }
      const nodes = this.g.nodes;
      if (hasRoadLayer) for (const n of Object.values(sim.nodes)) { if (n.kind === "pass") nodes.poly([n.pos[0], -n.pos[1] - px(6), n.pos[0] - px(5), -n.pos[1] + px(3), n.pos[0] + px(5), -n.pos[1] + px(3)]).fill({ color: 0xffffff }).stroke({ width: px(1), color: 0x222222 }); else if (n.kind === "village" && zoom >= 0.5) nodes.circle(n.pos[0], -n.pos[1], px(2.4)).fill({ color: 0xe8e0c8 }).stroke({ width: px(0.8), color: 0x333333 }); }
      if (a.layers.signs && zoom >= 0.28) {
        for (const r of Object.values(sim.routes).sort((p, q) => GRADE_RANK[q.grade] - GRADE_RANK[p.grade] || p.number - q.number)) {
          if (!r.active || count >= 60 || (zoom < 0.55 && r.grade !== "national") || (zoom < 1.1 && r.grade === "fu" && r.number !== 1)) continue;
          const es = r.edges.map((x) => sim.edges[x.edgeId]).filter((e) => e && e.state === "open" && e.built >= 1).sort((p, q) => q.lengthKm - p.lengthKm || (p.id < q.id ? -1 : 1)); if (!es.length) continue;
          const pts = shapes.get(es[0].id)!, m = pts[Math.floor(pts.length / 2)], sp = this.sign(count), c = sp.c; c.visible = true; c.position.set(m[0], -m[1]); c.scale.set(1 / zoom);
          const sg = sp.bg, col = r.grade === "national" ? 0xb02020 : r.grade === "fu" ? 0x7b3fa0 : 0x1f7a4d; sg.clear();
          if (r.grade === "national") sg.circle(0, 0, 11).fill({ color: col }).stroke({ width: 2, color: 0xffffff });
          else if (r.grade === "ken") sg.roundRect(-12, -9, 24, 18, 4).fill({ color: 0xffffff }).stroke({ width: 2.5, color: col });
          else sg.poly([0, -12, 12, -2, 7, 11, -7, 11, -12, -2]).fill({ color: 0xffffff }).stroke({ width: 2.5, color: col });
          sp.t.text = `${GRADE_SHORT[r.grade]}${r.number}`; sp.t.style.fontSize = r.grade === "national" ? 10 : 9; sp.t.style.fill = r.grade === "national" ? 0xffffff : col;
          sp.nk.visible = r.nick; if (r.nick) sp.nk.text = NICK_SHORT[r.grade];
          c.label = routeLabel(r); count++;
        }
      }
    }
    for (let i = count; i < this.signs.length; i++) this.signs[i].c.visible = false;
    const ov = this.g.ov;
    for (const c of a.cer) {
      if (c.path && c.path.length > 1) { ov.moveTo(c.path[0][0], -c.path[0][1]); for (const q of c.path.slice(1)) ov.lineTo(q[0], -q[1]); ov.stroke({ width: px(5), color: c.ok ? 0x45e06f : 0xff5252, alpha: 0.8, cap: "round", join: "round" }); }
      if (c.pts.length > 1) { ov.moveTo(c.pts[0][0], -c.pts[0][1]); for (const q of c.pts.slice(1)) ov.lineTo(q[0], -q[1]); ov.stroke({ width: px(2), color: 0xffffff, alpha: 0.95 }); }
    }
    if (a.pin) { ov.circle(a.pin[0], -a.pin[1], px(7)).fill({ color: 0xff3b6b }).stroke({ width: px(2), color: 0xffffff }); }
  }
  clear() { this.last = null; this.sig = ""; for (const k of Object.keys(this.g)) this.g[k].clear(); for (const sg of this.signs) sg.c.visible = false; }
}
