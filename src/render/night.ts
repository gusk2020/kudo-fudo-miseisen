/**
 * Stage 41 #2: the night view's drawing. One dark sheet over the map and ONE sprite of light (a canvas the size of the world's own grid, stretched with linear filtering so the cells blend into a glow), added on top: two display objects in all,
 * redrawn only when asked (the app asks once when it is switched on, once a game year, and when the world changes) -- never per frame. The light itself comes from src/sim/night41.ts; nothing here touches the game.
 */
import { Container, Graphics, Sprite, Texture } from "pixi.js";
import { nightColour, type NightField } from "../sim/night41";

export interface NightGeom { x0: number; y0: number; cell: number }
export class NightLayer {
  readonly container = new Container(); private sheet = new Graphics(); private light: Sprite | null = null; private canvas: HTMLCanvasElement | null = null; on = false;
  constructor() { this.container.visible = false; this.sheet.rect(-1e5, -1e5, 2e5, 2e5).fill({ color: 0x03050d, alpha: 0.9 }); this.container.addChild(this.sheet); }
  setOn(v: boolean) { this.on = v; this.container.visible = v; }
  /** Paint the field into the canvas and (re)place the sprite in world coordinates (y up, drawn as -y like every other layer). */
  update(f: NightField, g: NightGeom) {
    if (!this.canvas || this.canvas.width !== f.nx || this.canvas.height !== f.ny) { this.canvas = document.createElement("canvas"); this.canvas.width = f.nx; this.canvas.height = f.ny; this.light?.destroy({ texture: true }); this.light = null; }
    const c = this.canvas.getContext("2d")!, img = c.createImageData(f.nx, f.ny);
    for (let j = 0; j < f.ny; j++) for (let i = 0; i < f.nx; i++) { const x = f.v[j * f.nx + i], o = ((f.ny - 1 - j) * f.nx + i) * 4; if (x < 0.004) continue; const [r, gg, b] = nightColour(x); img.data[o] = r; img.data[o + 1] = gg; img.data[o + 2] = b; img.data[o + 3] = Math.round(255 * Math.min(1, 0.25 + x * 1.1)); }
    c.putImageData(img, 0, 0);
    const tex = Texture.from(this.canvas); tex.source.scaleMode = "linear"; tex.source.update();
    if (!this.light) { this.light = new Sprite(tex); this.light.blendMode = "add"; this.container.addChild(this.light); } else { this.light.texture = tex; }
    this.light.position.set(g.x0, -(g.y0 + f.ny * g.cell)); this.light.scale.set(g.cell);
  }
  destroy() { this.light?.destroy({ texture: true }); this.container.destroy({ children: true }); }
}
