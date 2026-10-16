import { prefOfSeat } from "./seat";
import { defaultBody, defaultState, SCHEMA_VERSION } from "./state";
import type { BodyState, FeatureState, Op, ProjectState, Vec } from "./types";
import { ISLAND_IDS, STEPS } from "./types";

const fin = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const isVec = (v: unknown): v is Vec => Array.isArray(v) && v.length === 2 && fin(v[0]) && fin(v[1]);
const COORD_LIMIT = 20000;
const okVec = (v: unknown): v is Vec => isVec(v) && Math.abs(v[0]) < COORD_LIMIT && Math.abs(v[1]) < COORD_LIMIT;

function cleanOp(o: any): Op | null {
  if (!o || typeof o !== "object" || !okVec(o.c) || !fin(o.r) || o.r <= 0 || o.r > 5000) return null;
  if (o.t === "pull" && okVec(o.d)) return { t: "pull", c: o.c, d: o.d, r: o.r };
  if (o.t === "bulge" && fin(o.k) && Math.abs(o.k) <= 0.9) return { t: "bulge", c: o.c, r: o.r, k: o.k };
  return null;
}
function cleanBody(b: any, id: (typeof ISLAND_IDS)[number], problems: string[]): BodyState {
  const d = defaultBody(id);
  if (!b || typeof b !== "object") { problems.push(`${id}: 欠損のため初期値`); return d; }
  const ops = Array.isArray(b.ops) ? (b.ops.map(cleanOp).filter(Boolean) as Op[]) : [];
  if (Array.isArray(b.ops) && ops.length !== b.ops.length) problems.push(`${id}: 破損した変形操作を${b.ops.length - ops.length}件除外`);
  const p = b.place;
  const place = p && okVec(p.pos) && fin(p.rot) && fin(p.scale) && p.scale > 0.05 && p.scale < 20 ? { pos: p.pos, rot: p.rot, scale: p.scale } : (problems.push(`${id}: 配置が不正のため初期値`), d.place);
  return { ops, place };
}
/** Allowed range of the size controls (Lake Biwa / Mt. Fuji): wide enough to see, narrow enough to keep the lake off the coast and the summit above sea level. */
export const FEATURE_LIMITS = { scale: [0.2, 5] as [number, number], height: [0.5, 1.3] as [number, number] };
function cleanFeature(f: any): FeatureState {
  return { pos: okVec(f?.pos) ? f.pos : null, rot: fin(f?.rot) ? f.rot : 0, ...(fin(f?.scale) && f.scale !== 1 ? { scale: Math.max(FEATURE_LIMITS.scale[0], Math.min(FEATURE_LIMITS.scale[1], f.scale)) } : {}), ...(f?.auto === true ? { auto: true as const } : {}), ...(fin(f?.height) && f.height !== 1 ? { height: Math.max(FEATURE_LIMITS.height[0], Math.min(FEATURE_LIMITS.height[1], f.height)) } : {}) };
}
function cleanLine(l: any, problems: string[], name: string): Vec[] | null {
  if (l == null) return null;
  if (!Array.isArray(l)) { problems.push(`${name}: 破損のため除外`); return null; }
  const v = l.filter(okVec);
  if (v.length !== l.length) problems.push(`${name}: 不正な点を除外`);
  return v.length >= 2 ? v : null;
}

/** Never throws: anything unusable falls back to defaults and is reported. */
export function parseState(input: unknown): { state: ProjectState; problems: string[]; ok: boolean } {
  const problems: string[] = []; const d = defaultState();
  let raw: any = input;
  if (typeof input === "string") { try { raw = JSON.parse(input); } catch { return { state: d, problems: ["JSONとして読めません"], ok: false }; } }
  if (raw && typeof raw === "object" && raw.state && typeof raw.state === "object" && raw.format === "kudo-fudo-miseisen") raw = raw.state;
  if (!raw || typeof raw !== "object") return { state: d, problems: ["データが空か形式不正です"], ok: false };
  const ver = raw.schemaVersion;
  if (!fin(ver)) problems.push("schemaVersionがありません(v1として解釈)");
  else if (ver > SCHEMA_VERSION) problems.push(`新しいバージョン(v${ver})のデータです。読める範囲だけ読み込みます`);
  const s: ProjectState = {
    schemaVersion: SCHEMA_VERSION,
    seed: fin(raw.seed) ? Math.floor(raw.seed) >>> 0 : d.seed,
    step: fin(raw.step) ? Math.max(0, Math.min(STEPS.length - 1, Math.floor(raw.step))) : 0,
    bodies: Object.fromEntries(ISLAND_IDS.map((id) => [id, cleanBody(raw.bodies?.[id], id, problems)])) as ProjectState["bodies"],
    features: { biwa: cleanFeature(raw.features?.biwa), fuji: cleanFeature(raw.features?.fuji) },
    ridges: { sw: cleanLine(raw.ridges?.sw, problems, "南西山脈"), ne: cleanLine(raw.ridges?.ne, problems, "北東山脈") },
    finalized: raw.finalized === true,
    ...(raw.real === true ? { real: true } : {}),
    ...(raw.islands === true ? { islands: true } : {}),
    ...(prefOfSeat(raw.capital) ? { capital: raw.capital } : {}),   // a prefecture id, or the city id an older save kept
    ...(prefOfSeat(raw.subCapital) ? { subCapital: raw.subCapital } : {}),
    ...(prefOfSeat(raw.palace) ? { palace: raw.palace } : {}),
    ...(okVec(raw.palacePos) ? { palacePos: raw.palacePos } : {}),
    layers: { ...d.layers },
  };
  if (raw.layers && typeof raw.layers === "object") for (const k of Object.keys(d.layers)) if (typeof raw.layers[k] === "boolean") s.layers[k] = raw.layers[k];
  return { state: s, problems, ok: true };
}
export function exportJson(state: ProjectState, extra?: Record<string, unknown>): string {
  return JSON.stringify({ format: "kudo-fudo-miseisen", schemaVersion: SCHEMA_VERSION, savedAt: new Date().toISOString(), state, ...extra }, null, 1);
}

// ---- IndexedDB (best effort: private mode or quota errors must never stop the app) ----
const DB = "kfm-stage1", STORE = "saves";
function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    if (typeof indexedDB === "undefined") return rej(new Error("no indexedDB"));
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function tx<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((res, rej) => { const q = f(db.transaction(STORE, mode).objectStore(STORE)); q.onsuccess = () => { res(q.result); db.close(); }; q.onerror = () => { rej(q.error); db.close(); }; });
}
export async function saveSlot(name: string, state: ProjectState): Promise<boolean> {
  try { await tx("readwrite", (s) => s.put(JSON.stringify({ savedAt: Date.now(), state }), name)); return true; } catch { return false; }
}
export async function loadSlot(name: string): Promise<{ state: ProjectState; problems: string[]; savedAt: number } | null> {
  try {
    const v = await tx<string | undefined>("readonly", (s) => s.get(name) as IDBRequest<string | undefined>);
    if (!v) return null;
    const j = JSON.parse(v), p = parseState(j.state);
    return p.ok ? { state: p.state, problems: p.problems, savedAt: j.savedAt ?? 0 } : null;
  } catch { return null; }
}
export async function listSlots(): Promise<string[]> {
  try { return (await tx<IDBValidKey[]>("readonly", (s) => s.getAllKeys())).map(String); } catch { return []; }
}
