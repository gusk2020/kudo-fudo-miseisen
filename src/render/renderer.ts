import { Application, Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import { realToWorld, worldParts } from "../core/body";
import { BODY_DEFS, ISLAND_LABEL, JAPAN } from "../core/data";
import { featureWorldPos } from "../core/state";
import type { TerrainResult } from "../core/terrain";
import type { IslandId, Issue, Op, Place, ProjectState, Vec } from "../core/types";
import { ISLAND_IDS } from "../core/types";
import { featureWorld } from "../core/validate";
import { RoadLayer, type RoadArgs } from "./roads";

export interface Pending { body?: { id: IslandId; op?: Op; place?: Place }; ridge?: { key: "sw" | "ne"; pts: Vec[] }; feature?: { which: "biwa" | "fuji"; pos: Vec } }
export interface View { cx: number; cy: number; zoom: number } // centre in world km (y up), zoom = px per km

const RAMP: [number, number[]][] = [[0, [92, 148, 76]], [150, [134, 170, 86]], [450, [196, 192, 112]], [900, [170, 136, 88]], [1600, [138, 108, 84]], [2400, [196, 190, 184]], [3400, [250, 250, 250]]];
function landColour(e: number): number[] {
  for (let i = 1; i < RAMP.length; i++) if (e <= RAMP[i][0]) { const [a, ca] = RAMP[i - 1], [b, cb] = RAMP[i], t = (e - a) / (b - a); return ca.map((v, k) => v + (cb[k] - v) * t); }
  return RAMP[RAMP.length - 1][1];
}
export function terrainCanvas(t: TerrainResult): HTMLCanvasElement {
  const { nx, ny, cell } = t.grid, c = document.createElement("canvas"); c.width = nx; c.height = ny;
  const g = c.getContext("2d")!, img = g.createImageData(nx, ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i, o = ((ny - 1 - j) * nx + i) * 4; let col: number[];
    if (t.land[k] === 0) { const d = Math.min(1, -t.elev[k] / 600); col = [40 - 22 * d, 110 - 50 * d, 160 - 55 * d]; }
    else if (t.land[k] === 2) col = [70, 130, 190];
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
  private root = new Container(); private base = new Container(); private overlay = new Container(); private labels = new Container();
  roads = new RoadLayer(); private roadArgs: RoadArgs | null = null;
  private terrainSprite: Sprite | null = null; private terrainRef: TerrainResult | null = null;
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
  update(s: ProjectState, t: TerrainResult | null, issues: Issue[], pending: Pending | null) { this.lastArgs = [s, t, issues, pending]; this.rebuild(); }
  private rebuild() {
    if (!this.lastArgs) return;
    const [s, t, issues, pending] = this.lastArgs, z = this.view.zoom, px = (n: number) => n / z;
    if (this.terrainSprite?.parent) this.terrainSprite.parent.removeChild(this.terrainSprite); // reused across rebuilds, destroyed only with its terrain
    this.base.removeChildren().forEach((c) => c.destroy({ children: true, context: true })); this.overlay.removeChildren().forEach((c) => c.destroy({ children: true, context: true })); this.labels.removeChildren().forEach((c) => c.destroy());
    const P = (v: Vec): [number, number] => [v[0], -v[1]];
    const flat = (poly: Vec[]) => poly.flatMap((q) => P(q));
    const bad = new Set<string>();
    for (const i of issues) if (i.severity === "error") for (const id of ISLAND_IDS) if (i.code.split(".").includes(id)) bad.add(id);
    const showTerrain = !!t && s.step >= 4;
    // terrain raster (or flat land)
    if (showTerrain && t) {
      if (this.terrainRef !== t) { this.terrainSprite?.destroy(true); this.terrainSprite = new Sprite(Texture.from(terrainCanvas(t))); this.terrainRef = t; }
      const sp = this.terrainSprite!, g = t.grid;
      sp.position.set(g.x0, -(g.y0 + g.ny * g.cell)); sp.scale.set(g.cell);
      sp.visible = s.layers.elevation && this.bg === "terrain"; if (sp.parent !== this.base) this.base.addChild(sp);
    } else { this.terrainSprite?.destroy(true); this.terrainSprite = null; this.terrainRef = null; }
    const landFlat = !(showTerrain && s.layers.elevation && this.bg === "terrain");
    const coast = new Graphics(), fills = new Graphics();
    for (const id of ISLAND_IDS) {
      const bp = pending?.body?.id === id ? worldParts(id, { ops: s.bodies[id].ops, place: pending.body.place ?? s.bodies[id].place }, pending.body.op) : worldParts(id, s.bodies[id]);
      for (const poly of bp) {
        if (landFlat) fills.poly(flat(poly)).fill({ color: bad.has(id) ? 0xd89090 : this.bg === "roadmap" ? 0xf3efe4 : 0xbfd18d });
        if (s.layers.coast) coast.poly(flat(poly)).stroke({ width: px(bad.has(id) ? 3 : 1.4), color: bad.has(id) ? 0xd22 : 0x2c3e1f });
      }
    }
    this.base.addChild(fills);
    // lakes & features
    const lakes = new Graphics();
    const showFeat = s.step >= 3 || s.layers.lakes;
    if (showFeat && s.layers.lakes) { const pw = pending?.feature?.which === "biwa" ? { ...s, features: { ...s.features, biwa: { ...s.features.biwa, pos: pending.feature.pos } } } : s; lakes.poly(flat(featureWorld(pw, "biwa"))).fill({ color: 0x4682c8 }).stroke({ width: px(1), color: 0x1d4f8a }); }
    this.base.addChild(lakes);
    if (showTerrain && t) this.drawHydro(t, s, px);
    this.base.addChild(coast);
    // fuji marker
    if (s.step >= 3 || s.step === 0) {
      const f = new Graphics(), pf = pending?.feature?.which === "fuji" ? { ...s, features: { ...s.features, fuji: { ...s.features.fuji, pos: pending.feature.pos } } } : s;
      f.poly(flat(featureWorld(pf, "fuji"))).stroke({ width: px(1.5), color: 0xffffff, alpha: 0.9 }).fill({ color: 0xffffff, alpha: s.step >= 3 ? 0.25 : 0 });
      const c = P(featureWorldPos(pf, "fuji")); f.poly([c[0], c[1] - px(9), c[0] - px(8), c[1] + px(6), c[0] + px(8), c[1] + px(6)]).fill({ color: 0xc8483a }).stroke({ width: px(1), color: 0xffffff });
      this.overlay.addChild(f);
    }
    if (s.layers.ridges) {
      const rg = new Graphics();
      for (const key of ["sw", "ne"] as const) {
        const line = pending?.ridge?.key === key ? pending.ridge.pts : s.ridges[key];
        if (line && line.length > 1) { rg.moveTo(...P(line[0])); for (const q of line.slice(1)) rg.lineTo(...P(q)); rg.stroke({ width: px(5), color: key === "sw" ? 0x7a4a2a : 0x8a3a5a, alpha: 0.85, cap: "round", join: "round" }); }
        if (line && s.step === 3) for (const q of line) rg.circle(...P(q), px(3.5)).fill({ color: 0xffffff }).stroke({ width: px(1), color: 0x333333 });
      }
      this.overlay.addChild(rg);
    }
    if (s.layers.cities) this.drawCities(s, t, showTerrain, px);
  }
  private drawHydro(t: TerrainResult, s: ProjectState, px: (n: number) => number) {
    if (s.layers.rivers) {
      const buckets: Graphics[] = [new Graphics(), new Graphics(), new Graphics()];
      for (let i = 0; i < t.streams.length; i += 5) {
        const w = t.streams[i + 4], b = buckets[w < 1.5 ? 0 : w < 3 ? 1 : 2];
        b.moveTo(t.streams[i], -t.streams[i + 1]).lineTo(t.streams[i + 2], -t.streams[i + 3]);
      }
      const minBucket = this.view.zoom < 0.35 ? 2 : this.view.zoom < 0.8 ? 1 : 0;   // national view: only the big rivers
      buckets.forEach((b, n) => { if (n < minBucket) { b.destroy(); return; } b.stroke({ width: px(1 + n * 1.1), color: 0x3a82d0, alpha: 0.95, cap: "round" }); this.base.addChild(b); });
    }
    if (s.layers.borders) {
      const g = new Graphics();
      for (let i = 0; i < t.borders.length; i += 4) g.moveTo(t.borders[i], -t.borders[i + 1]).lineTo(t.borders[i + 2], -t.borders[i + 3]);
      g.stroke({ width: px(1.1), color: 0x5b1f6e, alpha: 0.9, cap: "round" }); this.base.addChild(g);
    }
  }
  private drawCities(s: ProjectState, t: TerrainResult | null, showTerrain: boolean, px: (n: number) => number) {
    const g = new Graphics(), z = this.view.zoom;
    let list: { name: string; p: Vec; cap: boolean }[];
    if (showTerrain && t) list = t.cities.map((c) => ({ name: c.name, p: c.pos, cap: c.kind === "capital" }));
    else list = JAPAN.cities.map((c) => { const id = (c.island === "okinawa" ? "kyushu" : c.island) as IslandId; return { name: c.name, p: realToWorld(id, s.bodies[id], c.pos), cap: c.kind === "capital" }; });
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
