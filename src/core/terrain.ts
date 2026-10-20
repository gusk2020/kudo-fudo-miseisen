/** Deterministic terrain/hydrology/prefecture generation on a regular world grid. Pure: no DOM, no rendering. */
import { localToWorld, realToWorld } from "./body";
import { BODY_DEFS, EXTRA, EXTRA_IDS, JAPAN, realToLonLat, TOWNS } from "./data";
import { MinHeap } from "./heap";
import { dist, pointSegDist, rot as rotv } from "./geom";
import { fbm, hashArrays } from "./rng";
import { featureWorldPos } from "./state";
import { featureScales, featureWorld, FUJI_RADIUS_KM, fujiHeightFactor } from "./validate";
import type { IslandId, ProjectState, Vec } from "./types";
import { ISLAND_IDS } from "./types";

export interface RiverInfo { id: string; mouth: Vec; lengthKm: number; path: Vec[]; accCells: number }
export interface CityOut { id: string; name: string; kind: string; pref: string | null; pos: Vec; moved: boolean; elevM: number; prefIndex: number }
export interface TerrainResult {
  grid: { x0: number; y0: number; cell: number; nx: number; ny: number };
  land: Uint8Array;        // 0 sea, 1 land, 2 lake
  island: Uint8Array;      // 0 none, 1.. = ISLAND_IDS index + 1
  elev: Float32Array;      // metres; sea = negative depth for shading
  pref: Uint8Array;        // 0 none, 1.. = index in JAPAN.prefectures + 1 (see prefOrder)
  plains: Uint8Array;
  ridge: Float32Array;     // 0..1 closeness to a drawn ridge
  barrier: Float32Array;   // Stage 11: 0..1 construction barrier = drawn ranges and the Fuji cone (see the world's pathfinder)
  streams: Float32Array;   // x1,y1,x2,y2,widthCells per segment
  borders: Float32Array;   // x1,y1,x2,y2 per segment
  rivers: RiverInfo[];
  cities: CityOut[];
  /** Stage 16: the provincial towns, placed like the cities but kept OUT of the terrain hash and of `cities`: only a world built with towns (games made from Stage 16 on) adds them. */
  towns?: CityOut[];
  prefOrder: string[];
  stats: Record<string, number>;
  warnings: string[];
  hash: string;
}

export const GRID_MAX = 700;
export const RIVER_AREA_KM2 = 2200;

export function sampleDem(dem: Int16Array, real: Vec): number {
  const m = JAPAN.dem, [lon, lat] = realToLonLat(real);
  const fx = (lon - m.lon0) / m.dLon, fy = (m.lat0 - lat) / m.dLat;
  const x0 = Math.max(0, Math.min(m.w - 2, Math.floor(fx))), y0 = Math.max(0, Math.min(m.h - 2, Math.floor(fy)));
  const tx = Math.max(0, Math.min(1, fx - x0)), ty = Math.max(0, Math.min(1, fy - y0));
  const g = (x: number, y: number) => dem[y * m.w + x];
  return (g(x0, y0) * (1 - tx) + g(x0 + 1, y0) * tx) * (1 - ty) + (g(x0, y0 + 1) * (1 - tx) + g(x0 + 1, y0 + 1) * tx) * ty;
}

function fillPolygon(poly: Vec[], x0: number, y0: number, cell: number, nx: number, ny: number, fn: (i: number, j: number) => void) {
  let ymin = Infinity, ymax = -Infinity;
  for (const q of poly) { ymin = Math.min(ymin, q[1]); ymax = Math.max(ymax, q[1]); }
  const j0 = Math.max(0, Math.ceil((ymin - y0) / cell - 0.5)), j1 = Math.min(ny - 1, Math.floor((ymax - y0) / cell - 0.5));
  for (let j = j0; j <= j1; j++) {
    const y = y0 + (j + 0.5) * cell, xs: number[] = [];
    for (let k = 0, n = poly.length; k < n; k++) {
      const a = poly[k], b = poly[(k + 1) % n];
      if ((a[1] > y) !== (b[1] > y)) xs.push(a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.ceil((xs[k] - x0) / cell - 0.5)), i1 = Math.min(nx - 1, Math.floor((xs[k + 1] - x0) / cell - 0.5));
      for (let i = i0; i <= i1; i++) fn(i, j);
    }
  }
}

const N8: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];

/**
 * Stage 10: the high massifs of the real 飛騨山脈 (北アルプス, key "ne") and 赤石山脈 (南アルプス, key "sw"), as rough crest lines (lon/lat) with the half-width of
 * the high ground (CORE km, fully levelled) and of the transition (EDGE km, blended back to the DEM). Rough lines, not survey data -- the same ones the 実アルプス
 * button draws, extended a little to cover each massif's ends. Mt. Fuji (some 50 km from the southern line) and Lake Biwa are far outside either zone.
 */
/** Stage 11: height of the Fuji cone at which its barrier field reaches 1 (below it the field falls off linearly down to the foot). */
export const FUJI_BARRIER_FULL_M = 1500;
export const REAL_ALPS: Record<"ne" | "sw", { line: [number, number][]; core: number; edge: number }> = {
  ne: { line: [[137.70, 36.95], [137.76, 36.76], [137.62, 36.58], [137.65, 36.34], [137.55, 36.11], [137.52, 36.0]], core: 12, edge: 30 },
  sw: { line: [[138.24, 35.80], [138.23, 35.78], [138.24, 35.67], [138.10, 35.60], [138.14, 35.45], [138.10, 35.33], [138.06, 35.22]], core: 10, edge: 28 },
};
/** Inside a zone the ground becomes the level of the land around it (an inverse-distance average of the ring of land just outside the zone -- smooth in
 * position, so neither gaps nor steps), plus low rolling hills; the transition blends smoothly back to the original. The new level never exceeds 1,030 m (900 + hills). */
function levelRealAlps(key: "ne" | "sw", s: ProjectState, elev: Float32Array, land: Uint8Array, g: { x0: number; y0: number; cell: number; nx: number; ny: number }, seed: number) {
  const z = REAL_ALPS[key], pts = z.line.map(([lon, lat]) => realToWorld("honshu", s.bodies.honshu, [(lon - JAPAN.proj.lon0) * JAPAN.proj.kmPerDegLon, (lat - JAPAN.proj.lat0) * JAPAN.proj.kmPerDegLat]));
  const { x0, y0, cell, nx, ny } = g, src = Float32Array.from(elev), RING = 12, R = z.edge + RING;
  const crest = (p: Vec) => { let d = Infinity; for (let q = 0; q + 1 < pts.length; q++) d = Math.min(d, pointSegDist(p, pts[q], pts[q + 1])); return d; };
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity; for (const p of pts) { bx0 = Math.min(bx0, p[0]); bx1 = Math.max(bx1, p[0]); by0 = Math.min(by0, p[1]); by1 = Math.max(by1, p[1]); }
  const zone: { k: number; p: Vec; d: number }[] = [], ring: { p: Vec; e: number }[] = [];
  for (let j = Math.max(0, Math.floor((by0 - R - y0) / cell)); j <= Math.min(ny - 1, Math.ceil((by1 + R - y0) / cell)); j++)
    for (let i = Math.max(0, Math.floor((bx0 - R - x0) / cell)); i <= Math.min(nx - 1, Math.ceil((bx1 + R - x0) / cell)); i++) {
      const k = j * nx + i; if (land[k] !== 1) continue; const p: Vec = [x0 + (i + 0.5) * cell, y0 + (j + 0.5) * cell], d = crest(p);
      if (d < z.edge) zone.push({ k, p, d }); else if (d <= R) ring.push({ p, e: src[k] });
    }
  if (!ring.length) return;
  for (const { k, p, d } of zone) {
    let sw = 0, se = 0; for (const r of ring) { const q = 1 / ((p[0] - r.p[0]) ** 2 + (p[1] - r.p[1]) ** 2 + 400); sw += q; se += q * r.e; }
    const base = Math.min(900, se / sw), hills = 70 * (fbm(seed + 31, p[0] / 22, p[1] / 22) - 0.5) * 2, flat = Math.max(30, base + 60 + hills);
    const t = d <= z.core ? 0 : (d - z.core) / (z.edge - z.core), wgt = t * t * (3 - 2 * t);   // 0 inside the core, smoothstep to 1 at the outer edge
    elev[k] = flat * (1 - wgt) + src[k] * wgt;   // a gorge inside the massif is filled to the new level too (the massif and its valleys go together)
  }
}

export function generateTerrain(s: ProjectState, dem: Int16Array, progress: (p: number, msg: string) => void = () => {}): TerrainResult {
  const warnings: string[] = [];
  const seed = s.seed >>> 0;
  // ---- grid ----
  const parts: { id: IslandId; idx: number; polys: Vec[][] }[] = ISLAND_IDS.map((id, idx) => ({ id, idx: idx + 1, polys: BODY_DEFS[id].parts.map((p) => p.map((q) => localToWorld(s.bodies[id], q))) }));
  // Issue #13: the extra islands share the real-km frame (world = real, since no body is placed or deformed); they take island numbers after the four bodies
  const extras = s.islands ? EXTRA_IDS.map((id, i) => ({ id, idx: ISLAND_IDS.length + 1 + i, polys: EXTRA.islands[id].parts })) : [];
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  for (const b of parts) for (const p of b.polys) for (const q of p) { bx0 = Math.min(bx0, q[0]); bx1 = Math.max(bx1, q[0]); by0 = Math.min(by0, q[1]); by1 = Math.max(by1, q[1]); }
  const pad = 40;
  const cell = Math.max(5, Math.ceil((Math.max(bx1 - bx0, by1 - by0) + 2 * pad) / GRID_MAX));
  const x0 = Math.floor((bx0 - pad) / cell) * cell, y0 = Math.floor((by0 - pad) / cell) * cell;
  const nx = Math.ceil((bx1 + pad - x0) / cell), ny = Math.ceil((by1 + pad - y0) / cell), N = nx * ny;
  const cx = (i: number) => x0 + (i + 0.5) * cell, cy = (j: number) => y0 + (j + 0.5) * cell;
  const idxOf = (p: Vec) => { const i = Math.floor((p[0] - x0) / cell), j = Math.floor((p[1] - y0) / cell); return i < 0 || j < 0 || i >= nx || j >= ny ? -1 : j * nx + i; };

  // ---- land mask ----
  progress(0.05, "陸地");
  const land = new Uint8Array(N), island = new Uint8Array(N);
  for (const b of parts) for (const p of b.polys) fillPolygon(p, x0, y0, cell, nx, ny, (i, j) => { land[j * nx + i] = 1; island[j * nx + i] = b.idx; });
  for (const b of extras) for (const p of b.polys) fillPolygon(p, x0, y0, cell, nx, ny, (i, j) => { land[j * nx + i] = 1; island[j * nx + i] = b.idx; });

  // ---- elevation: the source DEM follows the warp (mesh splat) ----
  progress(0.15, "標高");
  const elev = new Float32Array(N).fill(NaN);
  const STEP = 3;
  for (const b of parts) {
    const def = BODY_DEFS[b.id], bs = s.bodies[b.id];
    let lx0 = Infinity, ly0 = Infinity, lx1 = -Infinity, ly1 = -Infinity;
    for (const p of def.parts) for (const q of p) { lx0 = Math.min(lx0, q[0]); lx1 = Math.max(lx1, q[0]); ly0 = Math.min(ly0, q[1]); ly1 = Math.max(ly1, q[1]); }
    lx0 -= 6; ly0 -= 6; lx1 += 6; ly1 += 6;
    const mx = Math.ceil((lx1 - lx0) / STEP) + 1, my = Math.ceil((ly1 - ly0) / STEP) + 1;
    const wx = new Float64Array(mx * my), wy = new Float64Array(mx * my), ev = new Float64Array(mx * my);
    for (let j = 0; j < my; j++) for (let i = 0; i < mx; i++) {
      const q: Vec = [lx0 + i * STEP, ly0 + j * STEP], w = localToWorld(bs, q), k = j * mx + i;
      wx[k] = w[0]; wy[k] = w[1]; ev[k] = sampleDem(dem, [q[0] + def.origin[0], q[1] + def.origin[1]]);
    }
    const tri = (a: number, bb: number, c: number) => {
      const minx = Math.min(wx[a], wx[bb], wx[c]), maxx = Math.max(wx[a], wx[bb], wx[c]), miny = Math.min(wy[a], wy[bb], wy[c]), maxy = Math.max(wy[a], wy[bb], wy[c]);
      const i0 = Math.max(0, Math.ceil((minx - x0) / cell - 0.5)), i1 = Math.min(nx - 1, Math.floor((maxx - x0) / cell - 0.5));
      const j0 = Math.max(0, Math.ceil((miny - y0) / cell - 0.5)), j1 = Math.min(ny - 1, Math.floor((maxy - y0) / cell - 0.5));
      const d = (wy[bb] - wy[c]) * (wx[a] - wx[c]) + (wx[c] - wx[bb]) * (wy[a] - wy[c]);
      if (Math.abs(d) < 1e-9) return;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const k = j * nx + i; if (island[k] !== b.idx) continue;
        const px = cx(i), py = cy(j);
        const l1 = ((wy[bb] - wy[c]) * (px - wx[c]) + (wx[c] - wx[bb]) * (py - wy[c])) / d;
        const l2 = ((wy[c] - wy[a]) * (px - wx[c]) + (wx[a] - wx[c]) * (py - wy[c])) / d, l3 = 1 - l1 - l2;
        if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;
        elev[k] = l1 * ev[a] + l2 * ev[bb] + l3 * ev[c];
      }
    };
    for (let j = 0; j < my - 1; j++) for (let i = 0; i < mx - 1; i++) { const a = j * mx + i, bb = a + 1, c = a + mx, e = c + 1; tri(a, bb, c); tri(bb, e, c); }
  }
  for (const b of extras) { for (let k = 0; k < N; k++) if (island[k] === b.idx) elev[k] = sampleDem(dem, [cx(k % nx), cy((k / nx) | 0)]); }
  // chamfer distance from sea inside land (km) and from land outside (km)
  const chamfer = (src: (k: number) => boolean): Float32Array => {
    const d = new Float32Array(N).fill(1e9);
    for (let k = 0; k < N; k++) if (src(k)) d[k] = 0;
    const fw: [number, number, number][] = [[-1, 0, 1], [0, -1, 1], [-1, -1, 1.414], [1, -1, 1.414]], bw: [number, number, number][] = [[1, 0, 1], [0, 1, 1], [1, 1, 1.414], [-1, 1, 1.414]];
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) for (const [di, dj, w] of fw) { const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= nx || b >= ny) continue; const v = d[b * nx + a] + w; if (v < d[j * nx + i]) d[j * nx + i] = v; }
    for (let j = ny - 1; j >= 0; j--) for (let i = nx - 1; i >= 0; i--) for (const [di, dj, w] of bw) { const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= nx || b >= ny) continue; const v = d[b * nx + a] + w; if (v < d[j * nx + i]) d[j * nx + i] = v; }
    for (let k = 0; k < N; k++) d[k] = d[k] * cell;
    return d;
  };
  const inland = chamfer((k) => land[k] === 0);
  const offshore = chamfer((k) => land[k] !== 0);
  // uncovered land cells: nearest covered value (rare, folded edges)
  for (let k = 0; k < N; k++) if (land[k] && Number.isNaN(elev[k])) {
    const i = k % nx, j = (k / nx) | 0; let found = NaN;
    for (let r = 1; r < 6 && Number.isNaN(found); r++) for (const [di, dj] of N8) { const a = i + di * r, b = j + dj * r; if (a >= 0 && b >= 0 && a < nx && b < ny && !Number.isNaN(elev[b * nx + a])) { found = elev[b * nx + a]; break; } }
    elev[k] = Number.isNaN(found) ? 5 : found;
  }
  for (let k = 0; k < N; k++) {
    if (land[k]) {
      const i = k % nx, j = (k / nx) | 0;
      const e = Math.max(elev[k], 2 + 0.4 * inland[k]);
      const amp = 35 + 0.07 * e;
      elev[k] = Math.max(2, e + (fbm(seed, cx(i) / 28, cy(j) / 28) - 0.5) * 2 * amp);
    } else elev[k] = -(25 + 14 * Math.pow(offshore[k], 0.85));
  }

  // ---- Stage 10: the real Alps removed (a range the player takes over is drawn anew; the original massif must not stay as a second barrier) ----
  for (const key of ["ne", "sw"] as const) if (s.alpsRemoved?.[key]) levelRealAlps(key, s, elev, land, { x0, y0, cell, nx, ny }, seed);

  // ---- hand-drawn ridges ----
  progress(0.3, "山脈");
  const ridge = new Float32Array(N);
  const W = 18;
  for (const key of ["sw", "ne"] as const) {
    for (const line of [s.ridges[key], ...(s.ridgeExtra?.[key] ?? [])]) { if (!line || line.length < 2) continue;
    for (let sg = 0; sg + 1 < line.length; sg++) {
      const a = line[sg], b = line[sg + 1];
      const i0 = Math.max(0, Math.floor((Math.min(a[0], b[0]) - 3 * W - x0) / cell)), i1 = Math.min(nx - 1, Math.ceil((Math.max(a[0], b[0]) + 3 * W - x0) / cell));
      const j0 = Math.max(0, Math.floor((Math.min(a[1], b[1]) - 3 * W - y0) / cell)), j1 = Math.min(ny - 1, Math.ceil((Math.max(a[1], b[1]) + 3 * W - y0) / cell));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const k = j * nx + i; if (!land[k]) continue;
        const d = pointSegDist([cx(i), cy(j)], a, b), f = Math.exp(-((d / W) ** 2));
        if (f > ridge[k]) ridge[k] = f;
      }
    }
    }
  }
  for (let k = 0; k < N; k++) if (ridge[k] > 0.01 && land[k]) {
    const i = k % nx, j = (k / nx) | 0, h = 1100 + 1100 * fbm(seed + 7, cx(i) / 55, cy(j) / 55);
    elev[k] = Math.min(3300, elev[k] + h * ridge[k]);
  }

  // Stage 11: the construction-barrier field = the drawn ranges plus the cone of Mt. Fuji (foot included). `ridge` itself stays the drawn ranges only: it also steers the rivers, and the terrain hash must not move for older saves
  const barrier = Float32Array.from(ridge);
  // ---- Mt. Fuji ----
  let fujiTop = -1;
  {
    const c = featureWorldPos(s, "fuji"), a0 = s.features.fuji.rot, [fkx, fky] = featureScales(s.features.fuji), fk = Math.max(fkx, fky), summit = JAPAN.fuji.summitM * fujiHeightFactor(s.features.fuji);
    const r0 = FUJI_RADIUS_KM * fk * 1.25;
    const ff = s.features.fuji, fujiEdited = !!(ff.pos || ff.scale !== undefined || ff.scaleY !== undefined || ff.height !== undefined);
    if (ff.pos || ff.scale !== undefined || ff.scaleY !== undefined || ff.height !== undefined) {
      // Issue #18: an edited Fuji leaves no relief behind at the real site -- the DEM's own cone is levelled to its surroundings
      const o = realToWorld("honshu", s.bodies.honshu, JAPAN.fuji.center), R = FUJI_RADIUS_KM * 1.7, ring: number[] = [];
      for (let q = 0; q < 16; q++) { const kk = idxOf([o[0] + Math.cos(q * Math.PI / 8) * R * 1.15, o[1] + Math.sin(q * Math.PI / 8) * R * 1.15]); if (kk >= 0 && land[kk] === 1) ring.push(elev[kk]); }
      ring.sort((p, q) => p - q); const base = ring.length ? ring[Math.floor(ring.length * 0.3)] : 100;
      for (let j = Math.max(0, Math.floor((o[1] - R - y0) / cell)); j <= Math.min(ny - 1, Math.ceil((o[1] + R - y0) / cell)); j++)
        for (let i = Math.max(0, Math.floor((o[0] - R - x0) / cell)); i <= Math.min(nx - 1, Math.ceil((o[0] + R - x0) / cell)); i++) {
          const k = j * nx + i; if (land[k] !== 1 || Number.isNaN(elev[k])) continue; const d = Math.hypot(cx(i) - o[0], cy(j) - o[1]);
          if (d < R) elev[k] = Math.min(elev[k], base + 500 * (d / R));
        }
    }
    for (let j = Math.max(0, Math.floor((c[1] - r0 - y0) / cell)); j <= Math.min(ny - 1, Math.ceil((c[1] + r0 - y0) / cell)); j++)
      for (let i = Math.max(0, Math.floor((c[0] - r0 - x0) / cell)); i <= Math.min(nx - 1, Math.ceil((c[0] + r0 - x0) / cell)); i++) {
        const k = j * nx + i; if (land[k] !== 1) continue;
        // the cone is stretched along its own axes (sx, sy) and then turned: take the cell into the cone's own frame, undo the stretch, and measure against the fixed silhouette
        const dx = cx(i) - c[0], dy = cy(j) - c[1]; let d: number, R: number;
        if (fkx === fky) { d = Math.hypot(dx, dy); const th = Math.atan2(dy, dx) - a0; R = FUJI_RADIUS_KM * fkx * (1 + 0.1 * Math.sin(3 * th + 1) + 0.06 * Math.sin(5 * th + 2)); }   // uniform size: the exact arithmetic every older save was made with (terrain hashes must not move)
        else { const u = (dx * Math.cos(a0) + dy * Math.sin(a0)) / fkx, v = (-dx * Math.sin(a0) + dy * Math.cos(a0)) / fky, th = Math.atan2(v, u); d = Math.hypot(u, v); R = FUJI_RADIUS_KM * (1 + 0.1 * Math.sin(3 * th + 1) + 0.06 * Math.sin(5 * th + 2)); }
        if (d < R) {
          const e = 250 + (summit - 250) * Math.pow(1 - d / R, 1.5); if (e > elev[k]) elev[k] = e;
          // Stage 11: a Fuji the player has moved, stretched or re-heightened is a construction barrier like a drawn range, foot included (it follows the mountain wherever it stands). The untouched Fuji is not: the real Tokaido skirts its foot, and the calibration of every game on the real map rests on that
          if (fujiEdited) { const foot = Math.min(1, e / FUJI_BARRIER_FULL_M); if (foot > barrier[k]) barrier[k] = foot; }
        }
      }
    const kc = idxOf(c);
    if (kc >= 0 && land[kc] === 1) { elev[kc] = summit; fujiTop = kc; }
  }

  // ---- Lake Biwa ----
  const lakeCells: number[] = [];
  fillPolygon(featureWorld(s, "biwa"), x0, y0, cell, nx, ny, (i, j) => { const k = j * nx + i; if (land[k] === 1) { land[k] = 2; lakeCells.push(k); } });
  if (lakeCells.length) {
    let lvl = Infinity;
    for (const k of lakeCells) { const i = k % nx, j = (k / nx) | 0; for (const [di, dj] of N8) { const a = i + di, b = j + dj; if (a >= 0 && b >= 0 && a < nx && b < ny && land[b * nx + a] === 1) lvl = Math.min(lvl, elev[b * nx + a]); } }
    if (!isFinite(lvl)) lvl = 85;
    for (const k of lakeCells) elev[k] = Math.max(2, lvl - 1);
  } else warnings.push("琵琶湖がグリッド上に1セルも取れませんでした");

  // ---- hydrology: priority flood gives a drainage tree that never climbs ----
  progress(0.5, "河川");
  const recv = new Int32Array(N).fill(-2);     // -2 unvisited/sea, -1 drains to sea
  const filled = new Float32Array(N);
  const order: number[] = [];
  const heap = new MinHeap(4096);
  const seen = new Uint8Array(N);
  for (let k = 0; k < N; k++) if (land[k]) {
    const i = k % nx, j = (k / nx) | 0; let coastal = false;
    for (const [di, dj] of N8) { const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= nx || b >= ny || !land[b * nx + a]) { coastal = true; break; } }
    if (coastal) { seen[k] = 1; recv[k] = -1; filled[k] = elev[k]; heap.push(elev[k], k); }
  }
  while (heap.size) {
    const { val: c } = heap.pop(); order.push(c);
    const i = c % nx, j = (c / nx) | 0;
    for (const [di, dj] of N8) {
      const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= nx || b >= ny) continue;
      const n = b * nx + a; if (!land[n] || seen[n] || island[n] !== island[c]) continue;
      seen[n] = 1; recv[n] = c; filled[n] = Math.max(elev[n], filled[c] + 1e-3); heap.push(filled[n], n);
    }
  }
  const acc = new Float32Array(N), bestChild = new Int32Array(N).fill(-1), bestAcc = new Float32Array(N);
  for (const k of order) acc[k] = 1;
  for (let t = order.length - 1; t >= 0; t--) {
    const c = order[t], r = recv[c]; if (r < 0) continue;
    acc[r] += acc[c];
    if (acc[c] > bestAcc[r]) { bestAcc[r] = acc[c]; bestChild[r] = c; }
  }
  const T = Math.max(8, Math.round(RIVER_AREA_KM2 / (cell * cell)));
  // carve: a stream never runs uphill on the final surface (valleys are cut down to the upstream level)
  for (let t = order.length - 1; t >= 0; t--) { const c = order[t], r = recv[c]; if (r >= 0 && acc[c] >= T && elev[r] > elev[c]) elev[r] = Math.max(1, elev[c]); }
  const streamSeg: number[] = [];
  for (const c of order) if (acc[c] >= T) {
    const r = recv[c];
    const px = cx(c % nx), py = cy((c / nx) | 0);
    if (r >= 0) streamSeg.push(px, py, cx(r % nx), cy((r / nx) | 0), Math.log2(acc[c] / T + 1));
    else {
      // last step towards the open water: head outwards from the cell
      const i = c % nx, j = (c / nx) | 0; let best = 0, bd: [number, number] = [0, 0];
      for (const [di, dj] of N8) { const a = i + di, b = j + dj; const sea = a < 0 || b < 0 || a >= nx || b >= ny || !land[b * nx + a]; if (sea && best === 0) { best = 1; bd = [di, dj]; } }
      streamSeg.push(px, py, px + bd[0] * cell, py + bd[1] * cell, Math.log2(acc[c] / T + 1));
    }
  }
  const rivers: RiverInfo[] = [];
  const mouths = order.filter((c) => recv[c] === -1 && acc[c] >= T).sort((a, b) => acc[b] - acc[a] || a - b);
  mouths.forEach((m, n) => {
    const path: Vec[] = []; let c = m, length = 0;
    while (c >= 0 && acc[c] >= T) { path.push([cx(c % nx), cy((c / nx) | 0)]); c = bestChild[c]; }
    path.reverse();
    for (let q = 1; q < path.length; q++) length += dist(path[q - 1], path[q]);
    rivers.push({ id: `riv.${String(n + 1).padStart(3, "0")}`, mouth: path[path.length - 1], lengthKm: Math.round(length), path, accCells: acc[m] });
  });

  // ---- plains ----
  const plains = new Uint8Array(N);
  let plainCount = 0, landCount = 0;
  for (let k = 0; k < N; k++) if (land[k] === 1) {
    landCount++;
    const i = k % nx, j = (k / nx) | 0;
    const ex = (elev[j * nx + Math.min(nx - 1, i + 1)] - elev[j * nx + Math.max(0, i - 1)]) / (2 * cell * 1000);
    const ey = (elev[Math.min(ny - 1, j + 1) * nx + i] - elev[Math.max(0, j - 1) * nx + i]) / (2 * cell * 1000);
    if (elev[k] < 220 && Math.hypot(ex, ey) < 0.012) { plains[k] = 1; plainCount++; }
  }

  // ---- prefectures: weighted Dijkstra where mountains, rivers and lakes are expensive ----
  progress(0.7, "府県");
  const prefs = JAPAN.prefectures, pref = new Uint8Array(N);
  const bodyOf = (isl: string): IslandId => (isl === "okinawa" ? "kyushu" : (isl as IslandId));
  const seedCell = (p: Vec): number => {
    let k = idxOf(p); if (k < 0) k = 0;
    const i0 = k % nx, j0 = (k / nx) | 0;
    for (let r = 0; r < 12; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
      const a = i0 + di, b = j0 + dj; if (a < 0 || b < 0 || a >= nx || b >= ny) continue;
      const n = b * nx + a; if (land[n] === 1 && pref[n] === 0) return n;
    }
    return -1;
  };
  const meanW = prefs.reduce((a, p) => a + p.weight, 0) / prefs.length;
  const cost = new Float32Array(N);
  for (let k = 0; k < N; k++) if (land[k]) {
    const i = k % nx, j = (k / nx) | 0;
    const ex = (elev[j * nx + Math.min(nx - 1, i + 1)] - elev[j * nx + Math.max(0, i - 1)]) / (2 * cell * 1000);
    const ey = (elev[Math.min(ny - 1, j + 1) * nx + i] - elev[Math.max(0, j - 1) * nx + i]) / (2 * cell * 1000);
    cost[k] = 1 + 25 * Math.hypot(ex, ey) + 7 * ridge[k] + (acc[k] >= T ? 1.5 : 0) + (acc[k] >= 4 * T ? 3 : 0) + (land[k] === 2 ? 3 : 0);
  }
  const D = new Float64Array(N).fill(Infinity);
  const dh = new MinHeap(4096);
  const mult = new Float64Array(prefs.length);
  const seedMoved: number[] = [];
  prefs.forEach((p, n) => {
    const w = realToWorld(bodyOf(p.island), s.bodies[bodyOf(p.island)], p.seed);
    const k = seedCell(w);
    mult[n] = Math.pow(meanW / p.weight, 0.7);
    if (k < 0) { warnings.push(`${p.name}の県庁位置が陸地に置けません`); return; }
    pref[k] = n + 1; D[k] = 0; dh.push(0, k); seedMoved.push(k);
  });
  while (dh.size) {
    const { key, val: c } = dh.pop(); if (key > D[c]) continue;
    const lab = pref[c], i = c % nx, j = (c / nx) | 0;
    for (const [di, dj] of N8) {
      const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= nx || b >= ny) continue;
      const n = b * nx + a; if (!land[n] || island[n] !== island[c]) continue;
      const nd = key + (di && dj ? 1.414 : 1) * cost[n] * mult[lab - 1];
      if (nd < D[n]) { D[n] = nd; pref[n] = lab; dh.push(nd, n); }
    }
  }
  for (const b of extras) { const pi = prefs.findIndex((q) => q.id === EXTRA.islands[b.id].pref); if (pi >= 0) for (let k = 0; k < N; k++) if (island[k] === b.idx && land[k] === 1) pref[k] = pi + 1; }
  let unassigned = 0; for (let k = 0; k < N; k++) if (land[k] && !pref[k]) unassigned++;
  if (unassigned) warnings.push(`府県に割り当たらない陸地セルが${unassigned}個あります`);
  const counts = new Int32Array(prefs.length + 1);
  for (let k = 0; k < N; k++) counts[pref[k]]++;
  prefs.forEach((p, n) => { if (counts[n + 1] < 3) warnings.push(`${p.name}が極端に小さい(${counts[n + 1]}セル)`); });
  const borders: number[] = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i; if (!land[k]) continue;
    if (i + 1 < nx && land[k + 1] && pref[k] !== pref[k + 1]) borders.push(x0 + (i + 1) * cell, y0 + j * cell, x0 + (i + 1) * cell, y0 + (j + 1) * cell);
    if (j + 1 < ny && land[k + nx] && pref[k] !== pref[k + nx]) borders.push(x0 + i * cell, y0 + (j + 1) * cell, x0 + (i + 1) * cell, y0 + (j + 1) * cell);
  }

  // ---- cities follow their island; only unsuitable sites move ----
  progress(0.9, "都市");
  const cities: CityOut[] = [];
  for (const c of s.islands ? [...JAPAN.cities, ...EXTRA.cities] : JAPAN.cities) {
    const isExtra = (EXTRA_IDS as readonly string[]).includes(c.island), b = isExtra ? "honshu" : bodyOf(c.island), w = isExtra ? c.pos : realToWorld(b, s.bodies[b], c.pos);
    let k = idxOf(w), moved = false;
    const bad = (n: number) => n < 0 || land[n] !== 1 || elev[n] > 2600;
    if (bad(k)) {
      moved = true; const i0 = k < 0 ? 0 : k % nx, j0 = k < 0 ? 0 : (k / nx) | 0; let best = -1, bd = Infinity;
      for (let r = 1; r < 30 && best < 0; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const a = i0 + di, bb = j0 + dj; if (a < 0 || bb < 0 || a >= nx || bb >= ny) continue;
        const n = bb * nx + a; if (bad(n)) continue;
        const dd = Math.hypot(cx(a) - w[0], cy(bb) - w[1]); if (dd < bd) { bd = dd; best = n; }
      }
      k = best;
    }
    if (k < 0) { warnings.push(`都市${c.name}を配置できません`); continue; }
    cities.push({ id: c.id, name: c.name, kind: c.kind, pref: c.pref, pos: moved ? [cx(k % nx), cy((k / nx) | 0)] : w, moved, elevM: Math.round(elev[k]), prefIndex: pref[k] });
  }
  // Stage 16: the towns, placed the same way (never moved far: a town on unsuitable ground is dropped rather than shifted into another town's land)
  const towns: CityOut[] = [], taken = new Set<number>(cities.map((c) => idxOf(c.pos)));
  for (const c of TOWNS) {
    const b = bodyOf(c.island), w = realToWorld(b, s.bodies[b], c.pos), k = idxOf(w);
    if (k < 0 || land[k] !== 1 || elev[k] > 2600 || taken.has(k)) continue;
    taken.add(k); towns.push({ id: c.id, name: c.name, kind: "town", pref: null, pos: w, moved: false, elevM: Math.round(elev[k]), prefIndex: pref[k] });
  }
  const movedN = cities.filter((c) => c.moved).length;
  if (movedN) warnings.push(`${movedN}都市が不適地のため局所補正されました`);

  const stats: Record<string, number> = {
    cell, nx, ny, landCells: landCount, lakeCells: lakeCells.length, riverCount: rivers.length, streamSegments: streamSeg.length / 5,
    plainFraction: landCount ? plainCount / landCount : 0, prefCount: prefs.length, prefMinCells: counts.slice(1).reduce((m, v) => Math.min(m, v), 1e9), prefMaxCells: counts.slice(1).reduce((m, v) => Math.max(m, v), 0),
    citiesMoved: movedN, fujiTopCell: fujiTop, maxElevM: elev.reduce((m, v) => (v > m ? v : m), -1e9),
  };
  const hash = hashArrays(Int16Array.from(elev, (v) => Math.round(v)), pref, land, Int16Array.from(borders), Int16Array.from(streamSeg));
  progress(1, "完了");
  return {
    grid: { x0, y0, cell, nx, ny }, land, island, elev, pref, plains, ridge, barrier, streams: Float32Array.from(streamSeg), borders: Float32Array.from(borders),
    rivers, cities, towns, prefOrder: prefs.map((p) => p.id), stats, warnings, hash,
  };
}
export { rotv as _rot };
