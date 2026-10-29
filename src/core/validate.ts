import { realToWorld, worldParts } from "./body";
import { axisFrame, featureHost, fujiCoreClear, hokkaidoOk, inKHRange, DEFAULT_MIN_SCALE, SMALL_LAND_KM2, islandsOverlap, kyushuOk, tOf, type AxisFrame } from "./constraints";
import { BODY_DEFS, EXTRA, EXTRA_IDS, ISLAND_LABEL, JAPAN } from "./data";
import { featureWorldPos } from "./state";
import { centroid, pointInPolygon, polyArea, principalAxis, rot as rotv, selfIntersections } from "./geom";
import type { IslandId, Issue, ProjectState, StepId, Vec } from "./types";
import { ISLAND_IDS } from "./types";
import { jacobianSV } from "./warp";

export const FUJI_RADIUS_KM = JAPAN.fuji.baseRadiusKm;
/** Fixed reference silhouette of the mountain base (size is fixed; only rotation is editable). */
export const FUJI_SHAPE: Vec[] = Array.from({ length: 48 }, (_, i) => {
  const a = (i / 48) * Math.PI * 2, r = FUJI_RADIUS_KM * (1 + 0.1 * Math.sin(3 * a + 1) + 0.06 * Math.sin(5 * a + 2));
  return [Math.cos(a) * r, Math.sin(a) * r] as Vec;
});
export const featureShape = (which: "biwa" | "fuji"): Vec[] => (which === "biwa" ? JAPAN.biwa.shape : FUJI_SHAPE);
/** Stage 11: the two sizes of a feature, along its own x and y axes (an absent `scaleY` is the same as `scale`). */
export const featureScales = (f: { scale?: number; scaleY?: number }): [number, number] => { const kx = f.scale ?? 1; return [kx, f.scaleY ?? kx]; };
export function featureWorld(s: ProjectState, which: "biwa" | "fuji"): Vec[] {
  const pos = featureWorldPos(s, which), a = s.features[which].rot, [kx, ky] = featureScales(s.features[which]);
  return featureShape(which).map((q) => { const r = rotv([q[0] * kx, q[1] * ky], a); return [r[0] + pos[0], r[1] + pos[1]] as Vec; });
}

/** Issue #18: Fuji's summit factor. A manual height always wins; with the `auto` link (set when the size is changed by touch) the elevation follows the size at HALF the proportion, capped at 3x (size 5x). The manual height range is separate and unchanged. */
export const FUJI_AUTO_HEIGHT_MAX = 3;   // = 1 + (5-1)/2: the body's 5x limit gives 3x. NOT the manual height range (FEATURE_LIMITS.height, 0.5-1.3x), which is a separate hand-set value
export function fujiHeightFactor(f: { scale?: number; scaleY?: number; height?: number; auto?: true }): number {
  if (f.height !== undefined) return f.height;
  if (!f.auto) return 1;
  // Stage 11: with the two axes stretched apart, the link follows the AREA-EQUIVALENT size sqrt(sx * sy) (= the plain size when the two are equal, so every older save is unchanged)
  const [kx, ky] = featureScales(f), eq = Math.sqrt(kx * ky);
  return Math.max(0.5, Math.min(FUJI_AUTO_HEIGHT_MAX, 1 + (eq - 1) / 2));
}

export interface Derived { parts: Record<IslandId, Vec[][]>; frame: AxisFrame; biwa: Vec[]; fuji: Vec[] }
export function derive(s: ProjectState): Derived {
  const parts = {} as Record<IslandId, Vec[][]>;
  for (const id of ISLAND_IDS) parts[id] = worldParts(id, s.bodies[id]);
  const neRef = rotv([Math.SQRT1_2, Math.SQRT1_2], s.bodies.honshu.place.rot);
  return { parts, frame: axisFrame(parts.honshu[0], neRef), biwa: featureWorld(s, "biwa"), fuji: featureWorld(s, "fuji") };
}

const sampleCache = new Map<IslandId, Vec[]>();
function restSamples(id: IslandId): Vec[] {
  let c = sampleCache.get(id);
  if (!c) {
    c = []; const main = BODY_DEFS[id].parts[0]; let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const q of main) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); }
    for (let y = y0; y <= y1; y += 12) for (let x = x0; x <= x1; x += 12) if (pointInPolygon([x, y], main)) c.push([x, y]);
    sampleCache.set(id, c);
  }
  return c;
}
const restAspect = (id: IslandId) => { const p = principalAxis(BODY_DEFS[id].parts[0]); return p.sMajor / p.sMinor; };

export interface WarpHealth { minDet: number; maxCond: number; areaRatio: number; aspectRatio: number; crossings: number }
export function warpHealth(s: ProjectState, id: IslandId, parts?: Vec[][]): WarpHealth {
  const bs = s.bodies[id], P = parts ?? worldParts(id, bs);
  let minDet = Infinity, maxCond = 1;
  for (const q of restSamples(id)) { const j = jacobianSV(bs.ops, q); minDet = Math.min(minDet, j.det); maxCond = Math.max(maxCond, j.smin > 1e-9 ? j.smax / j.smin : 1e9); }
  if (!isFinite(minDet)) minDet = 1;
  const area = Math.abs(polyArea(P[0])) / (bs.place.scale * bs.place.scale);
  const pa = principalAxis(P[0]);
  return { minDet, maxCond, areaRatio: area / BODY_DEFS[id].mainArea, aspectRatio: pa.sMajor / pa.sMinor / restAspect(id), crossings: P.reduce((n, p) => n + selfIntersections(p), 0) };
}

export function validate(s: ProjectState): Issue[] {
  const out: Issue[] = [];
  const add = (step: StepId, severity: Issue["severity"], code: string, msg: string) => out.push({ step, severity, code, msg });
  const d = derive(s);
  for (const id of ISLAND_IDS) {
    const step: StepId = id === "honshu" ? "honshu" : "islands", name = ISLAND_LABEL[id];
    const h = warpHealth(s, id, d.parts[id]);
    if (h.crossings > 0) add(step, "error", `${id}.selfx`, `${name}の海岸線が自己交差しています`);
    if (h.minDet <= 0.05) add(step, "error", `${id}.fold`, `${name}が折り重なっています(変形が強すぎ)`);
    else if (h.maxCond > 6) add(step, "error", `${id}.twist`, `${name}が極端にねじれています`);
    if (h.areaRatio < 0.3 || h.areaRatio > 4) add(step, "error", `${id}.degenerate`, `${name}の面積が極端に縮退/膨張しています`);
    if (id === "honshu" && h.aspectRatio < 0.5) add(step, "error", "honshu.elongation", "本州の細長い形が失われています");
    if (s.bodies[id].place.scale < 0.4 || s.bodies[id].place.scale > 2.5) add(step, "warn", `${id}.scale`, `${name}の拡大率が大きく偏っています`);
  }
  // honshu is the reference for everything after it
  const hk = d.parts.hokkaido[0], ky = d.parts.kyushu[0], sk = d.parts.shikoku[0];
  if (!hokkaidoOk(d.frame, hk)) add("islands", "error", "hokkaido.side", "北海道が本州の北東半分より北東側にありません");
  if (!kyushuOk(d.frame, ky)) add("islands", "error", "kyushu.side", "九州が本州の南西半分より南西側にありません");
  const kc = centroid(ky), hc = centroid(hk);
  if (!inKHRange(kc, hc, centroid(sk))) add("islands", "error", "shikoku.range", "四国の中心が北海道〜九州の軸範囲外です");
  for (let i = 0; i < ISLAND_IDS.length; i++) for (let j = i + 1; j < ISLAND_IDS.length; j++)
    if (islandsOverlap(d.parts[ISLAND_IDS[i]], d.parts[ISLAND_IDS[j]])) add("islands", "error", `overlap.${ISLAND_IDS[i]}.${ISLAND_IDS[j]}`, `${ISLAND_LABEL[ISLAND_IDS[i]]}と${ISLAND_LABEL[ISLAND_IDS[j]]}が重なっています`);
  const lands: Vec[][] = s.real ? [] : [d.parts.honshu[0]]; if (s.real) for (const id of ISLAND_IDS) lands.push(...d.parts[id]);
  if (s.real && s.islands) for (const id of EXTRA_IDS) lands.push(...EXTRA.islands[id].parts);
  for (const which of ["biwa", "fuji"] as const) {
    const nm = which === "biwa" ? "琵琶湖" : "富士山", host = featureHost(lands, d[which]);
    if (!host) add("features", "error", `${which}.coast`, `${nm}の中心が陸地にないか、同じ陸地に収まっていないか、海岸線に近すぎます(面積1.2倍で判定)`);
    else if (s.real && Math.min(...featureScales(s.features[which])) < DEFAULT_MIN_SCALE && Math.abs(polyArea(host)) > SMALL_LAND_KM2) add("features", "error", `${which}.minscale`, `${nm}を0.5倍より小さくできるのは沖縄など小さな島だけです`);
  }
  if (!s.real) for (const which of ["biwa", "fuji"] as const) if (!inKHRange(kc, hc, centroid(d[which]))) add("features", "error", `${which}.range`, `${which === "biwa" ? "琵琶湖" : "富士山"}が北海道〜九州の軸範囲外です`);
  if (!fujiCoreClear(d.biwa, d.fuji)) add("features", "error", "features.fujicore", "琵琶湖が富士山の山頂近くまで届いています(裾野が重なるのはかまいません)");   // Stage 27: the foot may overlap; the lake wins there, the summit stays
  if (!s.real) for (const k of ["sw", "ne"] as const) {
    const r = s.ridges[k], nm = k === "sw" ? "南西側の山脈" : "北東側の山脈";
    if (!r || r.length < 2) { add("features", "error", `ridge.${k}.missing`, `${nm}が未描画です`); continue; }
    if ((s.ridgeExtra?.[k] ?? []).some((l) => l.some((p) => !pointInPolygon(p, d.parts.honshu[0])))) add("features", "error", `ridge.${k}.outside`, `${nm}が本州の外に出ています`);
    if (r.some((p) => !pointInPolygon(p, d.parts.honshu[0]))) add("features", "error", `ridge.${k}.outside`, `${nm}が本州の外に出ています`);
    const mt = r.reduce((a, p) => a + tOf(d.frame, p), 0) / r.length;
    if (k === "sw" ? mt > 0.5 : mt < 0.5) add("features", "error", `ridge.${k}.half`, `${nm}が本州の${k === "sw" ? "南西" : "北東"}半分にありません`);
  }
  return out;
}
export const errorsFor = (issues: Issue[], step: StepId) => issues.filter((i) => i.step === step && i.severity === "error");
/** First step index (>=0) that has an error: the earliest step that must be fixed. */
export function stepsWithErrors(issues: Issue[]): Set<StepId> { return new Set(issues.filter((i) => i.severity === "error").map((i) => i.step)); }
export { realToWorld };
