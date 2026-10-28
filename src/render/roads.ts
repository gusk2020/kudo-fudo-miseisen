/** Dynamic transport layer (roads and railways): redrawn on its own (time ticks, zoom end) without touching the terrain layers. */
import { isIslandRoute, isOcean } from "../sim/sea22";
import { Container, Graphics, Text } from "pixi.js";
import { edgeShape } from "../sim/network";
import { GRADE_MODE, GRADE_SHORT, NICK_SHORT, modeOf, type EdgeState, type Grade, type SimEdge, type SimState } from "../sim/types";
import { routeLabel, routeOfficial } from "../sim/engine";
import type { World } from "../sim/world";
import { hubsAt } from "../sim/hubs";
import { pickCityCircles } from "./cityCircles";
import { tierOf } from "../sim/tier23";
import { LINE, nameWidth, placeNames, type Box, type NameCircle } from "./cityNames";
import { quays, seaPath } from "./seaPath";
import { isLakeFerry } from "../sim/ferry";
import type { Vec } from "../core/types";
import { AIR_STYLE, BRIDGE, GONE_GREY, HIGHLIGHT_LAYERS, QUALITY_STEPS, RAIL_WIDTH_T, ROAD_WIDTH, TIER_OF, TUNNEL, buildProgressStroke, edgeStyle, shade, type Kind, type LineState, type Stroke } from "./style24";

export interface CerOverlay { pts: Vec[]; path?: Vec[]; ok: boolean; segs?: { pts: Vec[]; ferry: boolean }[]; strokes?: Vec[][]; handles?: boolean; sel?: number | null }   // Stage 9: strokes with their control points (handles) and the selected stroke   // segs: land pieces (solid) and sea crossings (dashed) of a previewed route
export interface RoadArgs {
  sim: SimState | null; w: World | null;
  layers: { roads: boolean; rail?: boolean; plans: boolean; signs: boolean; abandoned?: boolean; ports?: boolean; airports?: boolean; lanes?: boolean; econ?: boolean };
  cer: CerOverlay[]; pin: Vec | null;
  lite?: boolean;                                                        // light drawing for a slow device: solid lines instead of dashes, fewer labels, no ports
  sel?: string | null;
  hide?: string[];                                                       // legend filters (display only): grade ids, 'road'/'rail' state keys
  hl?: { edges: string[]; air?: [Vec, Vec] } | null;                    // Stage 23: the route chosen in the ledger / number list, drawn over everything in its own colour
  names?: boolean;                                                       // route-name text beside the number signs
}
const GRADE_RANK: Record<Grade, number> = { jnr: 4, national: 3, fu: 2, ken: 1, priv: 3 };
/** Condition = the shade of the kind's own hue (style24.ts); the legend text repeats every class. Kept as a list for the classic legend. */
export const COND = QUALITY_STEPS.map((s) => ({ min: s.min, col: shade("road", s.min), label: s.label }));
/** Stage 9: the map shows kinds, not administrative grades (those stay in the ledger, the route details and the history). */
export type EdgeKind = "road" | "hwy" | "rail" | "hsr" | "maglev";
export const kindOf = (e: Pick<SimEdge, "standard" | "maglev" | "mode">): EdgeKind => (modeOf(e) === "rail" ? (e.maglev ? "maglev" : e.standard === "highgrade" ? "hsr" : "rail") : e.standard === "highgrade" ? "hwy" : "road");
export const KIND_LABEL9: Record<EdgeKind, string> = { road: "道路", hwy: "高速道路", rail: "鉄道", hsr: "新幹線", maglev: "リニア" };
export const CASING: Record<Grade | "none", number> = { national: 0x8e1b1b, ken: 0x1b6b3a, fu: 0x5a2a8a, jnr: 0x0b2a55, priv: 0x2a2a6a, none: 0x3a3a3a };   // (the classic map-making legend only)

function pattern(g: Graphics, pts: Vec[], dash: number[]) {
  let i = 0, left = dash[0], draw = true;
  for (let s = 0; s + 1 < pts.length; s++) {
    let [x, y] = pts[s]; const [bx, by] = pts[s + 1]; let seg = Math.hypot(bx - x, by - y); const ux = (bx - x) / (seg || 1), uy = (by - y) / (seg || 1);
    while (seg > 1e-6) { const step = Math.min(left, seg); if (draw) { g.moveTo(x, -y); g.lineTo(x + ux * step, -(y + uy * step)); } x += ux * step; y += uy * step; seg -= step; left -= step; if (left <= 1e-9) { i = (i + 1) % dash.length; draw = i % 2 === 0; left = dash[i]; } }
  }
}
const KEYS = ["city12", "halo", "facb", "ghost", "ferry", "plan", "cas", "old", "fillDash", "fill", "mid", "rcas", "rfill", "rtie", "rdash", "lanes", "fac", "nodes", "cityTop", "sel", "hl", "ov"];
/** Stage 23: a copy of a line moved sideways by d (world units) -- two lines that share a bridge or a tunnel are drawn side by side instead of one over the other. Display only. */
function offsetLine(pts: Vec[], d: number): Vec[] {
  return pts.map((p, i) => { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], dx = b[0] - a[0], dy = b[1] - a[1], n = Math.hypot(dx, dy) || 1; return [p[0] - (dy / n) * d, p[1] + (dx / n) * d] as Vec; });
}
/** Short cross-lines along a line (girders): where a bridge is, they make it read as a bridge at a glance and at any zoom where the line itself is wide enough to see. */
function girders(g: Graphics, pts: Vec[], step: number, half: number) {
  let carry = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1], len = Math.hypot(bx - ax, by - ay); if (len < 1e-9) continue; const ux = (bx - ax) / len, uy = (by - ay) / len;
    for (let d = step - carry; d <= len; d += step) { const x = ax + ux * d, y = ay + uy * d; g.moveTo(x - uy * half, -(y + ux * half)); g.lineTo(x + uy * half, -(y - ux * half)); carry = len - d; }
    if (len < step - carry) carry += len;
  }
}
const line = (g: Graphics, pts: Vec[]) => { g.moveTo(pts[0][0], -pts[0][1]); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], -pts[i][1]); };
const opColour = (id: string) => { let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0; return [0x7a1f3d, 0x1f5f7a, 0x6b4a14, 0x3b6b1f, 0x5a2a8a, 0x8a3a1a, 0x1f3f8a][h % 7]; };

/** An airport mark (a small plane cross), u = one screen pixel in world units. */
function plane(g: Graphics, x: number, y: number, u: number, col: number) { g.poly([x - 7 * u, -y - 3 * u, x - 2 * u, -y - 3 * u, x - 2 * u, -y - 8 * u, x, -y - 8 * u, x, -y - 3 * u, x + 4 * u, -y - 3 * u, x + 4 * u, -y - 1 * u, x, -y - 1 * u, x, -y + 4 * u, x - 2 * u, -y + 4 * u, x - 2 * u, -y - 1 * u, x - 7 * u, -y - 1 * u]).fill({ color: col }).stroke({ width: u * 0.8, color: 0x222222 }); }
/** Port colours by tier (地方港湾 → 国際戦略港湾) and the line colours of the routes; the legend repeats them in words. */
export const PORT_COL2 = [0x4f95d6, 0x0f3f8c], PORT_SIZE = [6, 11];
export class RoadLayer {
  container = new Container(); private last: RoadArgs | null = null; private sig = "";
  // Everything below is created once and reused: creating and destroying Graphics/Text on every redraw leaked ~130 KB each time (Issue #7).
  private g = Object.fromEntries(KEYS.map((k) => [k, new Graphics()])) as Record<string, Graphics>;
  private nameLayer = new Container(); private names: Text[] = []; private signLayer = new Container(); private signs: { c: Container; bg: Graphics; t: Text; nk: Text }[] = [];
  constructor() { for (const k of KEYS.filter((k) => k !== "ov")) this.container.addChild(this.g[k]); this.container.addChild(this.signLayer, this.nameLayer, this.g.ov); }
  private nameText(i: number): Text { let t = this.names[i]; if (!t) { t = new Text({ text: "", style: { fontSize: 12, fontWeight: "700", fill: 0x111111, stroke: { color: 0xffffff, width: 3 } } }); this.names[i] = t; this.nameLayer.addChild(t); } return t; }
  private sign(i: number) {
    let s = this.signs[i];
    if (!s) { const c = new Container(), bg = new Graphics(), t = new Text({ text: "", style: { fontSize: 10, fontWeight: "700", fill: 0xffffff } }), nk = new Text({ text: "", style: { fontSize: 9, fontWeight: "700", fill: 0xffffff, stroke: { color: 0x000000, width: 3 } } }); t.anchor.set(0.5); nk.anchor.set(0.5); nk.position.set(0, 16); c.addChild(bg, t, nk); this.signLayer.addChild(c); s = this.signs[i] = { c, bg, t, nk }; }
    return s;
  }
  /** Cheap change detector so a monthly tick that changed nothing visible costs nothing. */
  static signature(a: RoadArgs, zoom: number): string {
    let h = 0; const s = a.sim;
    if (s) {
      for (const e of Object.values(s.edges)) h = (h * 31 + (e.open ? 1 : 0) + (e.lost ? 2 : 0) + e.state.length * 5 + Math.floor(e.built * 10) * 4 + Math.floor(e.quality / 15) * 64 + e.cells.length + (e.nick ? 7 : 0) + e.standard.length * 13 + e.bypassedBy.length * 17 + (e.mode === "rail" ? 29 : 0)) >>> 0;
      for (const r of Object.values(s.routes)) h = (h * 31 + r.number + (r.active ? 1 : 0) + r.edges.length * 7 + r.oldEdges.length * 3 + (r.grade === "national" ? 3 : r.grade === "fu" ? 5 : r.grade === "jnr" ? 13 : r.grade === "priv" ? 17 : 11) + (r.nick ? 19 : 0)) >>> 0;
      for (const p of Object.values(s.projects)) h = (h * 31 + p.status.length + p.edgeIds.length) >>> 0;
      for (const c of Object.values(s.cities)) if (c.airport !== undefined) h = (h * 31 + 7) >>> 0;
      if (s.tier23) for (const [id, z] of Object.entries(s.tier23.zones)) h = (h * 31 + z.tier * 7 + z.facs.length + id.length) >>> 0;   // Stage 23
      if (s.city12) { for (const c of Object.values(s.city12)) h = (h * 31 + c.h.length * 7 + (c.h[c.h.length - 1] ?? 0) % 997) >>> 0; }
      if (s.metro) { for (const m of s.metro.list) h = (h * 31 + Math.round(m.pop / 1000) + m.cells.length * 3) >>> 0; }
      if (s.hubs) { for (const p of Object.values(s.hubs.ports)) h = (h * 31 + p.tier + (p.until ? 5 : 0)) >>> 0; for (const x of Object.values(s.hubs.airports)) h = (h * 31 + x.runwayM + (x.kind === "hub" ? 3 : 0) + (x.until ? 5 : 0)) >>> 0; for (const r of s.hubs.routes) h = (h * 31 + r.state.length + r.since) >>> 0; }
    }
    const L = a.layers;
    return `${h}|${Object.keys(s?.edges ?? {}).length}|${L.roads}${L.rail ?? 1}${L.plans}${L.signs}${L.abandoned ?? 1}${L.ports ?? 1}${L.airports ?? 1}${L.lanes ?? 1}${L.econ ?? 1}${a.lite ? "L" : ""}${a.names ? "N" : ""}${(a.hide ?? []).join(",")}|${Math.round(zoom * 20)}|${a.cer.map((c) => (c.strokes ? c.strokes.map((st) => st.map((q) => q[0].toFixed(1) + q[1].toFixed(1)).join()).join("/") + (c.sel ?? "") + (c.handles ? "h" : "") : "") + c.pts.length + (c.path?.length ?? 0) + (c.ok ? "y" : "n")).join(",")}|${a.pin ? a.pin.join(",") : ""}|${a.sel ?? ""}|${a.hl ? a.hl.edges.length + a.hl.edges.join("").length + (a.hl.air ? "a" : "") : ""}`;
  }
  /**
   * Stage 12/13: how big each metropolis is, and whether it is rising or falling -- green when it has gained on the nation over the last twenty years, red when it
   * has lost, grey in between. From Stage 13 the disc is the metropolitan area itself (metro.ts): its radius is sqrt(area / pi) of the ground the metropolis really
   * covers (an isochrone grown over the land, wider on a plain and narrower on a range), and the ground is drawn faintly under it so the disc reads as a scale
   * indicator, not as the shape. Older saves, before their first yearly step under Stage 13, show the Stage 12 disc scaled by the city's own size. No triangles:
   * the colour says rising or falling, the atlas says why. Only the largest and the biggest movers are drawn; the full list is in the atlas.
   */
  private drawCityEcon(sim: SimState, w: World, zoom: number, year: number | null, px: (n: number) => number, lite: boolean) {
    const g = this.g.city12, c12 = sim.city12!, M = sim.metro, rows: { x: number; y: number; p: number; rel: number; r: number; cells?: number[] }[] = [];
    let s0 = 0, s1 = 0; const raw: { x: number; y: number; p1: number; p0: number; r: number; cells?: number[] }[] = [];
    if (M) {
      for (const m of M.list) {
        const core = w.cityById.get(m.core); if (!core) continue; const h = M.h[m.core] ?? [];
        let k = h.length - 1; if (year !== null) { k = -1; for (let q = 0; q < h.length; q++) if (h[q][0] <= year) k = q; if (k < 0) continue; }
        const cur = year === null ? { pop: m.pop, area: m.areaKm2 } : { pop: h[k][1], area: h[k][2] }, past = h[Math.max(0, k - 4)];
        const p1 = cur.pop, p0 = past ? past[1] : p1; raw.push({ x: core.pos[0], y: core.pos[1], p1, p0, r: Math.sqrt(cur.area / Math.PI), ...(year === null ? { cells: m.cells } : {}) }); s0 += p0; s1 += p1;
      }
    } else for (const c of w.cities) {
      const h = c12[c.id]?.h; if (!h || h.length < 2) continue; let k = h.length - 1; if (year !== null) k = Math.max(1, Math.min(h.length - 1, Math.floor((year - sim.startYear) / 5)));
      const p1 = h[k], p0 = h[Math.max(0, k - 4)]; raw.push({ x: c.pos[0], y: c.pos[1], p1, p0, r: -1 }); s0 += p0; s1 += p1;
    }
    const nat = s0 > 0 ? s1 / s0 : 1;
    for (const r of raw) rows.push({ x: r.x, y: r.y, p: r.p1, rel: r.p0 > 0 ? r.p1 / r.p0 / nat : 1, r: r.r, ...(r.cells ? { cells: r.cells } : {}) });
    const bySize = [...rows].sort((p, q) => q.p - p.p), keep = new Set(bySize.slice(0, lite ? 8 : zoom < 0.5 ? 12 : 24));
    for (const r of [...rows].sort((p, q) => q.rel - p.rel).slice(0, 4)) if (r.rel > 1.1 && r.p > 5e4) keep.add(r);
    for (const r of [...rows].sort((p, q) => p.rel - q.rel).slice(0, 4)) if (r.rel < 0.9 && r.p > 5e4) keep.add(r);
    for (const r of keep) {
      const col = r.rel > 1.08 ? 0x2fbf5f : r.rel < 0.93 ? 0xe0463c : 0x9aa4ad, rad = r.r >= 0 ? Math.max(px(4), r.r) : Math.min(px(3 + 3.2 * Math.sqrt(r.p / 1e5)), px(26));
      if (r.cells && !lite && zoom >= 0.3) {
        const nx = w.nx, c = w.cell; let run = 0, k0 = -1;
        const flush = () => { if (run > 0) { const p = w.cellPos(k0); g.rect(p[0] - c / 2, -p[1] - c / 2, run * c, c); } run = 0; };
        for (const k of r.cells) { if (run > 0 && k === k0 + run && (k % nx) !== 0) run++; else { flush(); k0 = k; run = 1; } }
        flush(); g.fill({ color: col, alpha: 0.16 });
      }
      g.circle(r.x, -r.y, rad).fill({ color: col, alpha: r.r >= 0 ? 0.14 : 0.38 }).stroke({ width: px(1.2), color: col, alpha: r.r >= 0 ? 0.7 : 0.95 });
    }
  }
  /**
   * Stage 14 (Issue #35): the circle of every city that matters, on TOP of the roads (the metropolitan area above is a faint scale indicator on the bottom layer, where a thick bundle of lines hid it --
   * a big city could be there and not be seen). Always drawn: the two seats of government (a gold ring round the colour), the cores of the ten biggest metropolises, and the towns of the seats'
   * metropolises that are big enough to read (their own circles: the commuter belt round a capital is made of towns, not of one disc). Then the biggest cities by size, and the clear movers.
   * Colour is the same as the metropolis's: green gained on the nation over twenty years, red lost, grey about even; radius grows with the square root of the city's own people. No triangles.
   */
  private drawCityCircles(sim: SimState, w: World, zoom: number, year: number | null, px: (n: number) => number, lite: boolean) {
    const g = this.g.cityTop, circles = pickCityCircles(sim, w, zoom, year, lite);
    const drawn: NameCircle[] = [], tiers: number[] = [];
    for (const r of circles) {
      const col = r.rel > 1.08 ? 0x2fbf5f : r.rel < 0.93 ? 0xe0463c : 0x9aa4ad, rad = Math.min(px(3 + 4 * Math.sqrt(r.p / 1e5)), px(r.seat ? 34 : 28));
      g.circle(r.x, -r.y, rad).fill({ color: col, alpha: 0.3 }).stroke({ width: px(1.6), color: col, alpha: 1 });
      if (r.seat) g.circle(r.x, -r.y, rad + px(2.5)).stroke({ width: px(1.8), color: 0xffc83a, alpha: 0.95 });
      const tier = year === null ? tierOf(sim, r.id) : 0;
      if (tier) { g.circle(r.x, -r.y, rad + px(tier === 2 ? 4.6 : 3.4)).stroke({ width: px(tier === 2 ? 2.2 : 1.4), color: tier === 2 ? 0x3b1f6e : 0x7a4fb5, alpha: 0.95 }); }   // Stage 23: 政令指定都市 a heavy violet ring, 政令特区 a light one
      const wc = w.cityById.get(r.id); tiers.push(tier);
      drawn.push({ x: r.x * zoom, y: -r.y * zoom, rad: rad * zoom, name: wc && wc.kind !== "capital" && sim.pot17 && (!sim.tier23 || year !== null || tier > 0 || r.seat) ? wc.name : null, seat: r.seat });   // (Stage 23: with the tiers only the 特区・政令指定都市 and the seats are named; the others keep their circle)
    }
    // Stage 18/19: names of the places that grew into cities (cityNames.ts): no overlaps, biggest first, fewer when zoomed out; the base map's names of the capitals (drawn from zoom 0.55) are in the way too
    if (zoom >= 0.55 && sim.pot17) {
      const fixed: Box[] = []; for (const c of w.cities) if (c.kind === "capital") { const x = c.pos[0] * zoom + 5, y = -c.pos[1] * zoom - 6; fixed.push([x, y, x + nameWidth(c.name), y + LINE]); }
      // Stage 23: the order names are laid in is the order of importance: the seats, then 政令指定都市, then 政令特区, then the rest by size (the circles are in size order already)
      const ord = drawn.map((_, i) => i).sort((a, b) => (drawn[b].seat ? 3 : tiers[b]) - (drawn[a].seat ? 3 : tiers[a]) || a - b), sorted = ord.map((i) => drawn[i]);
      let nn = 0; for (const p of placeNames(sorted, fixed, zoom)) { const t = this.nameText(nn++); t.text = sorted[p.i].name!; t.visible = true; t.scale.set(1 / zoom); t.position.set(p.x / zoom, p.y / zoom); }
    }
  }
  /** Stage 8/9: ports and airports, each in two sizes only (large: 国際拠点港湾以上 / 国際ハブ空港; small: the rest), and the busiest domestic flights.
   *  International routes are kept in the simulation but not drawn. */
  private drawHubs(a: RoadArgs, sim: SimState, w: World, zoom: number, year: number | null, px: (n: number) => number, lite: boolean) {
    const at = hubsAt(sim, year ?? Number.POSITIVE_INFINITY), nodes = this.g.nodes, lanes = this.g.lanes, pos = (id: string) => w.cityById.get(id)?.pos;
    const showP = a.layers.ports ?? true, showA = a.layers.airports ?? true, showL = (a.layers.lanes ?? true) && zoom >= 0.12, far = zoom < 0.5;
    if (showL && showA) {
      const dom = at.routes.filter((r) => r.mode === "air" && !r.intl && r.state === "open").sort((p, q) => q.vol - p.vol).slice(0, lite ? 8 : far ? 14 : 30);
      for (const r of dom) { const p = pos(r.a), q = pos(r.b); if (!p || !q) continue; for (const sp of [AIR_STYLE.casing!, AIR_STYLE.body]) { pattern(lanes, [p, q], (sp.dash ?? [1e9]).map(px)); lanes.stroke({ width: px(sp.width), color: sp.colour, alpha: sp.alpha, cap: sp.cap }); } }
    }
    if (zoom < (lite ? 0.5 : 0.22)) return;
    if (showP) for (const p of at.ports) { const big = p.tier >= 3; if (far && !big) continue; const c = pos(p.city); if (!c) continue; const s = px(big ? PORT_SIZE[1] : PORT_SIZE[0]); nodes.rect(c[0] + px(5), -c[1] + px(2), s, s).fill({ color: big ? PORT_COL2[1] : PORT_COL2[0] }).stroke({ width: px(1.2), color: 0xffffff }); }
    if (showA) for (const x of at.airports) { const hub = x.kind === "hub" && (year === null || !x.build); if (far && !hub) continue; const c = pos(x.city); if (!c) continue; const s = hub && x.site !== w.cityById.get(x.city)?.cell ? w.cellPos(x.site) : c; plane(nodes, s[0], s[1], px(hub ? 2 : 1.2), hub ? 0xffc83a : 0xffffff); }
  }
  set(a: RoadArgs, zoom: number) { this.last = a; const sg = RoadLayer.signature(a, zoom); if (sg === this.sig) return false; this.sig = sg; this.draw(a, zoom); return true; }
  redraw(zoom: number) { if (this.last) { this.sig = ""; this.set(this.last, zoom); } }
  private draw(a: RoadArgs, zoom: number) {
    for (const k of Object.keys(this.g)) this.g[k].clear(); for (const t of this.names) t.visible = false;
    let count = 0;
    const px = (n: number) => n / zoom, { sim, w } = a;
    if (sim && w) {
      const lite = !!a.lite, pat = (g: Graphics, pts: Vec[], dash: number[]) => (lite ? line(g, pts) : pattern(g, pts, dash));
      const showRoads = a.layers.roads, showRail = a.layers.rail ?? true, showAband = a.layers.abandoned ?? true;
      const best = new Map<string, Grade>(), hide = new Set(a.hide ?? []);
      for (const r of Object.values(sim.routes)) {
        if (!r.active) continue;
        const grade = r.grade;
        for (const id of [...r.edges.map((x) => x.edgeId), ...r.oldEdges]) { const b = best.get(id); if (!b || GRADE_RANK[grade] > GRADE_RANK[b]) best.set(id, grade); }
      }
      const planned = new Map<string, string>(); for (const p of Object.values(sim.projects)) if (p.status !== "open" && p.status !== "abolished") for (const id of p.edgeIds) planned.set(id, p.status);
      const { ferry: fer, ghost, plan, halo, cas, fill, mid, fillDash, old, rcas, rfill, rtie, rdash, fac, facb } = this.g, shapes = new Map<string, Vec[]>(), nickGrade = new Map<string, Grade>();
      // Stage 23: a road and a railway that cross the same water or hill by the same bridge / tunnel are drawn side by side (display only; the network keeps its two edges). Found by a shared cell.
      const sharedSide = new Map<string, number>();
      if (zoom >= 0.35) {
        const byCell = new Map<number, SimEdge[]>();
        for (const e of Object.values(sim.edges)) if ((e.facility === "bridge" || e.facility === "tunnel") && e.built >= 1 && e.state === "open") for (const c of e.cells) { const l = byCell.get(c); if (l) l.push(e); else byCell.set(c, [e]); }
        for (const l of byCell.values()) if (l.length > 1) { const rd = l.find((x) => modeOf(x) !== "rail"), rl = l.find((x) => modeOf(x) === "rail"); if (rd && rl && rd.facility === rl.facility) { sharedSide.set(rd.id, 1); sharedSide.set(rl.id, -1); } }
      }
      const put = (gr: Graphics, pts2: Vec[], s: Stroke) => { if (s.dash) pat(gr, pts2, s.dash.map(px)); else line(gr, pts2); gr.stroke({ width: px(s.width), color: s.colour, alpha: s.alpha, cap: s.cap, join: "round" }); };   // one stroke of a style (style24.ts)
      // level of detail: the whole country shows only the trunk network; regional and local lines appear as you zoom in
      const minRank = zoom < 0.35 ? 3 : zoom < 0.8 ? 2 : 0;
      for (const e of Object.values(sim.edges)) {
        const eff = { built: e.built, state: e.state, q: e.quality };
        const rail = modeOf(e) === "rail", g = best.get(e.id);
        const rank = (g ? GRADE_RANK[g] : 0) + (e.standard === "highgrade" ? 2 : 0) + (rail ? 1 : 0);
        const isPlan = eff.built < 1, isAband = eff.built >= 1 && (eff.state === "closed" || eff.state === "lost");
        if (rank < minRank) { if (!(isPlan && zoom >= 0.35 && a.layers.plans)) continue; }
        if (rail ? !showRail : !showRoads) { if (!isPlan) continue; }
        if (isAband && !showAband) continue;
        if (e.facility === "ferry" && (isLakeFerry(e) ? hide.has("fac:lake") : hide.has("fac:ferry"))) continue;
        if (e.facility === "ferry" && isOcean(e) && !(e.through > 50 || (eff.state === "open" && e.peakThrough >= 1 && zoom >= 1.5))) continue;   // Stage 27: an ocean route is drawn while it carries people (any zoom) or, close in, while it is open and has ever been used; resting, closed and never-used ones (several leave 宮崎 and 大分 along the same coast) are in the ledger, not on the map
        if (e.facility === "ferry" && isIslandRoute(e) && (zoom < (eff.state === "open" ? (e.through > 50 ? 0 : 0.3) : 1))) continue;   // Stage 22/26: the many sea routes thin out far away: a resting one only close in, an island route from a middle zoom, an ocean route nobody uses (many leave 宮崎 and 大分 along the same coast) only from zoom 0.8, a busy one always
        if (hide.size) { const stKey = eff.built < 1 ? "plan" : eff.state; if (hide.has("st:" + stKey) || hide.has("k:" + kindOf(e)) || hide.has("g:" + (g ?? "none") + ":" + (rail ? "rail" : "road")) || (isPlan && hide.has("st:" + (planned.get(e.id) ?? "planned")))) continue; }
        const pts = e.facility === "ferry" ? seaPath(w, sim.nodes[e.a].cell, sim.nodes[e.b].cell, isLakeFerry(e)) : edgeShape(w, sim, e); shapes.set(e.id, pts);
        const thin = zoom < 0.35, kind: Kind = e.facility === "ferry" ? "sea" : kindOf(e), tier = TIER_OF[e.standard], isOld = e.bypassedBy.length > 0, wd = (rail ? RAIL_WIDTH_T[tier] : g ? ROAD_WIDTH[tier] : ROAD_WIDTH[tier] * 0.8) * (thin ? 0.6 : 1);
        if (g && e.nick) nickGrade.set(e.id, g);
        if (e.facility === "ferry") {   // a sea route: a dashed line in the sea colour, never the road's casing and fill
          if (eff.built >= 1 && zoom >= 0.35) for (const q of quays(w, sim.nodes[e.a].cell, sim.nodes[e.b].cell, isLakeFerry(e))) { line(fer, q); fer.stroke({ width: px(1.4), color: GONE_GREY, alpha: 0.8 }); }
          if (eff.built >= 1) put(fer, pts, { ...edgeStyle("sea", tier, eff.state, eff.q).body, width: rail ? 2.4 : 3 });
          continue;
        }
        if (eff.built >= 1 && eff.state === "open") {
          // Stage 23: a bridge is a white deck with a black edge on both sides; a tunnel is a faded line between two black dashed edges. The road or railway itself keeps its own colour on top,
          // so the kind of traffic can be read on the bridge and inside the tunnel; where both share the structure they run side by side (sharedSide).
          const side = sharedSide.get(e.id) ?? 0, dp = side ? offsetLine(pts, px(side * (wd + 3.2) * 0.5)) : pts, tun = e.facility === "tunnel" && zoom >= 0.35;
          if (e.facility === "bridge" && zoom >= 0.35) { put(facb, dp, BRIDGE.edge(wd)); put(facb, dp, BRIDGE.deck(wd)); if (zoom >= 0.6) { girders(facb, dp, px(BRIDGE.girderStep), px(wd * 0.5 + 6)); facb.stroke({ width: px(BRIDGE.girder.width), color: BRIDGE.girder.colour }); } }
          else if (tun) { const d = px(wd * 0.5 + 2.6); for (const sg of [1, -1]) put(fac, offsetLine(dp, sg * d), TUNNEL.edge); }
          const st = edgeStyle(kind, tier, "open", eff.q, { thin, tunnel: tun, old: isOld && !rail, bypass: e.bypassOf.length > 0 && !rail, undesignated: !g });
          if (rail) {   // every ordinary railway alike (national or private); 新幹線 with a white centre line, リニア with a dashed one
            put(rcas, dp, st.casing!); put(rfill, dp, st.body);
            if (st.ties) { if (zoom >= 0.8) put(rtie, dp, st.ties); } else put(mid, dp, st.centre!);
          } else {   // one style for every road whatever its administrative grade
            put(cas, dp, st.casing!); put(isOld ? old : fill, dp, st.body); if (st.centre) put(mid, dp, st.centre);
          }
        } else if (eff.built >= 1 && eff.state === "dormant") put(rail ? rdash : fillDash, pts, edgeStyle(kind, tier, "dormant", eff.q, { thin }).body);
        else if (eff.built >= 1) put(ghost, pts, edgeStyle(kind, tier, eff.state === "lost" ? "lost" : "closed", eff.q).body);
        else if (a.layers.plans) {
          const st = planned.get(e.id) ?? "planned";
          put(plan, pts, edgeStyle(kind, tier, st === "unbuilt" ? "unbuilt" : "planned", eff.q).body);
          if (st === "building" && e.built > 0) { const n = Math.max(1, Math.floor(pts.length * e.built)); put(plan, pts.slice(0, n + 1), buildProgressStroke(kind)); }
        }
      }
      if (a.sel && shapes.has(a.sel)) { const pts = shapes.get(a.sel)!; line(this.g.sel, pts); this.g.sel.stroke({ width: px(9), color: 0xffffff, alpha: 0.55, cap: "round", join: "round" }); }
      if (a.hl) {   // Stage 23: the chosen route over everything: a black edge, then magenta; only the edges whose position the game still has (nothing is invented for the rest)
        const hl = this.g.hl, hw = (e: SimEdge) => (modeOf(e) === "rail" ? RAIL_WIDTH_T : ROAD_WIDTH)[TIER_OF[e.standard]];
        for (const id of a.hl.edges) {
          const e = sim.edges[id]; if (!e) continue; const pts = e.facility === "ferry" ? seaPath(w, sim.nodes[e.a].cell, sim.nodes[e.b].cell, isLakeFerry(e)) : edgeShape(w, sim, e), wdt = Math.max(4, hw(e)) * (zoom < 0.35 ? 0.8 : 1);
          // white halo, black edge, highlight body, white core: readable over roads of any colour, rail, sea and ground alike
          for (const l of HIGHLIGHT_LAYERS) { if (e.facility === "ferry") pat(hl, pts, [px(9), px(5)]); else line(hl, pts); hl.stroke({ width: px(wdt + l.extra), color: l.colour, alpha: e.facility === "ferry" ? 1 : l.alpha, cap: e.facility === "ferry" ? "butt" : "round", join: "round" }); }
        }
        if (a.hl.air) { for (const l of HIGHLIGHT_LAYERS.slice(0, 3)) { pat(hl, a.hl.air, [px(10), px(6)]); hl.stroke({ width: px(l.extra - 2), color: l.colour }); } }
      }
      const nodes = this.g.nodes;
      for (const n of Object.values(sim.nodes)) {
        if (n.kind === "pass" && showRoads && zoom >= 0.35) nodes.poly([n.pos[0], -n.pos[1] - px(6), n.pos[0] - px(5), -n.pos[1] + px(3), n.pos[0] + px(5), -n.pos[1] + px(3)]).fill({ color: 0xffffff }).stroke({ width: px(1), color: 0x222222 });
        else if (n.kind === "village" && zoom >= 0.5 && showRoads) nodes.circle(n.pos[0], -n.pos[1], px(2)).fill({ color: 0xf2e6c8 }).stroke({ width: px(0.8), color: 0x333333 });
      }
      if (sim.city12 && (a.layers.econ ?? true)) { this.drawCityEcon(sim, w, zoom, null, px, lite); if (sim.metro) this.drawCityCircles(sim, w, zoom, null, px, lite); }
      if (sim.stage3 && sim.hubs) this.drawHubs(a, sim, w, zoom, null, px, lite);
      else if ((a.layers.ports ?? true) && !lite && sim.stage3 && zoom >= 0.5) {
        // supporting modes (games from before Stage 8): a port (blue square) at coastal cities, an airport (white cross) once it has opened
        const yr = Number.POSITIVE_INFINITY;
        for (const c of w.cities) {
          const [x, y] = c.pos; if (c.coastal) nodes.rect(x + px(5), -y + px(3), px(6), px(6)).fill({ color: 0x2a7fd0 }).stroke({ width: px(1), color: 0xffffff });
          const ap = sim.cities[c.id]?.airport; if (ap !== undefined && ap <= yr) plane(nodes, x, y, px(1), 0xffffff);
        }
      }
      if (a.layers.signs && zoom >= 0.28) {
        for (const r of Object.values(sim.routes).sort((p, q) => GRADE_RANK[q.grade] - GRADE_RANK[p.grade] || p.number - q.number)) {
          const grade: Grade = r.grade, number: number = r.number, rail = GRADE_MODE[grade] === "rail";
          if (!r.active || count >= (lite ? 24 : 60) || (rail ? !showRail : !showRoads) || (zoom < 0.55 && grade !== "national" && grade !== "jnr") || (zoom < 1.1 && grade === "fu" && number !== 1) || (zoom < 0.8 && grade === "priv")) continue;
          const es = r.edges.map((x) => sim.edges[x.edgeId]).filter((e) => e && (e.state === "open" && e.built >= 1) && shapes.has(e.id)).sort((p, q) => q.lengthKm - p.lengthKm || (p.id < q.id ? -1 : 1)); if (!es.length) continue;
          const pts = shapes.get(es[0].id)!, m = pts[Math.floor(pts.length / 2)], sp = this.sign(count), c = sp.c; c.visible = true; c.position.set(m[0], -m[1]); c.scale.set(1 / zoom);
          const sg = sp.bg; sg.clear(); const nick = r.nick;
          if (rail) {
            const opId = r.op ?? "jnr", col = grade === "jnr" ? 0x0b2a55 : opColour(opId), nm = r.opName ?? "";
            sg.roundRect(-13, -8, 26, 16, 3).fill({ color: grade === "jnr" ? col : 0xffffff }).stroke({ width: 2.5, color: col });
            sp.t.text = String(number); sp.t.style.fontSize = 9; sp.t.style.fill = grade === "jnr" ? 0xffffff : col;
          } else {
            const col = grade === "national" ? 0xb02020 : grade === "fu" ? 0x7b3fa0 : 0x1f7a4d;
            if (grade === "national") sg.circle(0, 0, 11).fill({ color: col }).stroke({ width: 2, color: 0xffffff });
            else if (grade === "ken") sg.roundRect(-12, -9, 24, 18, 4).fill({ color: 0xffffff }).stroke({ width: 2.5, color: col });
            else sg.poly([0, -12, 12, -2, 7, 11, -7, 11, -12, -2]).fill({ color: 0xffffff }).stroke({ width: 2.5, color: col });
            sp.t.text = String(number); sp.t.style.fontSize = grade === "national" ? 10 : 9; sp.t.style.fill = grade === "national" ? 0xffffff : col;
          }
          // The number sign above is number-only and always follows the 標識 layer. The route-NAME text is a separate setting (a.names) and applies to every route alike:
          // national, prefectural, railway, and the roads and lines that were designated later by the simulation.
          sp.nk.visible = !!a.names; if (a.names) sp.nk.text = routeOfficial(r).replace(/^(.+?)\s/, "").slice(0, 16) + (nick ? NICK_SHORT[grade] : "");
          c.label = routeLabel(r); count++;
        }
      }
      void nickGrade;
    }
    for (let i = count; i < this.signs.length; i++) this.signs[i].c.visible = false;
    const ov = this.g.ov;
    for (const c of a.cer) {
      if (c.segs?.length) for (const sg of c.segs) { if (sg.pts.length < 2) continue; if (sg.ferry) pattern(ov, sg.pts, [px(8), px(6)]); else line(ov, sg.pts); ov.stroke({ width: px(sg.ferry ? 4 : 5), color: sg.ferry ? 0x2f9bff : c.ok ? 0x45e06f : 0xff5252, alpha: 0.85, cap: "round", join: "round" }); }
      else if (c.path && c.path.length > 1) { line(ov, c.path); ov.stroke({ width: px(5), color: c.ok ? 0x45e06f : 0xff5252, alpha: 0.8, cap: "round", join: "round" }); }
      if (c.strokes?.length) c.strokes.forEach((st, i) => { if (st.length < 2) return; line(ov, st); ov.stroke({ width: px(c.sel === i ? 4 : 2), color: c.sel === i ? 0xffd23a : 0xffffff, alpha: 0.95 }); });
      else if (c.pts.length > 1) { line(ov, c.pts); ov.stroke({ width: px(2), color: 0xffffff, alpha: 0.95 }); }
      if (c.handles && c.strokes) c.strokes.forEach((st, i) => { for (const q of st) ov.circle(q[0], -q[1], px(c.sel === i ? 5 : 4)).fill({ color: c.sel === i ? 0xffd23a : 0xffffff }).stroke({ width: px(1.5), color: 0x1b1b1b }); });
    }
    if (a.pin) { ov.circle(a.pin[0], -a.pin[1], px(7)).fill({ color: 0xff3b6b }).stroke({ width: px(2), color: 0xffffff }); }
  }
  clear() { this.last = null; this.sig = ""; for (const k of Object.keys(this.g)) this.g[k].clear(); for (const sg of this.signs) sg.c.visible = false; }
}
export type { SimEdge };
