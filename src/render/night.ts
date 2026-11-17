/**
 * Stage 41 #2: the night view's drawing. One dark sheet over the map and ONE sprite of light (a canvas the size of the world's own grid, stretched with linear filtering so the cells blend into a glow), added on top: two display objects in all,
 * redrawn only when asked (the app asks once when it is switched on, once a game year, and when the world changes) -- never per frame. The light itself comes from src/sim/night41.ts; nothing here touches the game.
 */
import { Container, Graphics, Sprite, Texture } from "pixi.js";
import { nightColour, type NightField } from "../sim/night41";

export interface NightGeom { x0: number; y0: number; cell: number }
/** Issue #88: the size of the grains of light. 100 = the continuous glow (one stretched sprite, as before); below that the same field is drawn as separate GRAINS -- up to five per 5 km cell by how bright the cell is, at fixed pseudo-random places in it --
 *  whose radius grows with the setting (0.35 km at 0 up to 3.2 km at 99) and is never under `GRAIN_MIN_PX` on the screen, so a lone light can be found at any zoom. Only the drawing changes: the field, the game and the save are the same at every setting. */
export const GRAIN_MIN_PX = 0.9, GRAIN_MAX_DOTS = 26000;
export const grainRadiusKm = (size: number) => 0.35 + 2.85 * Math.pow(Math.max(0, Math.min(99, size)) / 99, 1.6);
const hash = (k: number, i: number) => { let h = Math.imul(k + 1, 0x9e3779b1) ^ Math.imul(i + 7, 0x85ebca6b); h ^= h >>> 15; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 13; return (h >>> 0) / 4294967296; };
/** The grains of a field: [x km, y km, brightness 0..1] each (pure; the same field gives the same grains). */
export function grainsOf(f: NightField, g: NightGeom, maxDots = GRAIN_MAX_DOTS): number[] {
  const cells: number[] = []; let want = 0; for (let k = 0; k < f.v.length; k++) { const x = f.v[k]; if (x < 0.012) continue; cells.push(k); want += Math.max(1, Math.min(5, Math.ceil(x * 5))); }
  const thin = want > maxDots ? maxDots / want : 1, out: number[] = [];
  for (const k of cells) { const x = f.v[k], n = Math.max(1, Math.min(5, Math.ceil(x * 5))), i0 = k % f.nx, j0 = (k / f.nx) | 0;
    for (let i = 0; i < n; i++) { if (thin < 1 && i > 0 && hash(k, 100 + i) > thin) continue; out.push(g.x0 + (i0 + 0.12 + 0.76 * hash(k, i * 2)) * g.cell, g.y0 + (j0 + 0.12 + 0.76 * hash(k, i * 2 + 1)) * g.cell, Math.min(1, 0.35 + x * (0.55 + 0.25 * hash(k, 50 + i)))); } }
  return out;
}
export class NightLayer {
  readonly container = new Container(); private sheet = new Graphics(); private light: Sprite | null = null; private canvas: HTMLCanvasElement | null = null; on = false;
  /** 0..100 (100 = continuous glow) */ size = 100; private dots = new Graphics(); private grains: number[] = []; private lastZoom = 1; dotsDrawn = 0;
  constructor() { this.container.visible = false; this.sheet.rect(-1e5, -1e5, 2e5, 2e5).fill({ color: 0x03050d, alpha: 0.9 }); this.container.addChild(this.sheet); this.dots.blendMode = "add"; this.container.addChild(this.dots); }
  setOn(v: boolean) { this.on = v; this.container.visible = v; if (v) this.redraw(this.lastZoom); }
  /** Paint the field into the canvas and (re)place the sprite in world coordinates (y up, drawn as -y like every other layer). */
  setSize(size: number, zoom: number) { this.size = Math.max(0, Math.min(100, Math.round(size))); this.redraw(zoom); }
  /** Draw the grains for this zoom (called when the size or the zoom changed, and after a new field). */
  redraw(zoom: number) {
    this.lastZoom = zoom; const cont = this.size >= 100; if (this.light) this.light.visible = cont; this.dots.visible = !cont; this.dots.clear(); this.dotsDrawn = 0; if (cont || !this.on) return;
    const r = Math.max(grainRadiusKm(this.size), GRAIN_MIN_PX / Math.max(0.02, zoom)), gr = this.grains;
    for (let i = 0; i < gr.length; i += 3) { const b = gr[i + 2], [cr, cg, cb] = nightColour(b); this.dots.circle(gr[i], -gr[i + 1], r).fill({ color: (cr << 16) | (cg << 8) | cb, alpha: Math.min(1, 0.45 + 0.55 * b) }); this.dotsDrawn++; }
  }
  update(f: NightField, g: NightGeom) {
    this.grains = grainsOf(f, g);
    if (!this.canvas || this.canvas.width !== f.nx || this.canvas.height !== f.ny) { this.canvas = document.createElement("canvas"); this.canvas.width = f.nx; this.canvas.height = f.ny; this.light?.destroy({ texture: true }); this.light = null; }
    const c = this.canvas.getContext("2d")!, img = c.createImageData(f.nx, f.ny);
    for (let j = 0; j < f.ny; j++) for (let i = 0; i < f.nx; i++) { const x = f.v[j * f.nx + i], o = ((f.ny - 1 - j) * f.nx + i) * 4; if (x < 0.004) continue; const [r, gg, b] = nightColour(x); img.data[o] = r; img.data[o + 1] = gg; img.data[o + 2] = b; img.data[o + 3] = Math.round(255 * Math.min(1, 0.25 + x * 1.1)); }
    c.putImageData(img, 0, 0);
    const tex = Texture.from(this.canvas); tex.source.scaleMode = "linear"; tex.source.update();
    if (!this.light) { this.light = new Sprite(tex); this.light.blendMode = "add"; this.container.addChild(this.light); } else { this.light.texture = tex; }
    this.light.position.set(g.x0, -(g.y0 + f.ny * g.cell)); this.light.scale.set(g.cell); this.redraw(this.lastZoom);
  }
  destroy() { this.light?.destroy({ texture: true }); this.container.destroy({ children: true }); }
}
