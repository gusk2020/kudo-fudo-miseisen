/** Save format v2: { map, sim } with integrity checks. v1 (map only) is migrated, never rejected. Nothing here throws. */
import { checkIntegrity } from "../sim/network";
import { DIAL_KEYS, composeDials } from "../sim/eras";
import { defaultPolicy } from "../sim/policy";
import { hashString } from "../sim/engine";
import type { SimState } from "../sim/types";
import type { World } from "../sim/world";
import { parseState } from "./save";
import type { ProjectState } from "./types";
import { ISLAND_IDS } from "./types";

export const SAVE_VERSION = 2;
/** Hash of everything that defines the finished map (not view prefs or step). Changes whenever the map is edited. */
export function mapStateHash(s: ProjectState): string {
  return hashString(JSON.stringify([s.seed, ISLAND_IDS.map((id) => s.bodies[id]), s.features.biwa, s.features.fuji, s.ridges.sw, s.ridges.ne, ...(s.islands ? ["islands"] : []), ...(s.capital ? ["capital", s.capital] : [])]));   // the extras are appended only when set, so a save made before them hashes exactly as it did
}
export interface GameSave { format: "kudo-fudo-miseisen"; schemaVersion: 2; savedAt: number; map: ProjectState; mapHash: string; sim: SimState | null }
export function makeSave(map: ProjectState, sim: SimState | null): GameSave {
  return { format: "kudo-fudo-miseisen", schemaVersion: 2, savedAt: Date.now(), map, mapHash: mapStateHash(map), sim };
}
const monthYear = (r: any) => (Number.isInteger(r.startYear) ? r.startYear : 1950) + Math.floor((Number.isInteger(r.month) ? r.month : 0) / 12);
const fin = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const isRec = (x: unknown): x is Record<string, any> => !!x && typeof x === "object" && !Array.isArray(x);

/** All-or-nothing: a road network is either fully trustworthy or not loaded at all (it is quarantined, not repaired). */
export function sanitizeSim(raw: unknown): { sim: SimState | null; problems: string[] } {
  const no = (m: string) => ({ sim: null, problems: [m] });
  if (!isRec(raw)) return no("道路データの形式が不正です");
  if (raw.schemaVersion !== 1 && raw.schemaVersion !== 2 && raw.schemaVersion !== 3) return no(`道路データのバージョン(${String(raw.schemaVersion)})に対応していません`);
  if (typeof raw.mapHash !== "string" || typeof raw.terrainHash !== "string") return no("道路データに地図の照合情報がありません");
  if (!Number.isInteger(raw.month) || raw.month < 0 || raw.month > 12 * 1000 || !Number.isInteger(raw.rngState) || !Number.isInteger(raw.startYear)) return no("道路データの時刻が不正です");
  for (const k of ["nodes", "edges", "routes", "projects", "cities", "next", "macro", "routeCounters"]) if (!isRec(raw[k])) return no(`道路データの${k}が不正です`);
  for (const n of Object.values<any>(raw.nodes)) if (!isRec(n) || typeof n.id !== "string" || !Number.isInteger(n.cell) || !Array.isArray(n.pos) || !fin(n.pos[0]) || !fin(n.pos[1])) return no("ノードが不正です");
  for (const e of Object.values<any>(raw.edges)) {
    if (!isRec(e) || typeof e.id !== "string" || typeof e.a !== "string" || typeof e.b !== "string" || !Array.isArray(e.cells) || e.cells.length < 2 || !e.cells.every((c: unknown) => Number.isInteger(c) && (c as number) >= 0)) return no("道路区間が不正です");
    for (const f of ["lengthKm", "quality", "weathering", "built", "maxGradePct", "traffic", "lowYears"]) if (!fin(e[f])) return no("道路区間の数値が不正です");
    if (typeof e.open !== "boolean" || typeof e.lost !== "boolean" || !["unpaved", "gravel", "paved"].includes(e.surface)) return no("道路区間の状態が不正です");
  }
  for (const r of Object.values<any>(raw.routes)) if (!isRec(r) || !Array.isArray(r.edges) || !["national", "ken", "fu", "jnr", "priv"].includes(r.grade) || !Number.isInteger(r.number)) return no("路線が不正です");
  for (const p of Object.values<any>(raw.projects)) if (!isRec(p) || !Array.isArray(p.edgeIds) || !Array.isArray(p.chain) || !fin(p.costBu)) return no("建設計画が不正です");
  // v1 -> v2: fill the fields added by the road-evolution rework with neutral defaults (the network itself is kept as saved)
  for (const e of Object.values<any>(raw.edges)) {
    e.standard = ["rural", "standard", "highgrade"].includes(e.standard) ? e.standard : "rural"; e.state = ["open", "dormant", "closed", "lost"].includes(e.state) ? e.state : e.lost ? "lost" : e.open ? "open" : "closed";
    for (const f of ["through", "local", "peakThrough", "zeroYears", "reviveYears", "congYears", "throughDropYears"]) if (!fin(e[f])) e[f] = 0;
    if (!fin(e.freight)) e.freight = 0; if (e.mode !== "rail") delete e.mode; if (e.op !== undefined && typeof e.op !== "string") delete e.op;
    if (typeof e.nick !== "boolean") e.nick = false; if (typeof e.region !== "string") e.region = ""; if (!Array.isArray(e.hist)) e.hist = []; if (!Array.isArray(e.bypassOf)) e.bypassOf = []; if (!Array.isArray(e.bypassedBy)) e.bypassedBy = [];
  }
  for (const r of Object.values<any>(raw.routes)) { if (!Array.isArray(r.oldEdges)) r.oldEdges = []; if (typeof r.nick !== "boolean") r.nick = false; if (r.mode !== "rail") { delete r.mode; r.name = `${{ national: "国道", ken: "県道", fu: "府道" }[r.grade as "national"]}${r.number}号`; } else if (typeof r.name !== "string") r.name = `${r.opName ?? "鉄道"}${r.number}号線`; }
  for (const p of Object.values<any>(raw.projects)) { if (typeof p.region !== "string") p.region = ""; if (!Array.isArray(p.replaces)) p.replaces = []; if (typeof p.kind !== "string") p.kind = "new"; }
  for (const n of Object.values<any>(raw.nodes)) void n;
  if (!isRec(raw.settlements)) raw.settlements = {}; if (!Array.isArray(raw.links)) raw.links = []; if (!Array.isArray(raw.snaps)) raw.snaps = []; if (!isRec(raw.regionShare)) raw.regionShare = {};
  if (!isRec(raw.operators)) raw.operators = { jnr: { id: "jnr", name: "国鉄", kind: "jnr", since: 1950, note: "国有の鉄道" } };
  if (!Array.isArray(raw.mods)) raw.mods = [];
  raw.era = typeof raw.era === "string" ? raw.era : "kobun";
  if (!isRec(raw.dials)) raw.dials = composeDials({ era: raw.era, mods: raw.mods }, monthYear(raw));
  raw.mods = (raw.mods as unknown[]).filter((m: any) => isRec(m) && typeof m.id === "string" && fin(m.from) && fin(m.until) && isRec(m.d) && Object.values(m.d).every(fin));
  if (!DIAL_KEYS.every((k) => fin(raw.dials[k]))) raw.dials = composeDials({ era: raw.era, mods: raw.mods }, monthYear(raw));
  if (raw.stage3 === true && !(isRec(raw.policy) && fin(raw.policy.points) && Array.isArray(raw.policy.history) && ["priority", "idleAuto", "auto"].includes(raw.policy.mode) && (raw.policy.pending === null || (isRec(raw.policy.pending) && Number.isInteger(raw.policy.pending.year))))) raw.policy = defaultPolicy(); if (raw.stage3 !== true) { delete raw.stage3; delete raw.policy; }
  if (raw.tech !== undefined && !(isRec(raw.tech) && fin(raw.tech.k) && raw.tech.k >= 1 && raw.tech.k <= 4)) delete raw.tech;
  // Issue #13: the era timeline is kept only if it is well formed; otherwise the game simply continues as a single-era game (never refused)
  if (raw.kaigen !== undefined) {
    const k = raw.kaigen, okE = (e: any) => isRec(e) && typeof e.name === "string" && e.name.length > 0 && e.name.length < 12 && Number.isInteger(e.start) && ["heisei", "shubun", "shoka"].includes(e.stance);
    if (!(isRec(k) && Array.isArray(k.eras) && k.eras.length >= 1 && k.eras.length < 40 && k.eras.every(okE) && Number.isInteger(k.next) && Number.isInteger(k.nextIdx) && (k.pending === null || (isRec(k.pending) && Number.isInteger(k.pending.year) && Array.isArray(k.pending.cands) && k.pending.cands.length > 0 && k.pending.cands.every((c: any) => isRec(c) && typeof c.name === "string" && ["heisei", "shubun", "shoka"].includes(c.stance)))))) delete raw.kaigen;
  }
  raw.schemaVersion = 3;
  const sim = { ...raw, events: Array.isArray(raw.events) ? raw.events : [], stats: Array.isArray(raw.stats) ? raw.stats : [], skippedMonths: fin(raw.skippedMonths) ? raw.skippedMonths : 0, lastWallMs: fin(raw.lastWallMs) ? raw.lastWallMs : 0, speed: [0, 1, 5, 20].includes(raw.speed) ? raw.speed : 0, ceremonyDone: raw.ceremonyDone === true } as unknown as SimState;
  const bad = checkIntegrity(sim); if (bad.length) return no(`道路網の整合性エラー: ${bad[0]}`);
  return { sim, problems: [] };
}
/** After the world exists: every cell must be real land on this map. */
export function validateSimAgainstWorld(sim: SimState, w: World, terrainHash: string): string | null {
  if (sim.terrainHash !== terrainHash) return "地形が保存時と一致しません(地形ハッシュ不一致)";
  for (const e of Object.values(sim.edges)) for (const c of e.cells) if (c >= w.N || w.t.land[c] !== 1) return `道路が地形の外にあります(${e.id})`;
  for (const n of Object.values(sim.nodes)) if (n.cell >= w.N) return "ノードが地形の外にあります";
  return null;
}
export interface ParsedSave { map: ProjectState; sim: SimState | null; quarantine: unknown | null; problems: string[]; ok: boolean; migratedFrom: 1 | 2 | null }
export function parseSave(input: unknown): ParsedSave {
  let raw: any = input; const problems: string[] = [];
  if (typeof input === "string") { try { raw = JSON.parse(input); } catch { const d = parseState(null); return { map: d.state, sim: null, quarantine: null, problems: ["JSONとして読めません"], ok: false, migratedFrom: null }; } }
  if (isRec(raw) && raw.schemaVersion >= 2 && isRec(raw.map)) {
    const m = parseState(raw.map); problems.push(...m.problems);
    if (raw.schemaVersion > SAVE_VERSION) problems.push(`新しいバージョン(v${raw.schemaVersion})のデータです。読める範囲だけ読み込みます`);
    if (raw.sim == null) return { map: m.state, sim: null, quarantine: null, problems, ok: m.ok, migratedFrom: 2 };
    const s = sanitizeSim(raw.sim);
    if (!s.sim) return { map: m.state, sim: null, quarantine: raw.sim, problems: [...problems, ...s.problems, "道路データは読み込まず退避しました"], ok: m.ok, migratedFrom: 2 };
    const h = mapStateHash(m.state);
    if (!m.state.finalized || s.sim.mapHash !== h || (typeof raw.mapHash === "string" && raw.mapHash !== h)) return { map: m.state, sim: null, quarantine: raw.sim, problems: [...problems, "地図が道路データの保存時と一致しないため、道路は読み込まず退避しました"], ok: m.ok, migratedFrom: 2 };
    return { map: m.state, sim: s.sim, quarantine: null, problems, ok: m.ok, migratedFrom: 2 };
  }
  const m = parseState(raw);   // v1: the map alone (possibly wrapped by the v1 exporter)
  return { map: m.state, sim: null, quarantine: null, problems: m.problems, ok: m.ok, migratedFrom: m.ok ? 1 : null };
}
export function exportGame(save: GameSave, extra?: Record<string, unknown>): string { return JSON.stringify({ ...save, savedAt: Date.now(), ...extra }, null, 1); }

// ---- IndexedDB (best effort) ----
const DB = "kfm-stage1", STORE = "saves";
function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => { if (typeof indexedDB === "undefined") return rej(new Error("no indexedDB")); const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(STORE); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
async function tx<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((res, rej) => { const q = f(db.transaction(STORE, mode).objectStore(STORE)); q.onsuccess = () => { res(q.result); db.close(); }; q.onerror = () => { rej(q.error); db.close(); }; });
}
export async function putRaw(key: string, value: unknown): Promise<boolean> { try { await tx("readwrite", (s) => s.put(JSON.stringify(value), key)); return true; } catch { return false; } }
export async function getRaw(key: string): Promise<string | undefined> { try { return await tx<string | undefined>("readonly", (s) => s.get(key) as IDBRequest<string | undefined>); } catch { return undefined; } }
export async function saveGame(name: string, save: GameSave): Promise<boolean> { return putRaw(name, { savedAt: save.savedAt, save }); }
export interface LoadedGame extends ParsedSave { savedAt: number }
/** Reads v2 slots and legacy v1 slots ({savedAt,state}); a v1 slot is migrated in memory and rewritten as v2 on the next save. */
export async function loadGame(name: string): Promise<LoadedGame | null> {
  try {
    const v = await tx<string | undefined>("readonly", (s) => s.get(name) as IDBRequest<string | undefined>); if (!v) return null;
    const j = JSON.parse(v), p = parseSave(j.save ?? j.state ?? j); return p.ok ? { ...p, savedAt: j.savedAt ?? 0 } : null;
  } catch { return null; }
}
export async function listSlots(): Promise<string[]> { try { return (await tx<IDBValidKey[]>("readonly", (s) => s.getAllKeys())).map(String); } catch { return []; } }
