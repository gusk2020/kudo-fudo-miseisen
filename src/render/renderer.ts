import { ROAD_LAND } from "./style24";
import { LAKE_LIST, buildBiwaIslands, buildLakeGraphics } from "./lakes";
import { WATER } from "./water";
import GMJ from "../data/coast-gmj.json";
import { gridBordersWithin, splitGmj } from "./gmBorders";
import { smoothLine, streamChains, streamKeep } from "./streams";
import { lonLatToReal } from "../core/data";
import { maxCapitalNames, placeNames } from "./cityNames";
import { Application, Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import { realToWorld, worldParts } from "../core/body";
import { BODY_DEFS, EXTRA, EXTRA_IDS, ISLAND_LABEL, JAPAN } from "../core/data";
import { palaceWorld, prefPoint, seatsOf } from "../core/seat";
import { featureWorldPos } from "../core/state";
import type { TerrainResult } from "../core/terrain";
import type { IslandId, Issue, Op, Place, ProjectState, Vec } from "../core/types";
import { ISLAND_IDS } from "../core/types";
import { featureWorld } from "../core/validate";
import { RoadLayer, type RoadArgs } from "./roads";

export interface Pending { body?: { id: IslandId; op?: Op; place?: Place }; ridge?: { key: "sw" | "ne"; pts: Vec[]; si?: number /* Stage 9: which stroke (0 = first, -1 = a new one) */ }; feature?: { which: "biwa" | "fuji"; pos: Vec; rot?: number; scale?: number; scaleY?: number; bad?: boolean } }
export interface View { cx: number; cy: number; zoom: number } // centre in world km (y up), zoom = px per km

const RAMP: [number, number[]][] = [[0, [92, 148, 76]], [150, [134, 170, 86]], [450, [196, 192, 112]], [900, [170, 136, 88]], [1600, [138, 108, 84]], [2400, [196, 190, 184]], [3400, [250, 250, 250]]];
function landColour(e: number): number[] {
  for (let i = 1; i < RAMP.length; i++) if (e <= RAMP[i][0]) { const [a, ca] = RAMP[i - 1], [b, cb] = RAMP[i], t = (e - a) / (b - a); return ca.map((v, k) => v + (cb[k] - v) * t); }
  return RAMP[RAMP.length - 1][1];
}
/** Stage 29: the "sea" layer as RGB per cell: a water cell its depth colour, and every other cell the colour of the NEAREST water cell (a breadth-first spread, `STEPS` cells deep; beyond that the shallow colour) -- so the water goes on past the grid's own coast
 * with no square block where a flat colour would meet depth-shaded sea. */
export function spreadSea(land: ArrayLike<number>, elev: ArrayLike<number>, nx: number, ny: number, steps = 6): Uint8ClampedArray {
  const out = new Uint8ClampedArray(nx * ny * 3), done = new Uint8Array(nx * ny); let q: number[] = [];
  for (let k = 0; k < nx * ny; k++) if (land[k] === 0) { const d = Math.min(1, -elev[k] / 600); out[3 * k] = 40 - 22 * d; out[3 * k + 1] = 110 - 50 * d; out[3 * k + 2] = 160 - 55 * d; done[k] = 1; q.push(k); }
  for (let step = 0; step < steps && q.length; step++) { const nq: number[] = []; for (const k of q) { const i = k % nx, j = (k / nx) | 0; for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue; const m = jj * nx + ii; if (done[m]) continue; done[m] = 1; out[3 * m] = out[3 * k]; out[3 * m + 1] = out[3 * k + 1]; out[3 * m + 2] = out[3 * k + 2]; nq.push(m); } } q = nq; }
  for (let k = 0; k < nx * ny; k++) if (!done[k]) { out[3 * k] = 40; out[3 * k + 1] = 110; out[3 * k + 2] = 160; }
  return out;
}
/** `part`: "all" is the whole picture; on the real map the coastline is the 地球地図's polygons, so the picture is drawn in two layers -- "sea" (every cell the water colour where it is not water in the grid, so no land colour spills past a coastline) under the polygons' flat land, and "land" (water cells transparent) on top, clipped to the polygons. */
export function terrainCanvas(t: TerrainResult, part: "all" | "sea" | "land" = "all"): HTMLCanvasElement {
  const { nx, ny, cell } = t.grid, c = document.createElement("canvas"); c.width = nx; c.height = ny;
  const g = c.getContext("2d")!, img = g.createImageData(nx, ny), seaCol = (k: number) => { const d = Math.min(1, -t.elev[k] / 600); return [40 - 22 * d, 110 - 50 * d, 160 - 55 * d]; };
  // Stage 29: under the polygons' land the "sea" layer must be SEA everywhere. A land cell used to take one flat shallow colour, which sat beside depth-shaded sea cells as a square block; it now takes the colour
  // of the nearest sea cell (a breadth-first spread, a few cells deep: the polygons cover the rest), so the water goes on past the grid's own coast without a seam.
  const spread = part === "sea" ? spreadSea(t.land, t.elev, nx, ny) : null;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i, o = ((ny - 1 - j) * nx + i) * 4; let col: ArrayLike<number>;
    if (t.land[k] === 0) { if (part === "land") continue; col = seaCol(k); }
    else if (part === "sea") col = [spread![3 * k], spread![3 * k + 1], spread![3 * k + 2]];
    else if (t.land[k] === 2 && part === "all") col = [70, 130, 190];   // (on the real map a lake is drawn from its own outline, so its cells are ordinary ground in the land layer)
    else {
      const e = t.elev[k], gx = (t.elev[j * nx + Math.min(nx - 1, i + 1)] - t.elev[j * nx + Math.max(0, i - 1)]) / (2 * cell * 1000);
      const gy = (t.elev[Math.min(ny - 1, j + 1) * nx + i] - t.elev[Math.max(0, j - 1) * nx + i]) / (2 * cell * 1000);
      const shade = Math.max(0.6, Math.min(1.35, 1 + 5 * (-gx * 0.7 + gy * 0.7))); // light from the north-west
      col = landColour(e).map((v) => Math.min(255, v * shade));
    }
    img.data[o] = col[0]; img.data[o + 1] = col[1]; img.data[o + 2] = col[2]; img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0); return c;
}

export class Renderer {
  app!: Application;
  view: View = { cx: 0, cy: 0, zoom: 0.3 };
  capitalsOnly = true;
  /** Stage 19: a seat point chosen on the map and not yet confirmed (a crosshair) */
  seatPending: Vec | null = null;
  /** Stage 24: after 2200 the seats are the game's (sim.capital ...), not the map state's: where the three markers stand (null = as the map state says). */
  seatOverride: { capital: Vec | null; sub: Vec | null; palace: Vec | null } | null = null;
  /** Stage 20: the small islands (drawn as ellipses of their real size, at least a few pixels wide so the tiniest can be seen and tapped) */
  /** Stage 22: the 県庁所在地 of the game's world (moved ones included), most important first; the base map names these, without overlaps */
  baseNames: { name: string; p: Vec }[] | null = null;
  islets: { pos: Vec; len: number; wid: number; bear: number; name: string; claim: boolean; shaped?: boolean; tiny?: boolean }[] | null = null;
  /** Stage 22: the real-map coastline of 地球地図日本 (drawn once, reused; the 5 km grid underneath keeps the simulation's own land) */
  private gm: { fill: Graphics; mask: Graphics; coast: Graphics; border: Graphics; bg: string } | null = null;
  private gmSplit = splitGmj(GMJ.polys as unknown as number[][]);
  private root = new Container(); private base = new Container(); private overlay = new Container(); private labels = new Container();
  /** Stage 9: show the points of the drawn ranges (while a range tool is in use), so they can be grabbed and moved. */
  ridgeHandles = false;
  roads = new RoadLayer(); private roadArgs: RoadArgs | null = null;
  private lakeG: ReturnType<typeof buildLakeGraphics> | null = null; private biwaIsl: Graphics | null = null; private biwaIslBg = ""; private landSprite: Sprite | null = null; private terrainSprite: Sprite | null = null; private terrainRef: TerrainResult | null = null;
  private lastArgs: [ProjectState, TerrainResult | null, Issue[], Pending | null] | null = null;
  private rebuildTimer: any = 0;
  /** Background map: shaded terrain, or a plain road-map style (flat land, no relief) that keeps the network readable. */
  bg: "terrain" | "roadmap" = "terrain";
  setBg(bg: "terrain" | "roadmap") { if (bg === this.bg) return; this.bg = bg; this.app.renderer.background.color = bg === "roadmap" ? 0xcfe3ee : 0x123c69; this.rebuild(); }
  onViewChange: (() => void) | null = null; onContextLost: (() => void) | null = null; onContextRestored: (() => void) | null = null;

  static async create(host: HTMLElement): Promise<Renderer> {
    const r = new Renderer();
    r.app = new Application();
    await r.app.init({ resizeTo: host, background: 0x123c69, antialias: false, resolution: Math.min(window.devicePixelRatio || 1, 2), autoDensity: true });
    host.appendChild(r.app.canvas);
    r.app.canvas.style.touchAction = "none";
    r.app.canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); r.onContextLost?.(); });
    r.app.canvas.addEventListener("webglcontextrestored", () => { r.roads.redraw(r.view.zoom); r.onContextRestored?.(); });
    r.root.addChild(r.base, r.overlay, r.roads.container, r.labels); r.app.stage.addChild(r.root);
    r.app.renderer.on("resize", () => r.applyView());
    return r;
  }
  get size() { return { w: this.app.screen.width, h: this.app.screen.height }; }
  screenToWorld(sx: number, sy: number): Vec { const { w, h } = this.size, z = this.view.zoom; return [this.view.cx + (sx - w / 2) / z, this.view.cy - (sy - h / 2) / z]; }
  worldToScreen(p: Vec): Vec { const { w, h } = this.size, z = this.view.zoom; return [(p[0] - this.view.cx) * z + w / 2, -(p[1] - this.view.cy) * z + h / 2]; }
  setView(v: Partial<View>, quiet = false) {
    Object.assign(this.view, v); this.view.zoom = Math.max(0.05, Math.min(12, this.view.zoom));
    this.applyView();
    if (!quiet) { this.onViewChange?.(); clearTimeout(this.rebuildTimer); this.rebuildTimer = setTimeout(() => { this.rebuild(); this.roads.redraw(this.view.zoom); }, 140); }
  }
  private applyView() {
    const { w, h } = this.size, z = this.view.zoom;
    this.root.scale.set(z); this.root.position.set(w / 2 - this.view.cx * z, h / 2 + this.view.cy * z);
  }
  fit(s: ProjectState) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const id of ISLAND_IDS) for (const p of worldParts(id, s.bodies[id])) for (const q of p) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); }
    const { w, h } = this.size;
    this.setView({ cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, zoom: Math.min(w / (x1 - x0 + 120), h / (y1 - y0 + 120)) }, true);
    this.rebuild();
  }
  /** Road layer only: cheap enough to call every simulation tick; skips redraw when nothing visible changed. */
  setRoads(a: RoadArgs) { this.roadArgs = a; return this.roads.set(a, this.view.zoom); }
  /** The feature being edited by touch (null = none): drawn with a handle. */
  featureSel: "biwa" | "fuji" | null = null;
  /** Stage 30A: the mountain range being edited -- its crest line and core half-width (world km); drawn with the same yellow outline as Fuji and Biwa */
  rangeSel: { pts: Vec[]; core: number } | null = null;
  /** Stage 11: the stroke of a range picked with the 区間 tool (drawn highlighted). */
  ridgeSel: { key: "sw" | "ne"; si: number } | null = null;
  /** How many range strokes the last redraw put on the map (0 on the road map; for tests). */
  ridgeStrokesDrawn = 0;
  private withPending(s: ProjectState, pending: Pending | null, which: "biwa" | "fuji"): ProjectState {
    const f = pending?.feature; if (!f || f.which !== which) return s;
    return { ...s, features: { ...s.features, [which]: { ...s.features[which], pos: f.pos, ...(f.rot !== undefined ? { rot: f.rot } : {}), ...(f.scale !== undefined ? { scale: f.scale } : {}), ...(f.scaleY !== undefined ? { scaleY: f.scaleY } : { scaleY: undefined }) } } };
  }
  update(s: ProjectState, t: TerrainResult | null, issues: Issue[], pending: Pending | null) { this.lastArgs = [s, t, issues, pending]; this.rebuild(); }
  private rebuild() {
    if (!this.lastArgs) return;
    const [s, t, issues, pending] = this.lastArgs, z = this.view.zoom, px = (n: number) => n / z;
    if (this.landSprite?.parent) this.landSprite.parent.removeChild(this.landSprite); if (this.terrainSprite?.parent) this.terrainSprite.parent.removeChild(this.terrainSprite); // reused across rebuilds, destroyed only with its terrain
    if (this.lakeG) { this.lakeG.big.parent?.removeChild(this.lakeG.big); this.lakeG.small.parent?.removeChild(this.lakeG.small); }
    this.biwaIsl?.parent?.removeChild(this.biwaIsl);   // (built once, kept across rebuilds)
    if (this.gm) { this.gm.fill.parent?.removeChild(this.gm.fill); this.gm.mask.parent?.removeChild(this.gm.mask); this.gm.coast.parent?.removeChild(this.gm.coast); this.gm.border.parent?.removeChild(this.gm.border); }
    this.base.removeChildren().forEach((c) => c.destroy({ children: true, context: true })); this.overlay.removeChildren().forEach((c) => c.destroy({ children: true, context: true })); this.labels.removeChildren().forEach((c) => c.destroy());
    const P = (v: Vec): [number, number] => [v[0], -v[1]];
    const flat = (poly: Vec[]) => poly.flatMap((q) => P(q));
    const bad = new Set<string>();
    for (const i of issues) if (i.severity === "error") for (const id of ISLAND_IDS) if (i.code.split(".").includes(id)) bad.add(id);
    const showTerrain = !!t && s.step >= 4;
    // terrain raster (or flat land)
    if (showTerrain && t) {
      const two = !!s.real;   // Stage 28: on the real map the polygons decide what is land (see terrainCanvas)
      if (this.terrainRef !== t) { this.terrainSprite?.destroy(true); this.landSprite?.destroy(true); this.terrainSprite = new Sprite(Texture.from(terrainCanvas(t, two ? "sea" : "all"))); this.landSprite = two ? new Sprite(Texture.from(terrainCanvas(t, "land"))) : null; this.terrainRef = t; }
      const sp = this.terrainSprite!, g = t.grid;
      sp.position.set(g.x0, -(g.y0 + g.ny * g.cell)); sp.scale.set(g.cell);
      sp.visible = s.layers.elevation && this.bg === "terrain"; if (sp.parent !== this.base) this.base.addChild(sp);
      if (this.landSprite) { this.landSprite.position.copyFrom(sp.position); this.landSprite.scale.copyFrom(sp.scale); this.landSprite.visible = sp.visible; }
    } else { this.terrainSprite?.destroy(true); this.terrainSprite = null; this.landSprite?.destroy(true); this.landSprite = null; this.terrainRef = null; }
    const landFlat = !(showTerrain && s.layers.elevation && this.bg === "terrain");
    const coast = new Graphics(), fills = new Graphics();
    const gmOn = !!s.real;   // Stage 22: on the real map the coastline is 地球地図日本's (the mainland, the added islands and the islets alike)
    if (gmOn) {
      const bgKey = `${this.bg}:${landFlat}`; if (!this.gm || this.gm.bg !== bgKey) { this.gm?.fill.destroy(); this.gm?.mask.destroy(); this.gm?.coast.destroy(); this.gm?.border.destroy(); const f = new Graphics(), c = new Graphics(), m = new Graphics(); for (const p of GMJ.polys) { const pts: number[] = []; for (let i = 0; i < p.length; i += 2) { const q = lonLatToReal(p[i] / 1000, p[i + 1] / 1000); pts.push(q[0], -q[1]); } if (landFlat) f.poly(pts).fill({ color: this.bg === "roadmap" ? ROAD_LAND : 0xbfd18d }); else f.poly(pts).fill({ color: 0x93b266 }); m.poly(pts).fill({ color: 0xffffff }); } const seg = (g: Graphics, a: number[]) => { for (let i = 0; i < a.length; i += 4) { const p = lonLatToReal(a[i] / 1000, a[i + 1] / 1000), q = lonLatToReal(a[i + 2] / 1000, a[i + 3] / 1000); g.moveTo(p[0], -p[1]).lineTo(q[0], -q[1]); } }, bd = new Graphics(); seg(c, this.gmSplit.coast); c.stroke({ width: 1, color: 0x2c3e1f, pixelLine: true }); seg(bd, this.gmSplit.border); bd.stroke({ width: 1, color: 0x5b1f6e, alpha: 0.9, pixelLine: true }); /* the same polygons are the mask of the relief and of the rivers */ this.gm = { fill: f, mask: m, coast: c, border: bd, bg: bgKey }; }
      this.base.addChild(this.gm.fill);
      this.base.addChild(this.gm.mask);
      if (!landFlat && this.landSprite) { this.landSprite.mask = this.gm.mask; this.base.addChild(this.landSprite); }   // (the polygons' flat land, then the relief inside them)
    }
    for (const id of gmOn ? [] : ISLAND_IDS) {
      const bp = pending?.body?.id === id ? worldParts(id, { ops: s.bodies[id].ops, place: pending.body.place ?? s.bodies[id].place }, pending.body.op) : worldParts(id, s.bodies[id]);
      for (const poly of bp) {
        if (landFlat) fills.poly(flat(poly)).fill({ color: bad.has(id) ? 0xd89090 : this.bg === "roadmap" ? ROAD_LAND : 0xbfd18d });
        if (s.layers.coast) coast.poly(flat(poly)).stroke({ width: px(bad.has(id) ? 3 : 1.4), color: bad.has(id) ? 0xd22 : 0x2c3e1f });
      }
    }
    if (s.islands && !gmOn) for (const id of EXTRA_IDS) for (const poly of EXTRA.islands[id].parts) {   // the added islands (world = real km; never deformed)
      if (landFlat) fills.poly(flat(poly)).fill({ color: this.bg === "roadmap" ? ROAD_LAND : 0xbfd18d });
      if (s.layers.coast) coast.poly(flat(poly)).stroke({ width: px(1.4), color: 0x2c3e1f });
    }
    if (this.islets) for (const o of this.islets) {   // Stage 20 / 22: the island's own outline is in the coastline above; a speck too small to see gets a small dot (never a made-up shape); one with no outline in the data, a dot too
      if (!o.shaped || o.tiny || !gmOn) { const r = px(2.6); fills.circle(o.pos[0], -o.pos[1], r).fill({ color: this.bg === "roadmap" ? ROAD_LAND : 0xbfd18d }); coast.circle(o.pos[0], -o.pos[1], r).stroke({ width: px(1.2), color: o.claim ? 0x8a3b1f : 0x2c3e1f }); }
      if (z > 0.9 || (z > 0.45 && o.len >= 12)) { const tx = new Text({ text: o.name, style: { fontSize: 10, fill: 0x111111, stroke: { color: 0xffffff, width: 3 } } }); tx.scale.set(1 / z); tx.position.set(o.pos[0] + px(6), -o.pos[1] - px(5)); this.labels.addChild(tx); }
    }
    this.base.addChild(fills);
    // lakes & features
    const lakes = new Graphics();
    const showFeat = s.step >= 3 || s.layers.lakes;
    if (showFeat && s.layers.lakes) { const pw = this.withPending(s, pending, "biwa"); lakes.poly(flat(featureWorld(pw, "biwa"))).fill({ color: WATER.lake }).stroke({ width: px(1), color: WATER.shore }); }
    // Stage 29: the other lakes of the real map (brackish ones included) from their own outlines, under the map's 琵琶湖; the islands of 琵琶湖 stand on it as land while that feature is where it began
    if (gmOn && LAKE_LIST.length && s.layers.lakes) {
      this.lakeG ??= buildLakeGraphics(); this.lakeG.small.visible = z >= 0.6; this.base.addChild(this.lakeG.big); this.base.addChild(this.lakeG.small);
    }
    this.base.addChild(lakes);
    if (gmOn && LAKE_LIST.length && s.layers.lakes && this.biwaUnmoved(s)) { if (this.biwaIsl && this.biwaIslBg !== this.bg) { this.biwaIsl.destroy(); this.biwaIsl = null; } this.biwaIslBg = this.bg; this.biwaIsl ??= buildBiwaIslands(this.bg === "roadmap" ? ROAD_LAND : 0x93b266, featureWorld(s, "biwa") as unknown as [number, number][]); this.base.addChild(this.biwaIsl); }
    if (showTerrain && t) this.drawHydro(t, s, px);
    if (gmOn && this.gm && s.layers.coast) this.base.addChild(this.gm.coast);
    if (gmOn && this.gm && s.layers.borders) this.base.addChild(this.gm.border);   // Stage 26: the real prefecture borders, once
    this.base.addChild(coast);
    // fuji marker
    if (s.step >= 3 || s.step === 0) {
      const f = new Graphics(), pf = this.withPending(s, pending, "fuji");
      f.poly(flat(featureWorld(pf, "fuji"))).stroke({ width: px(1.5), color: 0xffffff, alpha: 0.9 }).fill({ color: 0xffffff, alpha: s.step >= 3 ? 0.25 : 0 });
      const c = P(featureWorldPos(pf, "fuji")); f.poly([c[0], c[1] - px(9), c[0] - px(8), c[1] + px(6), c[0] + px(8), c[1] + px(6)]).fill({ color: 0xc8483a }).stroke({ width: px(1), color: 0xffffff });
      this.overlay.addChild(f);
    }
    if (this.featureSel && (s.step >= 3 || s.real)) {   // Issue #18: the handle -- an outline round the feature being edited, a centre dot and a rotation knob
      const ps = this.withPending(s, pending, this.featureSel), h = new Graphics(), bad = pending?.feature?.which === this.featureSel && pending.feature.bad, col = bad ? 0xe03030 : 0xffd400;
      const poly = featureWorld(ps, this.featureSel), c = P(featureWorldPos(ps, this.featureSel)), kn = P([featureWorldPos(ps, this.featureSel)[0] + Math.cos(ps.features[this.featureSel].rot) * Math.max(...poly.map((q) => Math.hypot(q[0] - featureWorldPos(ps, this.featureSel!)[0], q[1] - featureWorldPos(ps, this.featureSel!)[1]))) * 1.0, featureWorldPos(ps, this.featureSel)[1] + Math.sin(ps.features[this.featureSel].rot) * Math.max(...poly.map((q) => Math.hypot(q[0] - featureWorldPos(ps, this.featureSel!)[0], q[1] - featureWorldPos(ps, this.featureSel!)[1]))) * 1.0]);
      h.poly(flat(poly)).stroke({ width: px(2.5), color: col, alpha: 0.95 });
      h.moveTo(c[0], c[1]).lineTo(kn[0], kn[1]).stroke({ width: px(1.5), color: col }); h.circle(kn[0], kn[1], px(6)).fill({ color: col }).stroke({ width: px(1), color: 0x333333 });
      h.circle(c[0], c[1], px(8)).stroke({ width: px(2.5), color: col }).fill({ color: 0xffffff, alpha: 0.5 });
      this.overlay.addChild(h);
    }
    if (this.rangeSel && this.rangeSel.pts.length > 1) {   // Stage 30A: the selected range -- a yellow band as wide as its core (never thinner than a fingertip) with a solid crest line and edge lines, like Fuji's / Biwa's outline
      const rs = this.rangeSel, h = new Graphics(), cl = rs.pts.map(P), wd = 2 * Math.max(rs.core, px(11));
      const path = () => { h.moveTo(cl[0][0], cl[0][1]); for (const q of cl.slice(1)) h.lineTo(q[0], q[1]); };
      path(); h.stroke({ width: wd + px(5), color: 0xffd400, alpha: 0.95, cap: "round", join: "round" });
      path(); h.stroke({ width: wd, color: 0xfff3a0, alpha: 0.55, cap: "round", join: "round" });
      path(); h.stroke({ width: px(1.5), color: 0xc89b00 });
      this.overlay.addChild(h);
    }
    // Stage 11: the drawn ranges (lines, handles) belong to the terrain map: the road map does not show them (the barrier they make is still there in the simulation)
    this.ridgeStrokesDrawn = 0;
    if (s.layers.ridges && this.bg === "terrain") {
      const rg = new Graphics();
      for (const key of ["sw", "ne"] as const) {
        // Stage 9: every stroke of the range; the one being drawn or edited is shown as it is now
        const lines: (Vec[] | null)[] = [s.ridges[key], ...(s.ridgeExtra?.[key] ?? [])], pr = pending?.ridge?.key === key ? pending.ridge : null;
        if (pr) { const si = pr.si ?? (s.ridges[key] ? -1 : 0); if (si >= 0) lines[si] = pr.pts; else lines.push(pr.pts); }
        lines.forEach((line, li) => {
          if (line && line.length > 1) { this.ridgeStrokesDrawn++; const sel = this.ridgeSel?.key === key && this.ridgeSel.si === li; rg.moveTo(...P(line[0])); for (const q of line.slice(1)) rg.lineTo(...P(q)); rg.stroke({ width: px(sel ? 8 : 5), color: sel ? 0xffc400 : key === "sw" ? 0x7a4a2a : 0x8a3a5a, alpha: sel ? 0.95 : 0.85, cap: "round", join: "round" }); }
          if (line && (s.step === 3 || this.ridgeHandles)) line.forEach((q, i) => { const end = this.ridgeHandles && (i === 0 || i === line.length - 1); rg.circle(...P(q), px(end ? 8 : 4.5)).fill({ color: end ? 0xffe14a : 0xffffff }).stroke({ width: px(end ? 2 : 1), color: 0x333333 }); });   // Stage 9: the ends (where a stroke can be continued) are big and yellow
        });
      }
      this.overlay.addChild(rg);
    }
    if (s.layers.cities) this.drawCities(s, t, showTerrain, px); this.drawSeats(s, t, px);
  }
  private keepOf: { t: TerrainResult; keep: boolean[] } | null = null; private chainsOf: { t: TerrainResult; chains: { pts: number[]; w: number }[] } | null = null;
  private hokb: { t: TerrainResult; a: number[] } | null = null;
  private hokkaidoBorders(t: TerrainResult): number[] {
    if (this.hokb?.t !== t) { const hk = new Set<number>(); JAPAN.prefectures.forEach((p, n) => { if (p.id.startsWith("HK-")) hk.add(n + 1); }); this.hokb = { t, a: gridBordersWithin(t.grid, t.land, t.pref, (n) => hk.has(n)) }; }
    return this.hokb.a;
  }
  /** 琵琶湖 stands where the real lake is (so its islands from the data are in the right place). */
  private biwaUnmoved(s: ProjectState): boolean { const b = LAKE_LIST.find((l) => l.name === "琵琶湖"); if (!b) return false; const f = s.features.biwa, c = featureWorldPos(s, "biwa"); let x = 0, y = 0; for (const [lo, la] of b.outer) { const q = lonLatToReal(lo / 1e4, la / 1e4); x += q[0]; y += q[1]; } x /= b.outer.length; y /= b.outer.length; return Math.hypot(c[0] - x, c[1] - y) < 5 && !f.scale && !f.scaleY && Math.abs(f.rot) < 1e-6; }
  private drawHydro(t: TerrainResult, s: ProjectState, px: (n: number) => number) {
    if (s.layers.rivers) {
      const buckets: Graphics[] = [new Graphics(), new Graphics(), new Graphics()];
      if (this.keepOf?.t !== t) this.keepOf = { t, keep: streamKeep(t.streams) };
      // Stage 29: the pieces are joined into lines and drawn as smooth curves (a stair of 5 km steps read as an unnatural river); a stream fragment that connects to nothing is still not drawn (Stage 26)
      if (this.chainsOf?.t !== t) this.chainsOf = { t, chains: streamChains(t.streams, this.keepOf.keep).map((c) => ({ pts: smoothLine(c.pts), w: c.w })) };
      for (const c of this.chainsOf.chains) {
        const b = buckets[c.w < 1.5 ? 0 : c.w < 3 ? 1 : 2]; b.moveTo(c.pts[0], -c.pts[1]); for (let i = 2; i < c.pts.length; i += 2) b.lineTo(c.pts[i], -c.pts[i + 1]);
      }
      const minBucket = this.view.zoom < 0.35 ? 2 : this.view.zoom < 0.8 ? 1 : 0;   // national view: only the big rivers
      buckets.forEach((b, n) => { if (n < minBucket) { b.destroy(); return; } b.stroke({ width: px(1 + n * 1.1), color: WATER.river, alpha: 0.95, cap: "round", join: "round" }); if (s.real && this.gm) b.mask = this.gm.mask; this.base.addChild(b); });
    }
    if (s.layers.borders) {
      const g = new Graphics(), a = s.real ? this.hokkaidoBorders(t) : t.borders;   // Stage 26: on the real map the borders are 地球地図日本's (drawn with the coast layer above); the grid's stair-steps only where the data has none
      for (let i = 0; i < a.length; i += 4) g.moveTo(a[i], -a[i + 1]).lineTo(a[i + 2], -a[i + 3]);
      g.stroke({ width: px(1.1), color: 0x5b1f6e, alpha: 0.9, cap: "round" }); this.base.addChild(g);
    }
  }
  /** 首都・副首都・皇居: three independent markers (a red star, a blue star, a gold diamond), always shown, each with its name. */
  private drawSeats(s: ProjectState, t: TerrainResult | null, px: (n: number) => number) {
    if (!s.real) return; const seats = seatsOf(s), g = new Graphics(), z = this.view.zoom;
    const at = (pref: string): Vec | null => { const c = t?.cities.find((x) => x.pref === pref && x.kind === "capital"); return c ? c.pos : prefPoint(s, pref); };
    const star = (p: Vec, col: number, r: number) => { const pts: number[] = []; for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.45 : r; pts.push(p[0] + Math.cos(a) * rr, -p[1] + Math.sin(a) * rr); } g.poly(pts).fill({ color: col }).stroke({ width: px(1.2), color: 0xffffff }); };
    const label = (p: Vec, text: string, dy: number) => { const tx = new Text({ text, style: { fontSize: 11, fontWeight: "700", fill: 0x111111, stroke: { color: 0xffffff, width: 3 } } }); tx.scale.set(1 / z); tx.position.set(p[0] + px(10), -p[1] + px(dy)); this.labels.addChild(tx); };
    const ov = this.seatOverride, cp = ov ? ov.capital : s.capitalPos ?? at(seats.capital), sp = ov ? ov.sub : s.subPos ?? at(seats.sub), pp = ov ? ov.palace : s.palacePos ?? at(seats.palace);
    if (this.seatPending) { const q = this.seatPending, r = px(11); g.circle(q[0], -q[1], r).stroke({ width: px(2), color: 0xff7a00 }); g.moveTo(q[0] - r * 1.6, -q[1]).lineTo(q[0] + r * 1.6, -q[1]).moveTo(q[0], -q[1] - r * 1.6).lineTo(q[0], -q[1] + r * 1.6).stroke({ width: px(2), color: 0xff7a00 }); label(q, "候補", 6); }
    if (cp) { star(cp, 0xd62828, px(10)); label(cp, "首都", -14); }
    if (sp) { star(sp, 0x1f6fd0, px(9)); label(sp, "副首都", -14); }
    if (pp) { const r = px(7); g.poly([pp[0], -pp[1] - r, pp[0] + r, -pp[1], pp[0], -pp[1] + r, pp[0] - r, -pp[1]]).fill({ color: 0xf2c200 }).stroke({ width: px(1.4), color: 0x5a3b00 }); label(pp, "皇居", 2); }
    this.overlay.addChild(g);
  }
  private drawCities(s: ProjectState, t: TerrainResult | null, showTerrain: boolean, px: (n: number) => number) {
    const g = new Graphics(), z = this.view.zoom;
    let list: { name: string; p: Vec; cap: boolean }[];
    // Stage 18: the base map names the 49 prefectural capitals and nothing else (the other places of the data -- Kawasaki, Himeji ... -- are named only once the game has grown them into cities, by the road layer)
    const only = this.capitalsOnly;   // (games from before Stage 17 keep every city dot and name on the base map)
    if (showTerrain && t) list = t.cities.filter((c) => !only || c.kind === "capital").map((c) => ({ name: c.name, p: c.pos, cap: c.kind === "capital" }));
    else list = JAPAN.cities.filter((c) => !only || c.kind === "capital").map((c) => { const id = (c.island === "okinawa" ? "kyushu" : c.island) as IslandId; return { name: c.name, p: realToWorld(id, s.bodies[id], c.pos), cap: c.kind === "capital" }; });
    if (only && this.baseNames) {   // Stage 22: the world's own capitals, named by priority with no overlaps
      const bl = this.baseNames; for (const c of bl) g.circle(c.p[0], -c.p[1], px(3.2)).fill({ color: 0xffd23a }).stroke({ width: px(1), color: 0x222222 });
      for (const q of placeNames(bl.map((c) => ({ x: c.p[0] * z, y: -c.p[1] * z, rad: 3.2, name: c.name, seat: false })), [], z, maxCapitalNames(z))) { const tx = new Text({ text: bl[q.i].name, style: { fontSize: 12, fill: 0x111111, stroke: { color: 0xffffff, width: 3 } } }); tx.scale.set(1 / z); tx.position.set(q.x / z, q.y / z); this.labels.addChild(tx); }
      this.overlay.addChild(g); return;
    }
    for (const c of list) {
      g.circle(c.p[0], -c.p[1], px(c.cap ? 3.2 : 2.4)).fill({ color: c.cap ? 0xffd23a : 0xffffff }).stroke({ width: px(1), color: 0x222222 });
      if (z > 0.55 && (c.cap || z > 1.1)) {
        const tx = new Text({ text: c.name, style: { fontSize: 12, fill: 0x111111, stroke: { color: 0xffffff, width: 3 } } });
        tx.scale.set(1 / z); tx.position.set(c.p[0] + px(5), -c.p[1] - px(6)); this.labels.addChild(tx);
      }
    }
    this.overlay.addChild(g);
  }
}
export { BODY_DEFS, ISLAND_LABEL };
