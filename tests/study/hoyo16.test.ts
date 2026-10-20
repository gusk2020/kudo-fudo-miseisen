import { it } from "vitest";
import { writeFileSync } from "node:fs";
import { realToLonLat } from "../../src/core/data";
import { realWorld } from "../unit/simhelp";
import { mainStraitLinks } from "../../src/sim/ferry";
import { waterLinks } from "../../src/sim/waterlink";
const on = process.env.STUDY === "1";
(on ? it : it.skip)("hoyo", () => {
  const { w } = realWorld(true, true), out: string[] = [];
  // Saganoseki 131.88E 33.24N ; Sadamisaki 132.01E 33.34N
  const near = (lon: number, lat: number) => { let b = -1, bd = 1e9; const pos = (w as any).lonLatToCell; return { b, bd, pos }; };
  void near;
  const cells: Record<number, number[]> = {};
  for (let k = 0; k < w.N; k++) if (w.t.land[k] === 1) { const l = w.lm[k]; (cells[l] ??= []).push(k); }
  const sizes = Object.entries(cells).map(([l, c]) => [l, c.length, w.t.island[c[0]]]).sort((a: any, b: any) => b[1] - a[1]);
  out.push("masses (lm,cells,island): " + JSON.stringify(sizes.slice(0, 20)));
  const links = waterLinks(w), main = mainStraitLinks(w, links);
  out.push("main: " + main.map((l) => `${l.id} km=${l.km} lm ${l.lmA}-${l.lmB}`).join(" | "));
  for (let k = 0; k < w.N; k++) { const ll = realToLonLat(w.cellPos(k)); if (ll[0] > 131.5 && ll[0] < 132.5 && ll[1] > 32.9 && ll[1] < 33.7 && w.t.land[k] === 1) out.push(`cell ${k} lm${w.lm[k]} isl${w.t.island[k]} ${ll[0].toFixed(3)},${ll[1].toFixed(3)} pref${w.t.pref[k]}`); }
  out.push("cell km " + w.t.grid.cell);
  writeFileSync("/tmp/claude-0/hoyo16.txt", out.join("\n"));
}, 600000);
